import request from 'supertest';
import { beforeAll, describe, expect, it } from 'vitest';
import { api, app, as, login } from './helpers.js';
import { pool } from '../src/db/client.js';

describe('IAM — authentication & sessions', () => {
  it('IAM-1 logs in with organisation code + email + password and returns session', async () => {
    const res = await request(app).post('/api/auth/login').send({ tenantCode: 'sunrise', email: 'admin@sunrise.health', password: 'Admin@123' });
    expect(res.status).toBe(200);
    expect(res.body.accessToken).toBeTruthy();
    expect(res.body.session.tenant.code).toBe('sunrise');
    expect(res.body.session.permissions).toContain('settings.manage');
    expect(res.body.session.modules).toContain('ipd');
    expect(res.headers['set-cookie']?.[0]).toMatch(/nx_rt=.*HttpOnly/i);
  });

  it('IAM-1 rejects bad credentials with a generic message (no user enumeration)', async () => {
    const a = await request(app).post('/api/auth/login').send({ tenantCode: 'sunrise', email: 'nobody@sunrise.health', password: 'x' });
    const b = await request(app).post('/api/auth/login').send({ tenantCode: 'sunrise', email: 'admin@sunrise.health', password: 'wrong' });
    expect(a.status).toBe(401);
    expect(b.status).toBe(401);
    expect(a.body.error.message).toBe(b.body.error.message);
  });

  it('IAM-3 locks an account after 5 failed attempts', async () => {
    const admin = await as.admin();
    const roles = await api(admin).get('/api/admin/roles');
    const nurseRole = roles.body.find((r: { code: string }) => r.code === 'nurse');
    const email = `lock${Date.now()}@sunrise.health`;
    const created = await api(admin).post('/api/admin/users', { fullName: 'Lock Test', email, roleId: nurseRole.id, password: 'Correct@123' });
    expect(created.status).toBe(201);
    for (let i = 0; i < 4; i++) {
      const r = await request(app).post('/api/auth/login').send({ tenantCode: 'sunrise', email, password: 'bad' });
      expect(r.status).toBe(401);
    }
    const fifth = await request(app).post('/api/auth/login').send({ tenantCode: 'sunrise', email, password: 'bad' });
    expect(fifth.status).toBe(423);
    const correct = await request(app).post('/api/auth/login').send({ tenantCode: 'sunrise', email, password: 'Correct@123' });
    expect(correct.status).toBe(423);
    // Admin reset clears the lock
    await api(admin).post(`/api/admin/users/${created.body.id}/reset-password`, { password: 'Another@123' });
    expect((await request(app).post('/api/auth/login').send({ tenantCode: 'sunrise', email, password: 'Another@123' })).status).toBe(200);
  });

  it('IAM-2 rotates refresh tokens and detects replay', async () => {
    const res = await request(app).post('/api/auth/login').send({ tenantCode: 'sunrise', email: 'admin@sunrise.health', password: 'Admin@123' });
    const cookie = res.headers['set-cookie'][0].split(';')[0];
    const r1 = await request(app).post('/api/auth/refresh').set('Cookie', cookie);
    expect(r1.status).toBe(200);
    expect(r1.body.accessToken).toBeTruthy();
    const cookie2 = r1.headers['set-cookie'][0].split(';')[0];
    expect(cookie2).not.toBe(cookie);
    // Within the grace window a concurrent replay is refused but the family survives
    const benign = await request(app).post('/api/auth/refresh').set('Cookie', cookie);
    expect(benign.status).toBe(401);
    expect(benign.body.error.code).toBe('TOKEN_ROTATED');
    // Outside the window, replaying the old token revokes the whole family
    await pool.query('UPDATE refresh_tokens SET revoked_at = DATE_SUB(revoked_at, INTERVAL 1 MINUTE) WHERE revoked_at IS NOT NULL');
    const replay = await request(app).post('/api/auth/refresh').set('Cookie', cookie);
    expect(replay.status).toBe(401);
    expect(replay.body.error.code).toBe('UNAUTHORIZED');
    const after = await request(app).post('/api/auth/refresh').set('Cookie', cookie2);
    expect(after.status).toBe(401);
  });

  it('IAM-2 logout revokes the refresh token', async () => {
    const res = await request(app).post('/api/auth/login').send({ tenantCode: 'sunrise', email: 'admin@sunrise.health', password: 'Admin@123' });
    const cookie = res.headers['set-cookie'][0].split(';')[0];
    await request(app).post('/api/auth/logout').set('Cookie', cookie);
    expect((await request(app).post('/api/auth/refresh').set('Cookie', cookie)).status).toBe(401);
  });

  it('rejects requests without or with a forged token', async () => {
    expect((await request(app).get('/api/patients')).status).toBe(401);
    expect((await request(app).get('/api/patients').set('Authorization', 'Bearer abc.def.ghi')).status).toBe(401);
  });

  it('IAM-7 changes own password', async () => {
    const admin = await as.admin();
    const roles = await api(admin).get('/api/admin/roles');
    const role = roles.body.find((r: { code: string }) => r.code === 'accountant');
    const email = `pw${Date.now()}@sunrise.health`;
    await api(admin).post('/api/admin/users', { fullName: 'PW Test', email, roleId: role.id, password: 'First@1234' });
    const tok = await login('sunrise', email, 'First@1234');
    expect((await api(tok).post('/api/auth/change-password', { currentPassword: 'wrong', newPassword: 'Second@1234' })).status).toBe(400);
    expect((await api(tok).post('/api/auth/change-password', { currentPassword: 'First@1234', newPassword: 'Second@1234' })).status).toBe(200);
    await expect(login('sunrise', email, 'Second@1234')).resolves.toBeTruthy();
  });
});

describe('PLT — SaaS platform', () => {
  let owner: string;
  beforeAll(async () => {
    owner = await as.owner();
  });

  it('PLT-1 platform owner signs in without a code and cannot read tenant data', async () => {
    const me = await api(owner).get('/api/auth/me');
    expect(me.body.user.isPlatformAdmin).toBe(true);
    expect((await api(owner).get('/api/patients')).status).toBe(403);
  });

  it('PLT-1 tenant users cannot reach the platform console', async () => {
    const admin = await as.admin();
    expect((await api(admin).get('/api/platform/tenants')).status).toBe(403);
  });

  it('PLT-7 returns platform KPIs', async () => {
    const res = await api(owner).get('/api/platform/stats');
    expect(res.status).toBe(200);
    expect(res.body.totalTenants).toBeGreaterThanOrEqual(2);
    expect(res.body.mrr).toBeGreaterThan(0);
  });

  it('PLT-2 creates and updates plans', async () => {
    const code = `p${Date.now() % 100000}`;
    const r = await api(owner).post('/api/platform/plans', { code, name: 'Test Plan', priceMonthly: 10, priceYearly: 100, maxUsers: 2, maxBranches: 1, modules: ['patients', 'appointments'] });
    expect(r.status).toBe(201);
    expect((await api(owner).put(`/api/platform/plans/${r.body.id}`, { priceMonthly: 20 })).status).toBe(200);
    const list = await api(owner).get('/api/platform/plans');
    expect(list.body.find((p: { id: number }) => p.id === r.body.id).priceMonthly).toBe(20);
  });

  it('PLT-4 public self-signup provisions a trial tenant that can sign in', async () => {
    const code = `clinic${Date.now() % 100000}`;
    const res = await request(app)
      .post('/api/public/signup')
      .send({
        organization: { name: 'Signup Test Clinic', code, type: 'clinic' },
        admin: { fullName: 'Signup Admin', email: 'owner@signup.test', password: 'Signup@123' },
        planCode: 'professional',
      });
    expect(res.status).toBe(201);
    const tok = await login(code, 'owner@signup.test', 'Signup@123');
    const me = await api(tok).get('/api/auth/me');
    expect(me.body.tenant.status).toBe('trial');
    expect(me.body.modules).toContain('pharmacy');
    // default departments + system roles provisioned
    expect((await api(tok).get('/api/masters/departments?all=1')).body.length).toBeGreaterThan(3);
    expect((await api(tok).get('/api/admin/roles')).body.length).toBe(8);
    // duplicate code
    const dup = await request(app)
      .post('/api/public/signup')
      .send({ organization: { name: 'Dup', code, type: 'clinic' }, admin: { fullName: 'Dup Admin', email: 'dup@signup.test', password: 'Signup@123' } });
    expect(dup.status).toBe(409);
  });

  it('PLT-3/PLT-5 provisions a tenant, suspends it (login blocked) and reactivates it', async () => {
    const plans = await api(owner).get('/api/platform/plans');
    const starter = plans.body.find((p: { code: string }) => p.code === 'starter');
    const code = `prov${Date.now() % 100000}`;
    const res = await api(owner).post('/api/platform/tenants', {
      organization: { name: 'Provisioned Clinic', code, type: 'clinic' },
      admin: { fullName: 'Prov Admin', email: 'admin@prov.test', password: 'Prov@1234' },
      planId: starter.id,
      status: 'active',
    });
    expect(res.status).toBe(201);
    const tok = await login(code, 'admin@prov.test', 'Prov@1234');
    await api(owner).patch(`/api/platform/tenants/${res.body.tenantId}`, { status: 'suspended' });
    const blocked = await request(app).post('/api/auth/login').send({ tenantCode: code, email: 'admin@prov.test', password: 'Prov@1234' });
    expect(blocked.status).toBe(403);
    // existing access tokens stop working too
    expect((await api(tok).get('/api/patients')).status).toBe(403);
    await api(owner).patch(`/api/platform/tenants/${res.body.tenantId}`, { status: 'active' });
    await expect(login(code, 'admin@prov.test', 'Prov@1234')).resolves.toBeTruthy();
  });

  it('serves public branding for a tenant code', async () => {
    const res = await request(app).get('/api/public/tenant/sunrise');
    expect(res.status).toBe(200);
    expect(res.body.primaryColor).toMatch(/^#/);
    expect((await request(app).get('/api/public/tenant/does-not-exist')).status).toBe(404);
  });
});
