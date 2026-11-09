import { Router } from 'express';
import { and, asc, count, eq, gte, inArray, lte, sql } from 'drizzle-orm';
import { z } from 'zod';
import { db } from '../../db/client.js';
import {
  appointments,
  beds,
  branches,
  departments,
  doctorLeaves,
  doctors,
  doctorSchedules,
  labTests,
  medicines,
  services,
  wards,
} from '../../db/schema.js';
import { authenticate, requireAnyPermission, requirePermission, requireTenantUser, tctx } from '../../core/auth.js';
import { badRequest, conflict, notFound } from '../../core/errors.js';
import { audit, dateStr, likeTerm, optStr, paged, pagingSchema, pid, timeStr, timeToMin } from '../../core/util.js';
import { crudRouter } from './crud.js';
import { getSlots } from '../appointments/slots.js';

export const mastersRouter = Router();
mastersRouter.use(authenticate, requireTenantUser);

const active = z.boolean().default(true);
const rate = z.coerce.number().min(0).max(100).default(0);
const price = z.coerce.number().min(0).max(10_000_000);

// ------------------------------------------------------------------ simple masters
mastersRouter.use(
  '/departments',
  crudRouter({
    table: departments,
    entity: 'department',
    viewPermission: 'dashboard.view',
    managePermission: 'masters.manage',
    schema: z.object({ name: z.string().trim().min(2).max(100), code: optStr(20), description: optStr(300), isActive: active }),
    searchColumns: [departments.name, departments.code],
    orderBy: departments.name,
    label: (r) => String(r.name),
  }),
);

mastersRouter.use(
  '/branches',
  crudRouter({
    table: branches,
    entity: 'branch',
    viewPermission: 'dashboard.view',
    managePermission: 'settings.manage',
    schema: z.object({
      name: z.string().trim().min(2).max(120),
      code: z.string().trim().min(1).max(20),
      address: optStr(300),
      phone: optStr(30),
      isActive: active,
    }),
    searchColumns: [branches.name, branches.code],
    orderBy: branches.name,
    label: (r) => String(r.name),
  }),
);

mastersRouter.use(
  '/services',
  crudRouter({
    table: services,
    entity: 'service',
    viewPermission: 'dashboard.view',
    managePermission: 'masters.manage',
    schema: z.object({
      code: optStr(30),
      name: z.string().trim().min(2).max(150),
      category: z.enum(['consultation', 'procedure', 'investigation', 'room', 'nursing', 'package', 'other']),
      price,
      taxRate: rate,
      isActive: active,
    }),
    searchColumns: [services.name, services.code],
    orderBy: services.name,
    label: (r) => String(r.name),
    filters: (q) => [q.category ? eq(services.category, String(q.category) as 'other') : undefined],
  }),
);

mastersRouter.use(
  '/medicines',
  crudRouter({
    table: medicines,
    entity: 'medicine',
    viewPermission: 'dashboard.view',
    managePermission: 'pharmacy.manage',
    schema: z.object({
      name: z.string().trim().min(2).max(150),
      genericName: optStr(150),
      form: optStr(40),
      strength: optStr(40),
      manufacturer: optStr(120),
      category: optStr(60),
      hsnCode: optStr(20),
      unit: z.string().trim().min(1).max(20).default('unit'),
      reorderLevel: z.coerce.number().int().min(0).max(1_000_000).default(10),
      salePrice: price,
      taxRate: rate,
      isActive: active,
    }),
    searchColumns: [medicines.name, medicines.genericName],
    orderBy: medicines.name,
    label: (r) => String(r.name),
  }),
);

const labParam = z.object({
  name: z.string().trim().min(1).max(80),
  unit: z.string().trim().max(20).optional(),
  refLow: z.coerce.number().nullable().optional(),
  refHigh: z.coerce.number().nullable().optional(),
  refText: z.string().trim().max(80).optional(),
});

mastersRouter.use(
  '/lab-tests',
  crudRouter({
    table: labTests,
    entity: 'lab test',
    viewPermission: 'dashboard.view',
    managePermission: 'lab.manage',
    schema: z.object({
      code: optStr(30),
      name: z.string().trim().min(2).max(150),
      category: optStr(60),
      sampleType: optStr(60),
      price,
      taxRate: rate,
      turnaroundHours: z.coerce.number().int().min(1).max(720).default(24),
      parameters: z.array(labParam).min(1).max(60),
      isActive: active,
    }),
    searchColumns: [labTests.name, labTests.code, labTests.category],
    orderBy: labTests.name,
    label: (r) => String(r.name),
  }),
);

// ------------------------------------------------------------------ wards & beds
const wardSchema = z.object({
  name: z.string().trim().min(2).max(100),
  type: z.enum(['general', 'semi_private', 'private', 'icu', 'nicu', 'emergency', 'maternity']),
  floor: optStr(20),
  dailyRate: price,
  isActive: active,
});

mastersRouter.get('/wards', requirePermission('ipd.view'), async (req, res) => {
  const a = tctx(req);
  const ws = await db.select().from(wards).where(eq(wards.tenantId, a.tenantId)).orderBy(asc(wards.name));
  const bs = await db.select().from(beds).where(eq(beds.tenantId, a.tenantId)).orderBy(asc(beds.bedNo));
  res.json(ws.map((w) => ({ ...w, beds: bs.filter((b) => b.wardId === w.id) })));
});

mastersRouter.post('/wards', requirePermission('ipd.manage'), async (req, res) => {
  const a = tctx(req);
  const body = wardSchema.extend({ bedCount: z.coerce.number().int().min(0).max(200).default(0), bedPrefix: z.string().max(8).default('B') }).parse(req.body);
  const { bedCount, bedPrefix, ...ward } = body;
  const id = await db.transaction(async (tx) => {
    const [r] = await tx.insert(wards).values({ ...ward, tenantId: a.tenantId });
    if (bedCount > 0) {
      await tx.insert(beds).values(
        Array.from({ length: bedCount }, (_, i) => ({
          tenantId: a.tenantId,
          wardId: r.insertId,
          bedNo: `${bedPrefix}-${String(i + 1).padStart(2, '0')}`,
        })),
      );
    }
    return r.insertId;
  });
  await audit(req, 'create', 'ward', id, `Created ward ${ward.name} with ${bedCount} beds`);
  res.status(201).json({ id });
});

mastersRouter.put('/wards/:id', requirePermission('ipd.manage'), async (req, res) => {
  const a = tctx(req);
  const id = pid(req);
  const body = wardSchema.parse(req.body);
  const [w] = await db.select({ id: wards.id }).from(wards).where(and(eq(wards.id, id), eq(wards.tenantId, a.tenantId)));
  if (!w) throw notFound('Ward');
  await db.update(wards).set(body).where(eq(wards.id, id));
  await audit(req, 'update', 'ward', id, `Updated ward ${body.name}`);
  res.json({ ok: true });
});

mastersRouter.post('/wards/:id/beds', requirePermission('ipd.manage'), async (req, res) => {
  const a = tctx(req);
  const wardId = pid(req);
  const body = z.object({ bedNo: z.string().trim().min(1).max(20), dailyRate: price.nullable().optional() }).parse(req.body);
  const [w] = await db.select({ id: wards.id }).from(wards).where(and(eq(wards.id, wardId), eq(wards.tenantId, a.tenantId)));
  if (!w) throw notFound('Ward');
  const [r] = await db.insert(beds).values({ ...body, wardId, tenantId: a.tenantId });
  await audit(req, 'create', 'bed', r.insertId, `Added bed ${body.bedNo}`);
  res.status(201).json({ id: r.insertId });
});

mastersRouter.patch('/beds/:id', requireAnyPermission('ipd.manage', 'ipd.notes', 'ipd.admit'), async (req, res) => {
  const a = tctx(req);
  const id = pid(req);
  const body = z
    .object({
      status: z.enum(['available', 'cleaning', 'maintenance', 'reserved']).optional(),
      dailyRate: price.nullable().optional(),
      bedNo: z.string().trim().min(1).max(20).optional(),
    })
    .parse(req.body);
  const [b] = await db.select().from(beds).where(and(eq(beds.id, id), eq(beds.tenantId, a.tenantId)));
  if (!b) throw notFound('Bed');
  if (b.status === 'occupied' && body.status) throw conflict('Bed is occupied. Discharge or transfer the patient first.');
  if ((body.dailyRate !== undefined || body.bedNo) && !a.permissions.has('ipd.manage')) {
    throw badRequest('Only ward managers can change bed number or rate');
  }
  await db.update(beds).set(body).where(eq(beds.id, id));
  await audit(req, 'update', 'bed', id, `Bed ${b.bedNo} → ${body.status ?? 'updated'}`);
  res.json({ ok: true });
});

mastersRouter.delete('/beds/:id', requirePermission('ipd.manage'), async (req, res) => {
  const a = tctx(req);
  const id = pid(req);
  const [b] = await db.select().from(beds).where(and(eq(beds.id, id), eq(beds.tenantId, a.tenantId)));
  if (!b) throw notFound('Bed');
  if (b.status === 'occupied') throw conflict('Bed is occupied');
  await db.delete(beds).where(eq(beds.id, id));
  await audit(req, 'delete', 'bed', id, `Removed bed ${b.bedNo}`);
  res.json({ ok: true });
});

// ------------------------------------------------------------------ doctors
const doctorSchema = z.object({
  name: z.string().trim().min(2).max(120),
  departmentId: z.coerce.number().int().positive().nullable().optional(),
  specialization: optStr(120),
  qualification: optStr(200),
  registrationNo: optStr(60),
  experienceYears: z.coerce.number().int().min(0).max(80).default(0),
  phone: optStr(30),
  email: z.string().trim().email().max(150).or(z.literal('')).nullable().optional(),
  bio: optStr(2000),
  photoUrl: optStr(500),
  consultationFee: price.default(0),
  followUpFee: price.default(0),
  followUpDays: z.coerce.number().int().min(0).max(365).default(7),
  slotMinutes: z.coerce.number().int().min(5).max(240).default(15),
  maxPerSlot: z.coerce.number().int().min(1).max(100).default(1),
  telehealthEnabled: z.boolean().default(false),
  isActive: active,
});

const scheduleSchema = z
  .array(z.object({ dayOfWeek: z.coerce.number().int().min(0).max(6), startTime: timeStr, endTime: timeStr }))
  .max(42)
  .superRefine((rows, ctx) => {
    rows.forEach((r, i) => {
      if (timeToMin(r.endTime) <= timeToMin(r.startTime)) {
        ctx.addIssue({ code: 'custom', path: [i, 'endTime'], message: 'End time must be after start time' });
      }
    });
    for (let d = 0; d <= 6; d++) {
      const day = rows.filter((r) => r.dayOfWeek === d).sort((x, y) => timeToMin(x.startTime) - timeToMin(y.startTime));
      for (let i = 1; i < day.length; i++) {
        if (timeToMin(day[i].startTime) < timeToMin(day[i - 1].endTime)) {
          ctx.addIssue({ code: 'custom', path: [], message: 'Sessions on the same day must not overlap' });
        }
      }
    }
  });

async function assertDepartment(tenantId: number, departmentId?: number | null) {
  if (!departmentId) return;
  const [d] = await db.select({ id: departments.id }).from(departments).where(and(eq(departments.id, departmentId), eq(departments.tenantId, tenantId)));
  if (!d) throw badRequest('Unknown department');
}

async function getDoctor(tenantId: number, id: number) {
  const [d] = await db.select().from(doctors).where(and(eq(doctors.id, id), eq(doctors.tenantId, tenantId)));
  if (!d) throw notFound('Doctor');
  return d;
}

mastersRouter.get('/doctors', requirePermission('dashboard.view'), async (req, res) => {
  const a = tctx(req);
  const p = pagingSchema
    .extend({ all: z.coerce.boolean().optional(), departmentId: z.coerce.number().int().optional(), active: z.enum(['true', 'false']).optional() })
    .parse(req.query);
  const where = and(
    eq(doctors.tenantId, a.tenantId),
    p.departmentId ? eq(doctors.departmentId, p.departmentId) : undefined,
    p.active ? eq(doctors.isActive, p.active === 'true') : undefined,
    p.q ? sql`(${doctors.name} LIKE ${likeTerm(p.q)} OR ${doctors.specialization} LIKE ${likeTerm(p.q)})` : undefined,
  );
  const q = db
    .select({ doctor: doctors, departmentName: departments.name })
    .from(doctors)
    .leftJoin(departments, eq(departments.id, doctors.departmentId))
    .where(where)
    .orderBy(asc(doctors.name));
  const rows = p.all ? await q.limit(1000) : await q.limit(p.pageSize).offset((p.page - 1) * p.pageSize);
  const ids = rows.map((r) => r.doctor.id);
  const sched = ids.length
    ? await db.select().from(doctorSchedules).where(and(eq(doctorSchedules.tenantId, a.tenantId), inArray(doctorSchedules.doctorId, ids)))
    : [];
  const data = rows.map((r) => ({
    ...r.doctor,
    departmentName: r.departmentName,
    schedule: sched.filter((s) => s.doctorId === r.doctor.id),
  }));
  if (p.all) return res.json(data);
  const [{ n }] = await db.select({ n: count() }).from(doctors).where(where);
  res.json(paged(data, n, p));
});

mastersRouter.get('/doctors/:id', requirePermission('dashboard.view'), async (req, res) => {
  const a = tctx(req);
  const d = await getDoctor(a.tenantId, pid(req));
  const schedule = await db
    .select()
    .from(doctorSchedules)
    .where(and(eq(doctorSchedules.tenantId, a.tenantId), eq(doctorSchedules.doctorId, d.id)))
    .orderBy(asc(doctorSchedules.dayOfWeek), asc(doctorSchedules.startTime));
  const leaves = await db
    .select()
    .from(doctorLeaves)
    .where(and(eq(doctorLeaves.tenantId, a.tenantId), eq(doctorLeaves.doctorId, d.id)))
    .orderBy(asc(doctorLeaves.dateFrom));
  res.json({ ...d, schedule, leaves });
});

mastersRouter.post('/doctors', requirePermission('masters.manage'), async (req, res) => {
  const a = tctx(req);
  const body = doctorSchema.extend({ schedule: scheduleSchema.optional() }).parse(req.body);
  await assertDepartment(a.tenantId, body.departmentId);
  const { schedule, ...doc } = body;
  const id = await db.transaction(async (tx) => {
    const [r] = await tx.insert(doctors).values({ ...doc, email: doc.email || null, tenantId: a.tenantId });
    if (schedule?.length) {
      await tx.insert(doctorSchedules).values(schedule.map((s) => ({ ...s, tenantId: a.tenantId, doctorId: r.insertId })));
    }
    return r.insertId;
  });
  await audit(req, 'create', 'doctor', id, `Added doctor ${doc.name}`);
  res.status(201).json({ id });
});

mastersRouter.put('/doctors/:id', requirePermission('masters.manage'), async (req, res) => {
  const a = tctx(req);
  const id = pid(req);
  await getDoctor(a.tenantId, id);
  const body = doctorSchema.parse(req.body);
  await assertDepartment(a.tenantId, body.departmentId);
  await db.update(doctors).set({ ...body, email: body.email || null }).where(eq(doctors.id, id));
  await audit(req, 'update', 'doctor', id, `Updated doctor ${body.name}`);
  res.json({ ok: true });
});

mastersRouter.put('/doctors/:id/schedule', requirePermission('masters.manage'), async (req, res) => {
  const a = tctx(req);
  const id = pid(req);
  const d = await getDoctor(a.tenantId, id);
  const schedule = scheduleSchema.parse(req.body.schedule ?? req.body);
  await db.transaction(async (tx) => {
    await tx.delete(doctorSchedules).where(and(eq(doctorSchedules.tenantId, a.tenantId), eq(doctorSchedules.doctorId, id)));
    if (schedule.length) {
      await tx.insert(doctorSchedules).values(schedule.map((s) => ({ ...s, tenantId: a.tenantId, doctorId: id })));
    }
  });
  await audit(req, 'update', 'doctor', id, `Updated weekly schedule for ${d.name}`, { sessions: schedule.length });
  res.json({ ok: true });
});

mastersRouter.post('/doctors/:id/leaves', requirePermission('masters.manage'), async (req, res) => {
  const a = tctx(req);
  const id = pid(req);
  const d = await getDoctor(a.tenantId, id);
  const body = z.object({ dateFrom: dateStr, dateTo: dateStr, reason: optStr(200) }).parse(req.body);
  if (body.dateTo < body.dateFrom) throw badRequest('Leave end date must be on or after the start date');
  const [{ n }] = await db
    .select({ n: count() })
    .from(appointments)
    .where(
      and(
        eq(appointments.tenantId, a.tenantId),
        eq(appointments.doctorId, id),
        gte(appointments.date, body.dateFrom),
        lte(appointments.date, body.dateTo),
        inArray(appointments.status, ['booked', 'checked_in']),
      ),
    );
  const [r] = await db.insert(doctorLeaves).values({ ...body, tenantId: a.tenantId, doctorId: id });
  await audit(req, 'create', 'doctor_leave', r.insertId, `Leave for ${d.name}: ${body.dateFrom} → ${body.dateTo}`);
  res.status(201).json({ id: r.insertId, affectedAppointments: n });
});

mastersRouter.delete('/doctors/:id/leaves/:leaveId', requirePermission('masters.manage'), async (req, res) => {
  const a = tctx(req);
  const id = pid(req);
  const leaveId = pid(req, 'leaveId');
  await db
    .delete(doctorLeaves)
    .where(and(eq(doctorLeaves.id, leaveId), eq(doctorLeaves.doctorId, id), eq(doctorLeaves.tenantId, a.tenantId)));
  await audit(req, 'delete', 'doctor_leave', leaveId, 'Removed doctor leave');
  res.json({ ok: true });
});

mastersRouter.get('/doctors/:id/slots', requireAnyPermission('appointments.view', 'appointments.create'), async (req, res) => {
  const a = tctx(req);
  const { date } = z.object({ date: dateStr }).parse(req.query);
  const doctor = await getDoctor(a.tenantId, pid(req));
  res.json(await getSlots(db, a.tenantId, a.settings, doctor, date));
});
