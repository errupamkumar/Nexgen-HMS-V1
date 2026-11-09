/** Tenant administration: organisation settings, users, roles, audit trail, catalogue meta. */
import { Router } from 'express';
import { and, asc, count, desc, eq, gte, like, lte, ne, or, sql } from 'drizzle-orm';
import { z } from 'zod';
import { db } from '../../db/client.js';
import { auditLogs, doctors, plans, roles, tenants, users } from '../../db/schema.js';
import {
  authenticate,
  hashPassword,
  invalidateAuthCache,
  requirePermission,
  requireTenantUser,
  tctx,
} from '../../core/auth.js';
import { MODULES, PERMISSION_KEYS, PERMISSIONS } from '../../core/catalog.js';
import { badRequest, conflict, forbidden, notFound } from '../../core/errors.js';
import { resolveSettings, SETTINGS_SECTIONS, settingsSectionSchemas, type SettingsSection } from '../../core/settings.js';
import { audit, dateStr, likeTerm, paged, pagingSchema, pid, qcol } from '../../core/util.js';

export const adminRouter = Router();
adminRouter.use(authenticate, requireTenantUser);

// ------------------------------------------------------------------ meta
adminRouter.get('/meta', (_req, res) => {
  res.json({ modules: MODULES, permissions: PERMISSIONS });
});

// ------------------------------------------------------------------ settings
adminRouter.get('/settings', async (req, res) => {
  const a = tctx(req);
  const [t] = await db
    .select({ tenant: tenants, plan: plans })
    .from(tenants)
    .innerJoin(plans, eq(plans.id, tenants.planId))
    .where(eq(tenants.id, a.tenantId));
  res.json({
    organization: {
      name: t.tenant.name,
      code: t.tenant.code,
      type: t.tenant.type,
      email: t.tenant.email,
      phone: t.tenant.phone,
      address: t.tenant.address,
      city: t.tenant.city,
      state: t.tenant.state,
      country: t.tenant.country,
      status: t.tenant.status,
      trialEndsAt: t.tenant.trialEndsAt,
    },
    plan: { name: t.plan.name, code: t.plan.code, modules: t.plan.modules, maxUsers: t.plan.maxUsers },
    enabledModules: [...a.modules],
    settings: resolveSettings(t.tenant.settings),
  });
});

adminRouter.put('/settings/organization', requirePermission('settings.manage'), async (req, res) => {
  const a = tctx(req);
  const body = z
    .object({
      name: z.string().trim().min(2).max(150),
      type: z.enum(['clinic', 'polyclinic', 'hospital', 'diagnostic', 'nursing_home']),
      email: z.string().trim().email().max(150).or(z.literal('')).nullable().optional(),
      phone: z.string().trim().max(30).nullable().optional(),
      address: z.string().trim().max(300).nullable().optional(),
      city: z.string().trim().max(80).nullable().optional(),
      state: z.string().trim().max(80).nullable().optional(),
      country: z.string().trim().max(80).nullable().optional(),
    })
    .parse(req.body);
  await db.update(tenants).set(body).where(eq(tenants.id, a.tenantId));
  await audit(req, 'update', 'settings', 'organization', 'Updated organisation profile', body);
  res.json({ ok: true });
});

adminRouter.put('/settings/:section', requirePermission('settings.manage'), async (req, res) => {
  const a = tctx(req);
  const section = z.enum(SETTINGS_SECTIONS as [SettingsSection, ...SettingsSection[]]).parse(req.params.section);
  const value = settingsSectionSchemas[section].parse(req.body);
  if (section === 'patientFields') {
    const keys = (value as { key: string }[]).map((f) => f.key);
    if (new Set(keys).size !== keys.length) throw badRequest('Custom field keys must be unique');
  }
  if (section === 'locale') {
    try {
      new Intl.DateTimeFormat('en', { timeZone: (value as { timezone: string }).timezone });
    } catch {
      throw badRequest('Unknown timezone');
    }
  }
  const [t] = await db.select({ settings: tenants.settings }).from(tenants).where(eq(tenants.id, a.tenantId));
  const next = { ...(t.settings ?? {}), [section]: value };
  await db.update(tenants).set({ settings: next }).where(eq(tenants.id, a.tenantId));
  invalidateAuthCache({ tenantId: a.tenantId });
  await audit(req, 'update', 'settings', section, `Updated ${section} settings`, { [section]: value });
  res.json({ ok: true, settings: resolveSettings(next) });
});

// ------------------------------------------------------------------ roles
const roleSchema = z.object({
  name: z.string().trim().min(2).max(80),
  description: z.string().trim().max(300).nullable().optional(),
  permissions: z.array(z.enum(PERMISSION_KEYS as [string, ...string[]])).max(200),
});

adminRouter.get('/roles', requirePermission('staff.view'), async (req, res) => {
  const a = tctx(req);
  const rows = await db
    .select({
      role: roles,
      userCount: sql<number>`(SELECT COUNT(*) FROM users u WHERE u.role_id = ${qcol('roles', 'id')})`,
    })
    .from(roles)
    .where(eq(roles.tenantId, a.tenantId))
    .orderBy(asc(roles.id));
  res.json(rows.map((r) => ({ ...r.role, userCount: Number(r.userCount) })));
});

adminRouter.post('/roles', requirePermission('roles.manage'), async (req, res) => {
  const a = tctx(req);
  const body = roleSchema.parse(req.body);
  const code = body.name.toLowerCase().replace(/[^a-z0-9]+/g, '_').replace(/^_|_$/g, '').slice(0, 30) + '_' + Date.now().toString(36);
  const [r] = await db.insert(roles).values({ ...body, tenantId: a.tenantId, code, isSystem: false });
  await audit(req, 'create', 'role', r.insertId, `Created role ${body.name}`);
  res.status(201).json({ id: r.insertId });
});

adminRouter.put('/roles/:id', requirePermission('roles.manage'), async (req, res) => {
  const a = tctx(req);
  const id = pid(req);
  const body = roleSchema.parse(req.body);
  const [role] = await db.select().from(roles).where(and(eq(roles.id, id), eq(roles.tenantId, a.tenantId)));
  if (!role) throw notFound('Role');
  if (role.code === 'admin') throw forbidden('The Administrator role always has full access and cannot be edited');
  if (role.code === 'patient') throw forbidden('The patient portal role cannot be edited');
  await db.update(roles).set(body).where(eq(roles.id, id));
  invalidateAuthCache({ tenantId: a.tenantId });
  await audit(req, 'update', 'role', id, `Updated role ${body.name}`, { permissions: body.permissions });
  res.json({ ok: true });
});

adminRouter.delete('/roles/:id', requirePermission('roles.manage'), async (req, res) => {
  const a = tctx(req);
  const id = pid(req);
  const [role] = await db.select().from(roles).where(and(eq(roles.id, id), eq(roles.tenantId, a.tenantId)));
  if (!role) throw notFound('Role');
  if (role.isSystem) throw forbidden('System roles cannot be deleted');
  const [{ n }] = await db.select({ n: count() }).from(users).where(eq(users.roleId, id));
  if (n > 0) throw conflict(`This role is assigned to ${n} user(s). Reassign them first.`);
  await db.delete(roles).where(eq(roles.id, id));
  await audit(req, 'delete', 'role', id, `Deleted role ${role.name}`);
  res.json({ ok: true });
});

// ------------------------------------------------------------------ users
const userSchema = z.object({
  fullName: z.string().trim().min(2).max(120),
  email: z.string().trim().toLowerCase().email().max(150),
  phone: z.string().trim().max(30).nullable().optional(),
  roleId: z.coerce.number().int().positive(),
  doctorId: z.coerce.number().int().positive().nullable().optional(),
  status: z.enum(['active', 'inactive']).default('active'),
});

async function assertRoleAndDoctor(tenantId: number, roleId: number, doctorId?: number | null) {
  const [role] = await db.select().from(roles).where(and(eq(roles.id, roleId), eq(roles.tenantId, tenantId)));
  if (!role) throw badRequest('Unknown role');
  if (role.code === 'patient') throw badRequest('Patient portal accounts are created from the patient profile');
  if (doctorId) {
    const [d] = await db.select({ id: doctors.id }).from(doctors).where(and(eq(doctors.id, doctorId), eq(doctors.tenantId, tenantId)));
    if (!d) throw badRequest('Unknown doctor profile');
  }
  return role;
}

adminRouter.get('/users', requirePermission('staff.view'), async (req, res) => {
  const a = tctx(req);
  const p = pagingSchema.parse(req.query);
  const where = and(
    eq(users.tenantId, a.tenantId),
    ne(roles.code, 'patient'),
    p.q ? or(like(users.fullName, likeTerm(p.q)), like(users.email, likeTerm(p.q))) : undefined,
  );
  const rows = await db
    .select({
      id: users.id,
      fullName: users.fullName,
      email: users.email,
      phone: users.phone,
      status: users.status,
      roleId: users.roleId,
      roleName: roles.name,
      roleCode: roles.code,
      doctorId: users.doctorId,
      doctorName: doctors.name,
      lastLoginAt: users.lastLoginAt,
      lockedUntil: users.lockedUntil,
      createdAt: users.createdAt,
    })
    .from(users)
    .innerJoin(roles, eq(roles.id, users.roleId))
    .leftJoin(doctors, eq(doctors.id, users.doctorId))
    .where(where)
    .orderBy(asc(users.fullName))
    .limit(p.pageSize)
    .offset((p.page - 1) * p.pageSize);
  const [{ n }] = await db.select({ n: count() }).from(users).innerJoin(roles, eq(roles.id, users.roleId)).where(where);
  res.json(paged(rows, n, p));
});

adminRouter.post('/users', requirePermission('staff.manage'), async (req, res) => {
  const a = tctx(req);
  const body = userSchema.extend({ password: z.string().min(8).max(100) }).parse(req.body);
  await assertRoleAndDoctor(a.tenantId, body.roleId, body.doctorId);

  // Plan seat limit
  const [{ maxUsers }] = await db
    .select({ maxUsers: plans.maxUsers })
    .from(tenants)
    .innerJoin(plans, eq(plans.id, tenants.planId))
    .where(eq(tenants.id, a.tenantId));
  const [{ n }] = await db
    .select({ n: count() })
    .from(users)
    .innerJoin(roles, eq(roles.id, users.roleId))
    .where(and(eq(users.tenantId, a.tenantId), ne(roles.code, 'patient'), eq(users.status, 'active')));
  if (n >= maxUsers) throw forbidden(`Your plan allows ${maxUsers} active users. Upgrade to add more.`);

  const { password, ...rest } = body;
  const [r] = await db.insert(users).values({ ...rest, tenantId: a.tenantId, passwordHash: await hashPassword(password) });
  await audit(req, 'create', 'user', r.insertId, `Created user ${body.fullName} (${body.email})`);
  res.status(201).json({ id: r.insertId });
});

adminRouter.put('/users/:id', requirePermission('staff.manage'), async (req, res) => {
  const a = tctx(req);
  const id = pid(req);
  const body = userSchema.parse(req.body);
  const [u] = await db.select().from(users).where(and(eq(users.id, id), eq(users.tenantId, a.tenantId)));
  if (!u) throw notFound('User');
  await assertRoleAndDoctor(a.tenantId, body.roleId, body.doctorId);
  if (id === a.userId && body.status === 'inactive') throw badRequest('You cannot deactivate your own account');
  await db.update(users).set(body).where(eq(users.id, id));
  invalidateAuthCache({ userId: id });
  await audit(req, 'update', 'user', id, `Updated user ${body.fullName}`);
  res.json({ ok: true });
});

adminRouter.post('/users/:id/reset-password', requirePermission('staff.manage'), async (req, res) => {
  const a = tctx(req);
  const id = pid(req);
  const { password } = z.object({ password: z.string().min(8).max(100) }).parse(req.body);
  const [u] = await db.select().from(users).where(and(eq(users.id, id), eq(users.tenantId, a.tenantId)));
  if (!u) throw notFound('User');
  await db
    .update(users)
    .set({ passwordHash: await hashPassword(password), failedLogins: 0, lockedUntil: null })
    .where(eq(users.id, id));
  await audit(req, 'update', 'user', id, `Reset password for ${u.fullName}`);
  res.json({ ok: true });
});

// ------------------------------------------------------------------ audit trail
adminRouter.get('/audit', requirePermission('audit.view'), async (req, res) => {
  const a = tctx(req);
  const p = pagingSchema
    .extend({ entity: z.string().max(60).optional(), action: z.string().max(40).optional(), from: dateStr.optional(), to: dateStr.optional() })
    .parse(req.query);
  const where = and(
    eq(auditLogs.tenantId, a.tenantId),
    p.entity ? eq(auditLogs.entity, p.entity) : undefined,
    p.action ? eq(auditLogs.action, p.action) : undefined,
    p.from ? gte(auditLogs.createdAt, new Date(`${p.from}T00:00:00Z`)) : undefined,
    p.to ? lte(auditLogs.createdAt, new Date(`${p.to}T23:59:59.999Z`)) : undefined,
    p.q ? or(like(auditLogs.summary, likeTerm(p.q)), like(auditLogs.userName, likeTerm(p.q))) : undefined,
  );
  const rows = await db
    .select()
    .from(auditLogs)
    .where(where)
    .orderBy(desc(auditLogs.id))
    .limit(p.pageSize)
    .offset((p.page - 1) * p.pageSize);
  const [{ n }] = await db.select({ n: count() }).from(auditLogs).where(where);
  res.json(paged(rows, n, p));
});
