/**
 * Redis client abstraction (Spec 10).
 *
 * The platform depends on a shared, TTL-aware key/value + queue substrate for
 * rate limits, sessions, presence, and job queues. Real deployments point
 * `REDIS_URL` at a Redis server via a driver; tests and single-node dev use the
 * in-memory implementation below, which honours the same interface (including
 * TTL expiry) so behaviour is identical.
 */

export interface RedisClient {
  get(key: string): Promise<string | null>;
  set(key: string, value: string, ttlMs?: number): Promise<void>;
  del(key: string): Promise<void>;
  exists(key: string): Promise<boolean>;
  /** Queue primitives (list semantics) for the durable job queue. */
  rpush(key: string, value: string): Promise<void>;
  lpop(key: string): Promise<string | null>;
  llen(key: string): Promise<number>;
  incr(key: string, ttlMs?: number): Promise<number>;
  ping(): Promise<string>;
  /** Underlying driver kind, for diagnostics/tests. */
  readonly kind: 'memory' | 'redis';
}

interface Entry {
  value: string;
  expiresAt?: number;
}

interface QueueEntry {
  value: string;
}

export class InMemoryRedisClient implements RedisClient {
  readonly kind = 'memory' as const;
  private store = new Map<string, Entry>();
  private lists = new Map<string, QueueEntry[]>();

  private live(key: string): Entry | undefined {
    const entry = this.store.get(key);
    if (!entry) return undefined;
    if (entry.expiresAt !== undefined && Date.now() >= entry.expiresAt) {
      this.store.delete(key);
      return undefined;
    }
    return entry;
  }

  async get(key: string): Promise<string | null> {
    return this.live(key)?.value ?? null;
  }

  async set(key: string, value: string, ttlMs?: number): Promise<void> {
    const entry: Entry = { value };
    if (ttlMs !== undefined && ttlMs > 0) entry.expiresAt = Date.now() + ttlMs;
    this.store.set(key, entry);
  }

  async del(key: string): Promise<void> {
    this.store.delete(key);
    this.lists.delete(key);
  }

  async exists(key: string): Promise<boolean> {
    return this.live(key) !== undefined;
  }

  async rpush(key: string, value: string): Promise<void> {
    const list = this.lists.get(key) ?? [];
    list.push({ value });
    this.lists.set(key, list);
  }

  async lpop(key: string): Promise<string | null> {
    const list = this.lists.get(key);
    if (!list || list.length === 0) return null;
    const [first] = list.splice(0, 1);
    return first?.value ?? null;
  }

  async llen(key: string): Promise<number> {
    return this.lists.get(key)?.length ?? 0;
  }

  async incr(key: string, ttlMs?: number): Promise<number> {
    const current = Number(this.live(key)?.value ?? '0') + 1;
    const existing = this.live(key);
    await this.set(key, String(current), ttlMs ?? (existing?.expiresAt ? existing.expiresAt - Date.now() : undefined));
    return current;
  }

  async ping(): Promise<string> {
    return 'PONG';
  }
}

let client: RedisClient | null = null;

/** Returns the process-wide Redis client (in-memory unless a driver is wired). */
export function getRedis(): RedisClient {
  if (!client) client = new InMemoryRedisClient();
  return client;
}

/** Test hook — swap in a client (e.g., a fresh in-memory instance). */
export function setRedis(next: RedisClient): void {
  client = next;
}
