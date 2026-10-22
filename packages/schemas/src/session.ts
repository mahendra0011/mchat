import { z } from 'zod';

export const DeviceSessionSchema = z.object({
  id: z.string().uuid(),
  accountId: z.string().uuid(),
  activeWorkspaceId: z.string().uuid(),
  deviceLabel: z.string().min(1).max(100),
  platform: z.enum(['web', 'ios', 'android', 'desktop']),
  ipAddressMasked: z.string().default('***.***.***.***'),
  isCurrentSession: z.boolean().default(false),
  isPasskeyAuthenticated: z.boolean().default(false),
  hasRecentStepUp: z.boolean().default(false),
  stepUpExpiresAt: z.string().datetime().nullable().optional(),
  /** When the most recent step-up verification completed (drives the 5-minute re-auth window). */
  lastStepUpAt: z.string().datetime().nullable().optional(),
  createdAt: z.string().datetime(),
  lastActiveAt: z.string().datetime(),
  status: z.enum(['active', 'revoked', 'expired']).default('active'),
});

export type DeviceSession = z.infer<typeof DeviceSessionSchema>;

/**
 * Registered security key / passkey (Spec 30 — lightweight registration flow).
 * NOTE: full WebAuthn attestation & assertion verification is a follow-up;
 * this records the client-asserted credential material only.
 */
export const SecurityKeySchema = z.object({
  id: z.string(),
  accountId: z.string(),
  label: z.string().min(1).max(60),
  credentialId: z.string().min(1).max(200),
  publicKey: z.string().min(1).max(4096),
  createdAt: z.string().datetime(),
  lastUsedAt: z.string().datetime().nullable().optional(),
});

export type SecurityKey = z.infer<typeof SecurityKeySchema>;

export const RegisterSecurityKeyRequestSchema = z.object({
  label: z.string().min(1).max(60),
  publicKey: z.string().min(1).max(4096),
  credentialId: z.string().min(1).max(200),
});

export type RegisterSecurityKeyRequest = z.infer<typeof RegisterSecurityKeyRequestSchema>;

export const WebAuthnChallengeSchema = z.object({
  challenge: z.string().min(16),
  rpId: z.string(),
  rpName: z.string(),
  userId: z.string(),
  timeout: z.number().default(60000),
  userVerification: z.enum(['required', 'preferred', 'discouraged']).default('preferred'),
});

export type WebAuthnChallenge = z.infer<typeof WebAuthnChallengeSchema>;

export const StepUpAuthRequestSchema = z.object({
  sessionId: z.string().uuid(),
  actionReason: z.string().min(1).max(100),
  verificationMethod: z.enum(['password', 'passkey', 'recovery_code']),
  credentialProof: z.string().min(1),
});

export type StepUpAuthRequest = z.infer<typeof StepUpAuthRequestSchema>;

export const SessionRevocationRequestSchema = z.object({
  targetSessionId: z.string().uuid().optional(),
  revokeAllOtherSessions: z.boolean().default(false),
});

export type SessionRevocationRequest = z.infer<typeof SessionRevocationRequestSchema>;
