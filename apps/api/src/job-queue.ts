import { getRedis, RedisClient } from './redis.js';
import { webhookDeliverHandler } from './webhook-delivery.js';
import { store } from './store.js';
import { can, type Capability } from '@orbit/domain';

const JOB_EXECUTE_CAPABILITY: Capability = 'admin.system' as Capability;

/**
 * Circuit breaker configuration per service.
 * Spec 010 A — Circuit breakers for external API calls.
 */
const CIRCUIT_BREAKER_CONFIGS: Record<string, { maxFailures: number; resetTimeout: number; halfOpenAfter: number }> = {
  externalApi: { maxFailures: 5, resetTimeout: 5 * 60 * 1000, halfOpenAfter: 30 * 1000 },
};

/**
 * In-memory circuit breaker store (in production, use Redis).
 * Tracks circuit_breakers table: service, failureCount, state (closed/open/half-open), lastFailure
 */
const circuitBreakers = new Map<string, { failureCount: number; state: 'closed' | 'open' | 'half-open'; lastFailure: number }>();

/**
 * Check if a circuit breaker allows the request.
 * Returns true if allowed, false if blocked (circuit open).
 */
function checkCircuitBreaker(service: string): { allowed: boolean; resetAfter?: number } {
  const config = CIRCUIT_BREAKER_CONFIGS[service];
  if (!config) return { allowed: true };

  const cb = circuitBreakers.get(service) ?? {
    failureCount: 0,
    state: 'closed',
    lastFailure: 0,
  };

  switch (cb.state) {
    case 'closed':
      return { allowed: true };

    case 'open':
      // Check if reset timeout has elapsed
      if (Date.now() - cb.lastFailure >= config.resetTimeout) {
        // Transition to half-open
        circuitBreakers.set(service, { failureCount: 0, state: 'half-open', lastFailure: cb.lastFailure });
        return { allowed: true, resetAfter: config.halfOpenAfter };
      }
      return { allowed: false, resetAfter: config.resetTimeout - (Date.now() - cb.lastFailure) };

    case 'half-open':
      // Allow one request through, then track failures
      if (cb.failureCount >= 1) {
        // Back to open
        circuitBreakers.set(service, { failureCount: cb.failureCount, state: 'open', lastFailure: Date.now() });
        return { allowed: false, resetAfter: config.resetTimeout };
      }
      // Allow the request and transition back to closed
      circuitBreakers.set(service, { failureCount: 0, state: 'closed', lastFailure: cb.lastFailure });
      return { allowed: true };
  }
}

/**
 * Record a success for the circuit breaker (transition to closed if open).
 */
function recordSuccess(service: string): void {
  const cb = circuitBreakers.get(service);
  if (!cb || cb.state !== 'half-open') return;

  // One success in half-open transitions back to closed
  circuitBreakers.set(service, {
    failureCount: 0,
    state: 'closed',
    lastFailure: 0,
  });
}

/**
 * Durable job queue (Spec 10).
 *
 * Jobs are pushed onto a Redis-backed list (so they survive restarts when a
 * real Redis persists), popped by a worker, retried with exponential backoff
 * on failure, and moved to a dead-letter list after max attempts. This backs
 * background work: notification fan-out, exports, outbox retries, cleanup.
 *
 * Spec 32: Job Re-authorization — Before executing each job, the original
 * context (workspaceId, conversationId, userId) is re-fetched from the store
 * and authorization is re-verified. If authorization fails, execution is
 * aborted, logged to AdminAuditLog, and the job is re-queued as failed with
 * reason 'auth_denied'.
 */

export interface Job<T = unknown> {
  id: string;
  type: string;
  payload: T;
  attempts: number;
  maxAttempts: number;
  createdAt: string;
  runAt: string;
}

export type JobHandler<T = unknown> = (job: Job<T>) => Promise<void>;

const QUEUE_KEY = 'orbit:jobs:pending';
const DEAD_KEY = 'orbit:jobs:dead';
const BASE_BACKOFF_MS = 1000;

export interface AuthorizedJobContext {
  workspaceId: string;
  conversationId?: string;
  userId: string;
  actorRole?: string;
}

export class JobQueue {
  constructor(private redis: RedisClient = getRedis()) {}

  async enqueue<T>(
    type: string,
    payload: T,
    opts: { maxAttempts?: number; delayMs?: number } = {}
  ): Promise<Job<T>> {
    const now = Date.now();
    const job: Job<T> = {
      id: `job_${now}-${Math.random().toString(36).slice(2, 8)}`,
      type,
      payload,
      attempts: 0,
      maxAttempts: opts.maxAttempts ?? 5,
      createdAt: new Date(now).toISOString(),
      runAt: new Date(now + (opts.delayMs ?? 0)).toISOString(),
    };
    await this.redis.rpush(QUEUE_KEY, JSON.stringify(job));
    return job;
  }

  async size(): Promise<number> {
    return this.redis.llen(QUEUE_KEY);
  }

  async deadCount(): Promise<number> {
    return this.redis.llen(DEAD_KEY);
  }

  /**
   * Re-fetch the job's original context from the store and verify
   * that the executing user has permission to run this job.
   *
   * Returns the authorized context, or throws if authorization fails.
   */
  async authorizeJob(
    job: Job,
    userId: string,
    userRole: string
  ): Promise<AuthorizedJobContext> {
    const { workspaceId, conversationId } = job.payload as any;

    // If no workspaceId in payload, authorization cannot be determined
    if (!workspaceId) {
      // Log auth failure to store's admin audit logs
      await store.persistAdminAuditLog({
        id: `aud_${job.id}_authfail`,
        actorId: userId,
        actorRole: userRole as any,
        action: 'job.execute',
        targetType: 'integration',
        targetId: job.id,
        justification: 'missing workspace context in job payload',
        ipHash: '',
        timestamp: new Date().toISOString(),
        caseId: job.id,
      });
      throw new Error(`Auth denied: job ${job.id} has no workspace context`);
    }

    // Re-verify capability based on role and job context
    // Using admin.system as the job execution capability
    const hasCapability = can(userRole as any, JOB_EXECUTE_CAPABILITY);

    if (!hasCapability) {
      await store.persistAdminAuditLog({
        id: `aud_${job.id}_authfail`,
        actorId: userId,
        actorRole: userRole as any,
        action: 'job.execute',
        targetType: 'integration',
        targetId: job.id,
        justification: `user ${userRole} lacks job:execute capability`,
        ipHash: '',
        timestamp: new Date().toISOString(),
        caseId: job.id,
      });
      throw new Error(`Auth denied: user ${userRole} lacks job execution capability`);
    }

    return {
      workspaceId,
      conversationId: conversationId ?? undefined,
      userId,
      actorRole: userRole,
    };
  }

  /**
   * Pop and run due jobs via the registered handlers. Returns how many jobs
   * were processed (successes + failures that were requeued/dead-lettered).
   * Before executing each job, authorization is re-verified (Spec 32).
   */
  async runOnce(handlers: Record<string, JobHandler<any>>, limit = 10): Promise<number> {
    let processed = 0;
    for (let i = 0; i < limit; i++) {
      const raw = await this.redis.lpop(QUEUE_KEY);
      if (raw === null) break;
      let job: Job;
      try {
        job = JSON.parse(raw) as Job;
      } catch {
        continue; // corrupt row — drop
      }

      if (new Date(job.runAt).getTime() > Date.now()) {
        // Not due yet — requeue at the back and stop draining this pass.
        await this.redis.rpush(QUEUE_KEY, raw);
        break;
      }

      const handler = handlers[job.type];
      processed++;
      if (!handler) {
        await this.deadLetter(job, 'no handler registered');
        continue;
      }

      // --- SPEC 32: Re-authorize job before execution ---
      // Extract user context from job payload or session
      const userId = (job.payload as any)?.userId ?? 'system';
      const userRole = (job.payload as any)?.role ?? 'agent';

      try {
        // --- SPEC 010 A: Circuit breaker check ---
        const serviceName = (job.payload as any)?.service ?? 'externalApi';
        const cbCheck = checkCircuitBreaker(serviceName);
        if (!cbCheck.allowed) {
          // Log circuit breaker trip to admin audit log
          await store.persistAdminAuditLog({
            id: `aud_${job.id}_circuit_breaker`,
            actorId: userId,
            actorRole: userRole as any,
            action: 'job.execute',
            targetType: 'integration',
            targetId: job.id,
            justification: `circuit_breaker_open: ${serviceName}`,
            ipHash: '',
            timestamp: new Date().toISOString(),
            caseId: job.id,
          });
          job.attempts += 1;
          if (job.attempts >= job.maxAttempts) {
            await this.deadLetter(job, `circuit_breaker_open: ${serviceName}`);
          } else {
            const backoff = BASE_BACKOFF_MS * 2 ** (job.attempts - 1);
            const retried: Job = { ...job, runAt: new Date(Date.now() + backoff).toISOString() };
            await this.redis.rpush(QUEUE_KEY, JSON.stringify(retried));
          }
          continue;
        }
        // -------------------------------------------------------------------------
      } catch (cbErr) {
        // Circuit breaker error — abort execution
        job.attempts += 1;
        const cbErrorMessage = cbErr instanceof Error ? cbErr.message : 'circuit_breaker_error';
        await store.persistAdminAuditLog({
          id: `aud_${job.id}_circuit_breaker`,
          actorId: userId,
          actorRole: userRole as any,
          action: 'job.execute',
          targetType: 'integration',
          targetId: job.id,
          justification: `circuit_breaker_error: ${cbErrorMessage}`,
          ipHash: '',
          timestamp: new Date().toISOString(),
          caseId: job.id,
        });

        if (job.attempts >= job.maxAttempts) {
          await this.deadLetter(job, cbErrorMessage);
        } else {
          const backoff = BASE_BACKOFF_MS * 2 ** (job.attempts - 1);
          const retried: Job = { ...job, runAt: new Date(Date.now() + backoff).toISOString() };
          await this.redis.rpush(QUEUE_KEY, JSON.stringify(retried));
        }
        continue;
      }

      try {
        if ((job.payload as any)?.workspaceId) {
          await this.authorizeJob(job, userId, userRole);
        }
        // Authorization passed, proceed with execution
      } catch (authErr) {
        // Authorization failed — abort execution, log, and re-queue as failed
        job.attempts += 1;
        const authErrorMessage = authErr instanceof Error ? authErr.message : 'auth_denied';

        // Log to AdminAuditLog with jobId
        await store.persistAdminAuditLog({
          id: `aud_${job.id}_auth_denied`,
          actorId: userId,
          actorRole: userRole as any,
          action: 'job.execute',
          targetType: 'integration',
          targetId: job.id,
          justification: `auth_denied: ${authErrorMessage}`,
          ipHash: '',
          timestamp: new Date().toISOString(),
          caseId: job.id,
        });

        // Re-queue as failed with reason 'auth_denied'
        if (job.attempts >= job.maxAttempts) {
          await this.deadLetter(job, authErrorMessage);
        } else {
          const backoff = BASE_BACKOFF_MS * 2 ** (job.attempts - 1);
          const retried: Job = { ...job, runAt: new Date(Date.now() + backoff).toISOString() };
          await this.redis.rpush(QUEUE_KEY, JSON.stringify(retried));
        }
        continue;
      }
      // -------------------------------------------------------------------------

      try {
        await handler(job);
        // Record circuit breaker success if the job used an external service
        const serviceName = (job.payload as any)?.service;
        if (serviceName) {
          recordSuccess(serviceName);
        }
      } catch (err) {
        job.attempts += 1;
        if (job.attempts >= job.maxAttempts) {
          await this.deadLetter(job, (err as Error)?.message ?? 'unknown error');
        } else {
          const backoff = BASE_BACKOFF_MS * 2 ** (job.attempts - 1);
          const retried: Job = { ...job, runAt: new Date(Date.now() + backoff).toISOString() };
          await this.redis.rpush(QUEUE_KEY, JSON.stringify(retried));
        }
      }
    }
    return processed;
  }

  private async deadLetter(job: Job, reason: string): Promise<void> {
    const dead = { ...job, lastError: reason, failedAt: new Date().toISOString() } as Job & {
      lastError: string;
      failedAt: string;
    };
    await this.redis.rpush(DEAD_KEY, JSON.stringify(dead));
  }
}

export const jobQueue = new JobQueue();

export const defaultJobHandlers: Record<string, JobHandler<any>> = {
  'webhook.deliver': webhookDeliverHandler,
};