import { isC3Field } from './data-flow.js';

const FORBIDDEN_AUDIT_KEYS = new Set([
  'password',
  'token',
  'secret',
  'plaintext',
  'privatekey',
  'recoverycode',
  'otp',
  'cookie',
  'authorization',
  'cardnumber',
  'cvv',
]);

export function sanitizeAuditData<T extends Record<string, unknown>>(data: T): Record<string, unknown> {
  const result: Record<string, unknown> = {};

  for (const [key, value] of Object.entries(data)) {
    const lowerKey = key.toLowerCase();
    if (FORBIDDEN_AUDIT_KEYS.has(lowerKey) || isC3Field(key)) {
      result[key] = '[REDACTED_CONFIDENTIAL]';
    } else if (value && typeof value === 'object' && !Array.isArray(value)) {
      result[key] = sanitizeAuditData(value as Record<string, unknown>);
    } else {
      result[key] = value;
    }
  }

  return result;
}

export function generateAuditHash(actorId: string, action: string, timestamp: string): string {
  // Deterministic lightweight signature representation for audit chaining
  let hash = 0;
  const str = `${actorId}:${action}:${timestamp}`;
  for (let i = 0; i < str.length; i++) {
    hash = (hash << 5) - hash + str.charCodeAt(i);
    hash |= 0;
  }
  return `aud_${Math.abs(hash).toString(16).padStart(8, '0')}`;
}
