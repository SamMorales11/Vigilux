import postgres from 'postgres';
import { drizzle } from 'drizzle-orm/postgres-js';
import { env } from '../config/index.js';
import * as schema from './schema.js';

/**
 * Konfigurasi koneksi Neon PostgreSQL menggunakan postgres.js dan Drizzle ORM.
 * - Neon serverless / connection pooling membutuhkan prepare: false.
 * - SSL diaktifkan jika URL mengindikasikan koneksi Neon atau lingkungan produksi.
 */
const isSslRequired =
  env.DATABASE_URL.includes('neon.tech') ||
  env.DATABASE_URL.includes('sslmode=require') ||
  env.NODE_ENV === 'production';

export const sqlClient = postgres(env.DATABASE_URL, {
  max: env.DATABASE_MAX_CONNECTIONS,
  ssl: isSslRequired ? 'require' : false,
  prepare: false, // Wajib untuk PgBouncer / Neon connection pooling
  connect_timeout: 15,
  idle_timeout: 20,
});

export const db = drizzle(sqlClient, { schema });

/**
 * Health check helper untuk menguji koneksi ke database
 */
export async function checkDatabaseConnection(): Promise<boolean> {
  try {
    await sqlClient`SELECT 1`;
    return true;
  } catch {
    return false;
  }
}

/**
 * Helper untuk menutup koneksi database secara graceful
 */
export async function closeDatabaseConnection(): Promise<void> {
  await sqlClient.end();
}

export type Database = typeof db;
export * from './schema.js';
