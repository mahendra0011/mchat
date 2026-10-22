import { z } from 'zod';

export const RetentionPolicySchema = z.object({
  targetCategory: z.enum([
    'message_ciphertext',
    'attachments',
    'ephemeral_media',
    'audit_logs',
    'abuse_reports',
    'auth_sessions',
  ]),
  retentionDays: z.number().int().nonnegative(),
  isErasableOnDemand: z.boolean().default(true),
});

export type RetentionPolicy = z.infer<typeof RetentionPolicySchema>;

export const DeletionTombstoneSchema = z.object({
  tombstoneId: z.string().uuid(),
  targetType: z.enum(['message', 'attachment', 'user', 'workspace', 'session']),
  targetIdHash: z.string().length(64),
  workspaceId: z.string().uuid(),
  deletedAt: z.string().datetime(),
  reason: z.enum(['user_delete', 'retention_expiry', 'gdpr_erasure']),
  tombstoneHash: z.string().length(64),
});

export type DeletionTombstone = z.infer<typeof DeletionTombstoneSchema>;

export const RestoreReconciliationReportSchema = z.object({
  restoredRecordsCount: z.number().int().nonnegative(),
  suppressedTombstoneCount: z.number().int().nonnegative(),
  preservedRecordsCount: z.number().int().nonnegative(),
  reconciledAt: z.string().datetime(),
});

export type RestoreReconciliationReport = z.infer<typeof RestoreReconciliationReportSchema>;
