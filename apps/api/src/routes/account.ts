import { FastifyInstance } from 'fastify';
import { store } from '../store.js';
import { resolveRequestContext, requireStepUp } from '../auth.js';
import { rateLimit } from '../rate-limit.js';
import { jobQueue } from '../job-queue.js';

const DELETION_GRACE_DAYS = 30;
const PURGE_DELAY_MS = DELETION_GRACE_DAYS * 24 * 60 * 60 * 1000;

const exportRateLimiter = rateLimit({ limit: 5, windowMs: 60_000, keyPrefix: 'account-export' });

export async function accountRoutes(fastify: FastifyInstance): Promise<void> {
  // Request account deletion (sensitive: requires recent step-up re-auth)
  fastify.post(
    '/v1/account/deletion-requests',
    { preHandler: [resolveRequestContext, requireStepUp] },
    async (request, reply) => {
    const ctx = request.orbitContext!;
    ctx.account.status = 'deletion_pending';
    ctx.account.deletionRequestedAt = new Date().toISOString();
    await store.persistAccount(ctx.account);

    // Revoke all sessions for this account
    const revokedIds: string[] = [];
    for (const [sId, sess] of store.sessions.entries()) {
      if (sess.accountId === ctx.account.id) {
        store.sessions.delete(sId);
        revokedIds.push(sId);
      }
    }
    await store.revokeSessionsDurable(revokedIds);

    for (const device of store.deviceSessions.values()) {
      if (device.accountId === ctx.account.id) {
        device.status = 'revoked';
        await store.persistDeviceSession(device);
      }
    }

    // Durable job queue (Spec 10): schedule the actual purge after the grace period.
    const purgeJob = await jobQueue.enqueue(
      'account.purge',
      { accountId: ctx.account.id },
      { delayMs: PURGE_DELAY_MS, maxAttempts: 3 }
    );

    return reply.status(200).send({
      success: true,
      status: 'deletion_pending',
      message: 'Account deletion initiated. All active sessions revoked.',
      scheduledPurgeAt: new Date(Date.now() + PURGE_DELAY_MS).toISOString(),
      purgeJobId: purgeJob.id,
    });
  });

  // Account recovery: cancel a pending deletion within the grace period (Spec 10).
  fastify.post('/v1/account/deletion-requests/cancel', { preHandler: resolveRequestContext }, async (request, reply) => {
    const ctx = request.orbitContext!;

    if (ctx.account.status !== 'deletion_pending') {
      return reply.status(409).send({
        error: { code: 'NO_PENDING_DELETION', message: 'There is no pending deletion to cancel.', requestId: request.id },
      });
    }

    const requestedAt = ctx.account.deletionRequestedAt ? new Date(ctx.account.deletionRequestedAt).getTime() : 0;
    const elapsedMs = Date.now() - requestedAt;
    const graceMs = DELETION_GRACE_DAYS * 24 * 60 * 60 * 1000;
    if (elapsedMs > graceMs) {
      return reply.status(410).send({
        error: { code: 'GRACE_PERIOD_EXPIRED', message: 'The recovery grace period has expired.', requestId: request.id },
      });
    }

    ctx.account.status = 'active';
    ctx.account.deletionRequestedAt = null;
    await store.persistAccount(ctx.account);

    return reply.status(200).send({
      success: true,
      status: 'active',
      message: 'Account deletion cancelled. Your account has been recovered.',
    });
  });

  // Export account data (sensitive: requires recent step-up re-auth)
  fastify.post(
    '/v1/exports',
    { preHandler: [resolveRequestContext, requireStepUp, exportRateLimiter] },
    async (request, reply) => {
    const ctx = request.orbitContext!;
    const workspaces = Array.from(store.workspaces.values()).filter(
      (w) => w.ownerAccountId === ctx.account.id
    );

    const exportPackage = {
      exportId: `exp-${Date.now()}`,
      exportedAt: new Date().toISOString(),
      account: ctx.account,
      workspaces,
      notice: 'Business internal notes and other users private communications are excluded by policy.',
    };

    return reply.status(200).send(exportPackage);
  });
}
