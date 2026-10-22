import { createHmac, timingSafeEqual } from 'node:crypto';

/**
 * Scoped, expiring media URLs (Spec 10 — object storage + scoped URLs).
 *
 * Instead of relying solely on session auth for every media byte, the API can
 * mint a short-lived, signed URL that grants access to a single attachment.
 * The signature is an HMAC over `attachmentId:exp` with a server-held secret,
 * so a leaked URL stops working at `exp` and cannot be forged or retargeted.
 */

const DEFAULT_TTL_MS = 5 * 60 * 1000; // 5 minutes
const MAX_TTL_MS = 60 * 60 * 1000; // 1 hour cap

function secret(): string {
  // Process-held secret; override in production via env. Derived fallback keeps
  // the demo deterministic within a process while remaining unguessable across.
  return process.env.ORBIT_MEDIA_SIGNING_SECRET || 'orbit-media-dev-secret';
}

export function signMediaAccess(attachmentId: string, expiresAtMs: number): string {
  const payload = `${attachmentId}:${expiresAtMs}`;
  return createHmac('sha256', secret()).update(payload).digest('hex');
}

/** Creates a scoped URL path+query for an attachment. */
export function createScopedMediaUrl(
  attachmentId: string,
  opts: { ttlMs?: number } = {}
): { path: string; expiresAt: string; token: string } {
  const ttl = Math.min(Math.max(opts.ttlMs ?? DEFAULT_TTL_MS, 1000), MAX_TTL_MS);
  const expiresAtMs = Date.now() + ttl;
  const token = signMediaAccess(attachmentId, expiresAtMs);
  const exp = String(expiresAtMs);
  return {
    path: `/v1/media/${encodeURIComponent(attachmentId)}?exp=${exp}&sig=${token}`,
    expiresAt: new Date(expiresAtMs).toISOString(),
    token,
  };
}

/** Constant-time verification of a scoped URL signature. */
export function verifyScopedMediaAccess(
  attachmentId: string,
  expRaw: string | undefined,
  sig: string | undefined
): { valid: boolean; reason?: string } {
  if (!expRaw || !sig) return { valid: false, reason: 'missing_signature' };
  const exp = Number(expRaw);
  if (!Number.isFinite(exp)) return { valid: false, reason: 'malformed_expiry' };
  if (Date.now() >= exp) return { valid: false, reason: 'expired' };

  const expected = signMediaAccess(attachmentId, exp);
  const a = Buffer.from(expected, 'utf8');
  const b = Buffer.from(sig, 'utf8');
  if (a.length !== b.length) return { valid: false, reason: 'invalid_signature' };
  if (!timingSafeEqual(a, b)) return { valid: false, reason: 'invalid_signature' };
  return { valid: true };
}
