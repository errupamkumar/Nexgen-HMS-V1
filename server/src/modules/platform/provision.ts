/**
 * Tenant provisioning — used by the platform console, public self-signup and
 * the seed script, so every tenant starts from the same well-formed baseline.
 */
import { and, eq } from 'drizzle-orm';
import type { Tx } from '../../db/client.js';
import { departments, plans, roles, services, tenants, users } from '../../db/schema.js';
import { hashPassword } from '../../core/auth.js';
import { SYSTEM_ROLES } from '../../core/catalog.js';
import { conflict, notFound } from '../../core/errors.js';
import { defaultSettings } from '../../core/settings.js';

export interface ProvisionInput {
  code: string;
  name: string;
  type: 'clinic' | 'polyclinic' | 'hospital' | 'diagnostic' | 'nursing_home';
  planCode?: string;
  planId?: number;
  status?: 'trial' | 'active';
  trialDays?: number;
  email?: string | null;
  phone?: string | null;
  address?: string | null;
  city?: string | null;
  state?: string | null;
  admin: { fullName: string; email: string; password: string; phone?: string | null };
  primaryColor?: string;
}

const DEFAULT_DEPARTMENTS = ['General Medicine', 'Pediatrics', 'Gynecology', 'Orthopedics', 'Cardiology', 'Dermatology', 'ENT'];

export async function provisionTenant(tx: Tx, input: ProvisionInput) {
  const code = input.code.toLowerCase();
  const [existing] = await tx.select({ id: tenants.id }).from(tenants).where(eq(tenants.code, code)).limit(1);
  if (existing) throw conflict(`The organisation code "${code}" is already taken`);

  const [plan] = await tx
    .select()
    .from(plans)
    .where(input.planId ? eq(plans.id, input.planId) : eq(plans.code, input.planCode ?? 'starter'))
    .limit(1);
  if (!plan) throw notFound('Plan');

  const settings = defaultSettings();
  if (input.primaryColor) settings.profile.primaryColor = input.primaryColor;

  const status = input.status ?? 'trial';
  const trialEndsAt = status === 'trial' ? new Date(Date.now() + (input.trialDays ?? 14) * 86_400_000) : null;

  const [res] = await tx.insert(tenants).values({
    code,
    name: input.name,
    type: input.type,
    email: input.email ?? input.admin.email,
    phone: input.phone ?? null,
    address: input.address ?? null,
    city: input.city ?? null,
    state: input.state ?? null,
    planId: plan.id,
    status,
    trialEndsAt,
    settings,
    moduleOverrides: { enable: [], disable: [] },
  });
  const tenantId = res.insertId;

  await tx.insert(roles).values(
    SYSTEM_ROLES.map((r) => ({
      tenantId,
      code: r.code,
      name: r.name,
      description: r.description,
      permissions: r.permissions,
      isSystem: true,
    })),
  );
  const [adminRole] = await tx
    .select({ id: roles.id })
    .from(roles)
    .where(and(eq(roles.tenantId, tenantId), eq(roles.code, 'admin')))
    .limit(1);

  const [userRes] = await tx.insert(users).values({
    tenantId,
    roleId: adminRole.id,
    email: input.admin.email.toLowerCase(),
    passwordHash: await hashPassword(input.admin.password),
    fullName: input.admin.fullName,
    phone: input.admin.phone ?? null,
  });

  await tx.insert(departments).values(DEFAULT_DEPARTMENTS.map((name) => ({ tenantId, name })));
  await tx.insert(services).values([
    { tenantId, code: 'REG', name: 'Registration Fee', category: 'other' as const, price: 100 },
    { tenantId, code: 'DRS', name: 'Dressing', category: 'procedure' as const, price: 200 },
    { tenantId, code: 'INJ', name: 'Injection Administration', category: 'procedure' as const, price: 100 },
    { tenantId, code: 'ECG', name: 'ECG', category: 'investigation' as const, price: 300 },
    { tenantId, code: 'NURS', name: 'Nursing Charges (per day)', category: 'nursing' as const, price: 500 },
  ]);

  return { tenantId, adminUserId: userRes.insertId, plan };
}
