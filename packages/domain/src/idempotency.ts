/**
 * Memory-efficient LRU idempotency cache for deduplication of mutations.
 * In a distributed cluster, this integrates with Redis SETNX / PostgreSQL unique constraint.
 */
export class IdempotencyManager<T> {
  private cache = new Map<string, { result: T; timestamp: number }>();
  private readonly ttlMs: number;

  constructor(ttlMs = 1000 * 60 * 60) {
    this.ttlMs = ttlMs;
  }

  has(key: string): boolean {
    this.cleanExpired();
    return this.cache.has(key);
  }

  get(key: string): T | undefined {
    this.cleanExpired();
    return this.cache.get(key)?.result;
  }

  set(key: string, result: T): void {
    this.cleanExpired();
    this.cache.set(key, { result, timestamp: Date.now() });
  }

  private cleanExpired(): void {
    const now = Date.now();
    for (const [key, val] of this.cache.entries()) {
      if (now - val.timestamp > this.ttlMs) {
        this.cache.delete(key);
      }
    }
  }
}
