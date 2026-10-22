/**
 * Secure storage wrapper for the web client (Spec 30).
 * 
 * Wraps all localStorage.getItem/setItem calls with secureStorage.get/set
 * to prevent tokens from being stored in localStorage/sessionStorage.
 * 
 * Tokens migrated from localStorage:
 * - orbit_token (access token)
 * - orbit_refresh_token (refresh token)
 * - orbit_passkey_credential (passkey credential)
 * - orbit_session_id (session ID)
 *
 * For tokens that MUST remain in localStorage for backward compatibility,
 * deprecation warning logs are added with phase-out-date annotations.
 */

import { createSecureStorage, SecureStorage, retrieveSecureToken, removeSecureToken, clearSecureStorage } from '@orbit/secure-storage';

// Secure storage instance - configured via env.ts SECURE_STORAGE variable
let secureStorage: SecureStorage;

// Initialize secure storage
function initSecureStorage(): void {
  if (secureStorage) return;
  secureStorage = createSecureStorage();
}

// Token keys that have been migrated from localStorage
export const TOKEN_KEYS = {
  orbitToken: 'orbit_token',
  orbitRefreshToken: 'orbit_refresh_token',
  orbitPasskeyCredential: 'orbit_passkey_credential',
  orbitSessionId: 'orbit_session_id',
} as const;

// Deprecated: legacy localStorage keys (phase-out in progress)
const LEGACY_KEYS = {
  orbitToken: 'orbit_token',
  orbitRefreshToken: 'orbit_refresh_token',
  orbitPasskeyCredential: 'orbit_passkey_credential',
  orbitSessionId: 'orbit_session_id',
};

// Phase-out tracking - these keys will be removed after the phase-out date
const PHASE_OUT_DATES = {
  orbitToken: '2026-12-01',
  orbitRefreshToken: '2026-12-01',
  orbitPasskeyCredential: '2026-12-15',
  orbitSessionId: '2026-12-01',
} as const;

/**
 * Initialize the secure storage service.
 * Must be called before using any secureStorage functions.
 */
export function init(): void {
  initSecureStorage();
}

/**
 * Get a securely stored token from IndexedDB or memory storage.
 */
export async function get(name: (typeof TOKEN_KEYS)[keyof typeof TOKEN_KEYS]): Promise<string | null> {
  init();
  return retrieveSecureToken(secureStorage, name);
}

/**
 * Set a token securely in IndexedDB or memory storage.
 */
export async function set(
  name: (typeof TOKEN_KEYS)[keyof typeof TOKEN_KEYS],
  value: string
): Promise<void> {
  init();
  await secureStorage.set(name, value);
}

/**
 * Remove a securely stored token.
 */
export async function remove(name: (typeof TOKEN_KEYS)[keyof typeof TOKEN_KEYS]): Promise<void> {
  init();
  await removeSecureToken(secureStorage, name);
}

/**
 * Clear all securely stored tokens.
 */
export async function clear(): Promise<void> {
  init();
  await clearSecureStorage(secureStorage);
  // Remove non-essential localStorage keys on logout
  // (tokens already migrated above, but clean up any remaining prefs)
  if (typeof localStorage !== 'undefined') {
    localStorage.removeItem('orbit_device_prefs_v1');
  }
}

/**
 * Legacy fallback: get a token from localStorage with deprecation warning.
 * Used for backward compatibility during the migration phase.
 * @deprecated Use secureStorage.get() instead. Will be removed after phase-out date.
 */
export function getLegacy(
  name: string
): Promise<string | null> {
  // tslint:disable-next-line: no-console
  console.warn(
    `[secure-storage] '${name}' is stored in localStorage. ` +
      `Phase-out date: ${(PHASE_OUT_DATES as any)[name] || 'TBD'}. ` +
      'Migrate to secureStorage.get() as soon as possible.'
  );
  const value = typeof localStorage !== 'undefined' ? localStorage.getItem(name) : null;
  return Promise.resolve(value ?? null);
}

/**
 * Legacy fallback: set a token in localStorage with deprecation warning.
 * Used for backward compatibility during the migration phase.
 * @deprecated Use secureStorage.set() instead. Will be removed after phase-out date.
 */
export function setLegacy(
  name: string,
  value: string
): Promise<void> {
  // tslint:disable-next-line: no-console
  console.warn(
    `[secure-storage] '${name}' is being stored in localStorage. ` +
      `Phase-out date: ${(PHASE_OUT_DATES as any)[name] || 'TBD'}. ` +
      'Migrate to secureStorage.set() as soon as possible.'
  );
  if (typeof localStorage !== 'undefined') {
    localStorage.setItem(name, value);
  }
  return Promise.resolve();
}

/**
 * Check if a token key is still using localStorage (legacy).
 */
export function isLegacy(key: string): boolean {
  return key in LEGACY_KEYS;
}

/**
 * Migrate a single token from localStorage to secure storage.
 * Reads from localStorage, writes to secure storage, and removes from localStorage.
 */
export async function migrateToken(
  name: string
): Promise<{ migrated: boolean; fromLocalStorage: boolean }> {
  const isLocal = typeof localStorage !== 'undefined';
  if (!isLocal) return { migrated: false, fromLocalStorage: false };

  const value = localStorage.getItem(name);
  if (!value) return { migrated: false, fromLocalStorage: false };

  // Store securely first, then remove from localStorage
  init();
  await secureStorage.set(name, value);
  localStorage.removeItem(name);

  // tslint:disable-next-line: no-console
  console.info(
    `[secure-storage] Migrated '${name}' from localStorage to secure storage.`
  );

  return { migrated: true, fromLocalStorage: true };
}

/**
 * Migrate all tracked tokens from localStorage to secure storage.
 */
export async function migrateAllTokens(): Promise<void> {
  for (const key of Object.keys(LEGACY_KEYS) as Array<keyof typeof LEGACY_KEYS>) {
    await migrateToken(key);
  }
  // tslint:disable-next-line: no-console
  console.info('[secure-storage] All tracked tokens migrated from localStorage to secure storage.');
}

/**
 * Get an access token, preferring secure storage over localStorage legacy.
 * Tries secure storage first, falls back to localStorage for backward compat.
 */
export async function getAccessToken(): Promise<string | null> {
  const secureValue = await get(TOKEN_KEYS.orbitToken);
  if (secureValue) return secureValue;
  return getLegacy(TOKEN_KEYS.orbitToken);
}

/**
 * Set an access token securely.
 */
export async function setAccessToken(value: string): Promise<void> {
  await set(TOKEN_KEYS.orbitToken, value);
}

/**
 * Get a refresh token, preferring secure storage over localStorage legacy.
 */
export async function getRefreshToken(): Promise<string | null> {
  const secureValue = await get(TOKEN_KEYS.orbitRefreshToken);
  if (secureValue) return secureValue;
  return getLegacy(TOKEN_KEYS.orbitRefreshToken);
}

/**
 * Set a refresh token securely.
 */
export async function setRefreshToken(value: string): Promise<void> {
  await set(TOKEN_KEYS.orbitRefreshToken, value);
}

/**
 * Get a passkey credential, preferring secure storage over localStorage legacy.
 */
export async function getPasskeyCredential(): Promise<string | null> {
  const secureValue = await get(TOKEN_KEYS.orbitPasskeyCredential);
  if (secureValue) return secureValue;
  return getLegacy(TOKEN_KEYS.orbitPasskeyCredential);
}

/**
 * Set a passkey credential securely.
 */
export async function setPasskeyCredential(value: string): Promise<void> {
  await set(TOKEN_KEYS.orbitPasskeyCredential, value);
}

/**
 * Get a session ID, preferring secure storage over localStorage legacy.
 */
export async function getSessionId(): Promise<string | null> {
  const secureValue = await get(TOKEN_KEYS.orbitSessionId);
  if (secureValue) return secureValue;
  return getLegacy(TOKEN_KEYS.orbitSessionId);
}

/**
 * Set a session ID securely.
 */
export async function setSessionId(value: string): Promise<void> {
  await set(TOKEN_KEYS.orbitSessionId, value);
}