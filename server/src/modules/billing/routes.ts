import { Router } from 'express';
import { and, asc, count, desc, eq, gte, lte, or, sql } from 'drizzle-orm';
import { z } from 'zod';
import { db } from '../../db/client.js';
import { invoiceItems, invoices, PAYMENT_METHODS, patients, payments, users } from '../../db/schema.js';
import { authenticate, requirePermission, requireTenantUser, tctx } from '../../core/auth.js';
import { badRequest, conflict, notFound } from '../../core/errors.js';
import { audit, dateStr, likeTerm, optStr, paged, pagingSchema, pid } from '../../core/util.js';
import { patientName } from '../patients/routes.js';
import { addInvoiceItems, createInvoice, recomputeInvoice, recordPayment } from './service.js';

export const billingRouter = Router();
billingRouter.use(authenticate, requireTenantUser);

const lineSchema = z.object({
  itemType: z.enum(['consultation', 'service', 'medicine', 'lab_test', 'bed', 'registration', 'other']).default('service'),
  refId: z.coerce.number().int().positive().nullable().optional(),
  description: z.string().trim().min(1).max(200),
  quantity: z.coerce.number().positive().max(100000),
  unitPrice: z.coerce.number().min(0).max(10_000_000),
  discount: z.coerce.number().min(0).max(10_000_000).default(0),
  taxRate: z.coerce.number().min(0).max(100).default(0),
});

const paymentSchema = z.object({
  amount: z.coerce.number().positive().max(100_000_000),
  method: z.enum(PAYMENT_METHODS),
  reference: optStr(100),
  notes: optStr(300),
});

const rangeWhere = (col: Parameters<typeof gte>[0], from?: string, to?: string) => [
  from ? gte(col, new Date(`${from}T00:00:00Z`)) : undefined,
  to ? lte(col, new Date(`${to}T23:59:59.999Z`)) : undefined,
];

billingRouter.get('/invoices', requirePermission('billing.view'), async (req, res) => {
  const a = tctx(req);
  const p = pagingSchema
    .extend({
      status: z.string().max(20).optional(),
      type: z.string().max(20).optional(),
      from: dateStr.optional(),
      to: dateStr.optional(),
      patientId: z.coerce.number().int().optional(),
      due: z.coerce.boolean().optional(),
    })
    .parse(req.query);
  const where = and(
    eq(invoices.tenantId, a.tenantId),
    p.status ? eq(invoices.status, p.status as 'paid') : undefined,
    p.type ? eq(invoices.type, p.type as 'opd') : undefined,
    p.patientId ? eq(invoices.patientId, p.patientId) : undefined,
    p.due ? sql`${invoices.balance} > 0 AND ${invoices.status} IN ('unpaid','partially_paid')` : undefined,
    ...rangeWhere(invoices.createdAt, p.from, p.to),
    p.q ? or(sql`${patientName} LIKE ${likeTerm(p.q)}`, sql`${patients.uhid} LIKE ${likeTerm(p.q)}`, sql`${invoices.invoiceNo} LIKE ${likeTerm(p.q)}`) : undefined,
  );
  const rows = await db
    .select({
      id: invoices.id,
      invoiceNo: invoices.invoiceNo,
      type: invoices.type,
      status: invoices.status,
      total: invoices.total,
      amountPaid: invoices.amountPaid,
      balance: invoices.balance,
      createdAt: invoices.createdAt,
      patientId: patients.id,
      patientName,
      uhid: patients.uhid,
    })
    .from(invoices)
    .innerJoin(patients, eq(patients.id, invoices.patientId))
    .where(where)
    .orderBy(desc(invoices.id))
    .limit(p.pageSize)
    .offset((p.page - 1) * p.pageSize);
  const [agg] = await db
    .select({ n: count(), total: sql<number>`COALESCE(SUM(${invoices.total}),0)`, balance: sql<number>`COALESCE(SUM(${invoices.balance}),0)` })
    .from(invoices)
    .innerJoin(patients, eq(patients.id, invoices.patientId))
    .where(where);
  res.json({ ...paged(rows, agg.n, p), totals: { total: Number(agg.total), balance: Number(agg.balance) } });
});

export async function loadInvoice(tenantId: number, id: number) {
  const [row] = await db
    .select({
      invoice: invoices,
      patient: {
        id: patients.id,
        name: patientName,
        uhid: patients.uhid,
        phone: patients.phone,
        gender: patients.gender,
        dob: patients.dob,
        address: patients.address,
        city: patients.city,
      },
      createdByName: users.fullName,
    })
    .from(invoices)
    .innerJoin(patients, eq(patients.id, invoices.patientId))
    .leftJoin(users, eq(users.id, invoices.createdBy))
    .where(and(eq(invoices.id, id), eq(invoices.tenantId, tenantId)));
  if (!row) throw notFound('Invoice');
  const items = await db
    .select()
    .from(invoiceItems)
    .where(and(eq(invoiceItems.tenantId, tenantId), eq(invoiceItems.invoiceId, id)))
    .orderBy(asc(invoiceItems.id));
  const pays = await db
    .select({ payment: payments, receivedByName: users.fullName })
    .from(payments)
    .leftJoin(users, eq(users.id, payments.receivedBy))
    .where(and(eq(payments.tenantId, tenantId), eq(payments.invoiceId, id)))
    .orderBy(asc(payments.id));
  return {
    ...row.invoice,
    patient: row.patient,
    createdByName: row.createdByName,
    items,
    payments: pays.map((p) => ({ ...p.payment, receivedByName: p.receivedByName })),
  };
}

billingRouter.get('/invoices/:id', requirePermission('billing.view'), async (req, res) => {
  res.json(await loadInvoice(tctx(req).tenantId, pid(req)));
});

billingRouter.post('/invoices', requirePermission('billing.create'), async (req, res) => {
  const a = tctx(req);
  const body = z
    .object({
      patientId: z.coerce.number().int().positive(),
      type: z.enum(['opd', 'ipd', 'pharmacy', 'lab', 'general']).default('general'),
      items: z.array(lineSchema).min(1).max(100),
      notes: optStr(500),
      payment: paymentSchema.optional(),
    })
    .parse(req.body);
  const [pt] = await db.select({ id: patients.id }).from(patients).where(and(eq(patients.id, body.patientId), eq(patients.tenantId, a.tenantId)));
  if (!pt) throw notFound('Patient');
  if (body.payment && !a.permissions.has('billing.payment')) throw badRequest('You cannot collect payments');
  const result = await db.transaction(async (tx) => {
    const inv = await createInvoice(tx, a, { patientId: body.patientId, type: body.type, items: body.items, notes: body.notes });
    if (body.payment) await recordPayment(tx, a, inv.id, body.payment);
    return inv;
  });
  await audit(req, 'create', 'invoice', result.id, `Invoice ${result.invoiceNo} (${result.total})`);
  res.status(201).json(result);
});

billingRouter.post('/invoices/:id/items', requirePermission('billing.create'), async (req, res) => {
  const a = tctx(req);
  const id = pid(req);
  const items = z.array(lineSchema).min(1).max(50).parse(req.body.items ?? req.body);
  const inv = await loadInvoice(a.tenantId, id);
  if (['paid', 'cancelled', 'refunded'].includes(inv.status)) throw conflict(`Cannot add items to a ${inv.status} invoice`);
  await db.transaction(async (tx) => {
    await addInvoiceItems(tx, a.tenantId, id, items);
    await recomputeInvoice(tx, a.tenantId, id);
  });
  await audit(req, 'update', 'invoice', id, `Added ${items.length} item(s) to ${inv.invoiceNo}`);
  res.json({ ok: true });
});

billingRouter.delete('/invoices/:id/items/:itemId', requirePermission('billing.create'), async (req, res) => {
  const a = tctx(req);
  const id = pid(req);
  const itemId = pid(req, 'itemId');
  const inv = await loadInvoice(a.tenantId, id);
  if (['paid', 'cancelled', 'refunded'].includes(inv.status)) throw conflict(`Cannot edit a ${inv.status} invoice`);
  const item = inv.items.find((i) => i.id === itemId);
  if (!item) throw notFound('Invoice item');
  if (item.itemType === 'medicine' && item.batchId) throw conflict('Dispensed medicines must be returned through the pharmacy');
  await db.transaction(async (tx) => {
    await tx.delete(invoiceItems).where(and(eq(invoiceItems.id, itemId), eq(invoiceItems.tenantId, a.tenantId)));
    const totals = await recomputeInvoice(tx, a.tenantId, id);
    if (totals.amountPaid > totals.total) throw conflict('Removing this item would leave the invoice overpaid. Refund first.');
  });
  await audit(req, 'update', 'invoice', id, `Removed "${item.description}" from ${inv.invoiceNo}`);
  res.json({ ok: true });
});

billingRouter.post('/invoices/:id/finalize', requirePermission('billing.create'), async (req, res) => {
  const a = tctx(req);
  const id = pid(req);
  const inv = await loadInvoice(a.tenantId, id);
  if (inv.status !== 'draft') throw conflict('Only draft invoices can be finalised');
  if (inv.admissionId) throw conflict('IPD bills are finalised on discharge');
  await db.transaction(async (tx) => {
    await tx.update(invoices).set({ status: 'unpaid' }).where(eq(invoices.id, id));
    await recomputeInvoice(tx, a.tenantId, id);
  });
  await audit(req, 'status', 'invoice', id, `Finalised ${inv.invoiceNo}`);
  res.json({ ok: true });
});

billingRouter.post('/invoices/:id/payments', requirePermission('billing.payment'), async (req, res) => {
  const a = tctx(req);
  const id = pid(req);
  const body = paymentSchema.parse(req.body);
  const result = await db.transaction((tx) => recordPayment(tx, a, id, body));
  await audit(req, 'payment', 'invoice', id, `Payment ${result.receiptNo}: ${body.amount} via ${body.method}`);
  res.status(201).json(result);
});

billingRouter.post('/invoices/:id/refund', requirePermission('billing.refund'), async (req, res) => {
  const a = tctx(req);
  const id = pid(req);
  const body = paymentSchema.extend({ notes: z.string().trim().min(3).max(300) }).parse(req.body);
  const result = await db.transaction((tx) => recordPayment(tx, a, id, { ...body, refund: true }));
  await audit(req, 'refund', 'invoice', id, `Refund ${result.receiptNo}: ${body.amount} via ${body.method} — ${body.notes}`);
  res.status(201).json(result);
});

billingRouter.post('/invoices/:id/cancel', requirePermission('billing.cancel'), async (req, res) => {
  const a = tctx(req);
  const id = pid(req);
  const { reason } = z.object({ reason: z.string().trim().min(3).max(300) }).parse(req.body);
  const inv = await loadInvoice(a.tenantId, id);
  if (inv.status === 'cancelled') throw conflict('Already cancelled');
  if (inv.amountPaid > 0) throw conflict('This invoice has payments. Refund them before cancelling (BR-9).');
  if (inv.admissionId && inv.status === 'draft') throw conflict('The running IPD bill closes on discharge');
  if (inv.items.some((i) => i.itemType === 'medicine' && i.batchId)) throw conflict('Pharmacy invoices are reversed through a pharmacy return');
  await db.update(invoices).set({ status: 'cancelled', cancelReason: reason }).where(eq(invoices.id, id));
  await audit(req, 'status', 'invoice', id, `Cancelled ${inv.invoiceNo}: ${reason}`);
  res.json({ ok: true });
});

billingRouter.get('/payments', requirePermission('billing.view'), async (req, res) => {
  const a = tctx(req);
  const p = pagingSchema.extend({ from: dateStr.optional(), to: dateStr.optional(), method: z.enum(PAYMENT_METHODS).optional() }).parse(req.query);
  const where = and(
    eq(payments.tenantId, a.tenantId),
    p.method ? eq(payments.method, p.method) : undefined,
    ...rangeWhere(payments.paidAt, p.from, p.to),
    p.q ? or(sql`${patientName} LIKE ${likeTerm(p.q)}`, sql`${payments.receiptNo} LIKE ${likeTerm(p.q)}`) : undefined,
  );
  const rows = await db
    .select({
      id: payments.id,
      receiptNo: payments.receiptNo,
      amount: payments.amount,
      method: payments.method,
      reference: payments.reference,
      isRefund: payments.isRefund,
      paidAt: payments.paidAt,
      invoiceId: payments.invoiceId,
      invoiceNo: invoices.invoiceNo,
      patientName,
      uhid: patients.uhid,
      receivedByName: users.fullName,
    })
    .from(payments)
    .innerJoin(invoices, eq(invoices.id, payments.invoiceId))
    .innerJoin(patients, eq(patients.id, payments.patientId))
    .leftJoin(users, eq(users.id, payments.receivedBy))
    .where(where)
    .orderBy(desc(payments.id))
    .limit(p.pageSize)
    .offset((p.page - 1) * p.pageSize);
  const [agg] = await db
    .select({ n: count(), net: sql<number>`COALESCE(SUM(${payments.amount}),0)` })
    .from(payments)
    .innerJoin(patients, eq(patients.id, payments.patientId))
    .where(where);
  res.json({ ...paged(rows, agg.n, p), totals: { net: Number(agg.net) } });
});
