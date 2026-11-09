/** Creates the database if missing, runs migrations, then seeds demo data. */
import mysql from 'mysql2/promise';
import { env } from '../config/env.js';

async function main() {
  const conn = await mysql.createConnection({
    host: env.DB_HOST,
    port: env.DB_PORT,
    user: env.DB_USER,
    password: env.DB_PASSWORD,
  });
  await conn.query(
    `CREATE DATABASE IF NOT EXISTS \`${env.DB_NAME}\` CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci`,
  );
  await conn.end();
  console.log(`✔ database ${env.DB_NAME} ready`);
  const { runMigrations } = await import('./migrate.js');
  await runMigrations();
  const { seed } = await import('./seed.js');
  await seed();
  process.exit(0);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
