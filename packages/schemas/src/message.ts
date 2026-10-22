import { z } from 'zod';

export const MessageDeliveryStateSchema = z.enum([
  'sending',
  'sent',
  'delivered',
  'read',
  'failed',
  'scheduled',
]);
export type MessageDeliveryState = z.infer<typeof MessageDeliveryStateSchema>;

export const MessageContentTypeSchema = z.enum([
  'text',
  'image',
  'audio',
  'document',
  'workflow_card',
]);
export type MessageContentType = z.infer<typeof MessageContentTypeSchema>;

export const MessageAttachmentSchema = z.object({
  id: z.string().uuid(),
  mimeType: z.string(),
  name: z.string(),
  sizeBytes: z.number().int().positive(),
  url: z.string(),
  durationSeconds: z.number().optional(), // For voice notes
  waveform: z.array(z.number()).optional(), // For audio visualization
});

export type MessageAttachment = z.infer<typeof MessageAttachmentSchema>;

export const MessageReactionSchema = z.object({
  emoji: z.string(),
  count: z.number().int().positive(),
  workspaceIds: z.array(z.string().uuid()),
});

export type MessageReaction = z.infer<typeof MessageReactionSchema>;

export const MessageEnvelopeSchema = z.object({
  id: z.string().uuid(),
  conversationId: z.string().uuid(),
  senderWorkspaceId: z.string().uuid(),
  senderName: z.string(),
  senderAvatarUrl: z.string().optional(),
  idempotencyKey: z.string().min(1).max(128),
  clientMessageId: z.string().min(1).max(128),
  contentType: MessageContentTypeSchema.default('text'),
  body: z.string().max(20000),
  attachments: z.array(MessageAttachmentSchema).default([]),
  deliveryState: MessageDeliveryStateSchema.default('sent'),
  reactions: z.array(MessageReactionSchema).default([]),
  replyToMessageId: z.string().uuid().nullable().optional(),
  replyToSnippet: z.string().max(150).optional(),
  replyToSenderName: z.string().optional(),
  branchId: z.string().uuid().nullable().optional(),
  branchTitle: z.string().optional(),
  branchMessageCount: z.number().int().nonnegative().optional(),
  isEdited: z.boolean().default(false),
  editedAt: z.string().datetime().nullable().optional(),
  isDeleted: z.boolean().default(false),
  /** Wave B — delete-for-self: workspaces that no longer see this message. */
  deletedFor: z.array(z.string().uuid()).default([]).optional(),
  isEncrypted: z.boolean().default(false),
  scheduledFor: z.string().datetime().nullable().optional(),
  createdAt: z.string().datetime(),
  serverSequence: z.number().int().nonnegative().optional(),
  /** Spec 24 — integration that sent this message (for bot labeling). */
  integrationId: z.string().optional(),
});

export type MessageEnvelope = z.infer<typeof MessageEnvelopeSchema>;

export const SendMessageRequestSchema = z.object({
  conversationId: z.string().uuid(),
  idempotencyKey: z.string().min(1).max(128),
  clientMessageId: z.string().min(1).max(128),
  contentType: MessageContentTypeSchema.default('text'),
  body: z.string().min(1).max(20000),
  attachments: z.array(MessageAttachmentSchema).optional(),
  replyToMessageId: z.string().uuid().optional(),
  branchId: z.string().uuid().optional(),
  isEncrypted: z.boolean().default(false),
  scheduledFor: z.string().datetime().optional(),
  /** Wave B — sent via a saved reply; requires the saved_replies.use capability. */
  savedReplyId: z.string().uuid().optional(),
  /** Spec 24 — integration that sent this message (for bot labeling). */
  integrationId: z.string().optional(),
});

export type SendMessageRequest = z.infer<typeof SendMessageRequestSchema>;

export const ScheduleMessageRequestSchema = z.object({
  body: z.string().min(1).max(20000),
  scheduledFor: z.string().datetime(),
});

export type ScheduleMessageRequest = z.infer<typeof ScheduleMessageRequestSchema>;

export const DeleteMessageScopeSchema = z.enum(['self', 'everyone']);
export type DeleteMessageScope = z.infer<typeof DeleteMessageScopeSchema>;

export const EditMessageRequestSchema = z.object({
  body: z.string().min(1).max(20000),
});

export type EditMessageRequest = z.infer<typeof EditMessageRequestSchema>;

export const ToggleReactionRequestSchema = z.object({
  emoji: z.string().min(1).max(8),
});

export type ToggleReactionRequest = z.infer<typeof ToggleReactionRequestSchema>;
