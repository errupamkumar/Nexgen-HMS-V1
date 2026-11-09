/**
 * Generic tenant-scoped CRUD router for master data. Every query is pinned to
 * the caller's tenant; ids from other tenants resolve to 404, never to data.
 */
import { Router } from 'express';
import { and, asc, count, eq, like, or, type SQL } from 'drizzle-orm';
import type { MySqlColumn, MySqlTable } from 'drizzle-orm/mysql-core';
import type { ZodType } from 'zod';
import { z } from 'zod';
import { db } from '../../db/client.js';
import { requirePermission, tctx } from '../../core/auth.js';
import { conflict, notFound } from '../../core/errors.js';
import { audit, likeTerm, paged, pagingSchema, pid } from '../../core/util.js';

type AnyTable = MySqlTable & {
  id: MySqlColumn;
  tenantId: MySqlColumn;
  isActive?: MySqlColumn;
};

export interface CrudOptions {
  table: AnyTable;
  entity: string;
  viewPermission: string | string[];
  managePermission: string;
  schema: ZodType<Record<string, unknown>>;
  searchColumns: MySqlColumn[];
  orderBy: MySqlColumn;
  label: (row: Record<string, unknown>) => string;
  /** Extra list filters from the query string. */
  filters?: (query: Record<string, unknown>, table: AnyTable) => (SQL | undefined)[];
}

export function crudRouter(o: CrudOptions) {
  const r = Router();
  const t = o.table;
  const viewPerms = Array.isArray(o.viewPermission) ? o.viewPermission : [o.viewPermission];
  const view = requirePermission(...viewPerms);
  const manage = requirePermission(o.managePermission);

  r.get('/', view, async (req, res) => {
    const a = tctx(req);
    const p = pagingSchema
      .extend({ all: z.coerce.boolean().optional(), active: z.enum(['true', 'false']).optional() })
      .parse(req.query);
    const where = and(
      eq(t.tenantId, a.tenantId),
      p.q ? or(...o.searchColumns.map((c) => like(c, likeTerm(p.q!)))) : undefined,
      p.active && t.isActive ? eq(t.isActive, p.active === 'true') : undefined,
      ...(o.filters?.(req.query as Record<string, unknown>, t) ?? []),
    );
    if (p.all) {
      const rows = await db.select().from(t).where(where).orderBy(asc(o.orderBy)).limit(1000);
      return res.json(rows);
    }
    const rows = await db
      .select()
      .from(t)
      .where(where)
      .orderBy(asc(o.orderBy))
      .limit(p.pageSize)
      .offset((p.page - 1) * p.pageSize);
    const [{ n }] = await db.select({ n: count() }).from(t).where(where);
    res.json(paged(rows, n, p));
  });

  r.get('/:id', view, async (req, res) => {
    const a = tctx(req);
    const [row] = await db.select().from(t).where(and(eq(t.id, pid(req)), eq(t.tenantId, a.tenantId)));
    if (!row) throw notFound(o.entity);
    res.json(row);
  });

  r.post('/', manage, async (req, res) => {
    const a = tctx(req);
    const body = o.schema.parse(req.body);
    const [result] = await db.insert(t).values({ ...body, tenantId: a.tenantId } as never);
    const id = (result as unknown as { insertId: number }).insertId;
    await audit(req, 'create', o.entity, id, `Created ${o.entity} ${o.label(body)}`);
    res.status(201).json({ id });
  });

  r.put('/:id', manage, async (req, res) => {
    const a = tctx(req);
    const id = pid(req);
    const body = o.schema.parse(req.body);
    const [row] = await db.select({ id: t.id }).from(t).where(and(eq(t.id, id), eq(t.tenantId, a.tenantId)));
    if (!row) throw notFound(o.entity);
    await db
      .update(t)
      .set(body as never)
      .where(and(eq(t.id, id), eq(t.tenantId, a.tenantId)));
    await audit(req, 'update', o.entity, id, `Updated ${o.entity} ${o.label(body)}`);
    res.json({ ok: true });
  });

  r.delete('/:id', manage, async (req, res) => {
    const a = tctx(req);
    const id = pid(req);
    const [row] = await db.select().from(t).where(and(eq(t.id, id), eq(t.tenantId, a.tenantId)));
    if (!row) throw notFound(o.entity);
    try {
      await db.delete(t).where(and(eq(t.id, id), eq(t.tenantId, a.tenantId)));
    } catch (err) {
      const code = (err as { code?: string; cause?: { code?: string } }).cause?.code ?? (err as { code?: string }).code;
      if (code === 'ER_ROW_IS_REFERENCED_2' || code === 'ER_ROW_IS_REFERENCED') {
        throw conflict(`This ${o.entity} is in use. Deactivate it instead of deleting.`);
      }
      throw err;
    }
    await audit(req, 'delete', o.entity, id, `Deleted ${o.entity} ${o.label(row as Record<string, unknown>)}`);
    res.json({ ok: true });
  });

  return r;
}
