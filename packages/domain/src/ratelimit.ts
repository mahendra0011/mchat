/**
 * Sliding Window Rate Limiter and Abuse Defense (Specs 30 & 34)
 * Protects against credential stuffing, brute force, discovery enumeration, and DoS.
 */

export interface RateLimitResult {
  allowed: boolean;
  limit: number;
  remaining: number;
  resetMs: number;
}

export class SlidingWindowRateLimiter {
  private hits: Map<string, number[]> = new Map();

  check(key: string, limit: number, windowMs: number): RateLimitResult {
    const now = Date.now();
    const windowStart = now - windowMs;

    const timestamps = this.hits.get(key) || [];
    const validTimestamps = timestamps.filter((t) => t > windowStart);

    if (validTimestamps.length >= limit) {
      const oldestInWindow = validTimestamps[0];
      const resetMs = Math.max(0, oldestInWindow + windowMs - now);

      return {
        allowed: false,
        limit,
        remaining: 0,
        resetMs,
      };
    }

    validTimestamps.push(now);
    this.hits.set(key, validTimestamps);

    return {
      allowed: true,
      limit,
      remaining: limit - validTimestamps.length,
      resetMs: windowMs,
    };
  }

  reset(key: string): void {
    this.hits.delete(key);
  }

  clear(): void {
    this.hits.clear();
  }
}
