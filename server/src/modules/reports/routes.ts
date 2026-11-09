import { Router } from 'express';
import { and, eq, gte, lte, sql } from 'drizzle-orm';
import { z } from 'zod';
import { db } from '../../db/client.js';
import {
  admissions,
  appointments,
  beds,
  departments,
  doctors,
  encounters,
  invoiceItems,
  invoices,
  labOrderItems,
  labOrders,
  medicines,
  patients,
  payments,
} from '../../db/schema.js';
import { authenticate, requirePermission, requireTenantUser, tctx } from '../../core/auth.js';
import { addDays, dateStr, todayFor, qcol } from '../../core/util.js';

export const reportsRouter = Router();
reportsRouter.use(authenticate, requireTenantUser);

const rangeSchema = z.object({ from: dateStr.optional(), to: dateStr.optional() });
const utcStart = (d: string) => new Date(`${d}T00:00:00Z`);
const utcEnd = (d: string) => new Date(`${d}T23:59:59.999Z`);
const n = (v: unknown) => Number(v ?? 0);

/** Day bucket in the tenant's timezone. CONVERT_TZ needs tz tables; offsets are used as a portable fallback. */
function tzOffset(timezone: string): string {
  const now = new Date();
  const local = new Date(now.toLocaleString('en-US', { timeZone: timezone }));
  const utc = new Date(now.toLocaleString('en-US', { timeZone: 'UTC' }));
  const mins = Math.round((local.getTime() - utc.getTime()) / 60000);
  const sign = mins >= 0 ? '+' : '-';
  const abs = Math.abs(mins);
  return `${sign}${String(Math.floor(abs / 60)).padStart(2, '0')}:${String(abs % 60).padStart(2, '0')}`;
}

reportsRouter.get('/dashboard', requirePermission('dashboard.view'), async (req, res) => {
  const a = tctx(req);
  const t = a.tenantId;
  const today = todayFor(a.settings);
  const from30 = addDays(today, -29);
  const off = tzOffset(a.settings.locale.timezone);
  const has = (m: string) => a.modules.has(m);
  const can = (p: string) => a.permissions.has(p);

  const out: Record<string, unknown> = { today };

  const [apptToday] = await db
    .select({
      total: sql<number>`COUNT(*)`,
      waiting: sql<number>`SUM(${appointments.status} IN ('booked','checked_in'))`,
      inConsult: sql<number>`SUM(${appointments.status} = 'in_consultation')`,
      completed: sql<number>`SUM(${appointments.status} = 'completed')`,
      cancelled: sql<number>`SUM(${appointments.status} IN ('cancelled','no_show'))`,
    })
    .from(appointments)
    .where(and(eq(appointments.tenantId, t), eq(appointments.date, today)));
  out.appointmentsToday = {
    total: n(apptToday.total),
    waiting: n(apptToday.waiting),
    inConsultation: n(apptToday.inConsult),
    completed: n(apptToday.completed),
    cancelled: n(apptToday.cancelled),
  };

  const [pt] = await db
    .select({
      total: sql<number>`COUNT(*)`,
      today: sql<number>`SUM(DATE(CONVERT_TZ(${patients.createdAt}, '+00:00', ${off})) = ${today})`,
      month: sql<number>`SUM(DATE(CONVERT_TZ(${patients.createdAt}, '+00:00', ${off})) >= ${from30})`,
    })
    .from(patients)
    .where(and(eq(patients.tenantId, t), eq(patients.isDeleted, false)));
  out.patients = { total: n(pt.total), newToday: n(pt.today), new30d: n(pt.month) };

  const trend = await db
    .select({ day: sql<string>`DATE(${appointments.date})`, total: sql<number>`COUNT(*)`, completed: sql<number>`SUM(${appointments.status}='completed')` })
    .from(appointments)
    .where(and(eq(appointments.tenantId, t), gte(appointments.date, from30), lte(appointments.date, today)))
    .groupBy(appointments.date);
  out.appointmentTrend = trend.map((r) => ({ day: String(r.day).slice(0, 10), total: n(r.total), completed: n(r.completed) }));

  const byDept = await db
    .select({ name: sql<string>`COALESCE(${departments.name}, 'Unassigned')`, value: sql<number>`COUNT(*)` })
    .from(appointments)
    .leftJoin(departments, eq(departments.id, appointments.departmentId))
    .where(and(eq(appointments.tenantId, t), gte(appointments.date, from30)))
    .groupBy(departments.name);
  out.departmentLoad = byDept.map((r) => ({ name: r.name, value: n(r.value) })).sort((x, y) => y.value - x.value);

  if (has('billing') && can('billing.view')) {
    const rev = await db
      .select({ day: sql<string>`DATE(CONVERT_TZ(${payments.paidAt}, '+00:00', ${off}))`, amount: sql<number>`SUM(${payments.amount})` })
      .from(payments)
      .where(and(eq(payments.tenantId, t), gte(payments.paidAt, utcStart(addDays(from30, -1)))))
      .groupBy(sql`1`);
    const series = rev.map((r) => ({ day: String(r.day).slice(0, 10), amount: n(r.amount) })).filter((r) => r.day >= from30);
    out.revenueTrend = series;
    out.collectionToday = series.find((r) => r.day === today)?.amount ?? 0;
    out.collection30d = series.reduce((s, r) => s + r.amount, 0);
    const [due] = await db
      .select({ amount: sql<number>`COALESCE(SUM(${invoices.balance}),0)`, count: sql<number>`COUNT(*)` })
      .from(invoices)
      .where(and(eq(invoices.tenantId, t), sql`${invoices.status} IN ('unpaid','partially_paid')`));
    out.outstanding = { amount: n(due.amount), count: n(due.count) };
    const modes = await db
      .select({ name: payments.method, value: sql<number>`SUM(${payments.amount})` })
      .from(payments)
      .where(and(eq(payments.tenantId, t), gte(payments.paidAt, utcStart(from30))))
      .groupBy(payments.method);
    out.paymentModes = modes.map((m) => ({ name: m.name, value: n(m.value) }));
  }

  if (has('ipd') && can('ipd.view')) {
    const [b] = await db
      .select({ total: sql<number>`COUNT(*)`, occupied: sql<number>`SUM(${beds.status}='occupied')` })
      .from(beds)
      .where(eq(beds.tenantId, t));
    const [adm] = await db
      .select({ c: sql<number>`COUNT(*)` })
      .from(admissions)
      .where(and(eq(admissions.tenantId, t), eq(admissions.status, 'admitted')));
    out.beds = { total: n(b.total), occupied: n(b.occupied), occupancy: n(b.total) ? Math.round((n(b.occupied) / n(b.total)) * 100) : 0, admitted: n(adm.c) };
  }

  if (has('lab') && can('lab.view')) {
    const [l] = await db
      .select({
        pending: sql<number>`SUM(${labOrders.status} IN ('ordered','sample_collected'))`,
        toVerify: sql<number>`SUM(${labOrders.status}='completed')`,
        urgent: sql<number>`SUM(${labOrders.priority} <> 'routine' AND ${labOrders.status} IN ('ordered','sample_collected'))`,
      })
      .from(labOrders)
      .where(eq(labOrders.tenantId, t));
    out.lab = { pending: n(l.pending), toVerify: n(l.toVerify), urgent: n(l.urgent) };
  }

  if (has('pharmacy') && can('pharmacy.view')) {
    const soon = addDays(today, a.settings.pharmacy.nearExpiryDays);
    const [ph] = await db
      .select({
        low: sql<number>`SUM((SELECT COALESCE(SUM(b.quantity),0) FROM medicine_batches b WHERE b.medicine_id = ${qcol('medicines', 'id')} AND b.expiry_date >= ${today}) <= ${qcol('medicines', 'reorder_level')})`,
        expiring: sql<number>`SUM(EXISTS(SELECT 1 FROM medicine_batches b WHERE b.medicine_id = ${qcol('medicines', 'id')} AND b.quantity > 0 AND b.expiry_date BETWEEN ${today} AND ${soon}))`,
      })
      .from(medicines)
      .where(and(eq(medicines.tenantId, t), eq(medicines.isActive, true)));
    const [rx] = await db
      .select({ c: sql<number>`COUNT(*)` })
      .from(encounters)
      .where(and(eq(encounters.tenantId, t), eq(encounters.rxStatus, 'pending'), eq(encounters.status, 'final')));
    out.pharmacy = { lowStock: n(ph.low), expiringSoon: n(ph.expiring), pendingRx: n(rx.c) };
  }

  res.json(out);
});

reportsRouter.get('/collections', requirePermission('reports.view', 'billing.view'), async (req, res) => {
  const a = tctx(req);
  const r = rangeSchema.parse(req.query);
  const to = r.to ?? todayFor(a.settings);
  const from = r.from ?? addDays(to, -29);
  const off = tzOffset(a.settings.locale.timezone);
  const where = and(eq(payments.tenantId, a.tenantId), gte(payments.paidAt, utcStart(addDays(from, -1))), lte(payments.paidAt, utcEnd(addDays(to, 1))));
  const dayExpr = sql<string>`DATE(CONVERT_TZ(${payments.paidAt}, '+00:00', ${off}))`;
  const rows = await db
    .select({
      day: dayExpr,
      method: payments.method,
      collected: sql<number>`SUM(CASE WHEN ${payments.isRefund} THEN 0 ELSE ${payments.amount} END)`,
      refunded: sql<number>`SUM(CASE WHEN ${payments.isRefund} THEN -${payments.amount} ELSE 0 END)`,
      count: sql<number>`COUNT(*)`,
    })
    .from(payments)
    .where(where)
    .groupBy(sql`1`, payments.method);
  const inRange = rows.map((x) => ({ ...x, day: String(x.day).slice(0, 10) })).filter((x) => x.day >= from && x.day <= to);
  const daily = new Map<string, { day: string; collected: number; refunded: number; net: number }>();
  const byMethod = new Map<string, number>();
  for (const x of inRange) {
    const d = daily.get(x.day) ?? { day: x.day, collected: 0, refunded: 0, net: 0 };
    d.collected += n(x.collected);
    d.refunded += n(x.refunded);
    d.net = d.collected - d.refunded;
    daily.set(x.day, d);
    byMethod.set(x.method, (byMethod.get(x.method) ?? 0) + n(x.collected) - n(x.refunded));
  }
  const byType = await db
    .select({ type: invoices.type, billed: sql<number>`SUM(${invoices.total})`, count: sql<number>`COUNT(*)` })
    .from(invoices)
    .where(and(eq(invoices.tenantId, a.tenantId), sql`${invoices.status} <> 'cancelled'`, gte(invoices.createdAt, utcStart(from)), lte(invoices.createdAt, utcEnd(to))))
    .groupBy(invoices.type);
  const series = [...daily.values()].sort((x, y) => x.day.localeCompare(y.day));
  res.json({
    from,
    to,
    daily: series,
    byMethod: [...byMethod.entries()].map(([method, amount]) => ({ method, amount })),
    byType: byType.map((b) => ({ type: b.type, billed: n(b.billed), count: n(b.count) })),
    totals: {
      collected: series.reduce((s, d) => s + d.collected, 0),
      refunded: series.reduce((s, d) => s + d.refunded, 0),
      net: series.reduce((s, d) => s + d.net, 0),
    },
  });
});

reportsRouter.get('/doctors', requirePermission('reports.view'), async (req, res) => {
  const a = tctx(req);
  const r = rangeSchema.parse(req.query);
  const to = r.to ?? todayFor(a.settings);
  const from = r.from ?? addDays(to, -29);
  const rows = await db
    .select({
      doctorId: doctors.id,
      doctorName: doctors.name,
      department: departments.name,
      total: sql<number>`COUNT(${appointments.id})`,
      completed: sql<number>`SUM(${appointments.status}='completed')`,
      noShow: sql<number>`SUM(${appointments.status}='no_show')`,
      cancelled: sql<number>`SUM(${appointments.status}='cancelled')`,
      newVisits: sql<number>`SUM(${appointments.visitType}='new')`,
      followUps: sql<number>`SUM(${appointments.visitType}='follow_up')`,
      revenue: sql<number>`COALESCE(SUM(CASE WHEN ${appointments.status}='completed' THEN ${appointments.fee} ELSE 0 END),0)`,
    })
    .from(doctors)
    .leftJoin(departments, eq(departments.id, doctors.departmentId))
    .leftJoin(appointments, and(eq(appointments.doctorId, doctors.id), gte(appointments.date, from), lte(appointments.date, to)))
    .where(eq(doctors.tenantId, a.tenantId))
    .groupBy(doctors.id, doctors.name, departments.name);
  res.json({
    from,
    to,
    rows: rows
      .map((x) => ({
        ...x,
        total: n(x.total),
        completed: n(x.completed),
        noShow: n(x.noShow),
        cancelled: n(x.cancelled),
        newVisits: n(x.newVisits),
        followUps: n(x.followUps),
        revenue: n(x.revenue),
      }))
      .sort((x, y) => y.total - x.total),
  });
});

reportsRouter.get('/appointments', requirePermission('reports.view'), async (req, res) => {
  const a = tctx(req);
  const r = rangeSchema.parse(req.query);
  const to = r.to ?? todayFor(a.settings);
  const from = r.from ?? addDays(to, -29);
  const where = and(eq(appointments.tenantId, a.tenantId), gte(appointments.date, from), lte(appointments.date, to));
  const byStatus = await db.select({ name: appointments.status, value: sql<number>`COUNT(*)` }).from(appointments).where(where).groupBy(appointments.status);
  const bySource = await db.select({ name: appointments.source, value: sql<number>`COUNT(*)` }).from(appointments).where(where).groupBy(appointments.source);
  const byMode = await db.select({ name: appointments.mode, value: sql<number>`COUNT(*)` }).from(appointments).where(where).groupBy(appointments.mode);
  const byHour = await db
    .select({ hour: sql<number>`HOUR(${appointments.startTime})`, value: sql<number>`COUNT(*)` })
    .from(appointments)
    .where(where)
    .groupBy(sql`1`);
  const fmt = (rows: { name: string; value: unknown }[]) => rows.map((x) => ({ name: x.name, value: n(x.value) }));
  res.json({
    from,
    to,
    byStatus: fmt(byStatus),
    bySource: fmt(bySource),
    byMode: fmt(byMode),
    byHour: byHour.map((h) => ({ hour: n(h.hour), value: n(h.value) })).sort((x, y) => x.hour - y.hour),
  });
});

reportsRouter.get('/pharmacy', requirePermission('reports.view', 'pharmacy.view'), async (req, res) => {
  const a = tctx(req);
  const r = rangeSchema.parse(req.query);
  const to = r.to ?? todayFor(a.settings);
  const from = r.from ?? addDays(to, -29);
  const top = await db
    .select({
      name: medicines.name,
      quantity: sql<number>`SUM(${invoiceItems.quantity})`,
      amount: sql<number>`SUM(${invoiceItems.amount})`,
    })
    .from(invoiceItems)
    .innerJoin(invoices, eq(invoices.id, invoiceItems.invoiceId))
    .innerJoin(medicines, eq(medicines.id, invoiceItems.refId))
    .where(
      and(
        eq(invoiceItems.tenantId, a.tenantId),
        eq(invoiceItems.itemType, 'medicine'),
        sql`${invoices.status} <> 'cancelled'`,
        gte(invoices.createdAt, utcStart(from)),
        lte(invoices.createdAt, utcEnd(to)),
      ),
    )
    .groupBy(medicines.name)
    .orderBy(sql`3 DESC`)
    .limit(15);
  res.json({ from, to, topMedicines: top.map((x) => ({ name: x.name, quantity: n(x.quantity), amount: n(x.amount) })) });
});

reportsRouter.get('/lab', requirePermission('reports.view', 'lab.view'), async (req, res) => {
  const a = tctx(req);
  const r = rangeSchema.parse(req.query);
  const to = r.to ?? todayFor(a.settings);
  const from = r.from ?? addDays(to, -29);
  const rows = await db
    .select({ name: labOrderItems.testName, count: sql<number>`COUNT(*)`, revenue: sql<number>`SUM(${labOrderItems.price})` })
    .from(labOrderItems)
    .innerJoin(labOrders, eq(labOrders.id, labOrderItems.labOrderId))
    .where(
      and(
        eq(labOrderItems.tenantId, a.tenantId),
        sql`${labOrders.status} <> 'cancelled'`,
        gte(labOrders.createdAt, utcStart(from)),
        lte(labOrders.createdAt, utcEnd(to)),
      ),
    )
    .groupBy(labOrderItems.testName)
    .orderBy(sql`2 DESC`)
    .limit(20);
  res.json({ from, to, tests: rows.map((x) => ({ name: x.name, count: n(x.count), revenue: n(x.revenue) })) });
});
