import { createHmac, timingSafeEqual } from 'node:crypto';
import { FastifyInstance } from 'fastify';
import { jobQueue, type Job } from './job-queue.js';
import { store } from './store.js';

export interface WebhookDeliveryRecord {
  id: string;
  integrationId: string;
  event: string;
  payload: Record<string, unknown>;
  signature: string;
  timestamp: number;
  status: 'pending' | 'delivered' | 'failed' | 'dead_letter';
  deliveryStatus: 'sent' | 'failed' | 'retrying';
  attempts: number;
  lastError?: string;
  deliveredAt?: string;
  idempotencyKey?: string;
  createdAt: string;
}

const MAX_ATTEMPTS = 5;
const REPLAY_WINDOW_MS = 5 * 60 * 1000; // 5 minutes
const BACKOFF_SCHEDULE = [60_000, 300_000, 900_000, 3_600_000, 21_600_000]; // 1m, 5m, 15m, 1h, 6h

function generateSignature(secret: string, timestamp: number, payload: string): string {
  const message = `${timestamp}.${payload}`;
  return createHmac('sha256', secret).update(message).digest('hex');
}

function verifySignature(secret: string, timestamp: number, payload: string, signature: string): boolean {
  const expected = generateSignature(secret, timestamp, payload);
  try {
    return timingSafeEqual(Buffer.from(expected), Buffer.from(signature));
  } catch {
    return false;
  }
}

function isWithinReplayWindow(timestamp: number): boolean {
  return Date.now() - timestamp <= REPLAY_WINDOW_MS;
}

async function findDeliveryByIdempotencyKey(key: string): Promise<WebhookDeliveryRecord | null> {
  if (store.webhookDeliveries) {
    for (const record of store.webhookDeliveries.values()) {
      if (record.idempotencyKey === key) return record;
    }
  }
  if (store.db) {
    const res = await store.sql('SELECT * FROM webhook_deliveries WHERE idempotency_key = $1 LIMIT 1', [key]);
    if (res.rows.length > 0) return hydrateDelivery(res.rows[0]);
  }
  return null;
}

async function persistDelivery(record: WebhookDeliveryRecord): Promise<void> {
  if (store.db) {
    await store.sql(
      `INSERT INTO webhook_deliveries (
         id, integration_id, event, payload, signature, timestamp, status, delivery_status, attempts, last_error, delivered_at, idempotency_key, created_at
       ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13)
       ON CONFLICT (id) DO UPDATE SET
         status = EXCLUDED.status, delivery_status = EXCLUDED.delivery_status, attempts = EXCLUDED.attempts,
         last_error = EXCLUDED.last_error, delivered_at = EXCLUDED.delivered_at, idempotency_key = EXCLUDED.idempotency_key`,
      [
        record.id,
        record.integrationId,
        record.event,
        JSON.stringify(record.payload),
        record.signature,
        record.timestamp,
        record.status,
        record.deliveryStatus,
        record.attempts,
        record.lastError ?? null,
        record.deliveredAt ?? null,
        record.idempotencyKey ?? null,
        record.createdAt,
      ]
    );
  }
  store.webhookDeliveries ??= new Map<string, WebhookDeliveryRecord>();
  store.webhookDeliveries.set(record.id, record);
}

async function getDelivery(id: string): Promise<WebhookDeliveryRecord | null> {
  if (store.db) {
    const res = await store.sql('SELECT * FROM webhook_deliveries WHERE id = $1', [id]);
    if (res.rows.length > 0) return hydrateDelivery(res.rows[0]);
  }
  return store.webhookDeliveries?.get(id) ?? null;
}

function hydrateDelivery(row: Record<string, unknown>): WebhookDeliveryRecord {
  return {
    id: String(row.id),
    integrationId: String(row.integration_id),
    event: String(row.event),
    payload: JSON.parse(String(row.payload)),
    signature: String(row.signature),
    timestamp: Number(row.timestamp),
    status: String(row.status) as 'pending' | 'delivered' | 'failed' | 'dead_letter',
    deliveryStatus: (row.delivery_status ? String(row.delivery_status) : 'retrying') as 'sent' | 'failed' | 'retrying',
    attempts: Number(row.attempts),
    lastError: row.last_error ? String(row.last_error) : undefined,
    deliveredAt: row.delivered_at ? String(row.delivered_at) : undefined,
    idempotencyKey: row.idempotency_key ? String(row.idempotency_key) : undefined,
    createdAt: String(row.created_at),
  };
}

export function retryWithJitter(attempt: number, baseDelay: number): number {
  const jitter = Math.random() * baseDelay;
  return baseDelay * Math.pow(2, attempt) + jitter;
}

export async function deliverWebhook(
  integrationId: string,
  event: string,
  payload: Record<string, unknown>,
  idempotencyKey?: string
): Promise<void> {
  const integration = store.integrations.get(integrationId);
  if (!integration || !integration.webhookUrl || !integration.webhookSecret) {
    throw new Error('Integration not configured for webhooks');
  }

  const resolvedKey =
    idempotencyKey ?? (typeof payload.idempotencyKey === 'string' ? payload.idempotencyKey : undefined);

  if (resolvedKey) {
    const existing = await findDeliveryByIdempotencyKey(resolvedKey);
    if (existing) {
      return; // skip duplicate
    }
  }

  const timestamp = Date.now();
  const payloadStr = JSON.stringify(payload);
  const signature = generateSignature(integration.webhookSecret, timestamp, payloadStr);

  const delivery: WebhookDeliveryRecord = {
    id: `whd_${timestamp}-${Math.random().toString(36).slice(2, 8)}`,
    integrationId,
    event,
    payload,
    signature,
    timestamp,
    status: 'pending',
    deliveryStatus: 'retrying',
    attempts: 0,
    idempotencyKey: resolvedKey,
    createdAt: new Date().toISOString(),
  };

  await persistDelivery(delivery);
  await jobQueue.enqueue('webhook.deliver', { deliveryId: delivery.id }, { maxAttempts: MAX_ATTEMPTS });
}

async function attemptDelivery(delivery: WebhookDeliveryRecord): Promise<void> {
  const integration = store.integrations.get(delivery.integrationId);
  if (!integration || !integration.webhookUrl) {
    throw new Error('Integration webhook URL not configured');
  }

  const payloadStr = JSON.stringify(
    delivery.idempotencyKey
      ? { ...delivery.payload, idempotencyKey: delivery.idempotencyKey }
      : delivery.payload
  );
  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
    'X-Webhook-Signature': `t=${delivery.timestamp},v1=${delivery.signature}`,
    'X-Webhook-Event': delivery.event,
    'X-Webhook-Delivery': delivery.id,
    'User-Agent': 'Orbit-Webhooks/1.0',
  };

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 30_000);

  try {
    const res = await fetch(integration.webhookUrl, {
      method: 'POST',
      headers,
      body: payloadStr,
      signal: controller.signal,
    });

    clearTimeout(timeout);

    if (res.ok) {
      delivery.status = 'delivered';
      delivery.deliveryStatus = 'sent';
      delivery.deliveredAt = new Date().toISOString();
      await persistDelivery(delivery);
    } else {
      throw new Error(`HTTP ${res.status}: ${await res.text()}`);
    }
  } catch (err) {
    clearTimeout(timeout);
    throw err;
  }
}

export async function webhookDeliverHandler(job: Job<{ deliveryId: string }>): Promise<void> {
  const { deliveryId } = job.payload;
  const delivery = await getDelivery(deliveryId);

  if (!delivery) {
    throw new Error('Delivery record not found');
  }

  if (delivery.status === 'delivered') {
    return;
  }

  delivery.attempts += 1;

  try {
    await attemptDelivery(delivery);
  } catch (err) {
    delivery.lastError = (err as Error)?.message ?? 'unknown error';

    if (delivery.attempts >= MAX_ATTEMPTS) {
      delivery.status = 'dead_letter';
      delivery.deliveryStatus = 'failed';
      await persistDelivery(delivery);
      return;
    }

    const backoff = BACKOFF_SCHEDULE[delivery.attempts - 1] ?? BACKOFF_SCHEDULE[BACKOFF_SCHEDULE.length - 1];
    delivery.status = 'pending';
    delivery.deliveryStatus = 'retrying';
    await persistDelivery(delivery);

    await jobQueue.enqueue('webhook.deliver', { deliveryId }, {
      maxAttempts: MAX_ATTEMPTS,
      delayMs: backoff,
    });
    return;
  }
}

export async function webhookDeliveryRoutes(fastify: FastifyInstance): Promise<void> {
  fastify.get<{ Params: { id: string } }>(
    '/v1/webhooks/deliveries/:id',
    async (request, reply) => {
      const { id } = request.params;
      const delivery = await getDelivery(id);
      if (!delivery) {
        return reply.status(404).send({
          error: { code: 'NOT_FOUND', message: 'Webhook delivery not found', requestId: request.id },
        });
      }
      return reply.status(200).send({ data: delivery });
    }
  );
}

export function verifyWebhookSignature(
  secret: string,
  timestampHeader: string | undefined,
  signatureHeader: string | undefined,
  payload: string
): { valid: boolean; reason?: string } {
  if (!timestampHeader || !signatureHeader) {
    return { valid: false, reason: 'Missing signature headers' };
  }

  const timestampMatch = timestampHeader.match(/^t=(\d+)$/);
  const signatureMatch = signatureHeader.match(/^v1=([a-f0-9]+)$/);

  if (!timestampMatch || !signatureMatch) {
    return { valid: false, reason: 'Malformed signature headers' };
  }

  const timestamp = parseInt(timestampMatch[1], 10);
  const signature = signatureMatch[1];

  if (!isWithinReplayWindow(timestamp)) {
    return { valid: false, reason: 'Timestamp outside replay window' };
  }

  if (!verifySignature(secret, timestamp, payload, signature)) {
    return { valid: false, reason: 'Invalid signature' };
  }

  return { valid: true };
}

export { generateSignature, verifySignature, isWithinReplayWindow };
