import { Router } from 'express';
import { and, asc, count, desc, eq, gte, lte, or, sql } from 'drizzle-orm';
import { z } from 'zod';
import { db, lockingTx } from '../../db/client.js';
import { appointments, departments, doctors, invoices, patients } from '../../db/schema.js';
import { authenticate, requirePermission, requireTenantUser, tctx } from '../../core/auth.js';
import { forbidden, notFound } from '../../core/errors.js';
import { audit, dateStr, likeTerm, optStr, paged, pagingSchema, pid, timeStr, todayFor } from '../../core/util.js';
import { bookAppointment, changeStatus, rescheduleAppointment } from './service.js';

export const appointmentsRouter = Router();
appointmentsRouter.use(authenticate, requireTenantUser);

const listColumns = {
  id: appointments.id,
  appointmentNo: appointments.appointmentNo,
  date: appointments.date,
  startTime: appointments.startTime,
  endTime: appointments.endTime,
  tokenNo: appointments.tokenNo,
  status: appointments.status,
  visitType: appointments.visitType,
  mode: appointments.mode,
  source: appointments.source,
  fee: appointments.fee,
  reason: appointments.reason,
  checkedInAt: appointments.checkedInAt,
  patientId: patients.id,
  patientName: sql<string>`CONCAT(${patients.firstName}, ' ', COALESCE(${patients.lastName}, ''))`,
  uhid: patients.uhid,
  patientPhone: patients.phone,
  gender: patients.gender,
  dob: patients.dob,
  doctorId: doctors.id,
  doctorName: doctors.name,
  departmentName: departments.name,
  invoiceId: appointments.invoiceId,
  invoiceStatus: invoices.status,
  invoiceBalance: invoices.balance,
};

const baseQuery = () =>
  db
    .select(listColumns)
    .from(appointments)
    .innerJoin(patients, eq(patients.id, appointments.patientId))
    .innerJoin(doctors, eq(doctors.id, appointments.doctorId))
    .leftJoin(departments, eq(departments.id, appointments.departmentId))
    .leftJoin(invoices, eq(invoices.id, appointments.invoiceId));

appointmentsRouter.get('/', requirePermission('appointments.view'), async (req, res) => {
  const a = tctx(req);
  const p = pagingSchema
    .extend({
      date: dateStr.optional(),
      from: dateStr.optional(),
      to: dateStr.optional(),
      doctorId: z.coerce.number().int().optional(),
      patientId: z.coerce.number().int().optional(),
      status: z.string().max(30).optional(),
    })
    .parse(req.query);
  const where = and(
    eq(appointments.tenantId, a.tenantId),
    p.date ? eq(appointments.date, p.date) : undefined,
    p.from ? gte(appointments.date, p.from) : undefined,
    p.to ? lte(appointments.date, p.to) : undefined,
    p.doctorId ? eq(appointments.doctorId, p.doctorId) : undefined,
    p.patientId ? eq(appointments.patientId, p.patientId) : undefined,
    p.status ? eq(appointments.status, p.status as 'booked') : undefined,
    p.q
      ? or(
          sql`CONCAT(${patients.firstName}, ' ', COALESCE(${patients.lastName}, '')) LIKE ${likeTerm(p.q)}`,
          sql`${patients.uhid} LIKE ${likeTerm(p.q)}`,
          sql`${patients.phone} LIKE ${likeTerm(p.q)}`,
          sql`${appointments.appointmentNo} LIKE ${likeTerm(p.q)}`,
        )
      : undefined,
  );
  const rows = await baseQuery()
    .where(where)
    .orderBy(desc(appointments.date), asc(appointments.startTime), asc(appointments.tokenNo))
    .limit(p.pageSize)
    .offset((p.page - 1) * p.pageSize);
  const [{ n }] = await db
    .select({ n: count() })
    .from(appointments)
    .innerJoin(patients, eq(patients.id, appointments.patientId))
    .where(where);
  res.json(paged(rows, n, p));
});

/** Live queue for a day (APT-8). */
appointmentsRouter.get('/queue', requirePermission('appointments.view'), async (req, res) => {
  const a = tctx(req);
  const q = z.object({ date: dateStr.optional(), doctorId: z.coerce.number().int().optional() }).parse(req.query);
  const date = q.date ?? todayFor(a.settings);
  const rows = await baseQuery()
    .where(
      and(
        eq(appointments.tenantId, a.tenantId),
        eq(appointments.date, date),
        q.doctorId ? eq(appointments.doctorId, q.doctorId) : undefined,
      ),
    )
    .orderBy(asc(doctors.name), asc(appointments.tokenNo));
  const summary: Record<string, number> = { booked: 0, checked_in: 0, in_consultation: 0, completed: 0, cancelled: 0, no_show: 0 };
  for (const r of rows) summary[r.status] = (summary[r.status] ?? 0) + 1;
  res.json({ date, summary, items: rows });
});

appointmentsRouter.get('/:id', requirePermission('appointments.view'), async (req, res) => {
  const a = tctx(req);
  const [row] = await baseQuery().where(and(eq(appointments.id, pid(req)), eq(appointments.tenantId, a.tenantId)));
  if (!row) throw notFound('Appointment');
  res.json(row);
});

const bookSchema = z.object({
  patientId: z.coerce.number().int().positive(),
  doctorId: z.coerce.number().int().positive(),
  date: dateStr.optional(),
  startTime: timeStr.optional(),
  mode: z.enum(['in_person', 'video']).default('in_person'),
  source: z.enum(['walk_in', 'phone', 'desk']).default('desk'),
  reason: optStr(300),
  notes: optStr(500),
  walkIn: z.boolean().default(false),
});

appointmentsRouter.post('/', requirePermission('appointments.create'), async (req, res) => {
  const a = tctx(req);
  const body = bookSchema.parse(req.body);
  const result = await lockingTx((tx) => bookAppointment(tx, a, body));
  await audit(req, 'create', 'appointment', result.id, `Booked ${result.appointmentNo} (token ${result.tokenNo})`);
  res.status(201).json(result);
});

appointmentsRouter.post('/:id/reschedule', requirePermission('appointments.update'), async (req, res) => {
  const a = tctx(req);
  const id = pid(req);
  const body = z.object({ date: dateStr, startTime: timeStr }).parse(req.body);
  const result = await lockingTx((tx) => rescheduleAppointment(tx, a, id, body.date, body.startTime));
  await audit(req, 'update', 'appointment', id, `Rescheduled to ${body.date} ${body.startTime.slice(0, 5)}`);
  res.json(result);
});

appointmentsRouter.post('/:id/status', requirePermission('appointments.update'), async (req, res) => {
  const a = tctx(req);
  const id = pid(req);
  const body = z
    .object({ status: z.enum(['booked', 'checked_in', 'in_consultation', 'completed', 'cancelled', 'no_show']), reason: optStr(300) })
    .parse(req.body);
  if (body.status === 'cancelled' && !a.permissions.has('appointments.cancel')) throw forbidden('You cannot cancel appointments');
  const result = await db.transaction((tx) => changeStatus(tx, a.tenantId, id, body.status, body.reason));
  await audit(req, 'status', 'appointment', id, `${result.appointmentNo} → ${body.status}${body.reason ? ` (${body.reason})` : ''}`);
  res.json({ ok: true, status: body.status, invoiceNote: (result as { invoiceNote?: string | null }).invoiceNote ?? null });
});
