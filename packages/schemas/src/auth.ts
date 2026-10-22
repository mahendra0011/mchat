import { z } from 'zod';

export const UserAccountSchema = z.object({
  id: z.string().uuid(),
  email: z.string().email(),
  displayName: z.string().min(1).max(80),
  avatarUrl: z.string().url().optional(),
  /** Media attachment id used as the profile avatar (Spec 10 object storage). */
  avatarAssetId: z.string().max(200).nullable().optional(),
  /** Profile custom status emoji shown next to the display name. */
  statusEmoji: z.string().max(16).nullable().optional(),
  /** Phone number; only settable once the number has been OTP-verified. */
  phone: z.string().max(32).nullable().optional(),
  phoneVerified: z.boolean().default(false).optional(),
  status: z.enum(['active', 'suspended', 'deletion_pending']),
  createdAt: z.string().datetime(),
  deletionRequestedAt: z.string().datetime().nullable().optional(),
});

export type UserAccount = z.infer<typeof UserAccountSchema>;

export const AuthSessionSchema = z.object({
  sessionId: z.string().uuid(),
  accountId: z.string().uuid(),
  activeWorkspaceId: z.string().uuid(),
  deviceLabel: z.string().min(1).max(100),
  platform: z.enum(['web', 'ios', 'android', 'desktop']),
  createdAt: z.string().datetime(),
  lastActiveAt: z.string().datetime(),
  isCurrentSession: z.boolean().default(false),
  /** Absolute expiry; when elapsed the session is rejected with SESSION_EXPIRED. */
  expiresAt: z.string().datetime().optional(),
  hasRecentStepUp: z.boolean().optional(),
  stepUpExpiresAt: z.string().datetime().nullable().optional(),
  lastStepUpAt: z.string().datetime().nullable().optional(),
});

export type AuthSession = z.infer<typeof AuthSessionSchema>;

export const UpdateProfileRequestSchema = z
  .object({
    displayName: z.string().min(1).max(80).optional(),
    avatarAssetId: z.string().min(1).max(200).nullable().optional(),
    statusEmoji: z.string().max(16).nullable().optional(),
    /** Must match a phone number OTP-verified for this account. */
    phone: z.string().min(3).max(32).optional(),
  })
  .refine((v) => Object.values(v).some((x) => x !== undefined), {
    message: 'At least one profile field must be provided',
  });

export type UpdateProfileRequest = z.infer<typeof UpdateProfileRequestSchema>;

export const LoginRequestSchema = z.object({
  email: z.string().email(),
  password: z.string().min(8),
  deviceLabel: z.string().default('Web Browser'),
  platform: z.enum(['web', 'ios', 'android', 'desktop']).default('web'),
});

export type LoginRequest = z.infer<typeof LoginRequestSchema>;
