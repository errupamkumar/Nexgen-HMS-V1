import { Router } from 'express';
import rateLimit from 'express-rate-limit';
import { and, asc, count, desc, eq, like, or, sql } from 'drizzle-orm';
import { z } from 'zod';
import { isTest } from '../../config/env.js';
import { db } from '../../db/client.js';
import { patients, plans, tenants, users } from '../../db/schema.js';
import { authenticate, invalidateAuthCache, requirePlatformAdmin } from '../../core/auth.js';
import { MODULE_KEYS, MODULES } from '../../core/catalog.js';
import { notFound } from '../../core/errors.js';
import { resolveSettings } from '../../core/settings.js';
import { audit, likeTerm, paged, pagingSchema, pid, qcol } from '../../core/util.js';
import { provisionTenant } from './provision.js';

// ====================================================================== public
export const publicRouter = Router();

const signupLimiter = rateLimit({ windowMs: 60 * 60 * 1000, limit: isTest ? 10_000 : 10, standardHeaders: 'draft-8', legacyHeaders: false });

const tenantCode = z
  .string()
  .trim()
  .toLowerCase()
  .min(3)
  .max(30)
  .regex(/^[a-z0-9][a-z0-9-]*$/, 'lowercase letters, digits and hyphens only');

const signupSchema = z.object({
  organization: z.object({
    name: z.string().trim().min(2).max(150),
    code: tenantCode,
    type: z.enum(['clinic', 'polyclinic', 'hospital', 'diagnostic', 'nursing_home']),
    phone: z.string().trim().max(30).optional(),
    city: z.string().trim().max(80).optional(),
    state: z.string().trim().max(80).optional(),
  }),
  admin: z.object({
    fullName: z.string().trim().min(2).max(120),
    email: z.string().trim().toLowerCase().email(),
    password: z.string().min(8).max(100),
  }),
  planCode: z.string().default('professional'),
});

publicRouter.get('/plans', async (_req, res) => {
  const rows = await db.select().from(plans).where(eq(plans.isActive, true)).orderBy(asc(plans.sortOrder));
  res.json({ plans: rows, modules: MODULES });
});

/** Branding for the sign-in page of a given organisation code. */
publicRouter.get('/tenant/:code', async (req, res) => {
  const code = tenantCode.parse(req.params.code);
  const [t] = await db.select().from(tenants).where(eq(tenants.code, code)).limit(1);
  if (!t) throw notFound('Organisation');
  const s = resolveSettings(t.settings);
  res.json({
    code: t.code,
    name: t.name,
    type: t.type,
    logoUrl: s.profile.logoUrl,
    primaryColor: s.profile.primaryColor,
    tagline: s.profile.tagline,
  });
});

publicRouter.post('/signup', signupLimiter, async (req, res) => {
  const body = signupSchema.parse(req.body);
  const result = await db.transaction((tx) =>
    provisionTenant(tx, {
      ...body.organization,
      planCode: body.planCode,
      status: 'trial',
      trialDays: 14,
      admin: body.admin,
    }),
  );
  req.auth = { tenantId: result.tenantId, userId: result.adminUserId, userName: body.admin.fullName } as never;
  await audit(req, 'create', 'tenant', result.tenantId, `Self-signup: ${body.organization.name} (${body.organization.code})`);
  res.status(201).json({ tenantId: result.tenantId, code: body.organization.code, plan: result.plan.name });
});

// ====================================================================== platform owner
export const platformRouter = Router();
platformRouter.use(authenticate, requirePlatformAdmin);

platformRouter.get('/stats', async (_req, res) => {
  const byStatus = await db.select({ status: tenants.status, n: count() }).from(tenants).groupBy(tenants.status);
  const [{ n: userCount }] = await db.select({ n: count() }).from(users).where(sql`${users.tenantId} IS NOT NULL`);
  const [{ n: patientCount }] = await db.select({ n: count() }).from(patients);
  const mrrRows = await db
    .select({ mrr: sql<number>`COALESCE(SUM(${plans.priceMonthly}),0)` })
    .from(tenants)
    .innerJoin(plans, eq(plans.id, tenants.planId))
    .where(eq(tenants.status, 'active'));
  const byPlan = await db
    .select({ plan: plans.name, n: count() })
    .from(tenants)
    .innerJoin(plans, eq(plans.id, tenants.planId))
    .groupBy(plans.name);
  const recent = await db
    .select({ id: tenants.id, name: tenants.name, code: tenants.code, status: tenants.status, createdAt: tenants.createdAt })
    .from(tenants)
    .orderBy(desc(tenants.createdAt))
    .limit(8);
  res.json({
    tenantsByStatus: Object.fromEntries(byStatus.map((r) => [r.status, r.n])),
    totalTenants: byStatus.reduce((a, r) => a + r.n, 0),
    users: userCount,
    patients: patientCount,
    mrr: Number(mrrRows[0]?.mrr ?? 0),
    byPlan,
    recent,
  });
});

// ---------------- plans
const planSchema = z.object({
  code: z.string().trim().toLowerCase().min(2).max(40).regex(/^[a-z0-9_-]+$/),
  name: z.string().trim().min(2).max(100),
  description: z.string().max(500).optional().nullable(),
  priceMonthly: z.coerce.number().min(0),
  priceYearly: z.coerce.number().min(0),
  maxUsers: z.coerce.number().int().min(1).max(100000),
  maxBranches: z.coerce.number().int().min(1).max(1000),
  modules: z.array(z.enum(MODULE_KEYS as [string, ...string[]])).min(1),
  isActive: z.boolean().default(true),
  sortOrder: z.coerce.number().int().default(0),
});

platformRouter.get('/plans', async (_req, res) => {
  const rows = await db
    .select({ plan: plans, tenants: sql<number>`(SELECT COUNT(*) FROM tenants t WHERE t.plan_id = ${qcol('plans', 'id')})` })
    .from(plans)
    .orderBy(asc(plans.sortOrder));
  res.json(rows.map((r) => ({ ...r.plan, tenantCount: Number(r.tenants) })));
});

platformRouter.post('/plans', async (req, res) => {
  const body = planSchema.parse(req.body);
  const [r] = await db.insert(plans).values(body);
  await audit(req, 'create', 'plan', r.insertId, `Created plan ${body.name}`);
  res.status(201).json({ id: r.insertId });
});

platformRouter.put('/plans/:id', async (req, res) => {
  const id = pid(req);
  const body = planSchema.partial().parse(req.body);
  await db.update(plans).set(body).where(eq(plans.id, id));
  invalidateAuthCache();
  await audit(req, 'update', 'plan', id, `Updated plan ${body.name ?? id}`, body);
  res.json({ ok: true });
});

// ---------------- tenants
platformRouter.get('/tenants', async (req, res) => {
  const p = pagingSchema.extend({ status: z.string().optional() }).parse(req.query);
  const where = and(
    p.q ? or(like(tenants.name, likeTerm(p.q)), like(tenants.code, likeTerm(p.q)), like(tenants.city, likeTerm(p.q))) : undefined,
    p.status ? eq(tenants.status, p.status as 'active') : undefined,
  );
  const rows = await db
    .select({
      id: tenants.id,
      code: tenants.code,
      name: tenants.name,
      type: tenants.type,
      city: tenants.city,
      status: tenants.status,
      trialEndsAt: tenants.trialEndsAt,
      createdAt: tenants.createdAt,
      planId: tenants.planId,
      planName: plans.name,
      userCount: sql<number>`(SELECT COUNT(*) FROM users u WHERE u.tenant_id = ${qcol('tenants', 'id')})`,
      patientCount: sql<number>`(SELECT COUNT(*) FROM patients pt WHERE pt.tenant_id = ${qcol('tenants', 'id')})`,
    })
    .from(tenants)
    .innerJoin(plans, eq(plans.id, tenants.planId))
    .where(where)
    .orderBy(desc(tenants.createdAt))
    .limit(p.pageSize)
    .offset((p.page - 1) * p.pageSize);
  const [{ n }] = await db.select({ n: count() }).from(tenants).where(where);
  res.json(paged(rows.map((r) => ({ ...r, userCount: Number(r.userCount), patientCount: Number(r.patientCount) })), n, p));
});

platformRouter.get('/tenants/:id', async (req, res) => {
  const id = pid(req);
  const [t] = await db.select().from(tenants).where(eq(tenants.id, id));
  if (!t) throw notFound('Tenant');
  res.json({ ...t, settings: resolveSettings(t.settings) });
});

platformRouter.post('/tenants', async (req, res) => {
  const body = signupSchema
    .extend({ planId: z.coerce.number().int().positive(), status: z.enum(['trial', 'active']).default('active') })
    .parse(req.body);
  const result = await db.transaction((tx) =>
    provisionTenant(tx, { ...body.organization, planId: body.planId, status: body.status, admin: body.admin }),
  );
  await audit(req, 'create', 'tenant', result.tenantId, `Provisioned ${body.organization.name}`);
  res.status(201).json({ tenantId: result.tenantId });
});

platformRouter.patch('/tenants/:id', async (req, res) => {
  const id = pid(req);
  const body = z
    .object({
      name: z.string().trim().min(2).max(150).optional(),
      status: z.enum(['trial', 'active', 'suspended', 'cancelled']).optional(),
      planId: z.coerce.number().int().positive().optional(),
      trialEndsAt: z.coerce.date().nullable().optional(),
      subscriptionEndsAt: z.coerce.date().nullable().optional(),
      moduleOverrides: z
        .object({
          enable: z.array(z.enum(MODULE_KEYS as [string, ...string[]])),
          disable: z.array(z.enum(MODULE_KEYS as [string, ...string[]])),
        })
        .optional(),
    })
    .parse(req.body);
  const [t] = await db.select({ id: tenants.id }).from(tenants).where(eq(tenants.id, id));
  if (!t) throw notFound('Tenant');
  await db.update(tenants).set(body).where(eq(tenants.id, id));
  invalidateAuthCache({ tenantId: id });
  await audit(req, 'update', 'tenant', id, `Updated tenant ${id}`, body as Record<string, unknown>);
  res.json({ ok: true });
});
