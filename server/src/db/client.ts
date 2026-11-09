import mysql from 'mysql2/promise';
import { drizzle } from 'drizzle-orm/mysql2';
import { env } from '../config/env.js';
import * as schema from './schema.js';

export const pool = mysql.createPool({
  host: env.DB_HOST,
  port: env.DB_PORT,
  user: env.DB_USER,
  password: env.DB_PASSWORD,
  database: env.DB_NAME,
  connectionLimit: 20,
  waitForConnections: true,
  decimalNumbers: true,
  dateStrings: ['DATE'],
  timezone: 'Z',
  supportBigNumbers: true,
});

// Keep MySQL sessions in UTC so TIMESTAMP defaults and app-written Dates agree.
// Only the core (callback) pool emits connection events.
(pool as unknown as { pool: { on: (e: string, cb: (c: { query: (s: string) => void }) => void) => void } }).pool.on(
  'connection',
  (conn) => conn.query("SET time_zone = '+00:00'"),
);

export const db = drizzle({ client: pool, schema, mode: 'default', casing: 'snake_case' });
export type DB = typeof db;
export type Tx = Parameters<Parameters<DB['transaction']>[0]>[0];
export type DbOrTx = DB | Tx;

/**
 * Transaction for "lock a parent row, then check and insert" flows (bookings,
 * admissions, dispensing). READ COMMITTED makes reads after the lock see rows
 * committed by the transaction that held it; under the default REPEATABLE READ
 * the snapshot predates the lock and capacity checks go stale (DEF-001).
 */
export const lockingTx = <T>(fn: (tx: Tx) => Promise<T>) => db.transaction(fn, { isolationLevel: 'read committed' });
