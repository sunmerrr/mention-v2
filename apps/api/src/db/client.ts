import { drizzle } from 'drizzle-orm/node-postgres';
import { Pool } from 'pg';
export function createDatabase(url: string, migration = false) {
  const pool = new Pool({
    connectionString: url,
    max: migration ? 1 : 5,
    connectionTimeoutMillis: 5000,
    application_name: migration ? 'mention-migrate' : 'mention-api',
    options: migration
      ? '-c TimeZone=UTC'
      : '-c TimeZone=UTC -c jit=off -c statement_timeout=15000ms -c lock_timeout=3000ms -c idle_in_transaction_session_timeout=60000ms',
  });
  return { pool, db: drizzle(pool) };
}
