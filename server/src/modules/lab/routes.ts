import { Router } from 'express';
import { and, asc, count, desc, eq, gte, lte, or, sql } from 'drizzle-orm';
import { z } from 'zod';
import { db } from '../../db/client.js';
import { doctors, invoices, labOrderItems, labOrders, labTests, patients } from '../../db/schema.js';
import { authenticate, requirePermission, requireTenantUser, tctx } from '../../core/auth.js';
import { badRequest, conflict, notFound } from '../../core/errors.js';
import { notify } from '../../core/notify.js';
import { audit, dateStr, likeTerm, optStr, paged, pagingSchema, pid, qcol } from '../../core/util.js';
import { patientName } from '../patients/routes.js';
import { createLabOrder, flagFor } from './service.js';

export const labRouter = Router();
labRouter.use(authenticate, requireTenantUser);

labRouter.get('/orders', requirePermission('lab.view'), async (req, res) => {
  const a = tctx(req);
  const p = pagingSchema
    .extend({ status: z.string().max(30).optional(), from: dateStr.optional(), to: dateStr.optional(), patientId: z.coerce.number().int().optional() })
    .parse(req.query);
  const where = and(
    eq(labOrders.tenantId, a.tenantId),
    p.status ? eq(labOrders.status, p.status as 'ordered') : undefined,
    p.patientId ? eq(labOrders.patientId, p.patientId) : undefined,
    p.from ? gte(labOrders.createdAt, new Date(`${p.from}T00:00:00Z`)) : undefined,
    p.to ? lte(labOrders.createdAt, new Date(`${p.to}T23:59:59.999Z`)) : undefined,
    p.q ? or(sql`${patientName} LIKE ${likeTerm(p.q)}`, sql`${patients.uhid} LIKE ${likeTerm(p.q)}`, sql`${labOrders.orderNo} LIKE ${likeTerm(p.q)}`) : undefined,
  );
  const rows = await db
    .select({
      id: labOrders.id,
      orderNo: labOrders.orderNo,
      status: labOrders.status,
      priority: labOrders.priority,
      createdAt: labOrders.createdAt,
      sampleId: labOrders.sampleId,
      patientId: patients.id,
      patientName,
      uhid: patients.uhid,
      doctorName: doctors.name,
      invoiceStatus: invoices.status,
      tests: sql<string>`(SELECT GROUP_CONCAT(i.test_name SEPARATOR ', ') FROM lab_order_items i WHERE i.lab_order_id = ${qcol('lab_orders', 'id')})`,
    })
    .from(labOrders)
    .innerJoin(patients, eq(patients.id, labOrders.patientId))
    .leftJoin(doctors, eq(doctors.id, labOrders.doctorId))
    .leftJoin(invoices, eq(invoices.id, labOrders.invoiceId))
    .where(where)
    .orderBy(sql`FIELD(${labOrders.priority}, 'stat', 'urgent', 'routine')`, desc(labOrders.id))
    .limit(p.pageSize)
    .offset((p.page - 1) * p.pageSize);
  const [{ n }] = await db.select({ n: count() }).from(labOrders).innerJoin(patients, eq(patients.id, labOrders.patientId)).where(where);
  res.json(paged(rows, n, p));
});

export async function loadLabOrder(tenantId: number, id: number) {
  const [o] = await db
    .select({
      order: labOrders,
      patient: {
        id: patients.id,
        name: patientName,
        uhid: patients.uhid,
        gender: patients.gender,
        dob: patients.dob,
        phone: patients.phone,
      },
      doctorName: doctors.name,
    })
    .from(labOrders)
    .innerJoin(patients, eq(patients.id, labOrders.patientId))
    .leftJoin(doctors, eq(doctors.id, labOrders.doctorId))
    .where(and(eq(labOrders.id, id), eq(labOrders.tenantId, tenantId)));
  if (!o) throw notFound('Lab order');
  const items = await db
    .select({ item: labOrderItems, category: labTests.category, sampleType: labTests.sampleType })
    .from(labOrderItems)
    .leftJoin(labTests, eq(labTests.id, labOrderItems.labTestId))
    .where(and(eq(labOrderItems.tenantId, tenantId), eq(labOrderItems.labOrderId, id)))
    .orderBy(asc(labOrderItems.id));
  return { ...o.order, patient: o.patient, doctorName: o.doctorName, items: items.map((i) => ({ ...i.item, category: i.category, sampleType: i.sampleType })) };
}

labRouter.get('/orders/:id', requirePermission('lab.view'), async (req, res) => {
  res.json(await loadLabOrder(tctx(req).tenantId, pid(req)));
});

labRouter.post('/orders', requirePermission('lab.order'), async (req, res) => {
  const a = tctx(req);
  const body = z
    .object({
      patientId: z.coerce.number().int().positive(),
      doctorId: z.coerce.number().int().positive().nullable().optional(),
      testIds: z.array(z.coerce.number().int().positive()).min(1).max(50),
      priority: z.enum(['routine', 'urgent', 'stat']).default('routine'),
      notes: optStr(500),
    })
    .parse(req.body);
  if (body.doctorId) {
    const [d] = await db.select({ id: doctors.id }).from(doctors).where(and(eq(doctors.id, body.doctorId), eq(doctors.tenantId, a.tenantId)));
    if (!d) throw badRequest('Unknown doctor');
  }
  const result = await db.transaction((tx) => createLabOrder(tx, a, body));
  await audit(req, 'create', 'lab_order', result.id, `Lab order ${result.orderNo}`);
  res.status(201).json(result);
});

labRouter.post('/orders/:id/collect', requirePermission('lab.result'), async (req, res) => {
  const a = tctx(req);
  const id = pid(req);
  const { sampleId } = z.object({ sampleId: optStr(40) }).parse(req.body ?? {});
  const o = await loadLabOrder(a.tenantId, id);
  if (o.status !== 'ordered') throw conflict(`Sample already ${o.status.replace('_', ' ')}`);
  await db
    .update(labOrders)
    .set({ status: 'sample_collected', collectedAt: new Date(), sampleId: sampleId || `S-${o.orderNo}` })
    .where(eq(labOrders.id, id));
  await audit(req, 'status', 'lab_order', id, `Sample collected for ${o.orderNo}`);
  res.json({ ok: true });
});

labRouter.put('/orders/:id/results', requirePermission('lab.result'), async (req, res) => {
  const a = tctx(req);
  const id = pid(req);
  const body = z
    .object({
      items: z
        .array(
          z.object({
            id: z.coerce.number().int().positive(),
            results: z.array(z.object({ parameter: z.string().max(80), value: z.string().trim().max(100) })).max(60),
            resultNotes: optStr(500),
          }),
        )
        .min(1),
      complete: z.boolean().default(false),
    })
    .parse(req.body);
  const o = await loadLabOrder(a.tenantId, id);
  if (o.status === 'ordered') throw conflict('Collect the sample before entering results');
  if (o.status === 'verified' || o.status === 'cancelled') throw conflict(`Order is ${o.status}; results are locked`);

  const testIds = o.items.map((i) => i.labTestId);
  const tests = await db.select().from(labTests).where(and(eq(labTests.tenantId, a.tenantId), sql`${labTests.id} IN (${sql.join(testIds.map((t) => sql`${t}`), sql`, `)})`));

  await db.transaction(async (tx) => {
    for (const input of body.items) {
      const item = o.items.find((i) => i.id === input.id);
      if (!item) throw badRequest(`Item ${input.id} does not belong to this order`);
      const params = tests.find((t) => t.id === item.labTestId)?.parameters ?? [];
      const results = item.results.map((r) => {
        const v = input.results.find((x) => x.parameter === r.parameter)?.value ?? r.value;
        const prm = params.find((p) => p.name === r.parameter);
        return { ...r, value: v, flag: flagFor(v, prm) };
      });
      await tx
        .update(labOrderItems)
        .set({ results, resultNotes: input.resultNotes ?? null })
        .where(and(eq(labOrderItems.id, item.id), eq(labOrderItems.tenantId, a.tenantId)));
    }
    if (body.complete) {
      const fresh = await tx.select().from(labOrderItems).where(and(eq(labOrderItems.tenantId, a.tenantId), eq(labOrderItems.labOrderId, id)));
      const missing = fresh.some((i) => i.results.some((r) => r.value.trim() === ''));
      if (missing) throw badRequest('Enter a value for every parameter before completing');
      await tx.update(labOrders).set({ status: 'completed', completedAt: new Date() }).where(eq(labOrders.id, id));
    }
  });
  await audit(req, 'update', 'lab_order', id, `${body.complete ? 'Completed' : 'Saved'} results for ${o.orderNo}`);
  res.json({ ok: true });
});

labRouter.post('/orders/:id/verify', requirePermission('lab.verify'), async (req, res) => {
  const a = tctx(req);
  const id = pid(req);
  const o = await loadLabOrder(a.tenantId, id);
  if (o.status !== 'completed') throw conflict('Only completed results can be verified');
  await db.update(labOrders).set({ status: 'verified', verifiedAt: new Date(), verifiedBy: a.userId }).where(eq(labOrders.id, id));
  const abnormal = o.items.flatMap((i) => i.results).filter((r) => r.flag === 'H' || r.flag === 'L').length;
  await notify(db, a.tenantId, {
    title: `Lab report ready — ${o.patient.name}`,
    body: `${o.orderNo}: ${o.items.map((i) => i.testName).join(', ')}${abnormal ? ` · ${abnormal} abnormal value(s)` : ''}`,
    link: `/lab/orders/${id}`,
    type: 'lab',
    permission: 'opd.view',
  });
  await audit(req, 'status', 'lab_order', id, `Verified ${o.orderNo}`);
  res.json({ ok: true });
});

labRouter.post('/orders/:id/cancel', requirePermission('lab.order'), async (req, res) => {
  const a = tctx(req);
  const id = pid(req);
  const o = await loadLabOrder(a.tenantId, id);
  if (!['ordered', 'sample_collected'].includes(o.status)) throw conflict(`A ${o.status} order cannot be cancelled`);
  await db.transaction(async (tx) => {
    await tx.update(labOrders).set({ status: 'cancelled' }).where(eq(labOrders.id, id));
    if (o.invoiceId) {
      const [inv] = await tx.select().from(invoices).where(eq(invoices.id, o.invoiceId));
      if (inv && inv.amountPaid <= 0 && inv.status === 'unpaid') {
        await tx.update(invoices).set({ status: 'cancelled', cancelReason: 'Lab order cancelled' }).where(eq(invoices.id, inv.id));
      }
    }
  });
  await audit(req, 'status', 'lab_order', id, `Cancelled ${o.orderNo}`);
  res.json({ ok: true });
});
