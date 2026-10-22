import fastify, { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import cors from '@fastify/cors';
import websocket from '@fastify/websocket';
import { authRoutes } from './routes/auth.js';
import { workspaceRoutes } from './routes/workspaces.js';
import { conversationRoutes } from './routes/conversations.js';
import { businessRoutes } from './routes/business.js';
import { vaultRoutes } from './routes/vault.js';
import { privacyRoutes } from './routes/privacy.js';
import { accountRoutes } from './routes/account.js';
import { discoveryRoutes } from './routes/discovery.js';
import { billingRoutes } from './routes/billing.js';
import { adminRoutes } from './routes/admin.js';
import { integrationRoutes } from './routes/integrations.js';
import { telemetryRoutes } from './routes/telemetry.js';
import { portabilityRoutes } from './routes/portability.js';
import { cryptoRoutes } from './routes/crypto.js';
import { securityRoutes } from './routes/security.js';
import { analyticsRoutes } from './routes/analytics.js';
import { searchRoutes } from './routes/search.js';
import { presenceRoutes } from './routes/presence.js';
import { draftRoutes } from './routes/drafts.js';
import { notificationRoutes } from './routes/notifications.js';
import { mediaRoutes } from './routes/media.js';
import { messagingOpsRoutes } from './routes/messaging-ops.js';
import { callRoutes } from './routes/calls.js';
import { settingsRoutes } from './routes/settings.js';
import { verificationRoutes } from './routes/verification.js';
import { aiRoutes } from './routes/ai.js';
import { semanticSearchRoutes } from './routes/semantic-search.js';
import { setupRealtimeGateway } from './realtime.js';
import { telemetry } from './telemetry.js';
import { logger } from './logger.js';
import { store } from './store.js';
import { eventRegistry, EventRegistry } from './event-registry.js';
import { betaRoutes } from './routes/beta.js';
import { securityHeadersMiddleware } from './security-headers.js';
import { csrfMiddleware, csrfPreHandler } from './csrf.js';
import { rateLimitRoutes } from './rate-limit.js';
import { webhookDeliveryRoutes } from './webhook-delivery.js';
import { redactC3Fields, isC3Field } from '@orbit/domain';

const API_VERSION = '1';
const SUNSET_DATE = new Date(Date.now() + 365 * 24 * 60 * 60 * 1000).toISOString().split('T')[0];

function percentile(arr: number[], p: number): number {
  if (arr.length === 0) return 0;
  const sorted = [...arr].sort((a, b) => a - b);
  const index = Math.ceil(p * sorted.length) - 1;
  return sorted[Math.max(0, index)];
}


export function suppressC3InLogs(_request: any, reply: any, payload: any, done: (err: any, payload?: any) => void): void {
  let parsed: any = null;
  let wasString = false;
  let wasBuffer = false;
  if (typeof payload === 'string') {
    wasString = true;
    try { parsed = JSON.parse(payload); } catch { parsed = null; }
  } else if (Buffer.isBuffer(payload)) {
    wasBuffer = true;
    try { parsed = JSON.parse(payload.toString('utf8')); } catch { parsed = null; }
  } else if (payload && typeof payload === 'object') {
    parsed = payload;
  }

  if (!parsed || typeof parsed !== 'object') {
    done(null, payload);
    return;
  }

  function hasC3(obj: any, seen = new Set()): boolean {
    if (!obj || typeof obj !== 'object') return false;
    if (seen.has(obj)) return false;
    seen.add(obj);
    if (Array.isArray(obj)) {
      return obj.some((item) => hasC3(item, seen));
    }
    for (const [k, v] of Object.entries(obj)) {
      if (isC3Field(k)) return true;
      if (v && typeof v === 'object' && hasC3(v, seen)) return true;
    }
    return false;
  }

  if (!hasC3(parsed)) {
    done(null, payload);
    return;
  }

  const redacted = redactC3Fields(parsed as Record<string, unknown>);
  // Preserve CSRF token in responses (not C3-classified payload data).
  if ((parsed as any)?.csrfToken && typeof (parsed as any).csrfToken === 'string') {
    (redacted as any).csrfToken = (parsed as any).csrfToken;
  }
  reply.header('X-Data-Classification', 'C3');
  if (wasString) {
    done(null, JSON.stringify(redacted));
  } else if (wasBuffer) {
    done(null, Buffer.from(JSON.stringify(redacted), 'utf8'));
  } else {
    done(null, redacted);
  }
}

export function buildApp(): FastifyInstance {
  const app = fastify({
    logger: false, // Privacy safe: no body logging
  });
  app.feedbackStore = [];

  // Billing webhooks arrive as raw text/plain bodies (Stripe-style integrations).
  app.addContentTypeParser(['text/plain', 'application/octet-stream'], { parseAs: 'string' }, (_request, body, done) => {
    done(null, body);
  });

  // Observability (Spec 10 — OpenTelemetry-style): trace every HTTP request.
  // Privacy-safe: only method/route/status/duration are recorded, never bodies.
  app.addHook('onRequest', (request, _reply, done) => {
    (request as unknown as { _telemetryStart?: number })._telemetryStart = Date.now();
    done();
  });
  app.addHook('onResponse', (request, reply, done) => {
    const start = (request as unknown as { _telemetryStart?: number })._telemetryStart ?? Date.now();
    const durationMs = Date.now() - start;
    const route = request.routeOptions?.url ?? request.url;
    telemetry.counter('http.requests').add(1);
    telemetry.counter(`http.status.${reply.statusCode < 500 ? 'ok' : 'error'}`).add(1);
    telemetry.histogram('http.duration_ms').record(durationMs);
    telemetry.recordSpan({
      name: `${request.method} ${route}`,
      startedAt: start,
      endedAt: start + durationMs,
      status: reply.statusCode < 500 ? 'ok' : 'error',
      attributes: { 'http.method': request.method, 'http.status_code': reply.statusCode },
    });
    done();
  });

  // API Versioning & Deprecation headers (Spec 24)
  app.addHook('onSend', (_request: FastifyRequest, reply: FastifyReply, payload, done) => {
    reply.header('API-Version', API_VERSION);
    reply.header('API-Deprecated', 'false');
    reply.header('Sunset', SUNSET_DATE);
    done(null, payload);
  });

  // Security headers (Spec 33)
  app.addHook('onSend', securityHeadersMiddleware());

  // CORS
  app.register(cors, {
    origin: true,
    credentials: true,
    allowedHeaders: ['Content-Type', 'Authorization', 'x-workspace-id'],
  });

  // WebSocket
  app.register(websocket);

  // CSRF protection (Spec 33/34)
  app.register(csrfMiddleware());
  app.addHook('preHandler', csrfPreHandler);

  // Health check
  app.get('/v1/health', async () => {
    logger.debug('Health check requested');
    return { status: 'healthy', version: '0.2.0', timestamp: new Date().toISOString() };
  });

  // Operational Metrics (Spec 20 Deployment, Observability & Operations)
  app.get('/v1/metrics', async () => {
    const durations = telemetry.getHistogram('http.duration_ms');
    const avgDuration = durations.length
      ? Math.round(durations.reduce((a, b) => a + b, 0) / durations.length)
      : 0;

    // WebSocket metrics
    const wsConnections = store.sessions.size;
    const wsMessagesSent = telemetry.getCounter('ws.messages.sent') || 0;
    const wsMessagesReceived = telemetry.getCounter('ws.messages.received') || 0;
    const wsReconnects = telemetry.getCounter('ws.reconnects') || 0;

    // Queue metrics
    const queuePending = telemetry.getCounter('queue.pending') || 0;
    const queueRetries = telemetry.getCounter('queue.retries') || 0;
    const queueDeadLetter = telemetry.getCounter('queue.dead_letter') || 0;

    // Upload metrics
    const uploadInProgress = telemetry.getCounter('upload.in_progress') || 0;
    const uploadCompleted = telemetry.getCounter('upload.completed') || 0;
    const uploadFailed = telemetry.getCounter('upload.failed') || 0;
    const uploadBytes = telemetry.getCounter('upload.bytes') || 0;

    // DB metrics
    const dbPoolSize = telemetry.getCounter('db.pool.size') || 0;
    const dbActiveQueries = telemetry.getCounter('db.active_queries') || 0;
    const dbLatencyP95 = percentile(telemetry.getHistogram('db.query_duration_ms'), 0.95);

    // Cache metrics
    const cacheHits = telemetry.getCounter('cache.hits') || 0;
const cacheMisses = telemetry.getCounter('cache.misses') || 0;

// Release metrics (Spec 27)
const deployCount = telemetry.getCounter('release_deploy.success') || 0;
const deployFailedCount = telemetry.getCounter('release_deploy.failed') || 0;
const rollbackCount = telemetry.getCounter('release_deploy.rollback') || 0;
const lastDeployStr = telemetry.getCounter('release_deploy.last_timestamp') || null;
const lastDeployTimestamp = lastDeployStr ? new Date(parseInt(String(lastDeployStr).split('.')[0]) * 1000) : null;

// Environment health scores
const envHealthScores: Record<string, number> = {};
const envs = ['development', 'staging', 'production'];
for (const env of envs) {
  const healthEntries = telemetry.getHistogram(`release_health.${env}`);
  if (healthEntries.length > 0) {
    const avgCpu = healthEntries.reduce((a: number, b: number) => a + b, 0) / healthEntries.length;
    envHealthScores[env] = Math.max(0, 100 - Math.round(avgCpu / 2));
  } else {
    envHealthScores[env] = 100;
  }
}

// Delivery state transitions
const deliverySent = telemetry.getCounter('delivery.sent') || 0;
    const deliveryDelivered = telemetry.getCounter('delivery.delivered') || 0;
    const deliveryRead = telemetry.getCounter('delivery.read') || 0;
    const deliveryFailed = telemetry.getCounter('delivery.failed') || 0;

    // Crash-free sessions
    const totalSessions = telemetry.getCounter('sessions.total') || 0;
    const crashedSessions = telemetry.getCounter('sessions.crashed') || 0;
    const crashFreeRate = totalSessions > 0 ? ((totalSessions - crashedSessions) / totalSessions) * 100 : 100;

    logger.debug('Metrics requested', {
      wsConnections,
      queuePending,
      cacheHits,
      cacheMisses,
    });

    return {
      status: 'operational',
      uptimeSeconds: Math.floor(process.uptime()),
      memoryUsageMB: Math.round(process.memoryUsage().rss / (1024 * 1024)),
      observability: {
        totalRequests: telemetry.getCounter('http.requests'),
        errorResponses: telemetry.getCounter('http.status.error'),
        avgRequestDurationMs: avgDuration,
        spansRecorded: telemetry.getSpanCount(),
      },
      websocket: {
        connections: wsConnections,
        messagesSent: wsMessagesSent,
        messagesReceived: wsMessagesReceived,
        reconnects: wsReconnects,
      },
      queue: {
        pending: queuePending,
        retries: queueRetries,
        deadLetter: queueDeadLetter,
      },
      upload: {
        inProgress: uploadInProgress,
        completed: uploadCompleted,
        failed: uploadFailed,
        bytes: uploadBytes,
      },
      database: {
        poolSize: dbPoolSize,
        activeQueries: dbActiveQueries,
        latencyP95Ms: Math.round(dbLatencyP95),
      },
      cache: {
        hits: cacheHits,
        misses: cacheMisses,
        hitRate: cacheHits + cacheMisses > 0 ? Math.round((cacheHits / (cacheHits + cacheMisses)) * 100) : 0,
      },
      delivery: {
        sent: deliverySent,
        delivered: deliveryDelivered,
        read: deliveryRead,
        failed: deliveryFailed,
      },
      reliability: {
        crashFreeSessionsRate: Math.round(crashFreeRate * 100) / 100,
        totalSessions,
        crashedSessions,
      },
      release: {
        deployCount,
        deployFailedCount,
        rollbackCount,
        lastDeployTimestamp,
        envHealthScores: {
          development: envHealthScores.development ?? 100,
          staging: envHealthScores.staging ?? 100,
          production: envHealthScores.production ?? 100,
        },
      },
      timestamp: new Date().toISOString(),
    };
  });

  // Register routes
  app.register(authRoutes);
  app.register(workspaceRoutes);
  app.register(conversationRoutes);
  app.register(businessRoutes);
  app.register(vaultRoutes);
  app.register(privacyRoutes);
  app.register(accountRoutes);
  app.register(betaRoutes);

  // Expansion routes (Specs 21-26)
  app.register(discoveryRoutes);
  app.register(billingRoutes);
  app.register(adminRoutes);
  app.register(integrationRoutes);
  app.register(telemetryRoutes);
  app.register(portabilityRoutes, { db: store.db });
  app.register(cryptoRoutes);
  app.register(securityRoutes);
  app.register(analyticsRoutes);

  // P0 messaging routes (Spec 02)
  app.register(searchRoutes);
  app.register(presenceRoutes);
  app.register(draftRoutes);
  app.register(notificationRoutes);
  app.register(mediaRoutes);
  app.register(messagingOpsRoutes);

  // Real-time calls (Spec 02 / WAVE-F)
  app.register(callRoutes);

  // AI Helper (Spec 17 Phase 5)
  app.register(aiRoutes);

  // Semantic Search (Spec 17 Phase 5)
  app.register(semanticSearchRoutes);

  // Persisted settings + safety controls (Spec 09 / Spec 14)
  app.register(settingsRoutes);
  app.register(verificationRoutes);

  // Rate limit stats + webhook delivery status (Specs 33/34)
  app.register(rateLimitRoutes);
  app.register(webhookDeliveryRoutes);

  // Register WebSocket endpoint after plugin initialization
  app.register(async (instance) => {
    setupRealtimeGateway(instance);
  });

  // Initialize event registry
  app.ready().then(async () => {
    if (store.db) {
      eventRegistry.setDb(store.db);
      await eventRegistry.loadFromDb();
    }
    // Register initial events if not already in registry
    for (const initialEvent of EventRegistry.createInitialEvents()) {
      if (!eventRegistry.get(initialEvent.name)) {
        eventRegistry.register(initialEvent);
      }
    }
    logger.info('Event registry initialized', { eventCount: eventRegistry.list().length });
  });

  // Global Error Handler conforming to 12_API_AND_REALTIME_CONTRACTS.md
  app.setErrorHandler((error, request, reply) => {
    const statusCode = error.statusCode || 500;
    const errorCode = (error as any).code || 'INTERNAL_SERVER_ERROR';

    logger.error('Request error', {
      errorCode,
      message: error.message,
      statusCode,
      requestId: request.id,
      url: request.url,
      method: request.method,
    });

    reply.status(statusCode).send({
      error: {
        code: errorCode,
        message: error.message || 'An unexpected error occurred',
        requestId: request.id,
        retryable: statusCode >= 500,
      },
    });
  });

  return app;
}
