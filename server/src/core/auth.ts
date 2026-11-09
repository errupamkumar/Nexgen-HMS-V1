/**
 * Authentication, tenancy context and authorisation middleware.
 *
 * Every authenticated request resolves to an AuthContext that carries the
 * tenant, the user's permissions and the tenant's licensed modules. Route
 * handlers never trust tenant ids from the client — they read `req.auth`.
 */
import crypto from 'node:crypto';
import bcrypt from 'bcryptjs';
import jwt from 'jsonwebtoken';
import { eq } from 'drizzle-orm';
import type { NextFunction, Request, RequestHandler, Response } from 'express';
import { env } from '../config/env.js';
import { db } from '../db/client.js';
import { plans, roles, tenants, users } from '../db/schema.js';
import { MODULE_KEYS, moduleOfPermission, PERMISSION_KEYS } from './catalog.js';
import { forbidden, unauthorized } from './errors.js';
import { resolveSettings, type TenantSettings } from './settings.js';

export interface AuthContext {
  userId: number;
  userName: string;
  email: string;
  tenantId: number | null;
  tenantCode: string | null;
  isPlatformAdmin: boolean;
  roleCode: string | null;
  permissions: Set<string>;
  modules: Set<string>;
  patientId: number | null;
  doctorId: number | null;
  settings: TenantSettings | null;
}

export interface TenantAuthContext extends AuthContext {
  tenantId: number;
  tenantCode: string;
  settings: TenantSettings;
}

declare global {
  // eslint-disable-next-line @typescript-eslint/no-namespace
  namespace Express {
    interface Request {
      auth?: AuthContext;
    }
  }
}

// ------------------------------------------------------------- passwords
export const hashPassword = (plain: string) => bcrypt.hash(plain, 10);
export const verifyPassword = (plain: string, hash: string) => bcrypt.compare(plain, hash);

// ------------------------------------------------------------- tokens
interface AccessPayload {
  sub: string;
  tid: number | null;
}

export function signAccessToken(userId: number, tenantId: number | null): string {
  const payload: AccessPayload = { sub: String(userId), tid: tenantId };
  return jwt.sign(payload, env.JWT_ACCESS_SECRET, {
    expiresIn: env.ACCESS_TOKEN_TTL as jwt.SignOptions['expiresIn'],
    issuer: 'nexgen-hms',
  });
}

export function newRefreshToken(): { token: string; hash: string } {
  const token = crypto.randomBytes(48).toString('base64url');
  return { token, hash: sha256(token) };
}

export const sha256 = (s: string) => crypto.createHash('sha256').update(s).digest('hex');

// ------------------------------------------------------------- module licensing
export function enabledModules(planModules: string[], overrides?: { enable?: string[]; disable?: string[] } | null) {
  const set = new Set(planModules.filter((m) => MODULE_KEYS.includes(m)));
  for (const m of overrides?.enable ?? []) if (MODULE_KEYS.includes(m)) set.add(m);
  for (const m of overrides?.disable ?? []) set.delete(m);
  return set;
}

// ------------------------------------------------------------- context cache
// Short TTL cache so a busy desk does not hit MySQL three times per request.
// Explicitly invalidated whenever users, roles or tenants change.
const CACHE_TTL_MS = 30_000;
const contextCache = new Map<number, { at: number; ctx: AuthContext }>();

export function invalidateAuthCache(opts?: { userId?: number; tenantId?: number }) {
  if (!opts) return contextCache.clear();
  for (const [uid, entry] of contextCache) {
    if (uid === opts.userId || (opts.tenantId !== undefined && entry.ctx.tenantId === opts.tenantId)) {
      contextCache.delete(uid);
    }
  }
}

export async function loadAuthContext(userId: number): Promise<AuthContext | null> {
  const hit = contextCache.get(userId);
  if (hit && Date.now() - hit.at < CACHE_TTL_MS) return hit.ctx;

  const [row] = await db
    .select({ user: users, role: roles, tenant: tenants, plan: plans })
    .from(users)
    .leftJoin(roles, eq(roles.id, users.roleId))
    .leftJoin(tenants, eq(tenants.id, users.tenantId))
    .leftJoin(plans, eq(plans.id, tenants.planId))
    .where(eq(users.id, userId))
    .limit(1);
  if (!row || row.user.status !== 'active') return null;

  const isPlatformAdmin = row.user.isPlatformAdmin;
  const perms = isPlatformAdmin ? [] : row.role?.permissions ?? [];
  const ctx: AuthContext = {
    userId: row.user.id,
    userName: row.user.fullName,
    email: row.user.email,
    tenantId: row.user.tenantId,
    tenantCode: row.tenant?.code ?? null,
    isPlatformAdmin,
    roleCode: row.role?.code ?? null,
    permissions: new Set(perms.filter((p) => PERMISSION_KEYS.includes(p))),
    modules: row.tenant ? enabledModules(row.plan?.modules ?? [], row.tenant.moduleOverrides) : new Set(),
    patientId: row.user.patientId,
    doctorId: row.user.doctorId,
    settings: row.tenant ? resolveSettings(row.tenant.settings) : null,
  };

  // Tenant lifecycle gate (BR-2): suspended/cancelled/expired-trial tenants are locked out.
  if (row.tenant) {
    const t = row.tenant;
    const trialExpired = t.status === 'trial' && t.trialEndsAt && t.trialEndsAt.getTime() < Date.now();
    if (t.status === 'suspended' || t.status === 'cancelled' || trialExpired) {
      contextCache.delete(userId);
      throw forbidden(
        trialExpired
          ? 'Your free trial has ended. Please contact support to activate a subscription.'
          : 'This organisation account is suspended. Please contact support.',
      );
    }
  }

  contextCache.set(userId, { at: Date.now(), ctx });
  return ctx;
}

// ------------------------------------------------------------- middleware
export const authenticate: RequestHandler = async (req, _res, next) => {
  const header = req.headers.authorization;
  if (!header?.startsWith('Bearer ')) return next(unauthorized());
  let payload: AccessPayload;
  try {
    payload = jwt.verify(header.slice(7), env.JWT_ACCESS_SECRET, { issuer: 'nexgen-hms' }) as unknown as AccessPayload;
  } catch {
    return next(unauthorized('Session expired. Please sign in again.'));
  }
  const ctx = await loadAuthContext(Number(payload.sub));
  if (!ctx) return next(unauthorized('Account is inactive'));
  req.auth = ctx;
  next();
};

/** Staff route guard: tenant user, holds every listed permission, and each permission's module is licensed. */
export function requirePermission(...perms: string[]): RequestHandler {
  return (req: Request, _res: Response, next: NextFunction) => {
    const a = req.auth;
    if (!a) return next(unauthorized());
    if (a.isPlatformAdmin || !a.tenantId) return next(forbidden('Platform accounts cannot access tenant data'));
    for (const p of perms) {
      const mod = moduleOfPermission(p);
      if (mod && mod !== 'core' && !a.modules.has(mod)) {
        return next(forbidden(`The ${mod} module is not enabled for your organisation`));
      }
      if (!a.permissions.has(p)) return next(forbidden());
    }
    next();
  };
}

/** Passes when the user holds ANY of the permissions (module checks still apply). */
export function requireAnyPermission(...perms: string[]): RequestHandler {
  return (req, _res, next) => {
    const a = req.auth;
    if (!a) return next(unauthorized());
    if (a.isPlatformAdmin || !a.tenantId) return next(forbidden('Platform accounts cannot access tenant data'));
    const ok = perms.some((p) => {
      const mod = moduleOfPermission(p);
      return a.permissions.has(p) && (!mod || mod === 'core' || a.modules.has(mod));
    });
    return ok ? next() : next(forbidden());
  };
}

export const requireTenantUser: RequestHandler = (req, _res, next) => {
  const a = req.auth;
  if (!a) return next(unauthorized());
  if (!a.tenantId || a.isPlatformAdmin) return next(forbidden('Tenant account required'));
  next();
};

export const requirePlatformAdmin: RequestHandler = (req, _res, next) => {
  if (!req.auth?.isPlatformAdmin) return next(forbidden('Platform owner access required'));
  next();
};

export const requirePatient: RequestHandler = (req, _res, next) => {
  const a = req.auth;
  if (!a?.patientId || !a.tenantId) return next(forbidden('Patient portal account required'));
  if (!a.modules.has('portal')) return next(forbidden('The patient portal is not enabled for this clinic'));
  next();
};

/** Narrow `req.auth` to a tenant context inside handlers guarded by requirePermission. */
export function tctx(req: Request): TenantAuthContext {
  const a = req.auth;
  if (!a?.tenantId || !a.settings || !a.tenantCode) throw forbidden('Tenant account required');
  return a as TenantAuthContext;
}
