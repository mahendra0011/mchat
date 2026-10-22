import { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify';
import { store } from './store.js';
import { logger } from './logger.js';
import { getRedis } from './redis.js';

export interface RateLimitOptions {
  limit: number;
  windowMs: number;
  keyPrefix: string;
}

interface RateLimitStat {
  requests: number;
  blocked: number;
  windowMs: number;
  windowStart: number;
}

const stats = new Map<string, RateLimitStat>();

let inMemoryWarningLogged = false;

function logInMemoryWarning(): void {
  if (inMemoryWarningLogged) return;
  inMemoryWarningLogged = true;
  logger.warn('Rate limiter using in-memory store (REDIS_URL not set)');
  console.warn('Rate limiter using in-memory store (REDIS_URL not set)');
}

function clientKey(request: FastifyRequest): string {
  const authHeader = request.headers['authorization'];
  if (authHeader && authHeader.startsWith('Bearer ')) {
    return `u:${authHeader.slice(7)}`;
  }
  const ip = request.ip || request.socket?.remoteAddress || 'unknown';
  return `ip:${ip}`;
}

export function checkRateLimit(
  ip: string,
  limit: number,
  windowMs: number
): { allowed: boolean; retryAfter: number } {
  const now = Date.now();
  let stat = stats.get(ip);
  if (!stat || now - stat.windowStart >= windowMs) {
    stat = { requests: 0, blocked: 0, windowMs, windowStart: now };
    stats.set(ip, stat);
  }
  stat.requests += 1;
  if (stat.requests <= limit) {
    return { allowed: true, retryAfter: 0 };
  }
  stat.blocked += 1;
  const retryAfter = stat.windowStart + windowMs - now;
  return { allowed: false, retryAfter: Math.max(0, retryAfter) };
}

export function createRateLimiter(options: RateLimitOptions) {
  const useRedis = !!process.env.REDIS_URL && process.env.REDIS_URL.trim() !== '';
  if (!useRedis) logInMemoryWarning();

  return async (request: FastifyRequest, reply: FastifyReply): Promise<unknown> => {
    const ip = request.ip || request.socket?.remoteAddress || 'unknown';
    checkRateLimit(ip, options.limit, options.windowMs);

    if (useRedis) {
      const client = getRedis();
      const key = `rl:${options.keyPrefix}:${ip}`;
      const count = await client.incr(key, options.windowMs);
      const allowed = count <= options.limit;
      const remaining = Math.max(0, options.limit - count);
      reply.header('X-RateLimit-Limit', String(options.limit));
      reply.header('X-RateLimit-Remaining', String(remaining));
      reply.header('X-RateLimit-Reset', String(Math.ceil(options.windowMs / 1000)));
      if (!allowed) {
        const resetMs = options.windowMs;
        reply.header('Retry-After', String(Math.ceil(resetMs / 1000)));
        reply.status(429).send({
          error: {
            code: 'RATE_LIMITED',
            message: 'Too many requests. Please slow down and retry later.',
            retryable: true,
            retryAfterMs: resetMs,
            requestId: request.id,
          },
        });
        return reply;
      }
      return undefined;
    }

    const key = `${options.keyPrefix}:${clientKey(request)}`;
    const result = store.rateLimiter.check(key, options.limit, options.windowMs);
    reply.header('X-RateLimit-Limit', String(result.limit));
    reply.header('X-RateLimit-Remaining', String(result.remaining));
    reply.header('X-RateLimit-Reset', String(Math.ceil(result.resetMs / 1000)));
    if (!result.allowed) {
      reply.header('Retry-After', String(Math.ceil(result.resetMs / 1000)));
      reply.status(429).send({
        error: {
          code: 'RATE_LIMITED',
          message: 'Too many requests. Please slow down and retry later.',
          retryable: true,
          retryAfterMs: result.resetMs,
          requestId: request.id,
        },
      });
      return reply;
    }
    return undefined;
  };
}

export function rateLimit(options: RateLimitOptions) {
  return createRateLimiter(options);
}

export async function rateLimitRoutes(fastify: FastifyInstance): Promise<void> {
  fastify.get('/v1/rate-limits/stats', async (request: FastifyRequest, reply: FastifyReply) => {
    const ip = request.ip || request.socket?.remoteAddress || 'unknown';
    const stat = stats.get(ip) ?? { requests: 0, blocked: 0, windowMs: 0, windowStart: Date.now() };
    const all = Object.fromEntries(stats.entries());
    return reply.send({
      ip,
      requests: stat.requests,
      blocked: stat.blocked,
      window: stat.windowMs,
      windowStart: new Date(stat.windowStart).toISOString(),
      stats: all,
    });
  });
}
