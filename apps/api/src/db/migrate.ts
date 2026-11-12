import path from 'node:path';
import { migrate } from 'drizzle-orm/node-postgres/migrator';
import { loadEnv } from '../shared/config/load-env.js';
import { createDatabase } from './client.js';

await loadEnv();
const { config } = await import('../shared/config/index.js');
if (!config.DATABASE_URL) throw new Error('DATABASE_URL is required for migration');
const { pool, db } = createDatabase(config.DATABASE_URL, true);
try {
  await migrate(db, { migrationsFolder: path.resolve('drizzle') });
} finally {
  await pool.end();
}
