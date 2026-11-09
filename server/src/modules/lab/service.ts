import { and, eq, inArray } from 'drizzle-orm';
import type { Tx } from '../../db/client.js';
import { labOrderItems, labOrders, labTests, patients, type LabParameter, type LabResultValue } from '../../db/schema.js';
import { badRequest, notFound } from '../../core/errors.js';
import { notify } from '../../core/notify.js';
import { nextNumber } from '../../core/util.js';
import { createInvoice, type BillingCtx } from '../billing/service.js';

export interface LabOrderInput {
  patientId: number;
  doctorId?: number | null;
  encounterId?: number | null;
  testIds: number[];
  priority: 'routine' | 'urgent' | 'stat';
  notes?: string | null;
}

export async function createLabOrder(tx: Tx, ctx: BillingCtx & { modules: Set<string> }, input: LabOrderInput) {
  const [p] = await tx.select({ id: patients.id }).from(patients).where(and(eq(patients.id, input.patientId), eq(patients.tenantId, ctx.tenantId)));
  if (!p) throw notFound('Patient');
  const ids = [...new Set(input.testIds)];
  const tests = await tx
    .select()
    .from(labTests)
    .where(and(eq(labTests.tenantId, ctx.tenantId), inArray(labTests.id, ids), eq(labTests.isActive, true)));
  if (tests.length !== ids.length) throw badRequest('One or more lab tests are unknown or inactive');

  const orderNo = await nextNumber(tx, ctx.tenantId, ctx.settings, 'lab');
  const [r] = await tx.insert(labOrders).values({
    tenantId: ctx.tenantId,
    orderNo,
    patientId: input.patientId,
    doctorId: input.doctorId ?? null,
    encounterId: input.encounterId ?? null,
    priority: input.priority,
    notes: input.notes ?? null,
    createdBy: ctx.userId,
  });
  const labOrderId = r.insertId;
  await tx.insert(labOrderItems).values(
    tests.map((t) => ({
      tenantId: ctx.tenantId,
      labOrderId,
      labTestId: t.id,
      testName: t.name,
      price: t.price,
      results: t.parameters.map((prm) => ({ parameter: prm.name, value: '', unit: prm.unit ?? '', refRange: refRange(prm), flag: '' as const })),
    })),
  );

  let invoiceId: number | null = null;
  if (ctx.modules.has('billing') && tests.some((t) => t.price > 0)) {
    const inv = await createInvoice(tx, ctx, {
      patientId: input.patientId,
      type: 'lab',
      labOrderId,
      encounterId: input.encounterId ?? null,
      items: tests.map((t) => ({ itemType: 'lab_test', refId: t.id, description: t.name, quantity: 1, unitPrice: t.price, taxRate: t.taxRate })),
    });
    invoiceId = inv.id;
    await tx.update(labOrders).set({ invoiceId }).where(eq(labOrders.id, labOrderId));
  }
  if (input.priority !== 'routine') {
    await notify(tx, ctx.tenantId, {
      title: `${input.priority.toUpperCase()} lab order ${orderNo}`,
      body: tests.map((t) => t.name).join(', '),
      link: `/lab/orders/${labOrderId}`,
      type: 'lab',
      permission: 'lab.result',
    });
  }
  return { id: labOrderId, orderNo, invoiceId };
}

export function refRange(p: LabParameter): string {
  if (p.refText) return p.refText;
  const lo = p.refLow ?? null;
  const hi = p.refHigh ?? null;
  if (lo !== null && hi !== null) return `${lo} – ${hi}`;
  if (lo !== null) return `≥ ${lo}`;
  if (hi !== null) return `≤ ${hi}`;
  return '';
}

/** Auto H/L flag (BR-12). Non-numeric values are never flagged. */
export function flagFor(value: string, p?: LabParameter): LabResultValue['flag'] {
  if (!p || value.trim() === '') return '';
  const n = Number(value);
  if (!Number.isFinite(n)) return '';
  if (p.refHigh !== null && p.refHigh !== undefined && n > p.refHigh) return 'H';
  if (p.refLow !== null && p.refLow !== undefined && n < p.refLow) return 'L';
  if ((p.refHigh ?? null) === null && (p.refLow ?? null) === null) return '';
  return 'N';
}
