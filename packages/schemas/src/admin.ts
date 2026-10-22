import { z } from 'zod';

export const AdminRoleSchema = z.enum([
  'support',
  'trust_safety',
  'security_ops',
  'billing_support',
  'system_admin',
]);
export type AdminRole = z.infer<typeof AdminRoleSchema>;

export const AdminAuditLogSchema = z.object({
  id: z.string(),
  actorId: z.string(),
  actorRole: AdminRoleSchema,
  action: z.string(),
  targetType: z.enum(['user', 'workspace', 'conversation', 'report', 'integration', 'access_grant', 'legal_hold', 'privacy_request']),
  targetId: z.string(),
  justification: z.string(),
  ipHash: z.string(),
  timestamp: z.string(),
  caseId: z.string().optional(),
});
export type AdminAuditLog = z.infer<typeof AdminAuditLogSchema>;

export const UserReportStatusSchema = z.enum([
  'pending',
  'under_review',
  'resolved',
  'dismissed',
]);
export type UserReportStatus = z.infer<typeof UserReportStatusSchema>;

export const UserReportReasonSchema = z.enum([
  'spam',
  'harassment',
  'impersonation',
  'malware',
  'other',
]);
export type UserReportReason = z.infer<typeof UserReportReasonSchema>;

export const UserReportActionSchema = z.enum([
  'none',
  'warning',
  'temporary_hold',
  'suspended',
]);
export type UserReportAction = z.infer<typeof UserReportActionSchema>;

export const UserReportAppealStatusSchema = z.enum([
  'none',
  'filed',
  'upheld',
  'rejected',
]);
export type UserReportAppealStatus = z.infer<typeof UserReportAppealStatusSchema>;

export const ReportQueueTypeSchema = z.enum([
  'user_report',
  'spam_signal',
  'impersonation',
  'urgent_safety',
  'repeat_offender',
]);
export type ReportQueueType = z.infer<typeof ReportQueueTypeSchema>;

export const UserReportSchema = z.object({
  id: z.string(),
  reporterId: z.string(),
  reporterHandle: z.string(),
  targetUserId: z.string(),
  targetHandle: z.string(),
  targetConversationId: z.string().optional(),
  reason: UserReportReasonSchema,
  details: z.string().optional(),
  evidenceMessageIds: z.array(z.string()).optional(),
  status: UserReportStatusSchema,
  assignedReviewerId: z.string().optional(),
  resolutionNote: z.string().optional(),
  actionTaken: UserReportActionSchema.default('none'),
  appealStatus: UserReportAppealStatusSchema.optional(),
  appealReason: z.string().optional(),
  appealedAt: z.string().optional(),
  createdAt: z.string(),
  updatedAt: z.string(),
  queueType: ReportQueueTypeSchema.default('user_report'),
  caseId: z.string().optional(),
});
export type UserReport = z.infer<typeof UserReportSchema>;

export const SpamSignalSchema = z.object({
  id: z.string(),
  workspaceId: z.string(),
  conversationId: z.string().optional(),
  signalType: z.enum(['spam', 'phishing', 'scam', 'malware_link', 'bulk_invite', 'suspicious_pattern']),
  confidence: z.number().min(0).max(1),
  evidence: z.record(z.unknown()),
  createdAt: z.string(),
});
export type SpamSignal = z.infer<typeof SpamSignalSchema>;

export const UrgentSafetyCaseSchema = z.object({
  id: z.string(),
  workspaceId: z.string(),
  reporterId: z.string(),
  severity: z.enum(['critical', 'high', 'medium']),
  description: z.string(),
  assignedReviewer: z.string().optional(),
  status: z.enum(['open', 'in_progress', 'resolved', 'dismissed']),
  createdAt: z.string(),
  resolvedAt: z.string().optional(),
});
export type UrgentSafetyCase = z.infer<typeof UrgentSafetyCaseSchema>;

export const AccessGrantSchema = z.object({
  id: z.string(),
  targetWorkspaceId: z.string(),
  grantedByUserId: z.string(),
  approverUserId: z.string(),
  purpose: z.string(),
  capability: z.enum(['admin.support']),
  durationMinutes: z.number().int().positive(),
  status: z.enum(['active', 'revoked', 'expired']),
  createdAt: z.string(),
  expiresAt: z.string(),
  revokedAt: z.string().optional(),
  revokedBy: z.string().optional(),
  caseId: z.string().optional(),
});
export type AccessGrant = z.infer<typeof AccessGrantSchema>;

export const CreateAccessGrantRequestSchema = z.object({
  targetWorkspaceId: z.string(),
  purpose: z.string().min(10).max(500),
  durationMinutes: z.number().int().min(5).max(480),
  approverUserId: z.string(),
});
export type CreateAccessGrantRequest = z.infer<typeof CreateAccessGrantRequestSchema>;

export const LegalHoldSchema = z.object({
  id: z.string(),
  workspaceId: z.string(),
  conversationIds: z.array(z.string()),
  authorizedBy: z.string(),
  reason: z.string(),
  expiresAt: z.string().datetime(),
  status: z.enum(['active', 'released']),
  createdAt: z.string(),
  releasedAt: z.string().optional(),
  releasedBy: z.string().optional(),
});
export type LegalHold = z.infer<typeof LegalHoldSchema>;

export const CreateLegalHoldRequestSchema = z.object({
  workspaceId: z.string(),
  conversationIds: z.array(z.string()).min(1).max(100),
  authorizedBy: z.string(),
  reason: z.string().min(10).max(1000),
  expiresAt: z.string().datetime(),
});
export type CreateLegalHoldRequest = z.infer<typeof CreateLegalHoldRequestSchema>;
