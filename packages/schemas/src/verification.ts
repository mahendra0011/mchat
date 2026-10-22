import { z } from 'zod';

export const BusinessVerificationStatusSchema = z.enum([
  'draft',
  'submitted',
  'under_review',
  'approved',
  'rejected',
  'appealed',
]);
export type BusinessVerificationStatus = z.infer<typeof BusinessVerificationStatusSchema>;

/**
 * Spec 14 — business verification application. A workspace is only "verified"
 * (badge shown) after a trust & safety reviewer approves it. Payment or plan
 * upgrades never set `isVerified` on their own.
 */
export const BusinessVerificationSchema = z.object({
  id: z.string().uuid(),
  workspaceId: z.string().uuid(),
  legalName: z.string().min(1).max(200),
  registrationNumber: z.string().min(1).max(100),
  website: z.string().url().optional(),
  contactEmail: z.string().email(),
  /** References to uploaded evidence (documents); never stored inline. */
  evidenceDocumentIds: z.array(z.string()).default([]),
  status: BusinessVerificationStatusSchema.default('draft'),
  submittedAt: z.string().datetime().optional(),
  reviewerId: z.string().optional(),
  decidedAt: z.string().datetime().optional(),
  decisionNote: z.string().max(2000).optional(),
  appealReason: z.string().max(2000).optional(),
  createdAt: z.string().datetime(),
  updatedAt: z.string().datetime(),
});
export type BusinessVerification = z.infer<typeof BusinessVerificationSchema>;

export const SubmitBusinessVerificationRequestSchema = z.object({
  legalName: z.string().min(1).max(200),
  registrationNumber: z.string().min(1).max(100),
  website: z.string().url().optional(),
  contactEmail: z.string().email(),
  evidenceDocumentIds: z.array(z.string()).default([]),
});
export type SubmitBusinessVerificationRequest = z.infer<typeof SubmitBusinessVerificationRequestSchema>;

export const ResolveBusinessVerificationRequestSchema = z.object({
  decision: z.enum(['approve', 'reject']),
  note: z.string().max(2000).optional(),
});

export const AppealBusinessVerificationRequestSchema = z.object({
  reason: z.string().min(1).max(2000),
});

export const ResolveBusinessVerificationAppealRequestSchema = z.object({
  decision: z.enum(['uphold_rejection', 'overturn_and_approve']),
  note: z.string().max(2000).optional(),
});

/**
 * OTP verification (Spec 30 — second factor / phone & email verification).
 * Codes are short-lived, single-use and attempt-limited server-side.
 */
export const OtpChannelSchema = z.enum(['sms', 'email']);
export type OtpChannel = z.infer<typeof OtpChannelSchema>;

export const SendOtpCodeRequestSchema = z.object({
  channel: OtpChannelSchema,
  destination: z.string().min(3).max(64),
});
export type SendOtpCodeRequest = z.infer<typeof SendOtpCodeRequestSchema>;

export const VerifyOtpCodeRequestSchema = z.object({
  channel: OtpChannelSchema,
  destination: z.string().min(3).max(64),
  code: z.string().regex(/^\d{6}$/, 'code must be a 6-digit numeric string'),
});
export type VerifyOtpCodeRequest = z.infer<typeof VerifyOtpCodeRequestSchema>;
