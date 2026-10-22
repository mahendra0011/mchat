/**
 * Offline local cache (Spec 10 — IndexedDB-backed offline caching of messages/state).
 *
 * Provides a tiny async key/value interface used by the clients to cache messages,
 * drafts, and other state for offline-first reads. Two backends implement it:
 *
 *  - `IndexedDbLocalCache` — durable browser storage (preferred in web/mobile).
 *  - `MemoryLocalCache` — ephemeral fallback used in Node, tests, and any runtime
 *    without IndexedDB.
 *
 * `createLocalCache()` picks IndexedDB when the runtime exposes it, otherwise the
 * in-memory backend. Both share the same interface, so behaviour is identical and
 * the memory backend is fully unit-testable in Node.
 */

export interface LocalCache {
  get<T>(key: string): Promise<T | undefined>;
  set<T>(key: string, value: T): Promise<void>;
  delete(key: string): Promise<void>;
  /** List keys, optionally restricted to a prefix (e.g. `msgs:` for a conversation). */
  keys(prefix?: string): Promise<string[]>;
  clear(): Promise<void>;
}

export class MemoryLocalCache implements LocalCache {
  private store = new Map<string, string>();

  async get<T>(key: string): Promise<T | undefined> {
    const raw = this.store.get(key);
    if (raw === undefined) return undefined;
    try {
      return JSON.parse(raw) as T;
    } catch {
      return undefined;
    }
  }

  async set<T>(key: string, value: T): Promise<void> {
    this.store.set(key, JSON.stringify(value));
  }

  async delete(key: string): Promise<void> {
    this.store.delete(key);
  }

  async keys(prefix?: string): Promise<string[]> {
    const all = [...this.store.keys()];
    return prefix ? all.filter((k) => k.startsWith(prefix)) : all;
  }

  async clear(): Promise<void> {
    this.store.clear();
  }
}

function openDb(dbName: string, storeName: string): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(dbName, 1);
    request.onupgradeneeded = () => {
      const db = request.result;
      if (!db.objectStoreNames.contains(storeName)) db.createObjectStore(storeName);
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error ?? new Error('indexedDB open failed'));
  });
}

function requestToPromise<T>(req: IDBRequest<T>): Promise<T> {
  return new Promise((resolve, reject) => {
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error ?? new Error('indexedDB request failed'));
  });
}

export class IndexedDbLocalCache implements LocalCache {
  private dbName: string;
  private storeName: string;

  constructor(dbName = 'orbit-chat-cache', storeName = 'kv') {
    this.dbName = dbName;
    this.storeName = storeName;
  }

  private async withStore<T>(mode: IDBTransactionMode, fn: (store: IDBObjectStore) => IDBRequest<T>): Promise<T> {
    const db = await openDb(this.dbName, this.storeName);
    try {
      const tx = db.transaction(this.storeName, mode);
      const store = tx.objectStore(this.storeName);
      return await requestToPromise(fn(store));
    } finally {
      db.close();
    }
  }

  async get<T>(key: string): Promise<T | undefined> {
    const raw = await this.withStore<unknown>('readonly', (store) => store.get(key));
    return raw as T | undefined;
  }

  async set<T>(key: string, value: T): Promise<void> {
    await this.withStore('readwrite', (store) => store.put(value, key));
  }

  async delete(key: string): Promise<void> {
    await this.withStore('readwrite', (store) => store.delete(key));
  }

  async keys(prefix?: string): Promise<string[]> {
    const all = (await this.withStore<IDBValidKey[]>('readonly', (store) => store.getAllKeys())).map(String);
    return prefix ? all.filter((k) => k.startsWith(prefix)) : all;
  }

  async clear(): Promise<void> {
    await this.withStore('readwrite', (store) => store.clear());
  }
}

/** True when the runtime exposes IndexedDB (browser / worker). */
export function hasIndexedDb(): boolean {
  return typeof indexedDB !== 'undefined' && indexedDB !== null;
}

/** Create the best local cache available: IndexedDB in browsers, memory elsewhere. */
export function createLocalCache(dbName?: string, storeName?: string): LocalCache {
  if (hasIndexedDb()) return new IndexedDbLocalCache(dbName, storeName);
  return new MemoryLocalCache();
}
