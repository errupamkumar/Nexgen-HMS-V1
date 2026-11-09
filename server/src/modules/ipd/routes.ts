import { Router } from 'express';
import { and, asc, count, desc, eq, or, sql } from 'drizzle-orm';
import { z } from 'zod';
import { db, lockingTx, type Tx } from '../../db/client.js';
import { admissionNotes, admissions, beds, departments, doctors, invoices, patients, PAYMENT_METHODS, services, wards } from '../../db/schema.js';
import { authenticate, requireAnyPermission, requirePermission, requireTenantUser, tctx, type TenantAuthContext } from '../../core/auth.js';
import { badRequest, conflict, notFound } from '../../core/errors.js';
import { audit, likeTerm, nextNumber, optStr, paged, pagingSchema, pid, round2 } from '../../core/util.js';
import { addInvoiceItems, createInvoice, recomputeInvoice, recordPayment } from '../billing/service.js';
import { loadInvoice } from '../billing/routes.js';
import { patientName } from '../patients/routes.js';

export const ipdRouter = Router();
ipdRouter.use(authenticate, requireTenantUser);

const DAY_MS = 86_400_000;

/** Live bed board (IPD-1). */
ipdRouter.get('/board', requirePermission('ipd.view'), async (req, res) => {
  const a = tctx(req);
  const ws = await db.select().from(wards).where(and(eq(wards.tenantId, a.tenantId), eq(wards.isActive, true))).orderBy(asc(wards.name));
  const bs = await db
    .select({
      bed: beds,
      admissionId: admissions.id,
      admissionNo: admissions.admissionNo,
      admittedAt: admissions.admittedAt,
      patientId: patients.id,
      patientName,
      uhid: patients.uhid,
      gender: patients.gender,
      doctorName: doctors.name,
    })
    .from(beds)
    .leftJoin(admissions, and(eq(admissions.bedId, beds.id), eq(admissions.status, 'admitted')))
    .leftJoin(patients, eq(patients.id, admissions.patientId))
    .leftJoin(doctors, eq(doctors.id, admissions.doctorId))
    .where(eq(beds.tenantId, a.tenantId))
    .orderBy(asc(beds.bedNo));
  const summary = { total: 0, available: 0, occupied: 0, cleaning: 0, maintenance: 0, reserved: 0 };
  for (const b of bs) {
    summary.total++;
    summary[b.bed.status]++;
  }
  res.json({
    summary,
    occupancy: summary.total ? Math.round((summary.occupied / summary.total) * 100) : 0,
    wards: ws.map((w) => ({
      ...w,
      beds: bs
        .filter((b) => b.bed.wardId === w.id)
        .map((b) => ({
          ...b.bed,
          effectiveRate: b.bed.dailyRate ?? w.dailyRate,
          admission: b.admissionId
            ? { id: b.admissionId, admissionNo: b.admissionNo, admittedAt: b.admittedAt, patientId: b.patientId, patientName: b.patientName, uhid: b.uhid, gender: b.gender, doctorName: b.doctorName }
            : null,
        })),
    })),
  });
});

ipdRouter.get('/admissions', requirePermission('ipd.view'), async (req, res) => {
  const a = tctx(req);
  const p = pagingSchema.extend({ status: z.enum(['admitted', 'discharged', 'cancelled']).optional() }).parse(req.query);
  const where = and(
    eq(admissions.tenantId, a.tenantId),
    p.status ? eq(admissions.status, p.status) : undefined,
    p.q ? or(sql`${patientName} LIKE ${likeTerm(p.q)}`, sql`${patients.uhid} LIKE ${likeTerm(p.q)}`, sql`${admissions.admissionNo} LIKE ${likeTerm(p.q)}`) : undefined,
  );
  const rows = await db
    .select({
      id: admissions.id,
      admissionNo: admissions.admissionNo,
      status: admissions.status,
      admittedAt: admissions.admittedAt,
      dischargedAt: admissions.dischargedAt,
      provisionalDiagnosis: admissions.provisionalDiagnosis,
      patientId: patients.id,
      patientName,
      uhid: patients.uhid,
      doctorName: doctors.name,
      bedNo: beds.bedNo,
      wardName: wards.name,
    })
    .from(admissions)
    .innerJoin(patients, eq(patients.id, admissions.patientId))
    .innerJoin(doctors, eq(doctors.id, admissions.doctorId))
    .innerJoin(beds, eq(beds.id, admissions.bedId))
    .innerJoin(wards, eq(wards.id, beds.wardId))
    .where(where)
    .orderBy(desc(admissions.admittedAt))
    .limit(p.pageSize)
    .offset((p.page - 1) * p.pageSize);
  const [{ n }] = await db.select({ n: count() }).from(admissions).innerJoin(patients, eq(patients.id, admissions.patientId)).where(where);
  res.json(paged(rows, n, p));
});

async function getAdmission(tx: Tx | typeof db, tenantId: number, id: number, lock = false) {
  const q = tx.select().from(admissions).where(and(eq(admissions.id, id), eq(admissions.tenantId, tenantId)));
  const [adm] = lock ? await q.for('update') : await q;
  if (!adm) throw notFound('Admission');
  return adm;
}

async function lockAvailableBed(tx: Tx, tenantId: number, bedId: number) {
  const [row] = await tx
    .select({ bed: beds, ward: wards })
    .from(beds)
    .innerJoin(wards, eq(wards.id, beds.wardId))
    .where(and(eq(beds.id, bedId), eq(beds.tenantId, tenantId)))
    .for('update');
  if (!row) throw notFound('Bed');
  if (row.bed.status !== 'available' && row.bed.status !== 'reserved') {
    throw conflict(`Bed ${row.bed.bedNo} is ${row.bed.status} (BR-11)`);
  }
  return row;
}

/** Bill bed-days for the current bed segment onto the running invoice. */
async function billBedDays(tx: Tx, a: TenantAuthContext, adm: typeof admissions.$inferSelect, mode: 'transfer' | 'discharge') {
  const [row] = await tx.select({ bed: beds, ward: wards }).from(beds).innerJoin(wards, eq(wards.id, beds.wardId)).where(eq(beds.id, adm.bedId));
  const from = adm.bedChargesBilledUntil ?? adm.admittedAt;
  const hours = (Date.now() - from.getTime()) / 3_600_000;
  // Transfers bill completed days; discharge rounds up and guarantees at least one billed day overall.
  let days = mode === 'transfer' ? Math.floor(hours / 24) : Math.ceil(hours / 24 - 1e-9);
  if (mode === 'discharge' && !adm.bedChargesBilledUntil) days = Math.max(1, days);
  const rate = row.bed.dailyRate ?? row.ward.dailyRate;
  if (days > 0 && rate > 0 && adm.invoiceId) {
    await addInvoiceItems(tx, a.tenantId, adm.invoiceId, [
      { itemType: 'bed', refId: row.bed.id, description: `${row.ward.name} · Bed ${row.bed.bedNo} (${days} day${days > 1 ? 's' : ''})`, quantity: days, unitPrice: rate },
    ]);
  }
  const billedUntil = new Date(from.getTime() + days * DAY_MS);
  await tx.update(admissions).set({ bedChargesBilledUntil: billedUntil }).where(eq(admissions.id, adm.id));
  return { days, rate, bed: row.bed, ward: row.ward };
}

ipdRouter.get('/admissions/:id', requirePermission('ipd.view'), async (req, res) => {
  const a = tctx(req);
  const adm = await getAdmission(db, a.tenantId, pid(req));
  const [patient] = await db.select().from(patients).where(eq(patients.id, adm.patientId));
  const [doc] = await db
    .select({ id: doctors.id, name: doctors.name, specialization: doctors.specialization, departmentName: departments.name })
    .from(doctors)
    .leftJoin(departments, eq(departments.id, doctors.departmentId))
    .where(eq(doctors.id, adm.doctorId));
  const [bedRow] = await db.select({ bed: beds, ward: wards }).from(beds).innerJoin(wards, eq(wards.id, beds.wardId)).where(eq(beds.id, adm.bedId));
  const notes = await db
    .select()
    .from(admissionNotes)
    .where(and(eq(admissionNotes.tenantId, a.tenantId), eq(admissionNotes.admissionId, adm.id)))
    .orderBy(desc(admissionNotes.createdAt));
  const invoice = adm.invoiceId && a.permissions.has('billing.view') && a.modules.has('billing') ? await loadInvoice(a.tenantId, adm.invoiceId) : null;
  const stayDays = Math.max(1, Math.ceil(((adm.dischargedAt ?? new Date()).getTime() - adm.admittedAt.getTime()) / DAY_MS));
  res.json({
    ...adm,
    patient: { ...patient, name: `${patient.firstName} ${patient.lastName ?? ''}`.trim() },
    doctor: doc,
    bed: bedRow.bed,
    ward: bedRow.ward,
    notes,
    invoice,
    stayDays,
  });
});

ipdRouter.post('/admissions', requirePermission('ipd.admit'), async (req, res) => {
  const a = tctx(req);
  const body = z
    .object({
      patientId: z.coerce.number().int().positive(),
      doctorId: z.coerce.number().int().positive(),
      bedId: z.coerce.number().int().positive(),
      reason: optStr(500),
      provisionalDiagnosis: optStr(500),
      attendantName: optStr(120),
      attendantPhone: optStr(20),
      deposit: z.object({ amount: z.coerce.number().positive(), method: z.enum(PAYMENT_METHODS), reference: optStr(100) }).optional(),
    })
    .parse(req.body);
  const result = await lockingTx(async (tx) => {
    const [pt] = await tx.select().from(patients).where(and(eq(patients.id, body.patientId), eq(patients.tenantId, a.tenantId), eq(patients.isDeleted, false)));
    if (!pt) throw notFound('Patient');
    const [doc] = await tx.select().from(doctors).where(and(eq(doctors.id, body.doctorId), eq(doctors.tenantId, a.tenantId)));
    if (!doc) throw notFound('Doctor');
    const [{ n }] = await tx
      .select({ n: count() })
      .from(admissions)
      .where(and(eq(admissions.tenantId, a.tenantId), eq(admissions.patientId, pt.id), eq(admissions.status, 'admitted')));
    if (n) throw conflict(`${pt.firstName} is already admitted`);
    const { bed } = await lockAvailableBed(tx, a.tenantId, body.bedId);

    const admissionNo = await nextNumber(tx, a.tenantId, a.settings, 'admission');
    let invoiceId: number | null = null;
    if (a.modules.has('billing')) {
      const inv = await createInvoice(tx, a, { patientId: pt.id, type: 'ipd', items: [], status: 'draft', notes: `IPD running bill ${admissionNo}` });
      invoiceId = inv.id;
    }
    const { deposit, ...rest } = body;
    const [r] = await tx.insert(admissions).values({
      ...rest,
      tenantId: a.tenantId,
      admissionNo,
      departmentId: doc.departmentId,
      invoiceId,
      createdBy: a.userId,
    });
    if (invoiceId) await tx.update(invoices).set({ admissionId: r.insertId }).where(eq(invoices.id, invoiceId));
    await tx.update(beds).set({ status: 'occupied' }).where(eq(beds.id, bed.id));
    await tx.insert(admissionNotes).values({
      tenantId: a.tenantId,
      admissionId: r.insertId,
      type: 'progress',
      note: `Admitted to bed ${bed.bedNo} under ${doc.name}.${body.reason ? ` Reason: ${body.reason}` : ''}`,
      createdBy: a.userId,
      createdByName: a.userName,
    });
    if (deposit && invoiceId && a.permissions.has('billing.payment')) {
      await recordPayment(tx, a, invoiceId, { ...deposit, notes: 'Admission deposit' });
    }
    return { id: r.insertId, admissionNo, invoiceId };
  });
  await audit(req, 'create', 'admission', result.id, `Admitted ${result.admissionNo}`);
  res.status(201).json(result);
});

ipdRouter.post('/admissions/:id/transfer', requirePermission('ipd.admit'), async (req, res) => {
  const a = tctx(req);
  const id = pid(req);
  const { bedId, note } = z.object({ bedId: z.coerce.number().int().positive(), note: optStr(300) }).parse(req.body);
  await db.transaction(async (tx) => {
    const adm = await getAdmission(tx, a.tenantId, id, true);
    if (adm.status !== 'admitted') throw conflict('Only admitted patients can be transferred');
    if (adm.bedId === bedId) throw badRequest('Patient is already on this bed');
    const { bed: newBed, ward: newWard } = await lockAvailableBed(tx, a.tenantId, bedId);
    const old = await billBedDays(tx, a, adm, 'transfer');
    await tx.update(beds).set({ status: 'cleaning' }).where(eq(beds.id, adm.bedId));
    await tx.update(beds).set({ status: 'occupied' }).where(eq(beds.id, newBed.id));
    await tx.update(admissions).set({ bedId: newBed.id }).where(eq(admissions.id, id));
    if (adm.invoiceId) await recomputeInvoice(tx, a.tenantId, adm.invoiceId);
    await tx.insert(admissionNotes).values({
      tenantId: a.tenantId,
      admissionId: id,
      type: 'transfer',
      note: `Transferred from ${old.ward.name}/${old.bed.bedNo} to ${newWard.name}/${newBed.bedNo}.${note ? ` ${note}` : ''}`,
      createdBy: a.userId,
      createdByName: a.userName,
    });
  });
  await audit(req, 'update', 'admission', id, `Bed transfer → bed ${bedId}`);
  res.json({ ok: true });
});

ipdRouter.post('/admissions/:id/notes', requirePermission('ipd.notes'), async (req, res) => {
  const a = tctx(req);
  const id = pid(req);
  const body = z
    .object({
      type: z.enum(['progress', 'nursing', 'procedure']).default('progress'),
      note: z.string().trim().min(2).max(5000),
      vitals: z
        .object({
          bpSystolic: z.coerce.number().nullable().optional(),
          bpDiastolic: z.coerce.number().nullable().optional(),
          pulse: z.coerce.number().nullable().optional(),
          temperature: z.coerce.number().nullable().optional(),
          spo2: z.coerce.number().nullable().optional(),
          respiratoryRate: z.coerce.number().nullable().optional(),
        })
        .optional(),
    })
    .parse(req.body);
  const adm = await getAdmission(db, a.tenantId, id);
  if (adm.status !== 'admitted') throw conflict('Notes can only be added during the admission');
  const [r] = await db.insert(admissionNotes).values({ ...body, vitals: body.vitals ?? null, tenantId: a.tenantId, admissionId: id, createdBy: a.userId, createdByName: a.userName });
  await audit(req, 'create', 'admission_note', r.insertId, `${body.type} note on ${adm.admissionNo}`);
  res.status(201).json({ id: r.insertId });
});

ipdRouter.post('/admissions/:id/charges', requireAnyPermission('ipd.admit', 'billing.create'), async (req, res) => {
  const a = tctx(req);
  const id = pid(req);
  const body = z
    .object({
      serviceId: z.coerce.number().int().positive().optional(),
      description: z.string().trim().max(200).optional(),
      quantity: z.coerce.number().positive().max(1000).default(1),
      unitPrice: z.coerce.number().min(0).optional(),
      taxRate: z.coerce.number().min(0).max(100).optional(),
    })
    .parse(req.body);
  const adm = await getAdmission(db, a.tenantId, id);
  if (adm.status !== 'admitted' || !adm.invoiceId) throw conflict('Charges can only be added to an active admission with a running bill');
  let line = { itemType: 'service' as const, refId: null as number | null, description: body.description ?? '', unitPrice: body.unitPrice ?? 0, taxRate: body.taxRate ?? 0 };
  if (body.serviceId) {
    const [svc] = await db.select().from(services).where(and(eq(services.id, body.serviceId), eq(services.tenantId, a.tenantId)));
    if (!svc) throw notFound('Service');
    line = { itemType: 'service', refId: svc.id, description: body.description || svc.name, unitPrice: body.unitPrice ?? svc.price, taxRate: body.taxRate ?? svc.taxRate };
  }
  if (!line.description) throw badRequest('Description is required');
  await db.transaction(async (tx) => {
    await addInvoiceItems(tx, a.tenantId, adm.invoiceId!, [{ ...line, quantity: body.quantity }]);
    await recomputeInvoice(tx, a.tenantId, adm.invoiceId!);
  });
  await audit(req, 'update', 'admission', id, `Charge added: ${line.description} × ${body.quantity}`);
  res.status(201).json({ ok: true });
});

ipdRouter.post('/admissions/:id/discharge', requirePermission('ipd.discharge'), async (req, res) => {
  const a = tctx(req);
  const id = pid(req);
  const body = z
    .object({
      dischargeType: z.enum(['normal', 'lama', 'referred', 'absconded', 'death']),
      dischargeSummary: z.string().trim().min(5).max(10000),
    })
    .parse(req.body);
  const result = await db.transaction(async (tx) => {
    const adm = await getAdmission(tx, a.tenantId, id, true);
    if (adm.status !== 'admitted') throw conflict('Patient is not currently admitted');
    const seg = await billBedDays(tx, a, adm, 'discharge');
    await tx
      .update(admissions)
      .set({ status: 'discharged', dischargedAt: new Date(), dischargeType: body.dischargeType, dischargeSummary: body.dischargeSummary })
      .where(eq(admissions.id, id));
    await tx.update(beds).set({ status: 'cleaning' }).where(eq(beds.id, adm.bedId));
    let totals = null;
    if (adm.invoiceId) {
      await tx
        .update(invoices)
        .set({ status: 'unpaid' })
        .where(and(eq(invoices.id, adm.invoiceId), eq(invoices.status, 'draft')));
      totals = await recomputeInvoice(tx, a.tenantId, adm.invoiceId);
    }
    await tx.insert(admissionNotes).values({
      tenantId: a.tenantId,
      admissionId: id,
      type: 'progress',
      note: `Discharged (${body.dischargeType}). Bed ${seg.bed.bedNo} sent for cleaning.`,
      createdBy: a.userId,
      createdByName: a.userName,
    });
    return { admissionNo: adm.admissionNo, bedDaysBilled: seg.days, invoice: totals };
  });
  await audit(req, 'status', 'admission', id, `Discharged ${result.admissionNo} (${body.dischargeType})`);
  res.json({ ok: true, ...result, total: result.invoice ? round2(result.invoice.total) : 0 });
});
