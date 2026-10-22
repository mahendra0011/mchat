/**
 * Database client abstraction (Spec 10: PostgreSQL for authoritative relational data).
 * Allows the same migration + persistence code to run against:
 * - node-postgres (pg) Pool in development/staging/production
 * - PGlite (in-process Postgres) in tests
 */

export interface QueryResultLike {
  rows: Record<string, unknown>[];
  rowCount: number;
}

export interface DbClient {
  query(text: string, params?: unknown[]): Promise<QueryResultLike>;
  /**
   * Executes one or more statements in a single call (migration scripts).
   * node-postgres handles multi-statement strings natively; PGlite requires exec().
   */
  exec(sql: string): Promise<void>;
  /** Runs fn inside a single transaction. Rolls back on any thrown error. */
  transaction<T>(fn: (tx: DbClient) => Promise<T>): Promise<T>;
  close?(): Promise<void>;
}

/** Adapter for node-postgres Pool / PoolClient (transactions use a dedicated connection). */
export function wrapPg(poolOrClient: {
  query(text: string, values?: unknown[]): Promise<unknown>;
  exec?(sql: string): Promise<unknown>;
  connect?: () => Promise<{
    query(text: string, values?: unknown[]): Promise<unknown>;
    release(): void;
  }>;
  release?: () => void;
}): DbClient {
  const query = async (text: string, params: unknown[] = []): Promise<QueryResultLike> => {
    const result = (await poolOrClient.query(text, params.length > 0 ? params : undefined)) as {
      rows: Record<string, unknown>[];
      rowCount: number | null;
    };
    return { rows: result.rows ?? [], rowCount: result.rowCount ?? 0 };
  };

  // PGlite exposes exec() for multi-statement scripts; node-postgres accepts them via query().
  const exec = async (sql: string): Promise<void> => {
    if (typeof poolOrClient.exec === 'function') {
      await poolOrClient.exec(sql);
      return;
    }
    await poolOrClient.query(sql);
  };

  // Pool has connect(); a dedicated client does not.
  const isPool = typeof poolOrClient.connect === 'function';

  return {
    query,
    exec,
    async transaction<T>(fn: (tx: DbClient) => Promise<T>): Promise<T> {
      if (!isPool) {
        // Single-connection client (e.g. PGlite): serialize via explicit BEGIN/COMMIT.
        await query('BEGIN');
        try {
          const tx: DbClient = {
            query,
            exec,
            transaction: async () => {
              throw new Error('Nested transactions are not supported');
            },
          };
          const result = await fn(tx);
          await query('COMMIT');
          return result;
        } catch (error) {
          await query('ROLLBACK');
          throw error;
        }
      }
      const client = await poolOrClient.connect!();
      const txQuery = async (text: string, params: unknown[] = []): Promise<QueryResultLike> => {
        const result = (await client.query(text, params)) as {
          rows: Record<string, unknown>[];
          rowCount: number | null;
        };
        return { rows: result.rows ?? [], rowCount: result.rowCount ?? 0 };
      };
      const tx: DbClient = {
        query: txQuery,
        exec: async (sql: string) => {
          await txQuery(sql);
        },
        transaction: async () => {
          throw new Error('Nested transactions are not supported');
        },
      };
      await txQuery('BEGIN');
      try {
        const result = await fn(tx);
        await txQuery('COMMIT');
        return result;
      } catch (error) {
        await txQuery('ROLLBACK');
        throw error;
      } finally {
        client.release();
      }
    },
  };
}
