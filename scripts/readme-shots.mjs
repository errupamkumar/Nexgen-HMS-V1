/**
 * Captures the README screenshots in realistic working states.
 *
 *   npm run db:reset && npm run build && npm start      (in another terminal)
 *   npm run docs:shots -- http://localhost:4000
 *
 * Output: docs/images/screens/*.jpg   (CHROME_PATH overrides the browser)
 */
import { chromium } from 'playwright-core';
import fs from 'node:fs';
import { fileURLToPath } from 'node:url';

const BASE = process.argv[2] ?? 'http://localhost:4000';
const OUT = fileURLToPath(new URL('../docs/images/screens/', import.meta.url));
fs.mkdirSync(OUT, { recursive: true });

// ---------------------------------------------------------------- API helpers (state setup)
async function apiLogin(org, email, password) {
  const r = await fetch(`${BASE}/api/auth/login`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ tenantCode: org, email, password }) });
  const b = await r.json();
  if (!r.ok) throw new Error(`login ${email}: ${JSON.stringify(b)}`);
  const call = async (method, path, body) => {
    const res = await fetch(`${BASE}/api${path}`, { method, headers: { authorization: `Bearer ${b.accessToken}`, ...(body ? { 'content-type': 'application/json' } : {}) }, body: body ? JSON.stringify(body) : undefined });
    const t = await res.text();
    if (!res.ok) throw new Error(`${method} ${path}: ${res.status} ${t}`);
    return t ? JSON.parse(t) : null;
  };
  return { get: (p) => call('GET', p), post: (p, x) => call('POST', p, x ?? {}), put: (p, x) => call('PUT', p, x) };
}
function nextWeekday(n = 1) {
  const d = new Date(Date.now() + 5.5 * 3600e3);
  let added = 0;
  while (added < n) {
    d.setUTCDate(d.getUTCDate() + 1);
    if (![0, 6].includes(d.getUTCDay())) added++;
  }
  return d.toISOString().slice(0, 10);
}

const admin = await apiLogin('sunrise', 'admin@sunrise.health', 'Admin@123');
const doc = await apiLogin('sunrise', 'doctor@sunrise.health', 'Staff@123');
const doctors = await admin.get('/masters/doctors?all=1');
const cardio = doctors.find((d) => d.name === 'Dr. Rajesh Sharma');
const meds = await admin.get('/masters/medicines?all=1');
const med = (n) => meds.find((m) => m.name.startsWith(n));
const tests = await admin.get('/masters/lab-tests?all=1');
const testBy = (c) => tests.find((t) => t.code === c);

async function walkInConsult(firstName, lastName, gender, age, phone, extra = {}) {
  const p = await admin.post('/patients', { firstName, lastName, gender, age, phone, allergies: extra.allergies ?? [], conditions: extra.conditions ?? [], bloodGroup: extra.bloodGroup ?? 'B+', customFields: { insurance: 'Star Health', occupation: 'Teacher' } });
  const a = await admin.post('/appointments', { patientId: p.id, doctorId: cardio.id, walkIn: true, reason: 'Chest discomfort on exertion for 3 days' });
  const e = await doc.post('/opd/encounters', { appointmentId: a.id });
  await doc.put(`/opd/encounters/${e.id}`, {
    chiefComplaint: 'Chest discomfort on exertion for 3 days, occasional palpitations',
    history: 'Hypertensive for 6 years, irregular on medication. Father had MI at 58.',
    examination: 'Conscious, oriented. S1 S2 heard, no murmur. Chest clear. No pedal oedema.',
    vitals: { bpSystolic: 156, bpDiastolic: 98, pulse: 94, temperature: 36.9, spo2: 97, respiratoryRate: 18, weight: 78, height: 172 },
    diagnoses: [
      { code: 'I10', description: 'Essential hypertension', type: 'final' },
      { code: 'R07.4', description: 'Chest pain, unspecified', type: 'provisional' },
    ],
    advice: 'Low-salt diet, 30 min brisk walk daily, avoid smoking. Return immediately if chest pain at rest.',
    followUpDate: nextWeekday(5),
    prescriptions: [
      { medicineId: med('Telmisartan').id, medicineName: med('Telmisartan').name, dose: '1 tab', frequency: '1-0-0', durationDays: 30, route: 'Oral', instructions: 'Before food', quantity: 30 },
      { medicineId: med('Amlodipine').id, medicineName: med('Amlodipine').name, dose: '1 tab', frequency: '0-0-1', durationDays: 30, route: 'Oral', instructions: 'After food', quantity: 30 },
      { medicineId: med('Pantoprazole').id, medicineName: med('Pantoprazole').name, dose: '1 tab', frequency: '1-0-0', durationDays: 10, route: 'Oral', instructions: 'Empty stomach', quantity: 10 },
    ],
  });
  return { patient: p, appt: a, enc: e };
}

// Draft consultation (editable workspace) and a finalised one (for print + pharmacy queue)
const draft = await walkInConsult('Arjun', 'Malhotra', 'male', 52, '+91 9431100001', { allergies: ['Sulfa drugs'], conditions: ['Hypertension'] });
const final = await walkInConsult('Kavya', 'Reddy', 'female', 46, '+91 9431100002', { conditions: ['Hypertension'] });
await doc.post(`/opd/encounters/${final.enc.id}/lab-orders`, { testIds: [testBy('LIPID').id, testBy('KFT').id], priority: 'routine' });
await doc.post(`/opd/encounters/${final.enc.id}/finalize`);

// Lab order collected and ready for result entry, plus a verified one for the printed report
const lab = await apiLogin('sunrise', 'lab@sunrise.health', 'Staff@123');
const labPending = await admin.post('/lab/orders', { patientId: draft.patient.id, doctorId: cardio.id, testIds: [testBy('CBC').id, testBy('LIPID').id], priority: 'urgent' });
await lab.post(`/lab/orders/${labPending.id}/collect`, {});
const labDone = await admin.post('/lab/orders', { patientId: final.patient.id, doctorId: cardio.id, testIds: [testBy('CBC').id, testBy('LIPID').id], priority: 'routine' });
await lab.post(`/lab/orders/${labDone.id}/collect`, {});
{
  const o = await lab.get(`/lab/orders/${labDone.id}`);
  const vals = { Hemoglobin: '10.4', 'Total WBC': '12800', Platelets: '2.6', RBC: '4.5', 'Total Cholesterol': '238', Triglycerides: '186', HDL: '36', LDL: '98' };
  await lab.put(`/lab/orders/${labDone.id}/results`, { complete: true, items: o.items.map((it) => ({ id: it.id, results: it.results.map((r) => ({ parameter: r.parameter, value: vals[r.parameter] ?? '1' })), resultNotes: it.testName.includes('Lipid') ? 'Dyslipidaemia — correlate clinically, repeat fasting profile in 3 months.' : null })) });
  await lab.post(`/lab/orders/${labDone.id}/verify`);
}
const unpaid = (await admin.get('/billing/invoices?status=unpaid&type=opd&pageSize=1')).data[0];
const admission = (await admin.get('/ipd/admissions?status=admitted&pageSize=1')).data[0];

// ---------------------------------------------------------------- browser
const browser = await chromium.launch({ executablePath: process.env.CHROME_PATH ?? 'C:/Program Files/Google/Chrome/Application/chrome.exe', headless: true });
const shots = [];

async function persona(org, email, pw, opts = {}) {
  const ctx = await browser.newContext({ viewport: opts.viewport ?? { width: 1440, height: 900 }, deviceScaleFactor: opts.scale ?? 1 });
  await ctx.addInitScript((dark) => localStorage.setItem('nx_theme', dark ? 'dark' : 'light'), Boolean(opts.dark));
  const page = await ctx.newPage();
  page.on('pageerror', (e) => console.log('  pageerror:', e.message));
  if (email) {
    await page.goto(`${BASE}/login`);
    await page.fill('#org', org);
    await page.fill('#email', email);
    await page.fill('#password', pw);
    await page.click('button[type=submit]');
    await page.waitForURL((u) => !u.pathname.startsWith('/login'), { timeout: 20000 });
  }
  return { page, ctx };
}
async function go(page, path, waitText) {
  await page.goto(`${BASE}${path}`);
  await page.waitForLoadState('networkidle').catch(() => {});
  if (waitText) await page.getByText(waitText, { exact: false }).first().waitFor({ timeout: 15000 });
  await page.waitForTimeout(1800); // let charts finish animating
}
async function snap(page, name, clip) {
  await page.mouse.move(0, 0);
  await page.waitForTimeout(250);
  await page.screenshot({ path: `${OUT}${name}.jpg`, type: 'jpeg', quality: 84, ...(clip ? { clip } : {}) });
  shots.push(name);
  console.log('  ✔', name);
}

console.log('Capturing README screenshots…');

// 01 Sign-in with tenant branding
{
  const { page, ctx } = await persona();
  await page.goto(`${BASE}/login`);
  await page.fill('#org', 'sunrise');
  await page.fill('#email', 'admin@sunrise.health');
  await page.waitForTimeout(1200);
  await snap(page, '01-sign-in');
  await page.goto(`${BASE}/signup`);
  await page.waitForTimeout(800);
  await snap(page, '02-signup');
  await ctx.close();
}

// Administrator journey
{
  const { page, ctx } = await persona('sunrise', 'admin@sunrise.health', 'Admin@123');
  await go(page, '/dashboard', 'Collections');
  await snap(page, '03-dashboard');

  await go(page, '/patients?new=1', 'Register new patient');
  const dlg = page.getByRole('dialog');
  await dlg.locator('input').nth(0).fill('Meera');
  await dlg.locator('input').nth(1).fill('Choudhary');
  await dlg.locator('select').nth(0).selectOption('female');
  await dlg.locator('input[type=number]').first().fill('34');
  await dlg.getByPlaceholder('+91 98xxxxxxxx').fill('+91 9876543210');
  await dlg.getByPlaceholder('14-digit ABHA number').fill('91-2345-6789-0123');
  await dlg.locator('select').nth(1).selectOption('O+');
  await dlg.getByPlaceholder('e.g. Penicillin').fill('Penicillin');
  await dlg.getByPlaceholder('e.g. Penicillin').press('Enter');
  await dlg.getByPlaceholder('e.g. Diabetes').fill('Asthma');
  await dlg.getByPlaceholder('e.g. Diabetes').press('Enter');
  await page.waitForTimeout(500);
  await snap(page, '04-register-patient');

  await go(page, '/patients/1', 'Contact');
  await snap(page, '05-patient-profile');

  await go(page, '/appointments?book=1', 'Search patient by name');
  const b = page.getByRole('dialog');
  await b.getByText('Search patient by name').click();
  await page.keyboard.type('Arjun');
  await page.waitForTimeout(1200);
  await page.locator('[data-radix-popper-content-wrapper] button').first().click();
  await b.locator('select').first().selectOption(String(cardio.id));
  await b.locator('input[type=date]').first().fill(nextWeekday(2));
  await page.waitForTimeout(1500);
  await b.locator('button:not([disabled])').filter({ hasText: /^10:30 AM/ }).first().click();
  await b.getByPlaceholder('e.g. Fever for 3 days').fill('Review of BP and ECG');
  await page.waitForTimeout(400);
  await snap(page, '06-book-appointment');

  await go(page, '/appointments', 'Live queue');
  await snap(page, '07-live-queue');

  await go(page, `/billing/invoices/${unpaid.id}?pay=1`, 'Collect payment');
  await page.getByRole('dialog').getByRole('button', { name: 'upi', exact: true }).click();
  await page.getByRole('dialog').getByRole('textbox').last().fill('UPI-4521-8890');
  await snap(page, '10-collect-payment');

  await go(page, '/ipd', 'Bed board');
  await snap(page, '15-bed-board');
  await go(page, `/ipd/admissions/${admission.id}`, 'Clinical timeline');
  await snap(page, '16-admission');

  await go(page, '/reports', 'Daily collections');
  await snap(page, '17-reports');

  await go(page, '/settings', 'Organisation profile');
  await page.getByRole('button', { name: 'Branding' }).click();
  await page.waitForTimeout(400);
  await page.getByRole('button', { name: 'Use colour #7c3aed' }).click();
  await page.waitForTimeout(600);
  await snap(page, '18-branding');
  await page.getByRole('button', { name: 'Use colour #0d9488' }).click();

  await go(page, '/settings', 'Organisation profile');
  await page.getByRole('button', { name: 'Patient fields' }).click();
  await page.waitForTimeout(500);
  await snap(page, '19-custom-fields');

  await go(page, '/users', 'Users & roles');
  await page.getByRole('tab', { name: 'Roles & permissions' }).click();
  await page.waitForTimeout(500);
  await page.locator('div.rounded-xl', { hasText: 'Consultations, prescriptions, orders' }).getByRole('button', { name: 'Edit' }).click();
  await page.waitForTimeout(700);
  await snap(page, '20-roles-permissions');
  await page.keyboard.press('Escape');

  await go(page, '/dashboard', 'Collections');
  await page.keyboard.press('Control+k');
  await page.keyboard.type('Ar');
  await page.waitForTimeout(1200);
  await snap(page, '21-command-palette');
  await ctx.close();
}

// Doctor
{
  const { page, ctx } = await persona('sunrise', 'doctor@sunrise.health', 'Staff@123');
  await go(page, `/opd/${draft.enc.id}`, 'Vitals');
  await snap(page, '08-consultation');
  await page.getByText('Quantity is auto-calculated').scrollIntoViewIfNeeded();
  await page.evaluate(() => window.scrollBy(0, -140));
  await page.waitForTimeout(500);
  await snap(page, '09-prescription');
  await go(page, `/print/prescription/${final.enc.id}`, 'Prescription');
  await snap(page, '11-print-prescription');
  await ctx.close();
}

// Pharmacist
{
  const { page, ctx } = await persona('sunrise', 'pharmacy@sunrise.health', 'Staff@123');
  await go(page, '/pharmacy/dispense', 'Prescriptions');
  await page.locator('div.rounded-xl', { hasText: 'Kavya Reddy' }).getByRole('button', { name: 'Dispense', exact: true }).click();
  await page.waitForTimeout(1200);
  await snap(page, '12-dispense');
  await page.keyboard.press('Escape');
  await go(page, '/pharmacy/stock', 'On hand');
  await snap(page, '13-pharmacy-stock');
  await ctx.close();
}

// Lab technician
{
  const { page, ctx } = await persona('sunrise', 'lab@sunrise.health', 'Staff@123');
  await go(page, `/lab/orders/${labPending.id}`, 'Order details');
  const vals = ['10.4', '12800', '2.6', '4.5', '238', '186', '36', '98'];
  const inputs = page.locator('table input');
  for (let i = 0; i < Math.min(vals.length, await inputs.count()); i++) await inputs.nth(i).fill(vals[i]);
  await page.locator('h1, p.font-mono').first().click().catch(() => {});
  await page.evaluate(() => window.scrollTo(0, 0));
  await page.waitForTimeout(500);
  await snap(page, '14-lab-results');
  await go(page, `/print/lab/${labDone.id}`, 'Laboratory report');
  await snap(page, '14b-lab-report');
  await ctx.close();
}

// Patient portal
{
  const { page, ctx } = await persona('sunrise', 'patient@sunrise.health', 'Patient@123');
  await go(page, '/portal', 'Upcoming appointments');
  await snap(page, '22-portal-home');
  await go(page, '/portal/book', 'Book an appointment');
  await page.locator('div.rounded-xl', { hasText: 'Dr. Kavita Nair' }).first().click();
  await page.waitForTimeout(600);
  await page.locator('main button').filter({ hasText: /^(Mon|Tue|Wed|Thu|Fri)/ }).nth(1).click();
  await page.waitForTimeout(1200);
  await page.locator('main button:not([disabled])').filter({ hasText: /^\d{1,2}:\d\d (AM|PM)$/ }).nth(2).click();
  await page.waitForTimeout(400);
  await snap(page, '23-portal-booking');
  await ctx.close();
}

// Platform owner
{
  const { page, ctx } = await persona('', 'owner@nexgen.health', 'Owner@123');
  await go(page, '/platform', 'Organisations by plan');
  await snap(page, '24-platform-overview');
  await go(page, '/platform/tenants', 'Sunrise Multispeciality');
  await page.getByText('Sunrise Multispeciality Hospital').first().click();
  await page.waitForTimeout(1200);
  await snap(page, '25-tenant-modules');
  await go(page, '/platform/plans', 'Starter');
  await snap(page, '26-plans');
  await ctx.close();
}

// Another tenant, own theme + Starter plan navigation
{
  const { page, ctx } = await persona('carewell', 'admin@carewell.clinic', 'Admin@123');
  await go(page, '/dashboard', 'Today');
  await snap(page, '27-second-tenant');
  await ctx.close();
}

// Dark mode + mobile
{
  const { page, ctx } = await persona('sunrise', 'admin@sunrise.health', 'Admin@123', { dark: true });
  await go(page, '/dashboard', 'Collections');
  await snap(page, '28-dark-mode');
  await ctx.close();
}
{
  const { page, ctx } = await persona('sunrise', 'reception@sunrise.health', 'Staff@123', { viewport: { width: 390, height: 844 }, scale: 2 });
  await go(page, '/appointments', 'Live queue');
  await snap(page, '29-mobile-queue');
  await go(page, '/dashboard', 'Appointments today');
  await snap(page, '30-mobile-dashboard');
  await ctx.close();
}

await browser.close();
console.log(`\n${shots.length} screenshots written to docs/images/screens/`);
