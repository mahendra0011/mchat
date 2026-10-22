/**
 * Secure storage service for the API side.
 * Provides the SecureStorage interface and factory for the server-side runtime.
 * 
 * Spec 30: Never store session IDs, access tokens, refresh tokens, or recovery secrets in localStorage or sessionStorage.
 * This module is used server-side (e.g., for session management, audit logging).
 */

import { createSecureStorage as createClientSecureStorage, SecureStorage, BrowserCryptoStorage, retrieveSecureToken, removeSecureToken, clearSecureStorage } from '@orbit/secure-storage';

// Server-side fallback: if IndexedDB is not available, use memory storage
// In a production server environment, this would be replaced with a proper
 // secrets management solution (e.g., HashiCorp Vault, KMS, etc.)

/**
 * Create a SecureStorage instance configured for the API environment.
 * Reads from env.ts: SECURE_STORAGE=indexeddb → IndexedDBStorage, 
 * SECURE_STORAGE=memory → MemoryStorage (for testing).
 */
export function createSecureStorage(): SecureStorage {
  return createClientSecureStorage();
}

/**
 * BrowserCryptoStorage instance for the API runtime (no-op if crypto not available).
 */
export const browserCryptoStorage = new BrowserCryptoStorage();

/**
 * Store a token securely (server-side or test environment).
 */
export async function storeToken(name: string, value: string): Promise<void> {
  const storage = createSecureStorage();
  await storage.set(name, value);
}

/**
 * Retrieve a token securely.
 */
export async function retrieveToken(name: string): Promise<string | null> {
  const storage = createSecureStorage();
  return retrieveSecureToken(storage, name);
}

/**
 * Remove a stored token.
 */
export async function removeToken(name: string): Promise<void> {
  const storage = createSecureStorage();
  await removeSecureToken(storage, name);
}

/**
 * Clear all stored tokens.
 */
export async function clearTokens(): Promise<void> {
  const storage = createSecureStorage();
  await clearSecureStorage(storage);
}