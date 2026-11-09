/**
 * Headless browser QA: signs in as every persona, visits each key screen
 * (light, dark and mobile), screenshots it, and fails on console errors,
 * uncaught exceptions or 5xx responses. Also drives a real booking flow.
 *
 *   npm run qa:ui -- http://localhost:5173
 *   CHROME_PATH=/path/to/chrome npm run qa:ui -- <baseUrl>
 *
 * Output: docs/qa/screenshots/*.png and docs/qa/ui-report.json
 */
import { chromium } from 'playwright-core';
import fs from 'node:fs';
import { fileURLToPath } from 'node:url';

const BASE = process.argv[2] ?? 'http://localhost:5180';
const OUT = fileURLToPath(new URL('../docs/qa/screenshots/', import.meta.url));
fs.mkdirSync(OUT, { recursive: true });
const browser = await chromium.launch({ executablePath: process.env.CHROME_PATH ?? 'C:/Program Files/Google/Chrome/Application/chrome.exe', headless: true });
const report = [];

async function session(label, org, email, pw, pages, opts = {}) {
  const ctx = await browser.newContext({ viewport: opts.viewport ?? { width: 1440, height: 900 }, colorScheme: opts.dark ? 'dark' : 'light' });
  const page = await ctx.newPage();
  const errors = [];
  page.on('console', (m) => m.type() === 'error' && errors.push(`console: ${m.text().slice(0, 200)}`));
  page.on('pageerror', (e) => errors.push(`pageerror: ${e.message.slice(0, 200)}`));
  page.on('response', (r) => r.url().includes('/api/') && r.status() >= 500 && errors.push(`HTTP ${r.status()} ${r.url()}`));
  await page.goto(`${BASE}/login`);
  await page.fill('#org', org);
  await page.fill('#email', email);
  await page.fill('#password', pw);
  await page.click('button[type=submit]');
  await page.waitForURL((u) => !u.pathname.startsWith('/login'), { timeout: 15000 });
  for (const [name, path, waitFor] of pages) {
    const before = errors.length;
    try {
      await page.goto(`${BASE}${path}`);
      await page.waitForLoadState('networkidle', { timeout: 15000 }).catch(() => {});
      if (waitFor) await page.waitForSelector(waitFor, { timeout: 8000 });
      await page.waitForTimeout(1600);
      const file = `${label}-${name}.png`;
      await page.screenshot({ path: OUT + file, fullPage: false });
      const h1 = (await page.locator('h1').first().textContent().catch(() => '')) ?? '';
      report.push({ who: label, page: name, path, ok: errors.length === before, heading: h1.trim().slice(0, 60), errors: errors.slice(before) });
    } catch (e) {
      report.push({ who: label, page: name, path, ok: false, errors: [String(e.message).slice(0, 300), ...errors.slice(before)] });
    }
  }
  await ctx.close();
}

await session('admin', 'sunrise', 'admin@sunrise.health', 'Admin@123', [
  ['dashboard', '/dashboard', 'text=Collections'],
  ['patients', '/patients', 'table'],
  ['patient-detail', '/patients/1', 'text=Contact'],
  ['appointments', '/appointments', 'text=Live queue'],
  ['billing', '/billing', 'table'],
  ['pharmacy-stock', '/pharmacy/stock', 'table'],
  ['lab', '/lab', 'table'],
  ['ipd', '/ipd', 'text=Bed board'],
  ['reports', '/reports', 'text=Daily collections'],
  ['masters', '/masters', 'table'],
  ['users', '/users', 'table'],
  ['settings', '/settings', 'text=Organisation profile'],
  ['audit', '/audit', 'table'],
  ['messages', '/messages', 'text=Compose'],
]);
await session('detail', 'sunrise', 'admin@sunrise.health', 'Admin@123', [
  ['consultation', '/opd/1', 'text=Vitals'],
  ['booking-dialog', '/appointments?book=1', 'text=Search patient by name'],
  ['lab-order', '/lab/orders/4', 'text=Order details'],
  ['admission', '/ipd/admissions/1', 'text=Clinical timeline'],
  ['invoice', '/billing/invoices/1', 'text=Payments & refunds'],
  ['print-rx', '/print/prescription/1', 'text=Prescription'],
  ['print-invoice', '/print/invoice/1', 'text=Tax invoice'],
  ['print-lab', '/print/lab/4', 'text=Laboratory report'],
  ['print-discharge', '/print/discharge/1', 'text=Discharge summary'],
]);
await session('doctor', 'sunrise', 'doctor@sunrise.health', 'Staff@123', [
  ['dashboard', '/dashboard'],
  ['queue', '/appointments', 'text=Live queue'],
  ['opd-list', '/opd', 'table'],
]);
await session('admin-dark', 'sunrise', 'admin@sunrise.health', 'Admin@123', [['dashboard', '/dashboard', 'text=Collections'], ['ipd', '/ipd', 'text=Bed board']], { dark: true });
await session('mobile', 'sunrise', 'reception@sunrise.health', 'Staff@123', [['appointments', '/appointments'], ['patients', '/patients']], { viewport: { width: 390, height: 844 } });
await session('patient', 'sunrise', 'patient@sunrise.health', 'Patient@123', [['home', '/portal'], ['book', '/portal/book'], ['records', '/portal/records']]);
await session('owner', '', 'owner@nexgen.health', 'Owner@123', [['overview', '/platform'], ['tenants', '/platform/tenants', 'table'], ['plans', '/platform/plans']]);
await session('carewell', 'carewell', 'admin@carewell.clinic', 'Admin@123', [['dashboard', '/dashboard'], ['blocked-pharmacy', '/pharmacy']]);

// Login page itself
{
  const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 } });
  const p = await ctx.newPage();
  await p.goto(`${BASE}/login`);
  await p.fill('#org', 'sunrise');
  await p.waitForTimeout(900);
  await p.screenshot({ path: OUT + 'login.png' });
  await p.goto(`${BASE}/signup`);
  await p.screenshot({ path: OUT + 'signup.png' });
  await ctx.close();
}


fs.writeFileSync(new URL('../docs/qa/ui-report.json', import.meta.url), JSON.stringify(report, null, 2));
const bad = report.filter((r) => !r.ok);
console.log(`${report.length - bad.length}/${report.length} screens clean`);
for (const b of bad) console.log(`✘ ${b.who}/${b.page}: ${b.errors.join(' | ')}`);
for (const r of report.filter((x) => x.ok)) console.log(`✔ ${r.who}/${r.page} — "${r.heading}"`);

// Interactive: booking flow + command palette
{
  const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 } });
  const page = await ctx.newPage();
  const errs = [];
  page.on('pageerror', (e) => errs.push(e.message));
  await page.goto(`${BASE}/login`);
  await page.fill('#org', 'sunrise'); await page.fill('#email', 'reception@sunrise.health'); await page.fill('#password', 'Staff@123');
  await page.click('button[type=submit]');
  await page.waitForURL((u) => !u.pathname.startsWith('/login'));
  await page.goto(`${BASE}/appointments?book=1`);
  await page.getByText('Search patient by name').click();
  await page.keyboard.type('Sha');
  await page.waitForTimeout(1200);
  await page.locator('[data-radix-popper-content-wrapper] button').first().click();
  const dlg = page.getByRole('dialog');
  const sel = dlg.locator('select').first();
  await sel.selectOption({ index: 2 });
  const d = new Date(Date.now() + 5.5*3600e3); do d.setUTCDate(d.getUTCDate()+1); while ([0,6].includes(d.getUTCDay()));
  await dlg.locator('input[type=date]').first().fill(d.toISOString().slice(0,10));
  await page.waitForTimeout(1200);
  await page.screenshot({ path: OUT + 'flow-booking-slots.png' });
  const slotBtn = dlg.locator('button:not([disabled])').filter({ hasText: /\d:\d\d (AM|PM)/ }).first();
  await slotBtn.click();
  await dlg.getByRole('button', { name: /^Book / }).click();
  await page.waitForTimeout(1500);
  await page.screenshot({ path: OUT + 'flow-booked-toast.png' });
  await page.keyboard.press('Control+k');
  await page.keyboard.type('UH-0000');
  await page.waitForTimeout(1200);
  await page.screenshot({ path: OUT + 'flow-command-palette.png' });
  console.log(`interactive flow: ${errs.length ? 'ERR ' + errs.join(' | ') : 'clean'}`);
  await ctx.close();
}
await browser.close();
