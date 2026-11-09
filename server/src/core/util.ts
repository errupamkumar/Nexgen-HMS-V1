import type { Request } from 'express';
import { sql, type SQL } from 'drizzle-orm';
import { z } from 'zod';
import { auditLogs } from '../db/schema.js';
import type { DbOrTx } from '../db/client.js';
import { db } from '../db/client.js';
import { logger } from './logger.js';
import type { TenantSettings } from './settings.js';

// ------------------------------------------------------------- validation
export const idParam = z.coerce.number().int().positive();
export const pid = (req: Request, name = 'id') => idParam.parse(req.params[name]);

export const pagingSchema = z.object({
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(200).default(20),
  q: z.string().trim().max(100).optional(),
});
export type Paging = z.infer<typeof pagingSchema>;
export const paged = <T>(data: T[], total: number, p: Paging) => ({ data, total, page: p.page, pageSize: p.pageSize });

export const dateStr = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'expected YYYY-MM-DD');
export const timeStr = z
  .string()
  .regex(/^([01]\d|2[0-3]):[0-5]\d(:[0-5]\d)?$/, 'expected HH:mm')
  .transform((t) => (t.length === 5 ? `${t}:00` : t));
export const optStr = (max: number) => z.string().trim().max(max).optional().nullable();
export const money = z.coerce.number().min(0).max(100_000_000);

/** Escape LIKE wildcards in user search input. */
export const likeTerm = (q: string) => `%${q.replace(/[\\%_]/g, (c) => `\\${c}`)}%`;

export const round2 = (n: number) => Math.round((n + Number.EPSILON) * 100) / 100;

// ------------------------------------------------------------- time (tenant timezone)
export function nowInTz(timezone: string) {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: timezone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    hourCycle: 'h23',
  }).formatToParts(new Date());
  const get = (t: string) => parts.find((p) => p.type === t)?.value ?? '00';
  return { date: `${get('year')}-${get('month')}-${get('day')}`, time: `${get('hour')}:${get('minute')}:${get('second')}` };
}

export const todayFor = (s: TenantSettings) => nowInTz(s.locale.timezone).date;

export function addDays(date: string, days: number): string {
  const d = new Date(`${date}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

export const dayOfWeek = (date: string) => new Date(`${date}T00:00:00Z`).getUTCDay();

export const timeToMin = (t: string) => {
  const [h, m] = t.split(':').map(Number);
  return h * 60 + m;
};
export const minToTime = (m: number) => `${String(Math.floor(m / 60)).padStart(2, '0')}:${String(m % 60).padStart(2, '0')}:00`;

// ------------------------------------------------------------- numbering
/**
 * Atomic per-tenant counter. LAST_INSERT_ID(expr) makes the incremented value
 * readable on the same connection, so concurrent callers never collide.
 * Must run on the same connection/transaction as the insert that uses it.
 */
export async function nextSequence(tx: DbOrTx, tenantId: number, name: string): Promise<number> {
  await tx.execute(
    sql`INSERT INTO sequences (tenant_id, name, value) VALUES (${tenantId}, ${name}, LAST_INSERT_ID(1))
        ON DUPLICATE KEY UPDATE value = LAST_INSERT_ID(value + 1)`,
  );
  const res = (await tx.execute(sql`SELECT LAST_INSERT_ID() AS v`)) as unknown as [{ v: number | string }[]];
  return Number(res[0][0].v);
}

export async function nextNumber(
  tx: DbOrTx,
  tenantId: number,
  settings: TenantSettings,
  kind: 'uhid' | 'appointment' | 'invoice' | 'receipt' | 'lab' | 'admission',
): Promise<string> {
  const n = await nextSequence(tx, tenantId, kind);
  const prefix = settings.numbering[kind];
  return `${prefix}-${String(n).padStart(settings.numbering.padding, '0')}`;
}

// ------------------------------------------------------------- audit
export async function audit(
  req: Request,
  action: 'create' | 'update' | 'delete' | 'login' | 'logout' | 'status' | 'payment' | 'refund' | 'dispense' | string,
  entity: string,
  entityId: number | string | null,
  summary: string,
  details?: Record<string, unknown>,
  tx: DbOrTx = db,
) {
  try {
    await tx.insert(auditLogs).values({
      tenantId: req.auth?.tenantId ?? null,
      userId: req.auth?.userId ?? null,
      userName: req.auth?.userName ?? null,
      action,
      entity,
      entityId: entityId === null ? null : String(entityId),
      summary: summary.slice(0, 500),
      details: details ?? null,
      ip: req.ip ?? null,
    });
  } catch (err) {
    // Auditing must never break the business operation, but it must be loud.
    logger.error({ err, entity, action }, 'audit write failed');
  }
}

/**
 * Fully-qualified column reference for correlated subqueries. Drizzle renders
 * bare `id` in single-table selects, which would bind to the INNER table of a
 * subquery (DEF-002). Always use this inside `(SELECT ... WHERE x = ${qcol(...)})`.
 */
export const qcol = (table: string, column: string) => sql.raw(`\`${table}\`.\`${column}\``);

/** `col IN (...)` helper that tolerates empty lists. */
export const inList = (col: SQL | unknown, ids: number[]) =>
  ids.length ? sql`${col} IN (${sql.join(ids.map((i) => sql`${i}`), sql`, `)})` : sql`1 = 0`;
