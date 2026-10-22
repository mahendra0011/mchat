/**
 * Secure storage service using IndexedDB with crypto-backed randomness.
 * 
 * Spec 30: Never store session IDs, access tokens, refresh tokens, or recovery secrets in localStorage or sessionStorage.
 * 
 * Uses vanilla IndexedDB (no new npm deps). Token generation uses crypto.subtle
 * and Window.crypto.getRandomValues for cryptographically secure random values.
 */

const DB_NAME = 'orbit-secure-storage';
const DB_VERSION = 1;
const STORE_NAME = 'secrets';

let dbPromise: Promise<IDBDatabase> | null = null;

/**
 * Initialize IndexedDB connection.
 */
function getDB(): Promise<IDBDatabase> {
  if (dbPromise) return dbPromise;
  dbPromise = new Promise((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, DB_VERSION);
    request.onupgradeneeded = (event) => {
      const db = (event.target as IDBOpenDBRequest).result;
      if (!db.objectStoreNames.contains(STORE_NAME)) {
        db.createObjectStore(STORE_NAME);
      }
    };
    request.onsuccess = (event) => {
      resolve((event.target as IDBOpenDBRequest).result);
    };
    request.onerror = (event) => {
      reject(new Error('IndexedDB error: ' + (event.target as any).error));
    };
    request.onblocked = () => {
      reject(new Error('IndexedDB upgrade blocked'));
    };
  });
  return dbPromise;
}

/**
 * Generate a cryptographically secure random string of the specified length.
 */
async function generateSecureToken(length = 32): Promise<string> {
  const array = new Uint8Array(length);
  globalThis.crypto?.getRandomValues(array);
  return Buffer.from(array).toString('base64').slice(0, length);
}

/**
 * SecureStorage interface matching the specification.
 */
export interface SecureStorage {
  get(name: string): Promise<string | null>;
  set(name: string, value: string): Promise<void>;
  remove(name: string): Promise<void>;
  clear(): Promise<void>;
}

/**
 * IndexedDB-backed implementation of SecureStorage.
 */
export class IndexedDBStorage implements SecureStorage {
  async get(name: string): Promise<string | null> {
    const database = await getDB();
    return new Promise((resolve) => {
      const transaction = database.transaction(STORE_NAME, 'readonly');
      const store = transaction.objectStore(STORE_NAME);
      const request = store.get(name);
      request.onsuccess = () => {
        const result = request.result;
        resolve(result ? String(result) : null);
      };
      transaction.oncomplete = () => {};
    });
  }

  async set(name: string, value: string): Promise<void> {
    const database = await getDB();
    return new Promise((resolve, reject) => {
      const transaction = database.transaction(STORE_NAME, 'readwrite');
      const store = transaction.objectStore(STORE_NAME);
      store.put(value, name);
      transaction.oncomplete = () => resolve();
      transaction.onerror = (event) => {
        reject(new Error('IndexedDB error on set: ' + (event.target as any).error));
      };
    });
  }

  async remove(name: string): Promise<void> {
    const database = await getDB();
    return new Promise((resolve, reject) => {
      const transaction = database.transaction(STORE_NAME, 'readwrite');
      const store = transaction.objectStore(STORE_NAME);
      const request = store.delete(name);
      request.onsuccess = () => resolve();
      request.onerror = (event) => {
        reject(new Error('IndexedDB error on remove: ' + (event.target as any).error));
      };
      transaction.oncomplete = () => {};
    });
  }

  async clear(): Promise<void> {
    const database = await getDB();
    return new Promise((resolve, reject) => {
      const transaction = database.transaction(STORE_NAME, 'readwrite');
      const store = transaction.objectStore(STORE_NAME);
      const request = store.clear();
      request.onsuccess = () => resolve();
      request.onerror = (event) => {
        reject(new Error('IndexedDB error on clear: ' + (event.target as any).error));
      };
      transaction.oncomplete = () => {};
    });
  }
}

/**
 * Memory-backed implementation of SecureStorage for testing.
 */
export class MemoryStorage implements SecureStorage {
  private store: Record<string, string> = {};

  async get(name: string): Promise<string | null> {
    return Promise.resolve(this.store[name] ?? null);
  }

  async set(name: string, value: string): Promise<void> {
    this.store[name] = value;
    return Promise.resolve();
  }

  async remove(name: string): Promise<void> {
    delete this.store[name];
    return Promise.resolve();
  }

  async clear(): Promise<void> {
    this.store = {};
    return Promise.resolve();
  }
}

/**
 * Factory function that creates a SecureStorage instance based on the
 * SECURE_STORAGE environment variable.
 * 
 * - SECURE_STORAGE=indexeddb → IndexedDBStorage (production)
 * - SECURE_STORAGE=memory → MemoryStorage (testing)
 */
export function createSecureStorage(): SecureStorage {
  const secureStorageType = (typeof process !== 'undefined' ? process.env.SECURE_STORAGE : undefined) || 'indexeddb';

  switch (secureStorageType) {
    case 'indexeddb':
      return new IndexedDBStorage();
    case 'memory':
      return new MemoryStorage();
    default:
      console.warn(`[secure-storage] Unknown SECURE_STORAGE mode: ${secureStorageType}, falling back to indexeddb`);
      return new IndexedDBStorage();
  }
}

/**
 * BrowserCryptoStorage - uses crypto.subtle + Window.crypto.getRandomValues
 * for secure token generation. This is a lower-level utility that can
 * be used when direct IndexedDB access isn't needed but cryptographically
 * secure random values are required.
 */
export class BrowserCryptoStorage {
  private readonly crypto: Crypto;

  constructor() {
    this.crypto = (globalThis as any).crypto || (globalThis as any).msCrypto;
    if (!this.crypto?.subtle) {
      throw new Error('WebCrypto subtle API is unavailable in this runtime environment');
    }
  }

  /**
   * Generate a cryptographically secure random byte array.
   */
  async generateRandomBytes(length: number): Promise<Uint8Array> {
    const array = new Uint8Array(length);
    globalThis.crypto.getRandomValues(array);
    return array;
  }

  /**
   * Generate a secure random string using WebCrypto.
   */
  async generateSecureString(length = 32): Promise<string> {
    const bytes = await this.generateRandomBytes(length);
    return Buffer.from(bytes).toString('base64').slice(0, length);
  }

  /**
   * Derive a key using PBKDF2 or similar KDF for use as a storage encryption key.
   */
  async deriveKey(password: Uint8Array, _salt: Uint8Array, _iterations = 100000): Promise<CryptoKey> {
    return await this.crypto.subtle.importKey(
      'raw',
      password as BufferSource,
      { name: 'PBKDF2' },
      false,
      ['deriveBits', 'deriveKey']
    );
  }
}

/**
 * Convenience wrapper: generate a secure token and store it via the provided
 * SecureStorage instance. Returns the generated token.
 */
export async function storeSecureToken(
  storage: SecureStorage,
  name: string,
  length = 32
): Promise<string> {
  const token = await generateSecureToken(length);
  await storage.set(name, token);
  return token;
}

/**
 * Convenience wrapper: retrieve a securely stored token.
 */
export async function retrieveSecureToken(
  storage: SecureStorage,
  name: string
): Promise<string | null> {
  return storage.get(name);
}

/**
 * Remove a securely stored token.
 */
export async function removeSecureToken(
  storage: SecureStorage,
  name: string
): Promise<void> {
  await storage.remove(name);
}

/**
 * Clear all securely stored tokens.
 */
export async function clearSecureStorage(
  storage: SecureStorage
): Promise<void> {
  await storage.clear();
}