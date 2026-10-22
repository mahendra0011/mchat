/**
 * Startup environment validation (Spec 00_START_HERE.md — Environment baseline).
 * Validates required settings before the server starts.
 * A client-side variable must be assumed public; server secrets are validated here.
 */

import { secretStore } from './secret-store.js';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

function loadDotEnvFiles(): void {
  const here = path.dirname(fileURLToPath(import.meta.url));
  const candidates = [
    path.resolve(process.cwd(), '.env'),
    path.resolve(process.cwd(), '..', '.env'),
    path.resolve(process.cwd(), '..', '..', '.env'),
    path.resolve(here, '..', '.env'),
    path.resolve(here, '..', '..', '.env'),
    path.resolve(here, '..', '..', '..', '.env'),
  ];
  for (const candidate of candidates) {
    try {
      process.loadEnvFile(candidate);
    } catch {
      // ignore missing/unreadable env files
    }
  }
}

export interface ValidatedEnv {
  PORT: number;
  HOST: string;
  NODE_ENV: 'development' | 'test' | 'staging' | 'production';
  API_BASE_URL: string;
  WS_BASE_URL: string;
  AUTH_JWT_SECRET: string;
  SESSION_COOKIE_SECRET: string;
  SESSION_EXPIRY_SECONDS: number;
  DATABASE_URL: string | undefined;
  REDIS_URL: string | undefined;
  STORAGE_DRIVER: 'local' | 's3';
  STORAGE_LOCAL_DIR: string;
  STORAGE_MAX_FILE_SIZE_BYTES: number;
  LOG_LEVEL: 'debug' | 'info' | 'warn' | 'error';
  REDACT_SENSITIVE_LOGS: boolean;
  ENABLE_LOCAL_DEMO_FIXTURES: boolean;
  /** Spec 07/12 — when false, an unknown x-workspace-id is rejected (403) instead of ignored. */
  ALLOW_WORKSPACE_FALLBACK: boolean;
  STAGING: boolean;
  /** Spec 28 — product name */
  PRODUCT_NAME: string;
  /** Spec 28 — target domain */
  DOMAIN: 'chat' | 'community' | 'enterprise';
  /** Spec 28 — web strategy */
  WEB_STRATEGY: 'pwa' | 'spa' | 'mfa';
  /** Spec 28 — native strategy */
  NATIVE_STRATEGY: 'expo' | 'react-native' | 'flutter';
  /** Spec 28 — cloud search enabled */
  CLOUD_SEARCH_ENABLED: boolean;
  /** Spec 28 — privacy policy last updated */
  PRIVACY_POLICY_LAST_UPDATED: Date;
}

const DUMMY_SECRET_MARKERS = ['dummy', 'example', 'placeholder', 'changeme', 'sample'];

class EnvValidationError extends Error {}

function fail(errors: string[]): never {
  throw new EnvValidationError(
    `Invalid environment configuration:\n${errors.map((e) => `  - ${e}`).join('\n')}\n` +
      'Copy .env.example to .env and fill in safe local values. Never commit real secrets.'
  );
}

function requireString(name: string, value: string | undefined, errors: string[], opts: { min?: number }): string {
  if (!value || value.trim() === '') {
    errors.push(`${name} is required but missing`);
    return '';
  }
  if (opts.min && value.length < opts.min) {
    errors.push(`${name} must be at least ${opts.min} characters (got ${value.length})`);
  }
  return value;
}

function requireSecret(name: string, value: string | undefined, errors: string[], isProduction: boolean): string {
  const resolved = requireString(name, value, errors, { min: 32 });
  if (!resolved) return '';
  if (isProduction) {
    const lowered = resolved.toLowerCase();
    if (DUMMY_SECRET_MARKERS.some((marker) => lowered.includes(marker))) {
      errors.push(`${name} looks like a dummy/placeholder value and is not allowed in production`);
    }
  }
  return resolved;
}

function parseIntInRange(
  name: string,
  raw: string | undefined,
  fallback: number,
  errors: string[],
  min: number,
  max: number
): number {
  if (raw === undefined || raw.trim() === '') return fallback;
  const parsed = Number.parseInt(raw, 10);
  if (Number.isNaN(parsed) || parsed < min || parsed > max) {
    errors.push(`${name} must be an integer between ${min} and ${max} (got "${raw}")`);
    return fallback;
  }
  return parsed;
}

function parseBoolean(name: string, raw: string | undefined, fallback: boolean, errors: string[]): boolean {
  if (raw === undefined || raw.trim() === '') return fallback;
  const lowered = raw.trim().toLowerCase();
  if (['true', '1', 'yes'].includes(lowered)) return true;
  if (['false', '0', 'no'].includes(lowered)) return false;
  errors.push(`${name} must be a boolean (true/false), got "${raw}"`);
  return fallback;
}

function parseEnum<T extends string>(
  name: string,
  raw: string | undefined,
  allowed: readonly T[],
  fallback: T,
  errors: string[]
): T {
  if (raw === undefined || raw.trim() === '') return fallback;
  const value = raw.trim() as T;
  if (!allowed.includes(value)) {
    errors.push(`${name} must be one of ${allowed.join(', ')} (got "${raw}")`);
    return fallback;
  }
  return value;
}

function parseDatabaseUrl(raw: string | undefined, errors: string[]): string | undefined {
  if (raw === undefined || raw.trim() === '') return undefined;
  const value = raw.trim();
  if (!/^postgres(ql)?:\/\//.test(value)) {
    errors.push(`DATABASE_URL must start with postgres:// or postgresql:// (got "${value.slice(0, 12)}...")`);
    return undefined;
  }
  return value;
}

export async function validateEnv(source: NodeJS.ProcessEnv = process.env): Promise<ValidatedEnv> {
  const errors: string[] = [];

  async function getSecretFromStore(name: string): Promise<string | undefined> {
    const storeType = process.env.SECRET_STORE?.toLowerCase();
    if (storeType === 'aws') {
      return secretStore.get(name);
    }
    return source[name];
  }

  const nodeEnv = parseEnum(
    'NODE_ENV',
    source.NODE_ENV,
    ['development', 'test', 'staging', 'production'] as const,
    'development',
    errors
  );
  const isProduction = nodeEnv === 'production';

  const authJwtSecret = requireSecret('AUTH_JWT_SECRET', await getSecretFromStore('AUTH_JWT_SECRET'), errors, isProduction);
  const sessionCookieSecret = requireSecret('SESSION_COOKIE_SECRET', await getSecretFromStore('SESSION_COOKIE_SECRET'), errors, isProduction);
  const databaseUrl = parseDatabaseUrl(await getSecretFromStore('DATABASE_URL'), errors);
  const redisUrl = (await getSecretFromStore('REDIS_URL'))?.trim() !== '' ? await getSecretFromStore('REDIS_URL') : undefined;

  const env: ValidatedEnv = {
    PORT: parseIntInRange('PORT', source.PORT, 4000, errors, 1, 65535),
    HOST: source.HOST && source.HOST.trim() !== '' ? source.HOST : '0.0.0.0',
    NODE_ENV: nodeEnv,
    API_BASE_URL: requireString('API_BASE_URL', source.API_BASE_URL, errors, { min: 1 }) || 'http://localhost:4000',
    WS_BASE_URL: requireString('WS_BASE_URL', source.WS_BASE_URL, errors, { min: 1 }) || 'ws://localhost:4000/v1/realtime',
    AUTH_JWT_SECRET: authJwtSecret,
    SESSION_COOKIE_SECRET: sessionCookieSecret,
    SESSION_EXPIRY_SECONDS: parseIntInRange(
      'SESSION_EXPIRY_SECONDS',
      source.SESSION_EXPIRY_SECONDS,
      604800,
      errors,
      60,
      60 * 60 * 24 * 90
    ),
    DATABASE_URL: databaseUrl,
    REDIS_URL: redisUrl,
    STORAGE_DRIVER: parseEnum('STORAGE_DRIVER', source.STORAGE_DRIVER, ['local', 's3'] as const, 'local', errors),
    STORAGE_LOCAL_DIR: source.STORAGE_LOCAL_DIR && source.STORAGE_LOCAL_DIR.trim() !== '' ? source.STORAGE_LOCAL_DIR : './storage',
    STORAGE_MAX_FILE_SIZE_BYTES: parseIntInRange(
      'STORAGE_MAX_FILE_SIZE_BYTES',
      source.STORAGE_MAX_FILE_SIZE_BYTES,
      52428800,
      errors,
      1024,
      1024 * 1024 * 1024 * 5
    ),
    LOG_LEVEL: parseEnum('LOG_LEVEL', source.LOG_LEVEL, ['debug', 'info', 'warn', 'error'] as const, 'info', errors),
    REDACT_SENSITIVE_LOGS: parseBoolean('REDACT_SENSITIVE_LOGS', source.REDACT_SENSITIVE_LOGS, true, errors),
    ENABLE_LOCAL_DEMO_FIXTURES: parseBoolean(
      'ENABLE_LOCAL_DEMO_FIXTURES',
      source.ENABLE_LOCAL_DEMO_FIXTURES,
      nodeEnv !== 'production',
      errors
    ),
    ALLOW_WORKSPACE_FALLBACK: parseBoolean(
      'ALLOW_WORKSPACE_FALLBACK',
      source.ALLOW_WORKSPACE_FALLBACK,
      nodeEnv !== 'production',
      errors
    ),
    STAGING: parseBoolean('STAGING', source.STAGING, nodeEnv !== 'production', errors),
    PRODUCT_NAME: requireString('PRODUCT_NAME', source.PRODUCT_NAME, errors, { min: 1 }),
    DOMAIN: parseEnum('DOMAIN', source.DOMAIN, ['chat', 'community', 'enterprise'] as const, 'chat', errors),
    WEB_STRATEGY: parseEnum('WEB_STRATEGY', source.WEB_STRATEGY, ['pwa', 'spa', 'mfa'] as const, 'pwa', errors),
    NATIVE_STRATEGY: parseEnum('NATIVE_STRATEGY', source.NATIVE_STRATEGY, ['expo', 'react-native', 'flutter'] as const, 'expo', errors),
    CLOUD_SEARCH_ENABLED: parseBoolean('CLOUD_SEARCH_ENABLED', source.CLOUD_SEARCH_ENABLED, false, errors),
    PRIVACY_POLICY_LAST_UPDATED: source.PRIVACY_POLICY_LAST_UPDATED
      ? new Date(source.PRIVACY_POLICY_LAST_UPDATED)
      : new Date(),
  };

  if (isProduction && env.ENABLE_LOCAL_DEMO_FIXTURES) {
    errors.push('ENABLE_LOCAL_DEMO_FIXTURES must be false in production (demo fixtures must never run in prod)');
  }

  // Spec 27: Staging/Production parity check
  if (env.STAGING && env.NODE_ENV === 'production') {
    errors.push('STAGING must not be true when NODE_ENV is production');
  }

  if (errors.length > 0) {
    fail(errors);
  }

  return env;
}

export async function loadEnv(): Promise<ValidatedEnv> {
  loadDotEnvFiles();
  try {
    return await validateEnv();
  } catch (error) {
    if (error instanceof EnvValidationError) {
      console.error(`[Orbit Chat API] FATAL: ${error.message}`);
      process.exit(1);
    }
    throw error;
  }
}
