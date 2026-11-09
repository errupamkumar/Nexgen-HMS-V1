import { Router } from 'express';
import { and, asc, count, desc, eq, gt, gte, sql } from 'drizzle-orm';
import { z } from 'zod';
import { db, lockingTx, type Tx } from '../../db/client.js';
import {
  doctors,
  encounters,
  medicineBatches,
  medicines,
  PAYMENT_METHODS,
  patients,
  prescriptionItems,
  stockMovements,
  users,
} from '../../db/schema.js';
import { authenticate, requirePermission, requireTenantUser, tctx, type TenantAuthContext } from '../../core/auth.js';
import { badRequest, conflict, notFound } from '../../core/errors.js';
import { addDays, audit, dateStr, likeTerm, optStr, paged, pagingSchema, pid, todayFor, qcol } from '../../core/util.js';
import { createInvoice, recordPayment, type LineInput } from '../billing/service.js';
import { patientName } from '../patients/routes.js';

export const pharmacyRouter = Router();
pharmacyRouter.use(authenticate, requireTenantUser);

/** Stock overview with on-hand (non-expired), nearest expiry and alert flags (PHM-2). */
pharmacyRouter.get('/stock', requirePermission('pharmacy.view'), async (req, res) => {
  const a = tctx(req);
  const p = pagingSchema.extend({ filter: z.enum(['all', 'low', 'expiring', 'expired', 'out']).default('all') }).parse(req.query);
  const today = todayFor(a.settings);
  const soon = addDays(today, a.settings.pharmacy.nearExpiryDays);
  const onHand = sql<number>`COALESCE((SELECT SUM(b.quantity) FROM medicine_batches b WHERE b.medicine_id = ${qcol('medicines', 'id')} AND b.expiry_date >= ${today}), 0)`;
  const expiredQty = sql<number>`COALESCE((SELECT SUM(b.quantity) FROM medicine_batches b WHERE b.medicine_id = ${qcol('medicines', 'id')} AND b.expiry_date < ${today}), 0)`;
  const nearest = sql<string | null>`(SELECT MIN(b.expiry_date) FROM medicine_batches b WHERE b.medicine_id = ${qcol('medicines', 'id')} AND b.quantity > 0 AND b.expiry_date >= ${today})`;
  const filter =
    p.filter === 'low'
      ? sql`${onHand} <= ${medicines.reorderLevel}`
      : p.filter === 'out'
        ? sql`${onHand} = 0`
        : p.filter === 'expiring'
          ? sql`${nearest} <= ${soon}`
          : p.filter === 'expired'
            ? sql`${expiredQty} > 0`
            : undefined;
  const where = and(
    eq(medicines.tenantId, a.tenantId),
    p.q ? sql`(${medicines.name} LIKE ${likeTerm(p.q)} OR ${medicines.genericName} LIKE ${likeTerm(p.q)})` : undefined,
    filter,
  );
  const rows = await db
    .select({
      id: medicines.id,
      name: medicines.name,
      genericName: medicines.genericName,
      form: medicines.form,
      strength: medicines.strength,
      unit: medicines.unit,
      reorderLevel: medicines.reorderLevel,
      salePrice: medicines.salePrice,
      taxRate: medicines.taxRate,
      isActive: medicines.isActive,
      onHand,
      expiredQty,
      nearestExpiry: nearest,
    })
    .from(medicines)
    .where(where)
    .orderBy(asc(medicines.name))
    .limit(p.pageSize)
    .offset((p.page - 1) * p.pageSize);
  const [{ n }] = await db.select({ n: count() }).from(medicines).where(where);
  const data = rows.map((r) => {
    const qty = Number(r.onHand);
    return {
      ...r,
      onHand: qty,
      expiredQty: Number(r.expiredQty),
      low: qty <= r.reorderLevel,
      expiringSoon: Boolean(r.nearestExpiry && r.nearestExpiry <= soon),
    };
  });
  res.json(paged(data, n, p));
});

pharmacyRouter.get('/medicines/:id/batches', requirePermission('pharmacy.view'), async (req, res) => {
  const a = tctx(req);
  const id = pid(req);
  const rows = await db
    .select()
    .from(medicineBatches)
    .where(and(eq(medicineBatches.tenantId, a.tenantId), eq(medicineBatches.medicineId, id)))
    .orderBy(asc(medicineBatches.expiryDate));
  const moves = await db
    .select({ move: stockMovements, byName: users.fullName })
    .from(stockMovements)
    .leftJoin(users, eq(users.id, stockMovements.createdBy))
    .where(and(eq(stockMovements.tenantId, a.tenantId), eq(stockMovements.medicineId, id)))
    .orderBy(desc(stockMovements.id))
    .limit(50);
  res.json({ batches: rows, movements: moves.map((m) => ({ ...m.move, byName: m.byName })), today: todayFor(a.settings) });
});

pharmacyRouter.post('/stock-in', requirePermission('pharmacy.manage'), async (req, res) => {
  const a = tctx(req);
  const body = z
    .object({
      medicineId: z.coerce.number().int().positive(),
      batchNo: z.string().trim().min(1).max(40),
      expiryDate: dateStr,
      quantity: z.coerce.number().int().positive().max(1_000_000),
      purchasePrice: z.coerce.number().min(0),
      mrp: z.coerce.number().min(0),
      salePrice: z.coerce.number().min(0).optional(),
      supplier: optStr(120),
    })
    .parse(req.body);
  const [med] = await db.select().from(medicines).where(and(eq(medicines.id, body.medicineId), eq(medicines.tenantId, a.tenantId)));
  if (!med) throw notFound('Medicine');
  if (body.expiryDate <= todayFor(a.settings)) throw badRequest('Cannot stock in an expired batch');
  const id = await db.transaction(async (tx) => {
    const [r] = await tx.insert(medicineBatches).values({ ...body, salePrice: body.salePrice ?? med.salePrice, tenantId: a.tenantId });
    await tx.insert(stockMovements).values({
      tenantId: a.tenantId,
      medicineId: med.id,
      batchId: r.insertId,
      type: 'purchase',
      quantity: body.quantity,
      notes: body.supplier ? `From ${body.supplier}` : null,
      createdBy: a.userId,
    });
    return r.insertId;
  });
  await audit(req, 'create', 'stock', id, `Stock-in ${med.name} batch ${body.batchNo} × ${body.quantity}`);
  res.status(201).json({ id });
});

pharmacyRouter.post('/adjust', requirePermission('pharmacy.manage'), async (req, res) => {
  const a = tctx(req);
  const body = z
    .object({
      batchId: z.coerce.number().int().positive(),
      quantity: z.coerce.number().int().refine((n) => n !== 0, 'must not be zero'),
      type: z.enum(['adjustment', 'return', 'expired']).default('adjustment'),
      reason: z.string().trim().min(3).max(300),
    })
    .parse(req.body);
  await db.transaction(async (tx) => {
    const [b] = await tx
      .select()
      .from(medicineBatches)
      .where(and(eq(medicineBatches.id, body.batchId), eq(medicineBatches.tenantId, a.tenantId)))
      .for('update');
    if (!b) throw notFound('Batch');
    if (b.quantity + body.quantity < 0) throw badRequest(`Batch has only ${b.quantity} in stock`);
    await tx.update(medicineBatches).set({ quantity: b.quantity + body.quantity }).where(eq(medicineBatches.id, b.id));
    await tx.insert(stockMovements).values({
      tenantId: a.tenantId,
      medicineId: b.medicineId,
      batchId: b.id,
      type: body.type,
      quantity: body.quantity,
      notes: body.reason,
      createdBy: a.userId,
    });
  });
  await audit(req, 'update', 'stock', body.batchId, `Stock ${body.type} ${body.quantity > 0 ? '+' : ''}${body.quantity}: ${body.reason}`);
  res.json({ ok: true });
});

/** Prescriptions waiting at the pharmacy counter. */
pharmacyRouter.get('/prescriptions', requirePermission('pharmacy.view'), async (req, res) => {
  const a = tctx(req);
  const p = pagingSchema.extend({ status: z.enum(['pending', 'dispensed']).default('pending') }).parse(req.query);
  const where = and(eq(encounters.tenantId, a.tenantId), eq(encounters.rxStatus, p.status), eq(encounters.status, 'final'));
  const rows = await db
    .select({
      encounterId: encounters.id,
      finalizedAt: encounters.finalizedAt,
      patientId: patients.id,
      patientName,
      uhid: patients.uhid,
      phone: patients.phone,
      gender: patients.gender,
      dob: patients.dob,
      allergies: patients.allergies,
      doctorName: doctors.name,
    })
    .from(encounters)
    .innerJoin(patients, eq(patients.id, encounters.patientId))
    .innerJoin(doctors, eq(doctors.id, encounters.doctorId))
    .where(where)
    .orderBy(desc(encounters.finalizedAt))
    .limit(p.pageSize)
    .offset((p.page - 1) * p.pageSize);
  const ids = rows.map((r) => r.encounterId);
  const items = ids.length
    ? await db
        .select()
        .from(prescriptionItems)
        .where(and(eq(prescriptionItems.tenantId, a.tenantId), sql`${prescriptionItems.encounterId} IN (${sql.join(ids.map((i) => sql`${i}`), sql`, `)})`))
    : [];
  const [{ n }] = await db.select({ n: count() }).from(encounters).where(where);
  res.json(paged(rows.map((r) => ({ ...r, items: items.filter((i) => i.encounterId === r.encounterId) })), n, p));
});

interface DispenseLine {
  medicineId: number;
  quantity: number;
  prescriptionItemId?: number | null;
}

/** FEFO allocation (BR-10): earliest-expiring non-expired batches first. */
async function allocateFefo(tx: Tx, a: TenantAuthContext, line: DispenseLine) {
  const today = todayFor(a.settings);
  const [med] = await tx.select().from(medicines).where(and(eq(medicines.id, line.medicineId), eq(medicines.tenantId, a.tenantId)));
  if (!med) throw notFound('Medicine');
  const batches = await tx
    .select()
    .from(medicineBatches)
    .where(
      and(
        eq(medicineBatches.tenantId, a.tenantId),
        eq(medicineBatches.medicineId, med.id),
        gt(medicineBatches.quantity, 0),
        gte(medicineBatches.expiryDate, today),
      ),
    )
    .orderBy(asc(medicineBatches.expiryDate), asc(medicineBatches.id))
    .for('update');
  const available = batches.reduce((s, b) => s + b.quantity, 0);
  if (available < line.quantity) throw conflict(`Insufficient stock for ${med.name}: ${available} available, ${line.quantity} requested`);
  let remaining = line.quantity;
  const picks: { batch: (typeof batches)[number]; qty: number }[] = [];
  for (const b of batches) {
    if (remaining <= 0) break;
    const take = Math.min(b.quantity, remaining);
    picks.push({ batch: b, qty: take });
    remaining -= take;
  }
  return { med, picks };
}

pharmacyRouter.post('/dispense', requirePermission('pharmacy.dispense'), async (req, res) => {
  const a = tctx(req);
  const body = z
    .object({
      patientId: z.coerce.number().int().positive(),
      encounterId: z.coerce.number().int().positive().nullable().optional(),
      items: z
        .array(
          z.object({
            medicineId: z.coerce.number().int().positive(),
            quantity: z.coerce.number().int().positive().max(10000),
            prescriptionItemId: z.coerce.number().int().positive().nullable().optional(),
          }),
        )
        .min(1)
        .max(60),
      discount: z.coerce.number().min(0).default(0),
      // amount omitted = collect the full (server-computed) bill
      payment: z.object({ method: z.enum(PAYMENT_METHODS), amount: z.coerce.number().positive().optional(), reference: optStr(100) }).optional(),
    })
    .parse(req.body);

  const [pt] = await db.select({ id: patients.id }).from(patients).where(and(eq(patients.id, body.patientId), eq(patients.tenantId, a.tenantId)));
  if (!pt) throw notFound('Patient');
  if (body.payment && !a.permissions.has('billing.payment')) throw badRequest('You cannot collect payments');

  const result = await lockingTx(async (tx) => {
    let enc: typeof encounters.$inferSelect | undefined;
    if (body.encounterId) {
      [enc] = await tx.select().from(encounters).where(and(eq(encounters.id, body.encounterId), eq(encounters.tenantId, a.tenantId)));
      if (!enc || enc.patientId !== body.patientId) throw badRequest('Prescription does not belong to this patient');
      if (enc.rxStatus === 'dispensed') throw conflict('This prescription has already been dispensed');
    }

    const lines: LineInput[] = [];
    const moves: { medicineId: number; batchId: number; qty: number }[] = [];
    for (const item of body.items) {
      const { med, picks } = await allocateFefo(tx, a, item);
      for (const pk of picks) {
        await tx.update(medicineBatches).set({ quantity: pk.batch.quantity - pk.qty }).where(eq(medicineBatches.id, pk.batch.id));
        moves.push({ medicineId: med.id, batchId: pk.batch.id, qty: pk.qty });
        lines.push({
          itemType: 'medicine',
          refId: med.id,
          batchId: pk.batch.id,
          description: `${med.name}${med.strength ? ` ${med.strength}` : ''} · Batch ${pk.batch.batchNo} · Exp ${pk.batch.expiryDate}`,
          quantity: pk.qty,
          unitPrice: pk.batch.salePrice || med.salePrice,
          taxRate: med.taxRate,
        });
      }
      if (item.prescriptionItemId && enc) {
        await tx
          .update(prescriptionItems)
          .set({ dispensedQty: sql`${prescriptionItems.dispensedQty} + ${item.quantity}` })
          .where(and(eq(prescriptionItems.id, item.prescriptionItemId), eq(prescriptionItems.encounterId, enc.id)));
      }
    }
    // Spread an overall discount across lines proportionally.
    if (body.discount > 0) {
      const gross = lines.reduce((s, l) => s + l.quantity * l.unitPrice, 0);
      if (body.discount > gross) throw badRequest('Discount exceeds bill amount');
      let left = body.discount;
      lines.forEach((l, i) => {
        const share = i === lines.length - 1 ? left : Math.round(((l.quantity * l.unitPrice) / gross) * body.discount * 100) / 100;
        l.discount = share;
        left -= share;
      });
    }
    const inv = await createInvoice(tx, a, { patientId: body.patientId, type: 'pharmacy', items: lines, encounterId: enc?.id ?? null });
    await tx.insert(stockMovements).values(
      moves.map((m) => ({
        tenantId: a.tenantId,
        medicineId: m.medicineId,
        batchId: m.batchId,
        type: 'sale' as const,
        quantity: -m.qty,
        referenceType: 'invoice',
        referenceId: inv.id,
        createdBy: a.userId,
      })),
    );
    if (enc) await tx.update(encounters).set({ rxStatus: 'dispensed' }).where(eq(encounters.id, enc.id));
    let payment = null;
    if (body.payment && inv.total > 0) {
      payment = await recordPayment(tx, a, inv.id, { ...body.payment, amount: Math.min(body.payment.amount ?? inv.total, inv.total) });
    }
    return { invoiceId: inv.id, invoiceNo: inv.invoiceNo, total: inv.total, payment };
  });
  await audit(req, 'dispense', 'invoice', result.invoiceId, `Dispensed ${body.items.length} item(s) — ${result.invoiceNo}`);
  res.status(201).json(result);
});
