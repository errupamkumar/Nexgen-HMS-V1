import { beforeAll, describe, expect, it } from 'vitest';
import { api, as, doctorByName, newPatient } from './helpers.js';

describe('OPD — consultation / EMR', () => {
  let rec: string;
  let doc: string;
  let apptId: number;
  let encId: number;

  beforeAll(async () => {
    rec = await as.reception();
    doc = await as.doctor();
    const cardio = await doctorByName(rec, 'Dr. Rajesh Sharma');
    const p = await newPatient(rec);
    apptId = (await api(rec).post('/api/appointments', { patientId: p.id, doctorId: cardio.id, walkIn: true, reason: 'Chest pain' })).body.id;
  });

  it('OPD-1 starts a consultation and moves the appointment to in_consultation (idempotent resume)', async () => {
    const r = await api(doc).post('/api/opd/encounters', { appointmentId: apptId });
    expect(r.status).toBe(201);
    encId = r.body.id;
    const again = await api(doc).post('/api/opd/encounters', { appointmentId: apptId });
    expect(again.status).toBe(200);
    expect(again.body.id).toBe(encId);
    const a = await api(rec).get(`/api/appointments/${apptId}`);
    expect(a.body.status).toBe('in_consultation');
  });

  it('OPD-2/3/4 saves vitals (auto BMI), diagnoses and prescription', async () => {
    const meds = (await api(doc).get('/api/masters/medicines?all=1')).body;
    const r = await api(doc).put(`/api/opd/encounters/${encId}`, {
      chiefComplaint: 'Chest pain on exertion',
      vitals: { bpSystolic: 150, bpDiastolic: 95, pulse: 88, weight: 80, height: 175 },
      diagnoses: [{ code: 'I10', description: 'Essential hypertension', type: 'provisional' }],
      advice: 'Low salt diet',
      prescriptions: [
        { medicineId: meds[0].id, medicineName: meds[0].name, dose: '1 tab', frequency: '1-0-1', durationDays: 5, quantity: 10 },
        { medicineName: 'Free-text Syrup', dose: '5 ml', frequency: 'TDS', durationDays: 3, quantity: 1 },
      ],
    });
    expect(r.status).toBe(200);
    const e = await api(doc).get(`/api/opd/encounters/${encId}`);
    expect(e.body.vitals.bmi).toBeCloseTo(26.12, 1);
    expect(e.body.prescriptions).toHaveLength(2);
    expect(e.body.patient.uhid).toBeTruthy();
  });

  it('rejects out-of-range vitals', async () => {
    expect((await api(doc).put(`/api/opd/encounters/${encId}`, { vitals: { spo2: 140 } })).status).toBe(422);
  });

  it('OPD-5 orders lab tests from the encounter', async () => {
    const tests = (await api(doc).get('/api/masters/lab-tests?all=1')).body;
    const r = await api(doc).post(`/api/opd/encounters/${encId}/lab-orders`, { testIds: [tests[0].id, tests[1].id], priority: 'urgent' });
    expect(r.status).toBe(201);
    const e = await api(doc).get(`/api/opd/encounters/${encId}`);
    expect(e.body.labOrders[0].items).toHaveLength(2);
  });

  it('OPD-6/BR-14 finalising completes the appointment and locks the record', async () => {
    expect((await api(doc).post(`/api/opd/encounters/${encId}/finalize`)).status).toBe(200);
    expect((await api(rec).get(`/api/appointments/${apptId}`)).body.status).toBe('completed');
    expect((await api(doc).put(`/api/opd/encounters/${encId}`, { notes: 'late edit' })).status).toBe(409);
    expect((await api(doc).post(`/api/opd/encounters/${encId}/finalize`)).status).toBe(409);
    const rx = await api(await as.pharmacist()).get('/api/pharmacy/prescriptions');
    expect(rx.body.data.some((r: { encounterId: number }) => r.encounterId === encId)).toBe(true);
  });

  it('PAT-4 timeline shows the visit to clinicians but hides clinical notes from front desk', async () => {
    const e = await api(doc).get(`/api/opd/encounters/${encId}`);
    const t = await api(doc).get(`/api/patients/${e.body.patientId}/timeline`);
    expect(t.body.encounters.length).toBeGreaterThan(0);
    expect(t.body.labOrders.length).toBeGreaterThan(0);
    const t2 = await api(rec).get(`/api/patients/${e.body.patientId}/timeline`);
    expect(t2.body.clinicalAccess).toBe(false);
    expect(t2.body.encounters).toHaveLength(0);
  });
});

describe('BIL — billing', () => {
  let acc: string;
  let patientId: number;
  beforeAll(async () => {
    acc = await as.accountant();
    patientId = (await newPatient(await as.admin())).id;
  });

  it('BIL-1/2/BR-8 computes totals server-side and ignores client totals', async () => {
    const r = await api(acc).post('/api/billing/invoices', {
      patientId,
      type: 'general',
      total: 1, // ignored
      items: [
        { description: 'Dressing', quantity: 2, unitPrice: 250, discount: 50, taxRate: 0 },
        { description: 'Nebulisation', quantity: 1, unitPrice: 300, taxRate: 18 },
      ],
    });
    expect(r.status).toBe(201);
    const inv = await api(acc).get(`/api/billing/invoices/${r.body.id}`);
    expect(inv.body.subtotal).toBe(800);
    expect(inv.body.discountTotal).toBe(50);
    expect(inv.body.taxTotal).toBe(54);
    expect(inv.body.total).toBe(804);
    expect(inv.body.status).toBe('unpaid');
  });

  it('BIL-3 partial payments, overpayment guard and receipts', async () => {
    const r = await api(acc).post('/api/billing/invoices', { patientId, items: [{ description: 'Procedure', quantity: 1, unitPrice: 1000 }] });
    const id = r.body.id;
    const p1 = await api(acc).post(`/api/billing/invoices/${id}/payments`, { amount: 400, method: 'cash' });
    expect(p1.status).toBe(201);
    expect(p1.body.status).toBe('partially_paid');
    expect(p1.body.balance).toBe(600);
    expect((await api(acc).post(`/api/billing/invoices/${id}/payments`, { amount: 700, method: 'upi' })).status).toBe(400);
    const p2 = await api(acc).post(`/api/billing/invoices/${id}/payments`, { amount: 600, method: 'upi', reference: 'UPI123' });
    expect(p2.body.status).toBe('paid');
    expect(Number(p2.body.receiptNo.split('-')[1])).toBe(Number(p1.body.receiptNo.split('-')[1]) + 1);
  });

  it('BIL-4/BR-9 refunds and blocks cancelling a paid invoice', async () => {
    const r = await api(acc).post('/api/billing/invoices', { patientId, items: [{ description: 'X-ray', quantity: 1, unitPrice: 500 }], payment: { amount: 500, method: 'card' } });
    const id = r.body.id;
    expect((await api(acc).post(`/api/billing/invoices/${id}/cancel`, { reason: 'Wrong patient' })).status).toBe(409);
    expect((await api(acc).post(`/api/billing/invoices/${id}/refund`, { amount: 600, method: 'cash', notes: 'too much' })).status).toBe(400);
    const rf = await api(acc).post(`/api/billing/invoices/${id}/refund`, { amount: 500, method: 'cash', notes: 'Test not performed' });
    expect(rf.status).toBe(201);
    expect(rf.body.status).toBe('refunded');
    expect((await api(acc).post(`/api/billing/invoices/${id}/cancel`, { reason: 'Wrong patient' })).status).toBe(200);
  });

  it('BIL-5 cancels an unpaid invoice; reception cannot refund', async () => {
    const r = await api(acc).post('/api/billing/invoices', { patientId, items: [{ description: 'Misc', quantity: 1, unitPrice: 100 }] });
    expect((await api(acc).post(`/api/billing/invoices/${r.body.id}/cancel`, { reason: 'Duplicate' })).status).toBe(200);
    const rec = await as.reception();
    expect((await api(rec).post(`/api/billing/invoices/${r.body.id}/refund`, { amount: 1, method: 'cash', notes: 'x x x' })).status).toBe(403);
  });

  it('BIL-7 filters invoices and returns totals', async () => {
    const r = await api(acc).get(`/api/billing/invoices?patientId=${patientId}`);
    expect(r.body.total).toBeGreaterThanOrEqual(4);
    expect(r.body.totals.total).toBeGreaterThan(0);
    const pays = await api(acc).get('/api/billing/payments?method=upi');
    expect(pays.body.data.every((p: { method: string }) => p.method === 'upi')).toBe(true);
  });
});
