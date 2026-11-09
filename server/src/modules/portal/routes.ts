/**
 * Patient portal (POR-1/2). Every query is pinned to BOTH the tenant and the
 * signed-in patient — a portal user can never address another patient's data.
 */
import { Router } from 'express';
import { and, asc, desc, eq, inArray } from 'drizzle-orm';
import { z } from 'zod';
import { db, lockingTx } from '../../db/client.js';
import {
  appointments,
  departments,
  doctors,
  encounters,
  invoiceItems,
  invoices,
  labOrderItems,
  labOrders,
  patients,
  prescriptionItems,
  tenants,
} from '../../db/schema.js';
import { authenticate, requirePatient, type AuthContext } from '../../core/auth.js';
import { badRequest, conflict, forbidden, notFound } from '../../core/errors.js';
import type { TenantSettings } from '../../core/settings.js';
import { audit, dateStr, nowInTz, optStr, pid, timeStr } from '../../core/util.js';
import { getSlots } from '../appointments/slots.js';
import { bookAppointment, changeStatus } from '../appointments/service.js';

export const portalRouter = Router();
portalRouter.use(authenticate, requirePatient);

type PortalCtx = AuthContext & { tenantId: number; patientId: number; settings: TenantSettings };
const pc = (req: Express.Request) => req.auth as PortalCtx;

portalRouter.get('/me', async (req, res) => {
  const a = pc(req);
  const [p] = await db.select().from(patients).where(and(eq(patients.id, a.patientId), eq(patients.tenantId, a.tenantId)));
  if (!p) throw notFound('Patient');
  const [t] = await db.select({ name: tenants.name, phone: tenants.phone, address: tenants.address, city: tenants.city }).from(tenants).where(eq(tenants.id, a.tenantId));
  res.json({
    patient: { ...p, name: `${p.firstName} ${p.lastName ?? ''}`.trim() },
    clinic: t,
    onlineBooking: a.settings.appointments.allowOnlineBooking,
  });
});

portalRouter.get('/appointments', async (req, res) => {
  const a = pc(req);
  const rows = await db
    .select({
      id: appointments.id,
      appointmentNo: appointments.appointmentNo,
      date: appointments.date,
      startTime: appointments.startTime,
      tokenNo: appointments.tokenNo,
      status: appointments.status,
      mode: appointments.mode,
      visitType: appointments.visitType,
      fee: appointments.fee,
      doctorName: doctors.name,
      specialization: doctors.specialization,
      departmentName: departments.name,
    })
    .from(appointments)
    .innerJoin(doctors, eq(doctors.id, appointments.doctorId))
    .leftJoin(departments, eq(departments.id, appointments.departmentId))
    .where(and(eq(appointments.tenantId, a.tenantId), eq(appointments.patientId, a.patientId)))
    .orderBy(desc(appointments.date), desc(appointments.startTime))
    .limit(100);
  res.json(rows);
});

portalRouter.get('/doctors', async (req, res) => {
  const a = pc(req);
  const rows = await db
    .select({
      id: doctors.id,
      name: doctors.name,
      specialization: doctors.specialization,
      qualification: doctors.qualification,
      experienceYears: doctors.experienceYears,
      consultationFee: doctors.consultationFee,
      photoUrl: doctors.photoUrl,
      bio: doctors.bio,
      telehealthEnabled: doctors.telehealthEnabled,
      departmentName: departments.name,
    })
    .from(doctors)
    .leftJoin(departments, eq(departments.id, doctors.departmentId))
    .where(and(eq(doctors.tenantId, a.tenantId), eq(doctors.isActive, true)))
    .orderBy(asc(doctors.name));
  res.json(rows);
});

portalRouter.get('/doctors/:id/slots', async (req, res) => {
  const a = pc(req);
  const { date } = z.object({ date: dateStr }).parse(req.query);
  const [d] = await db.select().from(doctors).where(and(eq(doctors.id, pid(req)), eq(doctors.tenantId, a.tenantId), eq(doctors.isActive, true)));
  if (!d) throw notFound('Doctor');
  res.json(await getSlots(db, a.tenantId, a.settings, d, date));
});

portalRouter.post('/appointments', async (req, res) => {
  const a = pc(req);
  if (!a.settings.appointments.allowOnlineBooking) throw forbidden('Online booking is not available. Please call the clinic.');
  const body = z
    .object({
      doctorId: z.coerce.number().int().positive(),
      date: dateStr,
      startTime: timeStr,
      mode: z.enum(['in_person', 'video']).default('in_person'),
      reason: optStr(300),
    })
    .parse(req.body);
  const [d] = await db.select().from(doctors).where(and(eq(doctors.id, body.doctorId), eq(doctors.tenantId, a.tenantId)));
  if (!d) throw notFound('Doctor');
  if (body.mode === 'video' && !d.telehealthEnabled) throw badRequest('This doctor does not offer video consultations');
  const result = await lockingTx((tx) =>
    bookAppointment(tx, { tenantId: a.tenantId, userId: a.userId, settings: a.settings, modules: a.modules }, {
      ...body,
      patientId: a.patientId,
      source: 'portal',
    }),
  );
  await audit(req, 'create', 'appointment', result.id, `Portal booking ${result.appointmentNo}`);
  res.status(201).json(result);
});

portalRouter.post('/appointments/:id/cancel', async (req, res) => {
  const a = pc(req);
  const id = pid(req);
  const [appt] = await db
    .select()
    .from(appointments)
    .where(and(eq(appointments.id, id), eq(appointments.tenantId, a.tenantId), eq(appointments.patientId, a.patientId)));
  if (!appt) throw notFound('Appointment');
  if (appt.status !== 'booked') throw conflict('Only upcoming appointments can be cancelled online');
  const now = nowInTz(a.settings.locale.timezone);
  if (appt.date < now.date || (appt.date === now.date && appt.startTime <= now.time)) throw conflict('This appointment has already started');
  await db.transaction((tx) => changeStatus(tx, a.tenantId, id, 'cancelled', 'Cancelled by patient (portal)'));
  await audit(req, 'status', 'appointment', id, `${appt.appointmentNo} cancelled via portal`);
  res.json({ ok: true });
});

portalRouter.get('/prescriptions', async (req, res) => {
  const a = pc(req);
  const encs = await db
    .select({
      id: encounters.id,
      finalizedAt: encounters.finalizedAt,
      diagnoses: encounters.diagnoses,
      advice: encounters.advice,
      followUpDate: encounters.followUpDate,
      vitals: encounters.vitals,
      doctorName: doctors.name,
      specialization: doctors.specialization,
      qualification: doctors.qualification,
      registrationNo: doctors.registrationNo,
    })
    .from(encounters)
    .innerJoin(doctors, eq(doctors.id, encounters.doctorId))
    .where(and(eq(encounters.tenantId, a.tenantId), eq(encounters.patientId, a.patientId), eq(encounters.status, 'final')))
    .orderBy(desc(encounters.finalizedAt))
    .limit(50);
  const items = encs.length
    ? await db
        .select()
        .from(prescriptionItems)
        .where(and(eq(prescriptionItems.tenantId, a.tenantId), inArray(prescriptionItems.encounterId, encs.map((e) => e.id))))
    : [];
  res.json(encs.map((e) => ({ ...e, items: items.filter((i) => i.encounterId === e.id) })));
});

portalRouter.get('/lab-reports', async (req, res) => {
  const a = pc(req);
  const orders = await db
    .select({ id: labOrders.id, orderNo: labOrders.orderNo, verifiedAt: labOrders.verifiedAt, createdAt: labOrders.createdAt, doctorName: doctors.name })
    .from(labOrders)
    .leftJoin(doctors, eq(doctors.id, labOrders.doctorId))
    .where(and(eq(labOrders.tenantId, a.tenantId), eq(labOrders.patientId, a.patientId), eq(labOrders.status, 'verified')))
    .orderBy(desc(labOrders.verifiedAt))
    .limit(50);
  const items = orders.length
    ? await db.select().from(labOrderItems).where(and(eq(labOrderItems.tenantId, a.tenantId), inArray(labOrderItems.labOrderId, orders.map((o) => o.id))))
    : [];
  res.json(orders.map((o) => ({ ...o, items: items.filter((i) => i.labOrderId === o.id) })));
});

portalRouter.get('/invoices', async (req, res) => {
  const a = pc(req);
  const rows = await db
    .select()
    .from(invoices)
    .where(and(eq(invoices.tenantId, a.tenantId), eq(invoices.patientId, a.patientId), inArray(invoices.status, ['unpaid', 'partially_paid', 'paid', 'refunded'])))
    .orderBy(desc(invoices.id))
    .limit(100);
  const items = rows.length
    ? await db.select().from(invoiceItems).where(and(eq(invoiceItems.tenantId, a.tenantId), inArray(invoiceItems.invoiceId, rows.map((r) => r.id))))
    : [];
  res.json(rows.map((r) => ({ ...r, items: items.filter((i) => i.invoiceId === r.id) })));
});
