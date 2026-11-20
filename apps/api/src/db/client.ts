import { drizzle } from 'drizzle-orm/node-postgres';
import { Pool } from 'pg';
import { errorDiagnostics } from '../shared/logging/error-diagnostics.js';
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
  pool.on('error', (error: Error) => {
    // pg discards the broken idle connection. The next query can establish a new one.
    console.error(
      JSON.stringify({ event: 'postgres_idle_connection_error', failure: errorDiagnostics(error) }),
    );
  });
  return { pool, db: drizzle(pool) };
}
