/** Notifications, patient messaging and global search (command palette). */
import { Router } from 'express';
import { and, count, desc, eq, inArray, isNull, or, sql } from 'drizzle-orm';
import { z } from 'zod';
import { db } from '../../db/client.js';
import { appointments, doctors, invoices, messageLogs, notifications, patients, users } from '../../db/schema.js';
import { authenticate, requirePermission, requireTenantUser, tctx } from '../../core/auth.js';
import { sendPatientMessage } from '../../core/notify.js';
import { audit, likeTerm, paged, pagingSchema, pid } from '../../core/util.js';
import { patientName } from '../patients/routes.js';

export const commsRouter = Router();
commsRouter.use(authenticate, requireTenantUser);

function visibleTo(userId: number, perms: Set<string>) {
  const list = [...perms];
  return and(
    or(
      eq(notifications.userId, userId),
      and(isNull(notifications.userId), list.length ? or(isNull(notifications.permission), inArray(notifications.permission, list)) : isNull(notifications.permission)),
    ),
  );
}

commsRouter.get('/notifications', async (req, res) => {
  const a = tctx(req);
  const where = and(eq(notifications.tenantId, a.tenantId), visibleTo(a.userId, a.permissions));
  const rows = await db.select().from(notifications).where(where).orderBy(desc(notifications.id)).limit(40);
  const unreadExpr = sql<number>`SUM(NOT JSON_CONTAINS(${notifications.readBy}, CAST(${a.userId} AS JSON)))`;
  const [{ unread }] = await db.select({ unread: unreadExpr }).from(notifications).where(where);
  res.json({
    unread: Number(unread ?? 0),
    items: rows.map(({ readBy, ...r }) => ({ ...r, read: readBy.includes(a.userId) })),
  });
});

commsRouter.post('/notifications/:id/read', async (req, res) => {
  const a = tctx(req);
  await db
    .update(notifications)
    .set({ readBy: sql`JSON_ARRAY_APPEND(${notifications.readBy}, '$', ${a.userId})` })
    .where(and(eq(notifications.id, pid(req)), eq(notifications.tenantId, a.tenantId), sql`NOT JSON_CONTAINS(${notifications.readBy}, CAST(${a.userId} AS JSON))`));
  res.json({ ok: true });
});

commsRouter.post('/notifications/read-all', async (req, res) => {
  const a = tctx(req);
  await db
    .update(notifications)
    .set({ readBy: sql`JSON_ARRAY_APPEND(${notifications.readBy}, '$', ${a.userId})` })
    .where(and(eq(notifications.tenantId, a.tenantId), visibleTo(a.userId, a.permissions), sql`NOT JSON_CONTAINS(${notifications.readBy}, CAST(${a.userId} AS JSON))`));
  res.json({ ok: true });
});

// ------------------------------------------------------------------ messaging (COM-2)
commsRouter.get('/messages', requirePermission('communication.send'), async (req, res) => {
  const a = tctx(req);
  const p = pagingSchema.parse(req.query);
  const where = eq(messageLogs.tenantId, a.tenantId);
  const rows = await db
    .select({ msg: messageLogs, patientName, uhid: patients.uhid, sentByName: users.fullName })
    .from(messageLogs)
    .leftJoin(patients, eq(patients.id, messageLogs.patientId))
    .leftJoin(users, eq(users.id, messageLogs.sentBy))
    .where(where)
    .orderBy(desc(messageLogs.id))
    .limit(p.pageSize)
    .offset((p.page - 1) * p.pageSize);
  const [{ n }] = await db.select({ n: count() }).from(messageLogs).where(where);
  res.json(paged(rows.map((r) => ({ ...r.msg, patientName: r.patientName, uhid: r.uhid, sentByName: r.sentByName })), n, p));
});

commsRouter.post('/messages', requirePermission('communication.send'), async (req, res) => {
  const a = tctx(req);
  const body = z
    .object({
      patientIds: z.array(z.coerce.number().int().positive()).min(1).max(500),
      channels: z.array(z.enum(['sms', 'email', 'whatsapp'])).min(1),
      subject: z.string().trim().max(200).optional(),
      body: z.string().trim().min(2).max(1000),
    })
    .parse(req.body);
  const pts = await db
    .select()
    .from(patients)
    .where(and(eq(patients.tenantId, a.tenantId), inArray(patients.id, body.patientIds), eq(patients.isDeleted, false)));
  let sent = 0;
  let skipped = 0;
  await db.transaction(async (tx) => {
    for (const p of pts) {
      const text = body.body.replaceAll('{name}', p.firstName).replaceAll('{uhid}', p.uhid);
      const r = await sendPatientMessage(tx, a.tenantId, a.settings, {
        patientId: p.id,
        phone: p.phone,
        email: p.email,
        subject: body.subject,
        body: text,
        sentBy: a.userId,
        channels: body.channels,
      });
      sent += r.length;
      skipped += body.channels.length - r.length;
    }
  });
  await audit(req, 'create', 'message', null, `Sent message to ${pts.length} patient(s) via ${body.channels.join(', ')}`);
  res.status(201).json({ recipients: pts.length, sent, skipped });
});

// ------------------------------------------------------------------ global search
commsRouter.get('/search', async (req, res) => {
  const a = tctx(req);
  const { q } = z.object({ q: z.string().trim().min(2).max(60) }).parse(req.query);
  const term = likeTerm(q);
  const out: Record<string, unknown[]> = { patients: [], doctors: [], appointments: [], invoices: [] };
  if (a.permissions.has('patients.view') && a.modules.has('patients')) {
    out.patients = await db
      .select({ id: patients.id, name: patientName, uhid: patients.uhid, phone: patients.phone })
      .from(patients)
      .where(and(eq(patients.tenantId, a.tenantId), eq(patients.isDeleted, false), or(sql`${patientName} LIKE ${term}`, sql`${patients.uhid} LIKE ${term}`, sql`${patients.phone} LIKE ${term}`)))
      .limit(6);
  }
  out.doctors = await db
    .select({ id: doctors.id, name: doctors.name, specialization: doctors.specialization })
    .from(doctors)
    .where(and(eq(doctors.tenantId, a.tenantId), sql`${doctors.name} LIKE ${term}`))
    .limit(4);
  if (a.permissions.has('appointments.view') && a.modules.has('appointments')) {
    out.appointments = await db
      .select({ id: appointments.id, appointmentNo: appointments.appointmentNo, date: appointments.date, status: appointments.status })
      .from(appointments)
      .where(and(eq(appointments.tenantId, a.tenantId), sql`${appointments.appointmentNo} LIKE ${term}`))
      .limit(4);
  }
  if (a.permissions.has('billing.view') && a.modules.has('billing')) {
    out.invoices = await db
      .select({ id: invoices.id, invoiceNo: invoices.invoiceNo, total: invoices.total, status: invoices.status })
      .from(invoices)
      .where(and(eq(invoices.tenantId, a.tenantId), sql`${invoices.invoiceNo} LIKE ${term}`))
      .limit(4);
  }
  res.json(out);
});
