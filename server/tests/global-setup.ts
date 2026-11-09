/** Builds a fresh, seeded test database once per run. */
export default async function setup() {
  process.env.NODE_ENV = 'test';
  process.env.DB_NAME = 'nexgen_hms_test';
  const mysql = (await import('mysql2/promise')).default;
  const { env } = await import('../src/config/env.js');
  const conn = await mysql.createConnection({ host: env.DB_HOST, port: env.DB_PORT, user: env.DB_USER, password: env.DB_PASSWORD });
  await conn.query('DROP DATABASE IF EXISTS `nexgen_hms_test`');
  await conn.query('CREATE DATABASE `nexgen_hms_test` CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci');
  await conn.end();
  const { runMigrations } = await import('../src/db/migrate.js');
  await runMigrations();
  const { seed } = await import('../src/db/seed.js');
  await seed();
  const { pool } = await import('../src/db/client.js');
  await pool.end();
}
