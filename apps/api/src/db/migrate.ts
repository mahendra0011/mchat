import type { DbClient } from './client.js';
import { migrations } from './migrations.js';

/**
 * Forward-only migration runner (Spec 10: migrations with a recorded history).
 * Applies pending migrations in order inside a transaction and records them
 * in schema_migrations so boot is idempotent.
 */
export async function runMigrations(db: DbClient, log: (msg: string) => void = console.log): Promise<string[]> {
  await db.query(`
    CREATE TABLE IF NOT EXISTS schema_migrations (
      id          TEXT PRIMARY KEY,
      name        TEXT NOT NULL,
      applied_at  TIMESTAMPTZ NOT NULL DEFAULT now()
    )
  `);

  const appliedResult = await db.query('SELECT id FROM schema_migrations');
  const appliedIds = new Set(appliedResult.rows.map((row) => String(row.id)));

  const newlyApplied: string[] = [];

  for (const migration of migrations) {
    if (appliedIds.has(migration.id)) continue;

    await db.transaction(async (tx) => {
      await tx.exec(migration.sql);
      await tx.query('INSERT INTO schema_migrations (id, name) VALUES ($1, $2)', [
        migration.id,
        migration.name,
      ]);
    });

    newlyApplied.push(`${migration.id}_${migration.name}`);
    log(`[Orbit DB] Applied migration ${migration.id}_${migration.name}`);
  }

  if (newlyApplied.length === 0) {
    log(`[Orbit DB] Schema up to date (${appliedIds.size} migrations applied)`);
  }

  return newlyApplied;
}
