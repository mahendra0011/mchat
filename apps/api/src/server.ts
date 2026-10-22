import { buildApp } from './app.js';
import { loadEnv } from './env.js';
import { createPgClient, runMigrations } from './db/index.js';
import { store } from './store.js';
import { loadDrafts } from './routes/drafts.js';
import { processScheduledMessages } from './routes/messaging-ops.js';
import { initLogger, logger } from './logger.js';

const env = await loadEnv();
initLogger(env);
const { PORT, HOST } = env;

/** Wave B — scheduled messages are delivered on a 30s background tick. */
const SCHEDULED_MESSAGE_TICK_MS = 30_000;

async function main(): Promise<void> {
  // Durable mode (Spec 10): PostgreSQL authoritative store + forward-only migrations.
  // Without DATABASE_URL the API runs the in-memory demo store (fixtures) only.
  if (env.DATABASE_URL) {
    const db = createPgClient(env.DATABASE_URL, env.LOG_LEVEL);
    try {
      await runMigrations(db, (msg) => logger.info(msg));
      store.db = db;
      await store.hydrate();
      await loadDrafts();
      logger.info('[Orbit Chat API] Durable mode: PostgreSQL store active (hydrated)');
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      logger.error(`[Orbit Chat API] FATAL: database migration failed: ${message}`);
      process.exit(1);
    }
  } else {
    if (env.NODE_ENV === 'production') {
      logger.error('[Orbit Chat API] FATAL: DATABASE_URL is required in production. Refusing to start on the in-memory demo store.');
      process.exit(1);
    }
    logger.warn('[Orbit Chat API] WARNING: DATABASE_URL not set — running on the in-memory demo store. Data is lost on restart and this mode is NOT production-safe.');
  }

  const app = buildApp();

  // Wave B — scheduled message delivery tick (Spec 02 scheduled messages).
  setInterval(() => {
    processScheduledMessages().catch((error) => {
      logger.error('[Orbit Chat API] scheduled message tick failed:', { error });
    });
  }, SCHEDULED_MESSAGE_TICK_MS);

  app.listen({ port: PORT, host: HOST }, (err, address) => {
    if (err) {
      logger.error('Fatal error starting Orbit Chat API server:', { error: err });
      process.exit(1);
    }
    logger.info(`[Orbit Chat API] Running at ${address}`);
    logger.info(`[Orbit Chat Realtime] WebSocket endpoint available at ${address}/v1/realtime`);
  });
}

main().catch((error) => {
  logger.error('Fatal startup error:', { error });
  process.exit(1);
});