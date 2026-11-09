import { Router } from 'express';
import { and, asc, count, desc, eq, lt, ne, sql } from 'drizzle-orm';
import { z } from 'zod';
import { db } from '../../db/client.js';
import {
  appointments,
  departments,
  doctors,
  encounters,
  labOrderItems,
  labOrders,
  medicines,
  patients,
  prescriptionItems,
} from '../../db/schema.js';
import { authenticate, requirePermission, requireTenantUser, tctx } from '../../core/auth.js';
import { badRequest, conflict, notFound } from '../../core/errors.js';
import { notify } from '../../core/notify.js';
import { audit, dateStr, optStr, paged, pagingSchema, pid, round2 } from '../../core/util.js';
import { changeStatus } from '../appointments/service.js';
import { createLabOrder } from '../lab/service.js';
import { patientName } from '../patients/routes.js';

export const opdRouter = Router();
opdRouter.use(authenticate, requireTenantUser);

const num = (min: number, max: number) => z.coerce.number().min(min).max(max).nullable().optional();
const vitalsSchema = z
  .object({
    bpSystolic: num(40, 300),
    bpDiastolic: num(20, 200),
    pulse: num(20, 250),
    temperature: num(30, 45),
    spo2: num(40, 100),
    respiratoryRate: num(4, 80),
    weight: num(0.3, 400),
    height: num(20, 260),
  })
  .partial();

const rxItem = z.object({
  medicineId: z.coerce.number().int().positive().nullable().optional(),
  medicineName: z.string().trim().min(1).max(150),
  dose: optStr(60),
  frequency: optStr(60),
  durationDays: z.coerce.number().int().min(0).max(365).nullable().optional(),
  route: optStr(40),
  instructions: optStr(300),
  quantity: z.coerce.number().int().min(0).max(10000).default(0),
});

const encounterUpdate = z.object({
  chiefComplaint: optStr(2000),
  history: optStr(5000),
  examination: optStr(5000),
  vitals: vitalsSchema.default({}),
  diagnoses: z
    .array(z.object({ code: z.string().trim().max(20).optional(), description: z.string().trim().min(1).max(200), type: z.enum(['provisional', 'final']).optional() }))
    .max(20)
    .default([]),
  notes: optStr(5000),
  advice: optStr(3000),
  followUpDate: dateStr.nullable().optional(),
  prescriptions: z.array(rxItem).max(40).default([]),
});

const r1 = (n: number | null | undefined) => (n === null || n === undefined ? n : Math.round(n * 10) / 10);
const r0 = (n: number | null | undefined) => (n === null || n === undefined ? n : Math.round(n));

/** Normalise clinical precision (DEF-007) and derive BMI. */
function withBmi(v: z.infer<typeof vitalsSchema>) {
  const out = {
    ...v,
    bpSystolic: r0(v.bpSystolic),
    bpDiastolic: r0(v.bpDiastolic),
    pulse: r0(v.pulse),
    spo2: r0(v.spo2),
    respiratoryRate: r0(v.respiratoryRate),
    temperature: r1(v.temperature),
    weight: r1(v.weight),
    height: r1(v.height),
  };
  const bmi = out.weight && out.height ? round2(out.weight / Math.pow(out.height / 100, 2)) : null;
  return { ...out, bmi };
}

async function getEncounter(tenantId: number, id: number) {
  const [e] = await db.select().from(encounters).where(and(eq(encounters.id, id), eq(encounters.tenantId, tenantId)));
  if (!e) throw notFound('Encounter');
  return e;
}

opdRouter.get('/encounters', requirePermission('opd.view'), async (req, res) => {
  const a = tctx(req);
  const p = pagingSchema
    .extend({ patientId: z.coerce.number().int().optional(), doctorId: z.coerce.number().int().optional(), status: z.enum(['draft', 'final']).optional() })
    .parse(req.query);
  const where = and(
    eq(encounters.tenantId, a.tenantId),
    p.patientId ? eq(encounters.patientId, p.patientId) : undefined,
    p.doctorId ? eq(encounters.doctorId, p.doctorId) : undefined,
    p.status ? eq(encounters.status, p.status) : undefined,
  );
  const rows = await db
    .select({
      id: encounters.id,
      type: encounters.type,
      status: encounters.status,
      createdAt: encounters.createdAt,
      diagnoses: encounters.diagnoses,
      chiefComplaint: encounters.chiefComplaint,
      patientId: patients.id,
      patientName,
      uhid: patients.uhid,
      doctorName: doctors.name,
    })
    .from(encounters)
    .innerJoin(patients, eq(patients.id, encounters.patientId))
    .innerJoin(doctors, eq(doctors.id, encounters.doctorId))
    .where(where)
    .orderBy(desc(encounters.id))
    .limit(p.pageSize)
    .offset((p.page - 1) * p.pageSize);
  const [{ n }] = await db.select({ n: count() }).from(encounters).where(where);
  res.json(paged(rows, n, p));
});

/** Start (or resume) a consultation from an appointment (OPD-1). */
opdRouter.post('/encounters', requirePermission('opd.write'), async (req, res) => {
  const a = tctx(req);
  const body = z.object({ appointmentId: z.coerce.number().int().positive() }).parse(req.body);
  const result = await db.transaction(async (tx) => {
    const [appt] = await tx
      .select()
      .from(appointments)
      .where(and(eq(appointments.id, body.appointmentId), eq(appointments.tenantId, a.tenantId)));
    if (!appt) throw notFound('Appointment');
    const [existing] = await tx
      .select({ id: encounters.id })
      .from(encounters)
      .where(and(eq(encounters.tenantId, a.tenantId), eq(encounters.appointmentId, appt.id)));
    if (existing) return { id: existing.id, resumed: true };
    if (!['booked', 'checked_in', 'in_consultation'].includes(appt.status)) {
      throw conflict(`Cannot start a consultation for a ${appt.status.replace('_', ' ')} appointment`);
    }
    if (a.doctorId && a.doctorId !== appt.doctorId && a.roleCode === 'doctor') {
      throw badRequest('This appointment is booked with another doctor');
    }
    if (appt.status !== 'in_consultation') await changeStatus(tx, a.tenantId, appt.id, 'in_consultation');
    const [r] = await tx.insert(encounters).values({
      tenantId: a.tenantId,
      patientId: appt.patientId,
      doctorId: appt.doctorId,
      appointmentId: appt.id,
      type: 'opd',
      vitals: {},
      diagnoses: [],
      chiefComplaint: appt.reason ?? null,
      createdBy: a.userId,
    });
    return { id: r.insertId, resumed: false };
  });
  if (!result.resumed) await audit(req, 'create', 'encounter', result.id, `Consultation started for appointment ${body.appointmentId}`);
  res.status(result.resumed ? 200 : 201).json(result);
});

opdRouter.get('/encounters/:id', requirePermission('opd.view'), async (req, res) => {
  const a = tctx(req);
  const e = await getEncounter(a.tenantId, pid(req));
  const [patient] = await db.select().from(patients).where(eq(patients.id, e.patientId));
  const [doctor] = await db
    .select({ doctor: doctors, departmentName: departments.name })
    .from(doctors)
    .leftJoin(departments, eq(departments.id, doctors.departmentId))
    .where(eq(doctors.id, e.doctorId));
  const rx = await db
    .select()
    .from(prescriptionItems)
    .where(and(eq(prescriptionItems.tenantId, a.tenantId), eq(prescriptionItems.encounterId, e.id)))
    .orderBy(asc(prescriptionItems.id));
  const labs = await db
    .select({ id: labOrders.id, orderNo: labOrders.orderNo, status: labOrders.status, priority: labOrders.priority, createdAt: labOrders.createdAt })
    .from(labOrders)
    .where(and(eq(labOrders.tenantId, a.tenantId), eq(labOrders.encounterId, e.id)));
  const labItems = labs.length
    ? await db
        .select()
        .from(labOrderItems)
        .where(and(eq(labOrderItems.tenantId, a.tenantId), sql`${labOrderItems.labOrderId} IN (${sql.join(labs.map((l) => sql`${l.id}`), sql`, `)})`))
    : [];
  const history = await db
    .select({
      id: encounters.id,
      createdAt: encounters.createdAt,
      diagnoses: encounters.diagnoses,
      chiefComplaint: encounters.chiefComplaint,
      advice: encounters.advice,
      vitals: encounters.vitals,
      doctorName: doctors.name,
    })
    .from(encounters)
    .innerJoin(doctors, eq(doctors.id, encounters.doctorId))
    .where(and(eq(encounters.tenantId, a.tenantId), eq(encounters.patientId, e.patientId), ne(encounters.id, e.id), lt(encounters.createdAt, e.createdAt), eq(encounters.status, 'final')))
    .orderBy(desc(encounters.createdAt))
    .limit(10);
  const histRx = history.length
    ? await db
        .select()
        .from(prescriptionItems)
        .where(and(eq(prescriptionItems.tenantId, a.tenantId), sql`${prescriptionItems.encounterId} IN (${sql.join(history.map((h) => sql`${h.id}`), sql`, `)})`))
    : [];
  let appointment = null;
  if (e.appointmentId) {
    [appointment] = await db
      .select({ id: appointments.id, appointmentNo: appointments.appointmentNo, date: appointments.date, startTime: appointments.startTime, tokenNo: appointments.tokenNo, visitType: appointments.visitType, status: appointments.status })
      .from(appointments)
      .where(eq(appointments.id, e.appointmentId));
  }
  res.json({
    ...e,
    patient: { ...patient, name: `${patient.firstName} ${patient.lastName ?? ''}`.trim() },
    doctor: { ...doctor.doctor, departmentName: doctor.departmentName },
    appointment,
    prescriptions: rx,
    labOrders: labs.map((l) => ({ ...l, items: labItems.filter((i) => i.labOrderId === l.id) })),
    pastVisits: history.map((h) => ({ ...h, prescriptions: histRx.filter((r) => r.encounterId === h.id) })),
  });
});

opdRouter.put('/encounters/:id', requirePermission('opd.write'), async (req, res) => {
  const a = tctx(req);
  const id = pid(req);
  const e = await getEncounter(a.tenantId, id);
  if (e.status === 'final') throw conflict('This consultation is finalised and can no longer be edited');
  const body = encounterUpdate.parse(req.body);

  // Validate catalogue medicine references belong to this tenant
  const medIds = body.prescriptions.map((p) => p.medicineId).filter((x): x is number => Boolean(x));
  if (medIds.length) {
    const found = await db
      .select({ id: medicines.id })
      .from(medicines)
      .where(and(eq(medicines.tenantId, a.tenantId), sql`${medicines.id} IN (${sql.join(medIds.map((m) => sql`${m}`), sql`, `)})`));
    if (found.length !== new Set(medIds).size) throw badRequest('Unknown medicine in prescription');
  }

  await db.transaction(async (tx) => {
    const { prescriptions, vitals, ...fields } = body;
    await tx.update(encounters).set({ ...fields, vitals: withBmi(vitals) }).where(eq(encounters.id, id));
    await tx.delete(prescriptionItems).where(and(eq(prescriptionItems.tenantId, a.tenantId), eq(prescriptionItems.encounterId, id)));
    if (prescriptions.length) {
      await tx.insert(prescriptionItems).values(prescriptions.map((p) => ({ ...p, tenantId: a.tenantId, encounterId: id })));
    }
  });
  await audit(req, 'update', 'encounter', id, 'Saved consultation draft');
  res.json({ ok: true });
});

opdRouter.post('/encounters/:id/finalize', requirePermission('opd.write'), async (req, res) => {
  const a = tctx(req);
  const id = pid(req);
  const e = await getEncounter(a.tenantId, id);
  if (e.status === 'final') throw conflict('Already finalised');
  if (a.settings.clinical.requireVitals) {
    const v = e.vitals ?? {};
    if (!v.pulse && !v.bpSystolic && !v.temperature) throw badRequest('Record at least one vital sign before finalising (clinic policy)');
  }
  if (!e.diagnoses?.length && !e.chiefComplaint) throw badRequest('Add a chief complaint or diagnosis before finalising');
  const [{ rx }] = await db
    .select({ rx: count() })
    .from(prescriptionItems)
    .where(and(eq(prescriptionItems.tenantId, a.tenantId), eq(prescriptionItems.encounterId, id)));
  await db.transaction(async (tx) => {
    await tx
      .update(encounters)
      .set({ status: 'final', finalizedAt: new Date(), rxStatus: rx > 0 ? 'pending' : 'none' })
      .where(eq(encounters.id, id));
    if (e.appointmentId) {
      const [appt] = await tx.select({ status: appointments.status }).from(appointments).where(eq(appointments.id, e.appointmentId));
      if (appt?.status === 'in_consultation') await changeStatus(tx, a.tenantId, e.appointmentId, 'completed');
    }
    if (rx > 0 && a.modules.has('pharmacy')) {
      await notify(tx, a.tenantId, {
        title: 'New prescription to dispense',
        body: `${rx} item(s) prescribed`,
        link: '/pharmacy/dispense',
        type: 'pharmacy',
        permission: 'pharmacy.dispense',
      });
    }
  });
  await audit(req, 'status', 'encounter', id, 'Consultation finalised');
  res.json({ ok: true });
});

opdRouter.post('/encounters/:id/lab-orders', requirePermission('opd.write', 'lab.order'), async (req, res) => {
  const a = tctx(req);
  const id = pid(req);
  const e = await getEncounter(a.tenantId, id);
  const body = z
    .object({
      testIds: z.array(z.coerce.number().int().positive()).min(1).max(50),
      priority: z.enum(['routine', 'urgent', 'stat']).default('routine'),
      notes: optStr(500),
    })
    .parse(req.body);
  const result = await db.transaction((tx) =>
    createLabOrder(tx, a, { ...body, patientId: e.patientId, doctorId: e.doctorId, encounterId: e.id }),
  );
  await audit(req, 'create', 'lab_order', result.id, `Lab order ${result.orderNo} from consultation`);
  res.status(201).json(result);
});
