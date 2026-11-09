import { Router, type Request, type Response } from 'express';
import rateLimit, { ipKeyGenerator } from 'express-rate-limit';
import { and, eq, isNull } from 'drizzle-orm';
import { z } from 'zod';
import { env, isProd, isTest } from '../../config/env.js';
import { db } from '../../db/client.js';
import { plans, refreshTokens, roles, tenants, users } from '../../db/schema.js';
import {
  authenticate,
  hashPassword,
  invalidateAuthCache,
  loadAuthContext,
  newRefreshToken,
  sha256,
  signAccessToken,
  verifyPassword,
  type AuthContext,
} from '../../core/auth.js';
import { AppError, badRequest, unauthorized } from '../../core/errors.js';
import { audit } from '../../core/util.js';

export const authRouter = Router();

const REFRESH_COOKIE = 'nx_rt';
const MAX_FAILED = 5;
const LOCK_MINUTES = 15;
const ROTATION_GRACE_MS = 15_000;

/*
 * Two layers (DEF-006): a strict per-account limiter keyed by IP + organisation + email,
 * so one clinic's shared NAT address does not lock out all of its staff, and a looser
 * per-IP ceiling against credential stuffing. Per-account lockout adds a third layer.
 */
const limited = { error: { code: 'RATE_LIMITED', message: 'Too many sign-in attempts. Try again in a few minutes.' } };
const accountLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  limit: isTest ? 10_000 : env.LOGIN_LIMIT_PER_ACCOUNT,
  standardHeaders: 'draft-8',
  legacyHeaders: false,
  keyGenerator: (req) =>
    `${ipKeyGenerator(req.ip ?? '')}|${String(req.body?.tenantCode ?? '').toLowerCase()}|${String(req.body?.email ?? '').toLowerCase()}`,
  message: limited,
});
const ipLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  limit: isTest ? 10_000 : env.LOGIN_LIMIT_PER_IP,
  standardHeaders: 'draft-8',
  legacyHeaders: false,
  message: limited,
});

const loginSchema = z.object({
  tenantCode: z.string().trim().toLowerCase().max(40).optional().or(z.literal('')),
  email: z.string().trim().toLowerCase().email(),
  password: z.string().min(1).max(200),
});

function setRefreshCookie(res: Response, token: string) {
  res.cookie(REFRESH_COOKIE, token, {
    httpOnly: true,
    secure: isProd,
    sameSite: 'strict',
    path: '/api/auth',
    maxAge: env.REFRESH_TOKEN_DAYS * 86_400_000,
  });
}

async function issueSession(req: Request, res: Response, userId: number, tenantId: number | null) {
  const { token, hash } = newRefreshToken();
  await db.insert(refreshTokens).values({
    userId,
    tokenHash: hash,
    expiresAt: new Date(Date.now() + env.REFRESH_TOKEN_DAYS * 86_400_000),
    userAgent: (req.headers['user-agent'] ?? '').slice(0, 300),
    ip: req.ip ?? null,
  });
  setRefreshCookie(res, token);
  return signAccessToken(userId, tenantId);
}

/** Session payload consumed by the web app to build navigation, theming and guards. */
export async function sessionPayload(ctx: AuthContext) {
  let tenant = null;
  let roleName: string | null = null;
  if (ctx.tenantId) {
    const [t] = await db
      .select({
        id: tenants.id,
        code: tenants.code,
        name: tenants.name,
        type: tenants.type,
        status: tenants.status,
        trialEndsAt: tenants.trialEndsAt,
        phone: tenants.phone,
        email: tenants.email,
        address: tenants.address,
        city: tenants.city,
        state: tenants.state,
        planName: plans.name,
        planCode: plans.code,
      })
      .from(tenants)
      .innerJoin(plans, eq(plans.id, tenants.planId))
      .where(eq(tenants.id, ctx.tenantId));
    tenant = t ?? null;
    const [u] = await db
      .select({ roleName: roles.name })
      .from(users)
      .leftJoin(roles, eq(roles.id, users.roleId))
      .where(eq(users.id, ctx.userId));
    roleName = u?.roleName ?? null;
  }
  return {
    user: {
      id: ctx.userId,
      fullName: ctx.userName,
      email: ctx.email,
      roleCode: ctx.isPlatformAdmin ? 'platform_admin' : ctx.roleCode,
      roleName: ctx.isPlatformAdmin ? 'Platform Owner' : roleName,
      isPlatformAdmin: ctx.isPlatformAdmin,
      patientId: ctx.patientId,
      doctorId: ctx.doctorId,
    },
    tenant,
    permissions: [...ctx.permissions],
    modules: [...ctx.modules],
    settings: ctx.settings,
  };
}

authRouter.post('/login', ipLimiter, accountLimiter, async (req, res) => {
  const body = loginSchema.parse(req.body);
  const tenantCode = body.tenantCode || null;

  let tenantId: number | null = null;
  if (tenantCode) {
    const [t] = await db.select({ id: tenants.id }).from(tenants).where(eq(tenants.code, tenantCode)).limit(1);
    if (!t) throw unauthorized('Invalid organisation code, email or password');
    tenantId = t.id;
  }

  const [user] = await db
    .select()
    .from(users)
    .where(
      and(
        tenantId ? eq(users.tenantId, tenantId) : and(isNull(users.tenantId), eq(users.isPlatformAdmin, true)),
        eq(users.email, body.email),
      ),
    )
    .limit(1);

  if (!user) throw unauthorized('Invalid organisation code, email or password');
  if (user.lockedUntil && user.lockedUntil.getTime() > Date.now()) {
    const mins = Math.ceil((user.lockedUntil.getTime() - Date.now()) / 60_000);
    throw new AppError(423, 'ACCOUNT_LOCKED', `Too many failed attempts. Account locked for ${mins} more minute(s).`);
  }
  if (user.status !== 'active') throw unauthorized('This account has been deactivated');

  const ok = await verifyPassword(body.password, user.passwordHash);
  if (!ok) {
    const failed = user.failedLogins + 1;
    await db
      .update(users)
      .set({
        failedLogins: failed >= MAX_FAILED ? 0 : failed,
        lockedUntil: failed >= MAX_FAILED ? new Date(Date.now() + LOCK_MINUTES * 60_000) : null,
      })
      .where(eq(users.id, user.id));
    req.auth = { userId: user.id, userName: user.fullName, tenantId: user.tenantId } as AuthContext;
    await audit(req, 'login_failed', 'user', user.id, `Failed sign-in for ${user.email}`);
    if (failed >= MAX_FAILED) {
      throw new AppError(423, 'ACCOUNT_LOCKED', `Too many failed attempts. Account locked for ${LOCK_MINUTES} minutes.`);
    }
    throw unauthorized('Invalid organisation code, email or password');
  }

  await db.update(users).set({ failedLogins: 0, lockedUntil: null, lastLoginAt: new Date() }).where(eq(users.id, user.id));
  invalidateAuthCache({ userId: user.id });
  const ctx = await loadAuthContext(user.id); // throws 403 for suspended/expired tenants
  if (!ctx) throw unauthorized();

  const accessToken = await issueSession(req, res, user.id, user.tenantId);
  req.auth = ctx;
  await audit(req, 'login', 'user', user.id, `${user.fullName} signed in`);
  res.json({ accessToken, session: await sessionPayload(ctx) });
});

authRouter.post('/refresh', async (req, res) => {
  const token = req.cookies?.[REFRESH_COOKIE];
  if (!token) throw unauthorized('No session');
  const hash = sha256(token);
  const [row] = await db.select().from(refreshTokens).where(eq(refreshTokens.tokenHash, hash)).limit(1);
  if (!row) throw unauthorized('Session not found');

  if (row.revokedAt) {
    // Concurrent refreshes (several tabs restored at once, React StrictMode) present the
    // same token within moments of its rotation. Inside the grace window that is benign:
    // refuse without revoking, and the client retries with the cookie its sibling received.
    if (Date.now() - row.revokedAt.getTime() < ROTATION_GRACE_MS) {
      throw new AppError(401, 'TOKEN_ROTATED', 'Session was just refreshed elsewhere. Retry.');
    }
    // Outside the window a rotated token was replayed — treat the session family as compromised.
    await db
      .update(refreshTokens)
      .set({ revokedAt: new Date() })
      .where(and(eq(refreshTokens.userId, row.userId), isNull(refreshTokens.revokedAt)));
    res.clearCookie(REFRESH_COOKIE, { path: '/api/auth' });
    throw unauthorized('Session expired. Please sign in again.');
  }
  if (row.expiresAt.getTime() < Date.now()) throw unauthorized('Session expired. Please sign in again.');

  const ctx = await loadAuthContext(row.userId);
  if (!ctx) throw unauthorized('Account is inactive');

  await db.update(refreshTokens).set({ revokedAt: new Date() }).where(eq(refreshTokens.id, row.id));
  const accessToken = await issueSession(req, res, row.userId, ctx.tenantId);
  res.json({ accessToken, session: await sessionPayload(ctx) });
});

authRouter.post('/logout', async (req, res) => {
  const token = req.cookies?.[REFRESH_COOKIE];
  if (token) {
    await db.update(refreshTokens).set({ revokedAt: new Date() }).where(eq(refreshTokens.tokenHash, sha256(token)));
  }
  res.clearCookie(REFRESH_COOKIE, { path: '/api/auth' });
  res.json({ ok: true });
});

authRouter.get('/me', authenticate, async (req, res) => {
  res.json(await sessionPayload(req.auth!));
});

authRouter.post('/change-password', authenticate, async (req, res) => {
  const body = z
    .object({ currentPassword: z.string().min(1), newPassword: z.string().min(8).max(100) })
    .parse(req.body);
  const [user] = await db.select().from(users).where(eq(users.id, req.auth!.userId));
  if (!user || !(await verifyPassword(body.currentPassword, user.passwordHash))) {
    throw badRequest('Current password is incorrect');
  }
  await db.update(users).set({ passwordHash: await hashPassword(body.newPassword) }).where(eq(users.id, user.id));
  // Sign out other sessions.
  await db
    .update(refreshTokens)
    .set({ revokedAt: new Date() })
    .where(and(eq(refreshTokens.userId, user.id), isNull(refreshTokens.revokedAt)));
  await audit(req, 'update', 'user', user.id, 'Changed own password');
  const accessToken = await issueSession(req, res, user.id, user.tenantId);
  res.json({ ok: true, accessToken });
});
