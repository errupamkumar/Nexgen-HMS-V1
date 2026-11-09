/** Drops and recreates the database, then migrates and seeds. DEV/TEST ONLY. */
import mysql from 'mysql2/promise';
import { env, isProd } from '../config/env.js';

if (isProd) {
  console.error('Refusing to reset a production database');
  process.exit(1);
}
const conn = await mysql.createConnection({ host: env.DB_HOST, port: env.DB_PORT, user: env.DB_USER, password: env.DB_PASSWORD });
await conn.query(`DROP DATABASE IF EXISTS \`${env.DB_NAME}\``);
await conn.end();
console.log(`✔ dropped ${env.DB_NAME}`);
await import('./setup.js');
