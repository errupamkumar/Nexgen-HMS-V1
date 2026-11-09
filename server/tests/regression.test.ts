/** Regression tests for defects found during QA (see docs/06-QA-REPORT.md). */
import { describe, expect, it } from 'vitest';
import { api, as } from './helpers.js';

describe('DEF-002 — correlated subqueries bind to the outer row', () => {
  it('role user counts are per role', async () => {
    const roles = (await api(await as.admin()).get('/api/admin/roles')).body as { code: string; userCount: number }[];
    expect(roles.find((r) => r.code === 'admin')!.userCount).toBe(1);
    expect(roles.find((r) => r.code === 'pharmacist')!.userCount).toBe(1);
  });

  it('plan tenant counts are per plan', async () => {
    const plans = (await api(await as.owner()).get('/api/platform/plans')).body as { code: string; tenantCount: number }[];
    expect(plans.find((p) => p.code === 'enterprise')!.tenantCount).toBe(1);
  });

  it('patient lastVisit matches their latest completed appointment', async () => {
    const admin = await as.admin();
    const list = (await api(admin).get('/api/patients?pageSize=100')).body.data as { id: number; lastVisit: string | null }[];
    const withVisit = list.find((p) => p.lastVisit);
    expect(withVisit).toBeTruthy();
    const appts = (await api(admin).get(`/api/appointments?patientId=${withVisit!.id}&status=completed&pageSize=100`)).body.data as { date: string }[];
    const latest = appts.map((a) => a.date).sort().at(-1);
    expect(String(withVisit!.lastVisit).slice(0, 10)).toBe(latest);
  });

  it('pharmacy on-hand equals the sum of non-expired batches', async () => {
    const ph = await as.pharmacist();
    const stock = (await api(ph).get('/api/pharmacy/stock?q=Paracetamol')).body.data[0];
    const b = (await api(ph).get(`/api/pharmacy/medicines/${stock.id}/batches`)).body;
    const sum = b.batches.filter((x: { expiryDate: string }) => x.expiryDate >= b.today).reduce((s: number, x: { quantity: number }) => s + x.quantity, 0);
    expect(stock.onHand).toBe(sum);
  });

  it('low-stock filter returns the seeded low item', async () => {
    const low = (await api(await as.pharmacist()).get('/api/pharmacy/stock?filter=low')).body.data as { name: string }[];
    expect(low.map((m) => m.name)).toContain('Azithromycin 500');
  });
});

describe('DEF-003 — one encounter per appointment', () => {
  it('parallel "start consultation" clicks resolve to a single encounter', async () => {
    const rec = await as.reception();
    const doc = await as.doctor();
    const docs = (await api(rec).get('/api/masters/doctors?all=1')).body as { id: number; name: string }[];
    const cardio = docs.find((d) => d.name === 'Dr. Rajesh Sharma')!;
    const p = await api(rec).post('/api/patients', { firstName: 'Race', gender: 'male', phone: '+91 9876500001' });
    const appt = await api(rec).post('/api/appointments', { patientId: p.body.id, doctorId: cardio.id, walkIn: true });
    const results = await Promise.all([1, 2, 3].map(() => api(doc).post('/api/opd/encounters', { appointmentId: appt.body.id })));
    const ids = new Set(results.filter((r) => r.status < 300).map((r) => r.body.id));
    expect(ids.size).toBe(1);
  });
});

describe('DEF-004 / DEF-007 — consultation record integrity', () => {
  it('keeps the clinical history text separate from the past-visits list, and normalises vitals precision', async () => {
    const rec = await as.reception();
    const doc = await as.doctor();
    const docs = (await api(rec).get('/api/masters/doctors?all=1')).body as { id: number; name: string }[];
    const cardio = docs.find((d) => d.name === 'Dr. Rajesh Sharma')!;
    const p = await api(rec).post('/api/patients', { firstName: 'History', gender: 'female', phone: '+91 9876500002' });
    const appt = await api(rec).post('/api/appointments', { patientId: p.body.id, doctorId: cardio.id, walkIn: true });
    const enc = await api(doc).post('/api/opd/encounters', { appointmentId: appt.body.id });
    await api(doc).put(`/api/opd/encounters/${enc.body.id}`, {
      chiefComplaint: 'Cough',
      history: 'Smoker for 10 years',
      vitals: { temperature: 37.4567, weight: 70.06, height: 170, pulse: 88.6 },
    });
    const e = await api(doc).get(`/api/opd/encounters/${enc.body.id}`);
    expect(e.body.history).toBe('Smoker for 10 years');
    expect(Array.isArray(e.body.pastVisits)).toBe(true);
    expect(e.body.vitals).toMatchObject({ temperature: 37.5, weight: 70.1, pulse: 89 });
  });
});
