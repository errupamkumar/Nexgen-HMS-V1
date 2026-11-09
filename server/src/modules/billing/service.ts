/**
 * Billing engine. Totals are ALWAYS derived server-side from line items and
 * payments (BR-8) — callers pass quantities and prices, never totals.
 */
import { and, eq, sql } from 'drizzle-orm';
import type { DbOrTx } from '../../db/client.js';
import { invoiceItems, invoices, payments, PAYMENT_METHODS } from '../../db/schema.js';
import { badRequest, conflict, notFound } from '../../core/errors.js';
import type { TenantSettings } from '../../core/settings.js';
import { nextNumber, round2 } from '../../core/util.js';

export type ItemType = (typeof invoiceItems.$inferInsert)['itemType'];
export type InvoiceType = (typeof invoices.$inferInsert)['type'];
export type PaymentMethod = (typeof PAYMENT_METHODS)[number];

export interface LineInput {
  itemType: ItemType;
  refId?: number | null;
  batchId?: number | null;
  description: string;
  quantity: number;
  unitPrice: number;
  discount?: number;
  taxRate?: number;
}

export interface BillingCtx {
  tenantId: number;
  userId: number;
  settings: TenantSettings;
}

export function computeLine(l: LineInput) {
  const qty = Math.max(0, l.quantity);
  const gross = round2(qty * l.unitPrice);
  const discount = round2(Math.min(Math.max(0, l.discount ?? 0), gross));
  const taxRate = Math.max(0, l.taxRate ?? 0);
  const taxAmount = round2(((gross - discount) * taxRate) / 100);
  return { gross, discount, taxRate, taxAmount, amount: round2(gross - discount + taxAmount) };
}

export async function addInvoiceItems(tx: DbOrTx, tenantId: number, invoiceId: number, items: LineInput[]) {
  if (!items.length) return;
  await tx.insert(invoiceItems).values(
    items.map((l) => {
      const c = computeLine(l);
      return {
        tenantId,
        invoiceId,
        itemType: l.itemType,
        refId: l.refId ?? null,
        batchId: l.batchId ?? null,
        description: l.description.slice(0, 200),
        quantity: l.quantity,
        unitPrice: l.unitPrice,
        discount: c.discount,
        taxRate: c.taxRate,
        taxAmount: c.taxAmount,
        amount: c.amount,
      };
    }),
  );
}

/** Recalculate totals, paid amount, balance and status from the ledger. */
export async function recomputeInvoice(tx: DbOrTx, tenantId: number, invoiceId: number) {
  const [inv] = await tx.select().from(invoices).where(and(eq(invoices.id, invoiceId), eq(invoices.tenantId, tenantId)));
  if (!inv) throw notFound('Invoice');
  const [sums] = await tx
    .select({
      gross: sql<number>`COALESCE(SUM(${invoiceItems.quantity} * ${invoiceItems.unitPrice}), 0)`,
      discount: sql<number>`COALESCE(SUM(${invoiceItems.discount}), 0)`,
      tax: sql<number>`COALESCE(SUM(${invoiceItems.taxAmount}), 0)`,
      total: sql<number>`COALESCE(SUM(${invoiceItems.amount}), 0)`,
    })
    .from(invoiceItems)
    .where(and(eq(invoiceItems.tenantId, tenantId), eq(invoiceItems.invoiceId, invoiceId)));
  const [paid] = await tx
    .select({
      net: sql<number>`COALESCE(SUM(${payments.amount}), 0)`,
      refunds: sql<number>`COALESCE(SUM(CASE WHEN ${payments.isRefund} THEN 1 ELSE 0 END), 0)`,
    })
    .from(payments)
    .where(and(eq(payments.tenantId, tenantId), eq(payments.invoiceId, invoiceId)));

  const total = round2(Number(sums.total));
  const amountPaid = round2(Number(paid.net));
  const balance = round2(total - amountPaid);

  let status = inv.status;
  if (inv.status !== 'cancelled' && inv.status !== 'draft') {
    if (amountPaid <= 0 && Number(paid.refunds) > 0) status = 'refunded';
    else if (total > 0 && amountPaid >= total) status = 'paid';
    else if (total === 0) status = 'paid';
    else if (amountPaid > 0) status = 'partially_paid';
    else status = 'unpaid';
  }

  await tx
    .update(invoices)
    .set({
      subtotal: round2(Number(sums.gross)),
      discountTotal: round2(Number(sums.discount)),
      taxTotal: round2(Number(sums.tax)),
      total,
      amountPaid,
      balance,
      status,
    })
    .where(eq(invoices.id, invoiceId));
  return { total, amountPaid, balance, status };
}

export interface CreateInvoiceInput {
  patientId: number;
  type: InvoiceType;
  items: LineInput[];
  status?: 'unpaid' | 'draft';
  appointmentId?: number | null;
  admissionId?: number | null;
  labOrderId?: number | null;
  encounterId?: number | null;
  notes?: string | null;
}

export async function createInvoice(tx: DbOrTx, ctx: BillingCtx, input: CreateInvoiceInput) {
  const invoiceNo = await nextNumber(tx, ctx.tenantId, ctx.settings, 'invoice');
  const [r] = await tx.insert(invoices).values({
    tenantId: ctx.tenantId,
    invoiceNo,
    patientId: input.patientId,
    type: input.type,
    status: input.status ?? 'unpaid',
    appointmentId: input.appointmentId ?? null,
    admissionId: input.admissionId ?? null,
    labOrderId: input.labOrderId ?? null,
    encounterId: input.encounterId ?? null,
    notes: input.notes ?? null,
    createdBy: ctx.userId,
  });
  const id = r.insertId;
  await addInvoiceItems(tx, ctx.tenantId, id, input.items);
  const totals = await recomputeInvoice(tx, ctx.tenantId, id);
  return { id, invoiceNo, ...totals };
}

export async function recordPayment(
  tx: DbOrTx,
  ctx: BillingCtx,
  invoiceId: number,
  p: { amount: number; method: PaymentMethod; reference?: string | null; notes?: string | null; refund?: boolean },
) {
  const [inv] = await tx
    .select()
    .from(invoices)
    .where(and(eq(invoices.id, invoiceId), eq(invoices.tenantId, ctx.tenantId)))
    .for('update');
  if (!inv) throw notFound('Invoice');
  if (inv.status === 'cancelled') throw conflict('Invoice is cancelled');
  const amount = round2(p.amount);
  if (amount <= 0) throw badRequest('Amount must be greater than zero');

  if (p.refund) {
    if (amount > inv.amountPaid) throw badRequest(`Refund cannot exceed the amount paid (${inv.amountPaid})`);
  } else {
    if (inv.status !== 'draft' && amount > inv.balance + 0.001) {
      throw badRequest(`Payment exceeds the outstanding balance (${inv.balance})`);
    }
    if (!ctx.settings.billing.allowPartialPayment && inv.status !== 'draft' && Math.abs(amount - inv.balance) > 0.001) {
      throw badRequest('Partial payments are disabled. Collect the full balance.');
    }
  }

  const receiptNo = await nextNumber(tx, ctx.tenantId, ctx.settings, 'receipt');
  const [r] = await tx.insert(payments).values({
    tenantId: ctx.tenantId,
    invoiceId,
    patientId: inv.patientId,
    receiptNo,
    amount: p.refund ? -amount : amount,
    method: p.method,
    reference: p.reference ?? null,
    notes: p.notes ?? null,
    isRefund: Boolean(p.refund),
    receivedBy: ctx.userId,
  });
  const totals = await recomputeInvoice(tx, ctx.tenantId, invoiceId);
  return { paymentId: r.insertId, receiptNo, ...totals };
}
