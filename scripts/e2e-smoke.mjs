/**
 * End-to-end smoke test of the complete patient journey, through the web
 * server's /api proxy exactly as the browser calls it.
 *
 *   node scripts/e2e-smoke.mjs [baseUrl]        (default http://localhost:5173)
 *
 * register → book → check-in → consult (vitals, Rx, lab) → finalise → bill/pay
 * → dispense (FEFO) → lab collect/results/verify → admit → charge → discharge
 * → portal sees records → reports reflect activity.
 */
const BASE = process.argv[2] ?? 'http://localhost:5173';
const results = [];
let failures = 0;

async function waitFor(url, tries = 60) {
  for (let i = 0; i < tries; i++) {
    try {
      const r = await fetch(url);
      if (r.ok) return;
    } catch {}
    await new Promise((r) => setTimeout(r, 1000));
  }
  throw new Error(`Server not reachable: ${url}`);
}

async function login(org, email, password) {
  const r = await fetch(`${BASE}/api/auth/login`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ tenantCode: org, email, password }) });
  const b = await r.json();
  if (!r.ok) throw new Error(`login ${email}: ${JSON.stringify(b)}`);
  return b.accessToken;
}

function client(token) {
  const call = async (method, path, body) => {
    const r = await fetch(`${BASE}/api${path}`, {
      method,
      headers: { authorization: `Bearer ${token}`, ...(body ? { 'content-type': 'application/json' } : {}) },
      body: body ? JSON.stringify(body) : undefined,
    });
    const text = await r.text();
    const data = text ? JSON.parse(text) : null;
    if (!r.ok) throw new Error(`${method} ${path} → ${r.status} ${JSON.stringify(data)}`);
    return data;
  };
  return { get: (p) => call('GET', p), post: (p, b) => call('POST', p, b ?? {}), put: (p, b) => call('PUT', p, b) };
}

async function step(name, fn) {
  const t = Date.now();
  try {
    const detail = await fn();
    results.push({ step: name, ok: true, ms: Date.now() - t, detail: detail ?? '' });
    console.log(`  ✔ ${name}${detail ? ` — ${detail}` : ''}`);
  } catch (e) {
    failures++;
    results.push({ step: name, ok: false, ms: Date.now() - t, detail: e.message });
    console.log(`  ✘ ${name} — ${e.message}`);
  }
}

function nextWeekday() {
  const d = new Date(Date.now() + 5.5 * 3600_000);
  do d.setUTCDate(d.getUTCDate() + 1);
  while ([0, 6].includes(d.getUTCDay()));
  return d.toISOString().slice(0, 10);
}

await waitFor(`${BASE}/api/health`);
console.log(`E2E smoke against ${BASE}\n`);

const rec = client(await login('sunrise', 'reception@sunrise.health', 'Staff@123'));
const doc = client(await login('sunrise', 'doctor@sunrise.health', 'Staff@123'));
const ph = client(await login('sunrise', 'pharmacy@sunrise.health', 'Staff@123'));
const lab = client(await login('sunrise', 'lab@sunrise.health', 'Staff@123'));
const acc = client(await login('sunrise', 'accounts@sunrise.health', 'Staff@123'));
const admin = client(await login('sunrise', 'admin@sunrise.health', 'Admin@123'));

const ctx = {};
await step('Web app serves the SPA shell', async () => {
  const html = await (await fetch(BASE)).text();
  if (!html.includes('<div id="root">')) throw new Error('index.html missing root');
});
await step('Reception registers a patient (custom fields)', async () => {
  const p = await rec.post('/patients', { firstName: 'Smoke', lastName: 'Tester', gender: 'female', age: 42, phone: '+91 9800012345', allergies: ['Sulfa drugs'], customFields: { insurance: 'CGHS', occupation: 'Engineer' } });
  ctx.patient = p;
  return p.uhid;
});
await step('Reception books a future slot with Dr. Rajesh Sharma', async () => {
  const docs = await rec.get('/masters/doctors?all=1');
  ctx.cardio = docs.find((d) => d.name === 'Dr. Rajesh Sharma');
  const date = nextWeekday();
  const slots = await rec.get(`/masters/doctors/${ctx.cardio.id}/slots?date=${date}`);
  const free = slots.slots.find((s) => s.available > 0 && !s.past);
  const b = await rec.post('/appointments', { patientId: ctx.patient.id, doctorId: ctx.cardio.id, date, startTime: free.start });
  return `${b.appointmentNo} token ${b.tokenNo} fee ${b.fee}`;
});
await step('Walk-in for today, auto-invoiced with registration fee', async () => {
  const b = await rec.post('/appointments', { patientId: ctx.patient.id, doctorId: ctx.cardio.id, walkIn: true, reason: 'Chest discomfort' });
  ctx.walkIn = b;
  if (!b.invoice) throw new Error('no auto invoice');
  return `${b.appointmentNo} invoice ${b.invoice.invoiceNo}`;
});
await step('Reception collects the consultation fee', async () => {
  const inv = await acc.get(`/billing/invoices/${ctx.walkIn.invoice.id}`);
  const r = await rec.post(`/billing/invoices/${inv.id}/payments`, { amount: inv.balance, method: 'upi', reference: 'UPI-SMOKE-1' });
  return `${r.receiptNo} → ${r.status}`;
});
await step('Doctor starts consultation from the queue', async () => {
  const e = await doc.post('/opd/encounters', { appointmentId: ctx.walkIn.id });
  ctx.enc = e.id;
});
await step('Doctor records vitals, history, diagnosis and prescription', async () => {
  const meds = await doc.get('/masters/medicines?all=1');
  const para = meds.find((m) => m.name.startsWith('Paracetamol'));
  const panto = meds.find((m) => m.name.startsWith('Pantoprazole'));
  await doc.put(`/opd/encounters/${ctx.enc}`, {
    chiefComplaint: 'Chest discomfort on exertion, 2 days',
    history: 'Known hypertensive, irregular medication',
    examination: 'S1 S2 normal, no murmur',
    vitals: { bpSystolic: 152, bpDiastolic: 96, pulse: 92, temperature: 37.1, spo2: 97, weight: 72, height: 160 },
    diagnoses: [{ code: 'I10', description: 'Essential hypertension', type: 'final' }],
    advice: 'Low-salt diet, daily walk',
    followUpDate: nextWeekday(),
    prescriptions: [
      { medicineId: para.id, medicineName: para.name, dose: '1 tab', frequency: '1-0-1', durationDays: 3, quantity: 6 },
      { medicineId: panto.id, medicineName: panto.name, dose: '1 tab', frequency: '1-0-0', durationDays: 5, quantity: 5 },
    ],
  });
  const e = await doc.get(`/opd/encounters/${ctx.enc}`);
  if (e.history !== 'Known hypertensive, irregular medication') throw new Error('history text not persisted (DEF-004)');
  if (!Array.isArray(e.pastVisits)) throw new Error('pastVisits missing');
  return `BMI ${e.vitals.bmi}`;
});
await step('Doctor orders lab tests from the consultation', async () => {
  const tests = await doc.get('/masters/lab-tests?all=1');
  const lipid = tests.find((t) => t.code === 'LIPID');
  const o = await doc.post(`/opd/encounters/${ctx.enc}/lab-orders`, { testIds: [lipid.id], priority: 'urgent' });
  ctx.labOrder = o;
  return o.orderNo;
});
await step('Doctor finalises (appointment completed, record locked)', async () => {
  await doc.post(`/opd/encounters/${ctx.enc}/finalize`);
  const q = await rec.get('/appointments/queue');
  const row = q.items.find((i) => i.id === ctx.walkIn.id);
  if (row.status !== 'completed') throw new Error(`status ${row.status}`);
});
await step('Pharmacist dispenses the prescription (FEFO + bill + payment)', async () => {
  const rx = await ph.get('/pharmacy/prescriptions');
  const mine = rx.data.find((r) => r.encounterId === ctx.enc);
  if (!mine) throw new Error('prescription not in pharmacy queue');
  const r = await ph.post('/pharmacy/dispense', {
    patientId: ctx.patient.id,
    encounterId: ctx.enc,
    items: mine.items.map((i) => ({ medicineId: i.medicineId, quantity: i.quantity, prescriptionItemId: i.id })),
    payment: { method: 'cash' },
  });
  return `${r.invoiceNo} total ${r.total} → ${r.payment?.status}`;
});
await step('Lab collects sample, enters results, verifies', async () => {
  await lab.post(`/lab/orders/${ctx.labOrder.id}/collect`, {});
  const o = await lab.get(`/lab/orders/${ctx.labOrder.id}`);
  await lab.put(`/lab/orders/${ctx.labOrder.id}/results`, {
    complete: true,
    items: o.items.map((it) => ({ id: it.id, results: it.results.map((r) => ({ parameter: r.parameter, value: r.parameter === 'HDL' ? '32' : '210' })) })),
  });
  await lab.post(`/lab/orders/${ctx.labOrder.id}/verify`);
  const after = await lab.get(`/lab/orders/${ctx.labOrder.id}`);
  const flags = after.items[0].results.map((r) => `${r.parameter}:${r.flag}`).join(' ');
  return flags;
});
await step('Admit to an available bed with deposit', async () => {
  const board = await admin.get('/ipd/board');
  const bed = board.wards.flatMap((w) => w.beds).find((b) => b.status === 'available');
  const a = await admin.post('/ipd/admissions', { patientId: ctx.patient.id, doctorId: ctx.cardio.id, bedId: bed.id, reason: 'Hypertensive urgency — observation', deposit: { amount: 3000, method: 'cash' } });
  ctx.adm = a;
  return `${a.admissionNo} bed ${bed.bedNo}`;
});
await step('Nursing note + service charge on running bill', async () => {
  await admin.post(`/ipd/admissions/${ctx.adm.id}/notes`, { type: 'nursing', note: 'BP rechecked, comfortable', vitals: { pulse: 84, bpSystolic: 140, bpDiastolic: 90 } });
  const svc = (await admin.get('/masters/services?all=1')).find((s) => s.code === 'ECG');
  await admin.post(`/ipd/admissions/${ctx.adm.id}/charges`, { serviceId: svc.id, quantity: 1 });
});
await step('Discharge bills bed-days and issues the final bill', async () => {
  const r = await admin.post(`/ipd/admissions/${ctx.adm.id}/discharge`, { dischargeType: 'normal', dischargeSummary: 'Observed for 24h, BP controlled on oral therapy. Discharged stable.' });
  return `${r.bedDaysBilled} bed-day(s), total ${r.total}, status ${r.invoice.status}`;
});
await step('Patient timeline shows every touchpoint', async () => {
  const t = await doc.get(`/patients/${ctx.patient.id}/timeline`);
  const counts = `appts ${t.appointments.length}, encounters ${t.encounters.length}, labs ${t.labOrders.length}, invoices ${t.invoices.length}, admissions ${t.admissions.length}`;
  if (t.invoices.length < 4 || t.admissions.length !== 1) throw new Error(counts);
  return counts;
});
await step('Admin grants portal access; patient sees own records', async () => {
  await admin.post(`/patients/${ctx.patient.id}/portal-account`, { email: 'smoke.patient@example.com', password: 'Portal@123' });
  const pt = client(await login('sunrise', 'smoke.patient@example.com', 'Portal@123'));
  const rx = await pt.get('/portal/prescriptions');
  const labs = await pt.get('/portal/lab-reports');
  const inv = await pt.get('/portal/invoices');
  if (!rx.length || !labs.length || !inv.length) throw new Error('portal records missing');
  return `${rx.length} Rx, ${labs.length} lab reports, ${inv.length} bills`;
});
await step('Dashboard and reports reflect the activity', async () => {
  const d = await admin.get('/reports/dashboard');
  const c = await admin.get('/reports/collections');
  if (!(d.collectionToday > 0)) throw new Error('no collection today');
  return `today ${d.collectionToday}, 30-day net ${c.totals.net}, occupancy ${d.beds.occupancy}%`;
});
await step('Audit trail captured the journey', async () => {
  const a = await admin.get('/admin/audit?pageSize=100');
  const actions = new Set(a.data.map((r) => r.action));
  for (const need of ['create', 'payment', 'dispense', 'status', 'login']) if (!actions.has(need)) throw new Error(`missing ${need}`);
  return `${a.total} events`;
});

console.log(`\n${results.length - failures}/${results.length} steps passed`);
const fs = await import('node:fs');
fs.mkdirSync(new URL('../docs/qa/', import.meta.url), { recursive: true });
fs.writeFileSync(new URL('../docs/qa/e2e-smoke-results.json', import.meta.url), JSON.stringify({ base: BASE, at: new Date().toISOString(), results }, null, 2));
process.exit(failures ? 1 : 0);
