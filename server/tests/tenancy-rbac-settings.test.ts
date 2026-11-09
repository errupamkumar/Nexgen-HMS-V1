import { beforeAll, describe, expect, it } from 'vitest';
import { api, as, login, newPatient } from './helpers.js';

describe('NFR-1 — tenant isolation', () => {
  let sunrise: string;
  let carewell: string;
  let sunrisePatient: { id: number };
  let sunriseDoctorId: number;

  beforeAll(async () => {
    sunrise = await as.admin();
    carewell = await as.carewell();
    sunrisePatient = await newPatient(sunrise);
    sunriseDoctorId = (await api(sunrise).get('/api/masters/doctors?all=1')).body[0].id;
  });

  it('cannot read another tenant patient by id (404, not 403 — no existence leak)', async () => {
    expect((await api(carewell).get(`/api/patients/${sunrisePatient.id}`)).status).toBe(404);
    expect((await api(carewell).get(`/api/patients/${sunrisePatient.id}/timeline`)).status).toBe(404);
  });

  it('cannot update or delete another tenant patient', async () => {
    const upd = await api(carewell).put(`/api/patients/${sunrisePatient.id}`, { firstName: 'Hacked', gender: 'male', phone: '+91 9999999999' });
    expect(upd.status).toBe(404);
    const after = await api(sunrise).get(`/api/patients/${sunrisePatient.id}`);
    expect(after.body.firstName).not.toBe('Hacked');
  });

  it('lists only own tenant data', async () => {
    const list = await api(carewell).get('/api/patients?pageSize=200');
    expect(list.body.data.every((p: { id: number }) => p.id !== sunrisePatient.id)).toBe(true);
    const docs = await api(carewell).get('/api/masters/doctors?all=1');
    expect(docs.body.every((d: { id: number }) => d.id !== sunriseDoctorId)).toBe(true);
  });

  it('cannot book with another tenant doctor or patient', async () => {
    const own = await newPatient(carewell);
    const r = await api(carewell).post('/api/appointments', { patientId: own.id, doctorId: sunriseDoctorId, walkIn: true });
    expect(r.status).toBe(404);
    const r2 = await api(carewell).post('/api/appointments', { patientId: sunrisePatient.id, doctorId: sunriseDoctorId, walkIn: true });
    expect(r2.status).toBe(404);
  });

  it('cannot read another tenant invoice, lab order or admission', async () => {
    const invs = await api(sunrise).get('/api/billing/invoices?pageSize=1');
    expect((await api(carewell).get(`/api/billing/invoices/${invs.body.data[0].id}`)).status).toBe(404);
    expect((await api(carewell).get('/api/lab/orders/1')).status).toBe(403); // lab not licensed for Starter
  });

  it('BR-3 rejects unlicensed modules with 403 (Starter has no pharmacy/lab/ipd)', async () => {
    expect((await api(carewell).get('/api/pharmacy/stock')).status).toBe(403);
    expect((await api(carewell).get('/api/lab/orders')).status).toBe(403);
    expect((await api(carewell).get('/api/ipd/board')).status).toBe(403);
    const me = await api(carewell).get('/api/auth/me');
    expect(me.body.modules).not.toContain('ipd');
  });

  it('PLT-6 module override enables a module for one tenant', async () => {
    const owner = await as.owner();
    const tenants = await api(owner).get('/api/platform/tenants?q=carewell');
    const id = tenants.body.data[0].id;
    await api(owner).patch(`/api/platform/tenants/${id}`, { moduleOverrides: { enable: ['pharmacy'], disable: [] } });
    const tok = await as.carewell();
    expect((await api(tok).get('/api/pharmacy/stock')).status).toBe(200);
    await api(owner).patch(`/api/platform/tenants/${id}`, { moduleOverrides: { enable: [], disable: [] } });
    const tok2 = await as.carewell();
    expect((await api(tok2).get('/api/pharmacy/stock')).status).toBe(403);
  });
});

describe('IAM-4/5 — role-based access control', () => {
  it('BR-4 front desk cannot record clinical content', async () => {
    const rec = await as.reception();
    expect((await api(rec).post('/api/opd/encounters', { appointmentId: 1 })).status).toBe(403);
    expect((await api(rec).put('/api/opd/encounters/1', { diagnoses: [{ description: 'x' }] })).status).toBe(403);
  });

  it('lab technician cannot see billing; accountant cannot see lab', async () => {
    expect((await api(await as.lab()).get('/api/billing/invoices')).status).toBe(403);
    expect((await api(await as.accountant()).get('/api/lab/orders')).status).toBe(403);
  });

  it('nurse cannot manage settings or users', async () => {
    const n = await as.nurse();
    expect((await api(n).put('/api/admin/settings/billing', { defaultTaxRate: 5 })).status).toBe(403);
    expect((await api(n).post('/api/admin/users', {})).status).toBe(403);
  });

  it('custom roles grant exactly their permissions and changes apply immediately', async () => {
    const admin = await as.admin();
    const role = await api(admin).post('/api/admin/roles', { name: 'Billing Clerk', permissions: ['dashboard.view', 'billing.view'] });
    expect(role.status).toBe(201);
    const email = `clerk${Date.now()}@sunrise.health`;
    await api(admin).post('/api/admin/users', { fullName: 'Clerk', email, roleId: role.body.id, password: 'Clerk@1234' });
    const clerk = await login('sunrise', email, 'Clerk@1234');
    expect((await api(clerk).get('/api/billing/invoices')).status).toBe(200);
    expect((await api(clerk).get('/api/patients')).status).toBe(403);
    await api(admin).put(`/api/admin/roles/${role.body.id}`, { name: 'Billing Clerk', permissions: ['dashboard.view', 'billing.view', 'patients.view'] });
    expect((await api(clerk).get('/api/patients')).status).toBe(200);
    // cannot delete a role in use
    expect((await api(admin).del(`/api/admin/roles/${role.body.id}`)).status).toBe(409);
  });

  it('Administrator role is locked and system roles cannot be deleted', async () => {
    const admin = await as.admin();
    const roles = (await api(admin).get('/api/admin/roles')).body;
    const adminRole = roles.find((r: { code: string }) => r.code === 'admin');
    expect((await api(admin).put(`/api/admin/roles/${adminRole.id}`, { name: 'Hacker', permissions: [] })).status).toBe(403);
    const nurse = roles.find((r: { code: string }) => r.code === 'nurse');
    expect((await api(admin).del(`/api/admin/roles/${nurse.id}`)).status).toBe(403);
  });

  it('rejects unknown permission keys', async () => {
    const admin = await as.admin();
    expect((await api(admin).post('/api/admin/roles', { name: 'Bad', permissions: ['root.everything'] })).status).toBe(422);
  });
});

describe('CFG — configuration engine', () => {
  it('CFG-3/8 numbering prefix changes take effect immediately', async () => {
    const admin = await as.admin();
    const cur = (await api(admin).get('/api/admin/settings')).body.settings.numbering;
    const res = await api(admin).put('/api/admin/settings/numbering', { ...cur, uhid: 'SUN' });
    expect(res.status).toBe(200);
    const p = await newPatient(admin);
    expect(p.uhid).toMatch(/^SUN-\d{6}$/);
    await api(admin).put('/api/admin/settings/numbering', cur);
  });

  it('validates settings input', async () => {
    const admin = await as.admin();
    expect((await api(admin).put('/api/admin/settings/profile', { primaryColor: 'blue' })).status).toBe(422);
    expect((await api(admin).put('/api/admin/settings/locale', { timezone: 'Mars/Olympus' })).status).toBe(400);
    expect((await api(admin).put('/api/admin/settings/unknown', {})).status).toBe(422);
  });

  it('CFG-1 updates organisation profile', async () => {
    const admin = await as.admin();
    const s = (await api(admin).get('/api/admin/settings')).body.organization;
    const r = await api(admin).put('/api/admin/settings/organization', { ...s, phone: '+91 612 000 0000' });
    expect(r.status).toBe(200);
    expect((await api(admin).get('/api/admin/settings')).body.organization.phone).toBe('+91 612 000 0000');
  });

  it('CFG-7 enforces custom patient fields', async () => {
    const admin = await as.admin();
    const fields = (await api(admin).get('/api/admin/settings')).body.settings.patientFields;
    await api(admin).put('/api/admin/settings/patientFields', [...fields, { key: 'aadhaar_last4', label: 'Aadhaar (last 4)', type: 'number', required: true }]);
    const missing = await api(admin).post('/api/patients', { firstName: 'Cf', gender: 'male', phone: '+91 9000000001' });
    expect(missing.status).toBe(400);
    const badSelect = await api(admin).post('/api/patients', { firstName: 'Cf', gender: 'male', phone: '+91 9000000001', customFields: { aadhaar_last4: 1234, insurance: 'Unknown Co' } });
    expect(badSelect.status).toBe(400);
    const ok = await api(admin).post('/api/patients', { firstName: 'Cf', gender: 'male', phone: '+91 9000000001', customFields: { aadhaar_last4: '1234', insurance: 'CGHS' } });
    expect(ok.status).toBe(201);
    const got = await api(admin).get(`/api/patients/${ok.body.id}`);
    expect(got.body.customFields).toMatchObject({ aadhaar_last4: 1234, insurance: 'CGHS' });
    await api(admin).put('/api/admin/settings/patientFields', fields);
    // duplicate keys rejected
    expect((await api(admin).put('/api/admin/settings/patientFields', [fields[0], fields[0]])).status).toBe(400);
  });

  it('AUD-1 records mutations in the audit trail', async () => {
    const admin = await as.admin();
    const p = await newPatient(admin, { firstName: 'Audited' });
    const res = await api(admin).get('/api/admin/audit?entity=patient&pageSize=50');
    expect(res.body.data.some((r: { entityId: string; action: string }) => r.entityId === String(p.id) && r.action === 'create')).toBe(true);
    const logins = await api(admin).get('/api/admin/audit?action=login');
    expect(logins.body.total).toBeGreaterThan(0);
  });
});
