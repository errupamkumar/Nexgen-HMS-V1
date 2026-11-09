import { Router } from 'express';
import { and, count, desc, eq, or, sql } from 'drizzle-orm';
import { z } from 'zod';
import { db } from '../../db/client.js';
import {
  admissions,
  appointments,
  beds,
  doctors,
  encounters,
  invoices,
  labOrderItems,
  labOrders,
  patients,
  prescriptionItems,
  roles,
  users,
  wards,
} from '../../db/schema.js';
import { authenticate, hashPassword, requirePermission, requireTenantUser, tctx } from '../../core/auth.js';
import { badRequest, conflict, notFound } from '../../core/errors.js';
import type { CustomFieldDef } from '../../core/settings.js';
import { audit, dateStr, likeTerm, nextNumber, optStr, paged, pagingSchema, pid, qcol } from '../../core/util.js';

export const patientsRouter = Router();
patientsRouter.use(authenticate, requireTenantUser);

const list = z.array(z.string().trim().min(1).max(100)).max(50).default([]);

export const patientSchema = z.object({
  firstName: z.string().trim().min(1).max(80),
  lastName: optStr(80),
  gender: z.enum(['male', 'female', 'other']),
  dob: dateStr.nullable().optional(),
  age: z.coerce.number().int().min(0).max(130).optional(),
  phone: z
    .string()
    .trim()
    .regex(/^\+?[0-9 -]{7,20}$/, 'enter a valid phone number'),
  email: z.string().trim().toLowerCase().email().max(150).or(z.literal('')).nullable().optional(),
  bloodGroup: z.enum(['A+', 'A-', 'B+', 'B-', 'AB+', 'AB-', 'O+', 'O-', '']).nullable().optional(),
  address: optStr(300),
  city: optStr(80),
  state: optStr(80),
  pincode: optStr(10),
  nationalId: optStr(40),
  emergencyName: optStr(120),
  emergencyPhone: optStr(20),
  allergies: list,
  conditions: list,
  notes: optStr(2000),
  customFields: z.record(z.string(), z.unknown()).default({}),
});

/** Validate custom fields against the tenant's configured definitions (CFG-7). */
export function validateCustomFields(defs: CustomFieldDef[], values: Record<string, unknown>) {
  const out: Record<string, unknown> = {};
  for (const def of defs) {
    const raw = values[def.key];
    const empty = raw === undefined || raw === null || raw === '';
    if (empty) {
      if (def.required) throw badRequest(`${def.label} is required`);
      continue;
    }
    if (def.type === 'number') {
      const n = Number(raw);
      if (!Number.isFinite(n)) throw badRequest(`${def.label} must be a number`);
      out[def.key] = n;
    } else if (def.type === 'date') {
      if (!/^\d{4}-\d{2}-\d{2}$/.test(String(raw))) throw badRequest(`${def.label} must be a date`);
      out[def.key] = String(raw);
    } else if (def.type === 'select') {
      if (!def.options?.includes(String(raw))) throw badRequest(`${def.label} must be one of: ${def.options?.join(', ')}`);
      out[def.key] = String(raw);
    } else {
      out[def.key] = String(raw).slice(0, 300);
    }
  }
  return out;
}

function normalise(body: z.infer<typeof patientSchema>) {
  const { age, ...rest } = body;
  let dob = rest.dob ?? null;
  if (!dob && age !== undefined) {
    const d = new Date();
    dob = `${d.getUTCFullYear() - age}-01-01`;
  }
  return { ...rest, dob, email: rest.email || null, bloodGroup: rest.bloodGroup || null };
}

export const patientName = sql<string>`TRIM(CONCAT(${patients.firstName}, ' ', COALESCE(${patients.lastName}, '')))`;

patientsRouter.get('/', requirePermission('patients.view'), async (req, res) => {
  const a = tctx(req);
  const p = pagingSchema.parse(req.query);
  const where = and(
    eq(patients.tenantId, a.tenantId),
    eq(patients.isDeleted, false),
    p.q
      ? or(
          sql`${patientName} LIKE ${likeTerm(p.q)}`,
          sql`${patients.uhid} LIKE ${likeTerm(p.q)}`,
          sql`${patients.phone} LIKE ${likeTerm(p.q)}`,
          sql`${patients.nationalId} LIKE ${likeTerm(p.q)}`,
        )
      : undefined,
  );
  const rows = await db
    .select({
      id: patients.id,
      uhid: patients.uhid,
      firstName: patients.firstName,
      lastName: patients.lastName,
      name: patientName,
      gender: patients.gender,
      dob: patients.dob,
      phone: patients.phone,
      email: patients.email,
      bloodGroup: patients.bloodGroup,
      city: patients.city,
      allergies: patients.allergies,
      createdAt: patients.createdAt,
      lastVisit: sql<string | null>`(SELECT MAX(ap.date) FROM appointments ap WHERE ap.patient_id = ${qcol('patients', 'id')} AND ap.status = 'completed')`,
    })
    .from(patients)
    .where(where)
    .orderBy(desc(patients.id))
    .limit(p.pageSize)
    .offset((p.page - 1) * p.pageSize);
  const [{ n }] = await db.select({ n: count() }).from(patients).where(where);
  res.json(paged(rows, n, p));
});

/** Possible duplicates by phone (PAT-3) — called by the registration form before saving. */
patientsRouter.get('/duplicates', requirePermission('patients.view'), async (req, res) => {
  const a = tctx(req);
  const { phone } = z.object({ phone: z.string().trim().min(5).max(20) }).parse(req.query);
  const rows = await db
    .select({ id: patients.id, uhid: patients.uhid, name: patientName, gender: patients.gender, dob: patients.dob })
    .from(patients)
    .where(and(eq(patients.tenantId, a.tenantId), eq(patients.phone, phone), eq(patients.isDeleted, false)))
    .limit(10);
  res.json(rows);
});

patientsRouter.get('/:id', requirePermission('patients.view'), async (req, res) => {
  const a = tctx(req);
  const id = pid(req);
  const [p] = await db
    .select()
    .from(patients)
    .where(and(eq(patients.id, id), eq(patients.tenantId, a.tenantId), eq(patients.isDeleted, false)));
  if (!p) throw notFound('Patient');
  const [portal] = await db
    .select({ id: users.id, email: users.email, status: users.status })
    .from(users)
    .where(and(eq(users.tenantId, a.tenantId), eq(users.patientId, id)))
    .limit(1);
  res.json({ ...p, name: `${p.firstName} ${p.lastName ?? ''}`.trim(), portalAccount: portal ?? null });
});

/** Unified longitudinal timeline (PAT-4). Clinical detail only for opd.view holders. */
patientsRouter.get('/:id/timeline', requirePermission('patients.view'), async (req, res) => {
  const a = tctx(req);
  const id = pid(req);
  const [p] = await db.select({ id: patients.id }).from(patients).where(and(eq(patients.id, id), eq(patients.tenantId, a.tenantId)));
  if (!p) throw notFound('Patient');
  const t = a.tenantId;
  const canClinical = a.permissions.has('opd.view') && a.modules.has('opd');

  const appts = await db
    .select({
      id: appointments.id,
      appointmentNo: appointments.appointmentNo,
      date: appointments.date,
      startTime: appointments.startTime,
      status: appointments.status,
      visitType: appointments.visitType,
      doctorName: doctors.name,
      tokenNo: appointments.tokenNo,
    })
    .from(appointments)
    .innerJoin(doctors, eq(doctors.id, appointments.doctorId))
    .where(and(eq(appointments.tenantId, t), eq(appointments.patientId, id)))
    .orderBy(desc(appointments.date), desc(appointments.startTime))
    .limit(100);

  const encs = canClinical
    ? await db
        .select({
          id: encounters.id,
          type: encounters.type,
          status: encounters.status,
          createdAt: encounters.createdAt,
          finalizedAt: encounters.finalizedAt,
          chiefComplaint: encounters.chiefComplaint,
          diagnoses: encounters.diagnoses,
          vitals: encounters.vitals,
          advice: encounters.advice,
          followUpDate: encounters.followUpDate,
          doctorName: doctors.name,
          appointmentId: encounters.appointmentId,
        })
        .from(encounters)
        .innerJoin(doctors, eq(doctors.id, encounters.doctorId))
        .where(and(eq(encounters.tenantId, t), eq(encounters.patientId, id)))
        .orderBy(desc(encounters.createdAt))
        .limit(100)
    : [];
  const rx = canClinical && encs.length
    ? await db
        .select()
        .from(prescriptionItems)
        .where(
          and(
            eq(prescriptionItems.tenantId, t),
            sql`${prescriptionItems.encounterId} IN (${sql.join(encs.map((e) => sql`${e.id}`), sql`, `)})`,
          ),
        )
    : [];

  const labs = a.modules.has('lab')
    ? await db
        .select({ id: labOrders.id, orderNo: labOrders.orderNo, status: labOrders.status, createdAt: labOrders.createdAt, priority: labOrders.priority })
        .from(labOrders)
        .where(and(eq(labOrders.tenantId, t), eq(labOrders.patientId, id)))
        .orderBy(desc(labOrders.createdAt))
        .limit(100)
    : [];
  const labItems = labs.length
    ? await db
        .select({ labOrderId: labOrderItems.labOrderId, testName: labOrderItems.testName })
        .from(labOrderItems)
        .where(and(eq(labOrderItems.tenantId, t), sql`${labOrderItems.labOrderId} IN (${sql.join(labs.map((l) => sql`${l.id}`), sql`, `)})`))
    : [];

  const bills = a.modules.has('billing')
    ? await db
        .select({
          id: invoices.id,
          invoiceNo: invoices.invoiceNo,
          type: invoices.type,
          status: invoices.status,
          total: invoices.total,
          balance: invoices.balance,
          createdAt: invoices.createdAt,
        })
        .from(invoices)
        .where(and(eq(invoices.tenantId, t), eq(invoices.patientId, id)))
        .orderBy(desc(invoices.createdAt))
        .limit(100)
    : [];

  const adms = a.modules.has('ipd')
    ? await db
        .select({
          id: admissions.id,
          admissionNo: admissions.admissionNo,
          status: admissions.status,
          admittedAt: admissions.admittedAt,
          dischargedAt: admissions.dischargedAt,
          doctorName: doctors.name,
          bedNo: beds.bedNo,
          wardName: wards.name,
        })
        .from(admissions)
        .innerJoin(doctors, eq(doctors.id, admissions.doctorId))
        .innerJoin(beds, eq(beds.id, admissions.bedId))
        .innerJoin(wards, eq(wards.id, beds.wardId))
        .where(and(eq(admissions.tenantId, t), eq(admissions.patientId, id)))
        .orderBy(desc(admissions.admittedAt))
    : [];

  res.json({
    appointments: appts,
    encounters: encs.map((e) => ({ ...e, prescriptions: rx.filter((r) => r.encounterId === e.id) })),
    labOrders: labs.map((l) => ({ ...l, tests: labItems.filter((i) => i.labOrderId === l.id).map((i) => i.testName) })),
    invoices: bills,
    admissions: adms,
    clinicalAccess: canClinical,
  });
});

patientsRouter.post('/', requirePermission('patients.create'), async (req, res) => {
  const a = tctx(req);
  const body = normalise(patientSchema.parse(req.body));
  const customFields = validateCustomFields(a.settings.patientFields, body.customFields);
  const result = await db.transaction(async (tx) => {
    const uhid = await nextNumber(tx, a.tenantId, a.settings, 'uhid');
    const [r] = await tx.insert(patients).values({ ...body, customFields, uhid, tenantId: a.tenantId, createdBy: a.userId });
    return { id: r.insertId, uhid };
  });
  await audit(req, 'create', 'patient', result.id, `Registered ${body.firstName} ${body.lastName ?? ''} (${result.uhid})`);
  res.status(201).json(result);
});

patientsRouter.put('/:id', requirePermission('patients.update'), async (req, res) => {
  const a = tctx(req);
  const id = pid(req);
  const body = normalise(patientSchema.parse(req.body));
  const customFields = validateCustomFields(a.settings.patientFields, body.customFields);
  const [p] = await db.select({ id: patients.id }).from(patients).where(and(eq(patients.id, id), eq(patients.tenantId, a.tenantId), eq(patients.isDeleted, false)));
  if (!p) throw notFound('Patient');
  await db.update(patients).set({ ...body, customFields }).where(eq(patients.id, id));
  await audit(req, 'update', 'patient', id, `Updated patient ${body.firstName} ${body.lastName ?? ''}`);
  res.json({ ok: true });
});

patientsRouter.delete('/:id', requirePermission('patients.delete'), async (req, res) => {
  const a = tctx(req);
  const id = pid(req);
  const [p] = await db.select().from(patients).where(and(eq(patients.id, id), eq(patients.tenantId, a.tenantId), eq(patients.isDeleted, false)));
  if (!p) throw notFound('Patient');
  const [{ n }] = await db
    .select({ n: count() })
    .from(admissions)
    .where(and(eq(admissions.tenantId, a.tenantId), eq(admissions.patientId, id), eq(admissions.status, 'admitted')));
  if (n) throw conflict('Patient is currently admitted');
  await db.update(patients).set({ isDeleted: true }).where(eq(patients.id, id));
  await audit(req, 'delete', 'patient', id, `Archived patient ${p.uhid}`);
  res.json({ ok: true });
});

/** Create / reset a patient-portal login (POR-1). */
patientsRouter.post('/:id/portal-account', requirePermission('patients.update'), async (req, res) => {
  const a = tctx(req);
  const id = pid(req);
  if (!a.modules.has('portal')) throw badRequest('The patient portal module is not enabled');
  const body = z.object({ email: z.string().trim().toLowerCase().email(), password: z.string().min(8).max(100) }).parse(req.body);
  const [p] = await db.select().from(patients).where(and(eq(patients.id, id), eq(patients.tenantId, a.tenantId)));
  if (!p) throw notFound('Patient');
  const [role] = await db.select({ id: roles.id }).from(roles).where(and(eq(roles.tenantId, a.tenantId), eq(roles.code, 'patient')));
  const [existing] = await db.select().from(users).where(and(eq(users.tenantId, a.tenantId), eq(users.patientId, id)));
  const passwordHash = await hashPassword(body.password);
  if (existing) {
    await db.update(users).set({ email: body.email, passwordHash, status: 'active' }).where(eq(users.id, existing.id));
  } else {
    await db.insert(users).values({
      tenantId: a.tenantId,
      roleId: role.id,
      email: body.email,
      passwordHash,
      fullName: `${p.firstName} ${p.lastName ?? ''}`.trim(),
      phone: p.phone,
      patientId: id,
    });
  }
  await audit(req, 'update', 'patient', id, `Portal access ${existing ? 'reset' : 'created'} for ${p.uhid}`);
  res.json({ ok: true });
});

