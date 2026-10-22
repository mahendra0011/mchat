import { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify';
import { PrivacyTelemetryEventSchema, PrivacyTelemetryEvent } from '@orbit/schemas';
import { store } from '../store.js';

export async function telemetryRoutes(app: FastifyInstance): Promise<void> {
  // Collect content-free privacy telemetry events
  app.post('/v1/telemetry/events', async (req: FastifyRequest, reply: FastifyReply) => {
    const parseRes = PrivacyTelemetryEventSchema.safeParse(req.body);
    if (!parseRes.success) {
      return reply.status(400).send({
        error: { code: 'INVALID_EVENT', message: 'Telemetry event failed schema validation' },
      });
    }

    const event: PrivacyTelemetryEvent = parseRes.data;
    store.telemetryEvents.push(event);
    await store.persistTelemetryEvent(event);

    return reply.status(202).send({ success: true, eventId: event.eventId });
  });

  // Query sanitized aggregate metrics (no message content or user IDs)
  app.get('/v1/telemetry/summary', async (_req: FastifyRequest, reply: FastifyReply) => {
    const counts: Record<string, number> = {};
    for (const evt of store.telemetryEvents) {
      counts[evt.eventName] = (counts[evt.eventName] || 0) + 1;
    }
    return reply.send({
      data: {
        totalEventsCollected: store.telemetryEvents.length,
        eventDistribution: counts,
      },
    });
  });
}
