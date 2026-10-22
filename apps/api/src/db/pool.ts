import pg from 'pg';
import type { DbClient } from './client.js';
import { wrapPg } from './client.js';

/**
 * PostgreSQL connection factory (Spec 10: PostgreSQL for authoritative relational data).
 * DATABASE_URL is required to enable durable mode; without it the API runs on the
 * in-memory demo store (fixtures) and must never be treated as production.
 */
export function createPgClient(databaseUrl: string, logLevel: 'debug' | 'info' | 'warn' | 'error' = 'info'): DbClient {
  const pool = new pg.Pool({
    connectionString: databaseUrl,
    max: 10,
    idleTimeoutMillis: 30_000,
    connectionTimeoutMillis: 5_000,
    // Sensitive data must never reach logs (Spec 08/37).
    log: logLevel === 'debug' ? (msg) => console.log(`[Orbit DB] ${msg}`) : undefined,
  });

  pool.on('error', (error) => {
    console.error('[Orbit DB] Unexpected pool error:', error.message);
  });

  const client = wrapPg(pool);
  return {
    query: client.query,
    exec: client.exec,
    transaction: client.transaction,
    close: async () => {
      await pool.end();
    },
  };
}
