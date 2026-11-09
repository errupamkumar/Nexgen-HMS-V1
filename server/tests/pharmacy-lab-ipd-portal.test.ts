import { beforeAll, describe, expect, it } from 'vitest';
import { api, as, doctorByName, newPatient, nextWeekday, today } from './helpers.js';
import { addDays } from '../src/core/util.js';

describe('PHM — pharmacy', () => {
  let ph: string;
  let medId: number;
  let patientId: number;

  beforeAll(async () => {
    ph = await as.pharmacist();
    const m = await api(ph).post('/api/masters/medicines', { name: `FEFO Test ${Date.now()}`, salePrice: 10, taxRate: 0, reorderLevel: 5 });
    expect(m.status).toBe(201);
    medId = m.body.id;
    patientId = (await newPatient(await as.admin())).id;
  });

  it('PHM-1 stocks in batches and rejects expired batches', async () => {
    expect((await api(ph).post('/api/pharmacy/stock-in', { medicineId: medId, batchNo: 'LATE', expiryDate: addDays(today(), 400), quantity: 10, purchasePrice: 5, mrp: 12, salePrice: 11 })).status).toBe(201);
    expect((await api(ph).post('/api/pharmacy/stock-in', { medicineId: medId, batchNo: 'EARLY', expiryDate: addDays(today(), 60), quantity: 5, purchasePrice: 5, mrp: 12, salePrice: 10 })).status).toBe(201);
    expect((await api(ph).post('/api/pharmacy/stock-in', { medicineId: medId, batchNo: 'OLD', expiryDate: addDays(today(), -1), quantity: 5, purchasePrice: 5, mrp: 12 })).status).toBe(400);
  });

  it('PHM-2 reports on-hand and near-expiry', async () => {
    const r = await api(ph).get(`/api/pharmacy/stock?q=${encodeURIComponent('FEFO Test')}`);
    const row = r.body.data.find((x: { id: number }) => x.id === medId);
    expect(row.onHand).toBe(15);
    expect(row.expiringSoon).toBe(true);
  });

  it('PHM-3/BR-10 dispenses FEFO across batches and blocks insufficient stock', async () => {
    expect((await api(ph).post('/api/pharmacy/dispense', { patientId, items: [{ medicineId: medId, quantity: 16 }] })).status).toBe(409);
    const r = await api(ph).post('/api/pharmacy/dispense', { patientId, items: [{ medicineId: medId, quantity: 7 }], payment: { method: 'cash', amount: 1000 } });
    expect(r.status).toBe(201);
    // 5 from EARLY @10 + 2 from LATE @11
    expect(r.body.total).toBe(72);
    expect(r.body.payment.status).toBe('paid');
    const b = await api(ph).get(`/api/pharmacy/medicines/${medId}/batches`);
    const early = b.body.batches.find((x: { batchNo: string }) => x.batchNo === 'EARLY');
    const late = b.body.batches.find((x: { batchNo: string }) => x.batchNo === 'LATE');
    expect(early.quantity).toBe(0);
    expect(late.quantity).toBe(8);
    expect(b.body.movements.filter((m: { type: string }) => m.type === 'sale')).toHaveLength(2);
  });

  it('PHM-5 adjusts stock and prevents negative stock', async () => {
    const b = await api(ph).get(`/api/pharmacy/medicines/${medId}/batches`);
    const late = b.body.batches.find((x: { batchNo: string }) => x.batchNo === 'LATE');
    expect((await api(ph).post('/api/pharmacy/adjust', { batchId: late.id, quantity: -100, reason: 'Breakage' })).status).toBe(400);
    expect((await api(ph).post('/api/pharmacy/adjust', { batchId: late.id, quantity: -1, reason: 'Breakage' })).status).toBe(200);
  });

  it('PHM-3/4 dispenses against a prescription and marks it dispensed', async () => {
    const rx = await api(ph).get('/api/pharmacy/prescriptions');
    const pending = rx.body.data.find((r: { items: { medicineId: number | null }[] }) => r.items.some((i) => i.medicineId));
    expect(pending).toBeTruthy();
    const items = pending.items
      .filter((i: { medicineId: number | null }) => i.medicineId)
      .map((i: { medicineId: number; quantity: number; id: number }) => ({ medicineId: i.medicineId, quantity: Math.max(1, Math.min(i.quantity, 2)), prescriptionItemId: i.id }));
    const r = await api(ph).post('/api/pharmacy/dispense', { patientId: pending.patientId, encounterId: pending.encounterId, items });
    expect(r.status).toBe(201);
    const again = await api(ph).post('/api/pharmacy/dispense', { patientId: pending.patientId, encounterId: pending.encounterId, items });
    expect(again.status).toBe(409);
    const inv = await api(ph).get(`/api/billing/invoices/${r.body.invoiceId}`);
    expect(inv.body.type).toBe('pharmacy');
    expect(inv.body.items.every((i: { batchId: number | null }) => i.batchId)).toBe(true);
  });
});

describe('LAB — laboratory', () => {
  let lab: string;
  let orderId: number;
  beforeAll(async () => {
    lab = await as.lab();
    const p = await newPatient(await as.admin());
    const tests = (await api(lab).get('/api/masters/lab-tests?all=1')).body as { id: number; code: string }[];
    const fbs = tests.find((t) => t.code === 'FBS')!;
    const lipid = tests.find((t) => t.code === 'LIPID')!;
    const r = await api(lab).post('/api/lab/orders', { patientId: p.id, testIds: [fbs.id, lipid.id] });
    expect(r.status).toBe(201);
    expect(r.body.invoiceId).toBeTruthy();
    orderId = r.body.id;
  });

  it('LAB-2 requires sample collection before results', async () => {
    const o = await api(lab).get(`/api/lab/orders/${orderId}`);
    const r = await api(lab).put(`/api/lab/orders/${orderId}/results`, { items: [{ id: o.body.items[0].id, results: [] }] });
    expect(r.status).toBe(409);
    expect((await api(lab).post(`/api/lab/orders/${orderId}/collect`, {})).status).toBe(200);
    expect((await api(lab).post(`/api/lab/orders/${orderId}/collect`, {})).status).toBe(409);
  });

  it('LAB-3/BR-12 flags results high/low/normal automatically', async () => {
    const o = await api(lab).get(`/api/lab/orders/${orderId}`);
    const fbs = o.body.items.find((i: { testName: string }) => i.testName.includes('Sugar'));
    const lipid = o.body.items.find((i: { testName: string }) => i.testName.includes('Lipid'));
    const partial = await api(lab).put(`/api/lab/orders/${orderId}/results`, {
      items: [{ id: fbs.id, results: [{ parameter: 'Glucose (Fasting)', value: '142' }] }],
      complete: true,
    });
    expect(partial.status).toBe(400); // lipid not filled yet
    const r = await api(lab).put(`/api/lab/orders/${orderId}/results`, {
      items: [
        { id: fbs.id, results: [{ parameter: 'Glucose (Fasting)', value: '142' }] },
        {
          id: lipid.id,
          results: [
            { parameter: 'Total Cholesterol', value: '180' },
            { parameter: 'Triglycerides', value: '220' },
            { parameter: 'HDL', value: '35' },
            { parameter: 'LDL', value: '90' },
          ],
        },
      ],
      complete: true,
    });
    expect(r.status).toBe(200);
    const after = await api(lab).get(`/api/lab/orders/${orderId}`);
    const flags = Object.fromEntries(after.body.items.flatMap((i: { results: { parameter: string; flag: string }[] }) => i.results.map((x) => [x.parameter, x.flag])));
    expect(flags).toMatchObject({ 'Glucose (Fasting)': 'H', 'Total Cholesterol': 'N', Triglycerides: 'H', HDL: 'L', LDL: 'N' });
    expect(after.body.status).toBe('completed');
  });

  it('LAB-2 verifies and locks results; cannot cancel after completion', async () => {
    expect((await api(lab).post(`/api/lab/orders/${orderId}/verify`)).status).toBe(200);
    const o = await api(lab).get(`/api/lab/orders/${orderId}`);
    expect(o.body.status).toBe('verified');
    expect((await api(lab).put(`/api/lab/orders/${orderId}/results`, { items: [{ id: o.body.items[0].id, results: [] }] })).status).toBe(409);
    expect((await api(lab).post(`/api/lab/orders/${orderId}/cancel`)).status).toBe(409);
  });
});

describe('IPD — in-patient', () => {
  let admin: string;
  let nurse: string;
  let doctorId: number;
  let freeBeds: { id: number; bedNo: string }[];
  let admId: number;

  beforeAll(async () => {
    admin = await as.admin();
    nurse = await as.nurse();
    doctorId = (await doctorByName(admin, 'Dr. Vikram Rao')).id;
    const board = await api(admin).get('/api/ipd/board');
    freeBeds = board.body.wards.flatMap((w: { beds: { id: number; bedNo: string; status: string }[] }) => w.beds.filter((b) => b.status === 'available'));
  });

  it('IPD-2 admits to an available bed with a deposit and a running bill', async () => {
    const p = await newPatient(admin);
    const r = await api(admin).post('/api/ipd/admissions', { patientId: p.id, doctorId, bedId: freeBeds[0].id, reason: 'Fracture', deposit: { amount: 500, method: 'cash' } });
    expect(r.status).toBe(201);
    admId = r.body.id;
    const d = await api(admin).get(`/api/ipd/admissions/${admId}`);
    expect(d.body.bed.status).toBe('occupied');
    expect(d.body.invoice.status).toBe('draft');
    expect(d.body.invoice.amountPaid).toBe(500);
    // BR-11: same bed again → conflict; same patient again → conflict
    const p2 = await newPatient(admin);
    expect((await api(admin).post('/api/ipd/admissions', { patientId: p2.id, doctorId, bedId: freeBeds[0].id })).status).toBe(409);
    expect((await api(admin).post('/api/ipd/admissions', { patientId: p.id, doctorId, bedId: freeBeds[1].id })).status).toBe(409);
  });

  it('IPD-4 nurses add notes with vitals; nurses cannot discharge', async () => {
    expect((await api(nurse).post(`/api/ipd/admissions/${admId}/notes`, { type: 'nursing', note: 'Pain controlled', vitals: { pulse: 80 } })).status).toBe(201);
    expect((await api(nurse).post(`/api/ipd/admissions/${admId}/discharge`, { dischargeType: 'normal', dischargeSummary: 'Recovered well' })).status).toBe(403);
  });

  it('IPD-5 adds charges from the service master', async () => {
    const svc = (await api(admin).get('/api/masters/services?all=1')).body.find((s: { code: string }) => s.code === 'DRS');
    expect((await api(admin).post(`/api/ipd/admissions/${admId}/charges`, { serviceId: svc.id, quantity: 2 })).status).toBe(201);
  });

  it('IPD-3 transfers bed; old bed goes to cleaning', async () => {
    const r = await api(admin).post(`/api/ipd/admissions/${admId}/transfer`, { bedId: freeBeds[2].id });
    expect(r.status).toBe(200);
    const board = await api(admin).get('/api/ipd/board');
    const all = board.body.wards.flatMap((w: { beds: { id: number; status: string }[] }) => w.beds);
    expect(all.find((b: { id: number }) => b.id === freeBeds[0].id).status).toBe('cleaning');
    expect(all.find((b: { id: number }) => b.id === freeBeds[2].id).status).toBe('occupied');
  });

  it('IPD-6 discharge bills bed-days, issues the invoice and frees the bed for cleaning', async () => {
    const r = await api(admin).post(`/api/ipd/admissions/${admId}/discharge`, { dischargeType: 'normal', dischargeSummary: 'Recovered well, review in 2 weeks' });
    expect(r.status).toBe(200);
    expect(r.body.bedDaysBilled).toBe(1);
    const d = await api(admin).get(`/api/ipd/admissions/${admId}`);
    expect(d.body.status).toBe('discharged');
    expect(d.body.invoice.status).toBe('partially_paid');
    expect(d.body.invoice.items.some((i: { itemType: string }) => i.itemType === 'bed')).toBe(true);
    expect(d.body.invoice.balance).toBe(d.body.invoice.total - 500);
    expect((await api(admin).post(`/api/ipd/admissions/${admId}/notes`, { note: 'late' })).status).toBe(409);
    // housekeeping marks the bed available again
    expect((await api(admin).patch(`/api/masters/beds/${freeBeds[2].id}`, { status: 'available' })).status).toBe(200);
  });
});

describe('POR — patient portal', () => {
  let pt: string;
  beforeAll(async () => {
    pt = await as.patient();
  });

  it('POR-1 sees only own records and no staff APIs', async () => {
    const me = await api(pt).get('/api/portal/me');
    expect(me.status).toBe(200);
    const appts = await api(pt).get('/api/portal/appointments');
    expect(appts.status).toBe(200);
    expect((await api(pt).get('/api/patients')).status).toBe(403);
    expect((await api(pt).get('/api/billing/invoices')).status).toBe(403);
    const inv = await api(pt).get('/api/portal/invoices');
    expect(inv.body.every((i: { patientId: number }) => i.patientId === me.body.patient.id)).toBe(true);
  });

  it('staff cannot use portal APIs', async () => {
    expect((await api(await as.admin()).get('/api/portal/me')).status).toBe(403);
  });

  it('POR-2 books online and cancels; honours the online-booking switch', async () => {
    const docs = (await api(pt).get('/api/portal/doctors')).body;
    const derm = docs.find((d: { name: string }) => d.name === 'Dr. Kavita Nair');
    const date = nextWeekday(3);
    const slots = (await api(pt).get(`/api/portal/doctors/${derm.id}/slots?date=${date}`)).body.slots;
    const r = await api(pt).post('/api/portal/appointments', { doctorId: derm.id, date, startTime: slots[2].start });
    expect(r.status).toBe(201);
    expect((await api(pt).post(`/api/portal/appointments/${r.body.id}/cancel`)).status).toBe(200);
    // staff get notified of online bookings
    const notes = await api(await as.reception()).get('/api/notifications');
    expect(notes.body.items.some((n: { title: string }) => n.title === 'New online booking')).toBe(true);

    const admin = await as.admin();
    const appt = (await api(admin).get('/api/admin/settings')).body.settings.appointments;
    await api(admin).put('/api/admin/settings/appointments', { ...appt, allowOnlineBooking: false });
    const pt2 = await as.patient();
    expect((await api(pt2).post('/api/portal/appointments', { doctorId: derm.id, date, startTime: slots[3].start })).status).toBe(403);
    await api(admin).put('/api/admin/settings/appointments', appt);
  });
});

describe('RPT — reports & dashboard', () => {
  it('RPT-1 dashboard returns KPIs for licensed modules', async () => {
    const r = await api(await as.admin()).get('/api/reports/dashboard');
    expect(r.status).toBe(200);
    for (const k of ['appointmentsToday', 'patients', 'revenueTrend', 'outstanding', 'beds', 'lab', 'pharmacy']) expect(r.body).toHaveProperty(k);
  });

  it('RPT-1 dashboard hides financial KPIs from roles without billing access', async () => {
    const r = await api(await as.lab()).get('/api/reports/dashboard');
    expect(r.body).not.toHaveProperty('revenueTrend');
    expect(r.body).toHaveProperty('lab');
  });

  it('RPT-3 collections total equals the sum of payments in range', async () => {
    const admin = await as.admin();
    const from = addDays(today(), -7);
    const to = today();
    const rep = await api(admin).get(`/api/reports/collections?from=${from}&to=${to}`);
    const byMethod = rep.body.byMethod.reduce((s: number, m: { amount: number }) => s + m.amount, 0);
    expect(Math.round(byMethod)).toBe(Math.round(rep.body.totals.net));
    const docs = await api(admin).get('/api/reports/doctors');
    expect(docs.body.rows.length).toBe(6);
  });

  it('global search respects permissions', async () => {
    const lab = await as.lab();
    const r = await api(lab).get('/api/search?q=INV');
    expect(r.body.invoices).toHaveLength(0);
    const adm = await api(await as.admin()).get('/api/search?q=INV');
    expect(adm.body.invoices.length).toBeGreaterThan(0);
  });
});
