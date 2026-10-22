import { z } from 'zod';

export const PrivacyReceiptParticipantSchema = z.object({
  workspaceId: z.string().uuid(),
  displayName: z.string(),
  role: z.string(),
  isBusinessAgent: z.boolean().default(false),
});

export type PrivacyReceiptParticipant = z.infer<typeof PrivacyReceiptParticipantSchema>;

export const PrivacyReceiptSchema = z.object({
  conversationId: z.string().uuid(),
  title: z.string().optional(),
  encryption: z.object({
    isE2EE: z.boolean(),
    protocol: z.string(),
    verified: z.boolean(),
    limitations: z.string(),
  }),
  participants: z.array(PrivacyReceiptParticipantSchema),
  retention: z.object({
    policyName: z.string(),
    retentionDays: z.number().nullable(),
    disappearingMessagesEnabled: z.boolean(),
    deletionNotice: z.string(),
  }),
  devices: z.object({
    totalAuthorizedDevices: z.number().int().positive(),
    unverifiedDevicesCount: z.number().int().nonnegative().default(0),
    recentDeviceChanges: z.boolean().default(false),
  }),
  integrations: z.object({
    hasActiveAI: z.boolean().default(false),
    aiProcessingScope: z.enum(['none', 'local_only', 'user_explicit_share']),
    activeModulesCount: z.number().int().nonnegative().default(0),
  }),
  accessAuditLog: z.array(z.object({
    timestamp: z.string().datetime(),
    eventType: z.string(),
    actorName: z.string(),
    description: z.string(),
  })).default([]),
});

export type PrivacyReceipt = z.infer<typeof PrivacyReceiptSchema>;

export const DataRequestTypeSchema = z.enum([
  'access',
  'correction',
  'deletion',
  'consent_withdrawal',
  'appeal',
]);
export type DataRequestType = z.infer<typeof DataRequestTypeSchema>;

export const DataRequestStatusSchema = z.enum([
  'pending_verification',
  'verified',
  'in_progress',
  'completed',
  'rejected',
]);
export type DataRequestStatus = z.infer<typeof DataRequestStatusSchema>;

export const DataRequestSchema = z.object({
  id: z.string(),
  userId: z.string(),
  workspaceId: z.string(),
  type: DataRequestTypeSchema,
  status: DataRequestStatusSchema,
  scope: z.string().optional(),
  verificationMethod: z.enum(['email_otp', 'phone_otp', 'passkey', 'admin_review', 'document_upload']).optional(),
  verifiedAt: z.string().datetime().optional(),
  deadlineAt: z.string().datetime().optional(),
  completedAt: z.string().datetime().optional(),
  rejectionReason: z.string().optional(),
  notes: z.string().optional(),
  exceptions: z.array(z.string()).default([]),
  userNotifiedAt: z.string().datetime().optional(),
  createdAt: z.string().datetime(),
  updatedAt: z.string().datetime(),
});
export type DataRequest = z.infer<typeof DataRequestSchema>;

export const CreateDataRequestRequestSchema = z.object({
  type: DataRequestTypeSchema,
  scope: z.string().optional(),
});
export type CreateDataRequestRequest = z.infer<typeof CreateDataRequestRequestSchema>;

export const ProcessDataRequestRequestSchema = z.object({
  status: z.enum(['verified', 'in_progress', 'completed', 'rejected']),
  notes: z.string().optional(),
  exceptions: z.array(z.string()).default([]),
});
export type ProcessDataRequestRequest = z.infer<typeof ProcessDataRequestRequestSchema>;
