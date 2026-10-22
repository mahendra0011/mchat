import { z } from 'zod';

export const BusinessInternalNoteSchema = z.object({
  id: z.string().uuid(),
  conversationId: z.string().uuid(),
  workspaceId: z.string().uuid(),
  authorWorkspaceId: z.string().uuid(),
  authorName: z.string(),
  authorAvatarUrl: z.string().optional(),
  body: z.string().min(1).max(10000),
  createdAt: z.string().datetime(),
  // Distinct flag to enforce runtime type safety
  resourceType: z.literal('business_internal_note').default('business_internal_note'),
});

export type BusinessInternalNote = z.infer<typeof BusinessInternalNoteSchema>;

export const CreateInternalNoteRequestSchema = z.object({
  body: z.string().min(1).max(10000),
});

export type CreateInternalNoteRequest = z.infer<typeof CreateInternalNoteRequestSchema>;

export const ConversationAssignmentStatusSchema = z.enum([
  'open',
  'assigned',
  'waiting',
  'resolved',
]);
export type ConversationAssignmentStatus = z.infer<typeof ConversationAssignmentStatusSchema>;

export const ConversationPrioritySchema = z.enum(['low', 'normal', 'high', 'urgent']);
export type ConversationPriority = z.infer<typeof ConversationPrioritySchema>;

export const BusinessConversationMetadataSchema = z.object({
  conversationId: z.string().uuid(),
  workspaceId: z.string().uuid(),
  assigneeWorkspaceId: z.string().uuid().nullable().optional(),
  assigneeName: z.string().optional(),
  status: ConversationAssignmentStatusSchema.default('open'),
  priority: ConversationPrioritySchema.default('normal'),
  labels: z.array(z.string()).default([]),
  firstResponseTimeSeconds: z.number().int().nonnegative().optional(),
  resolvedAt: z.string().datetime().nullable().optional(),
  updatedAt: z.string().datetime(),
});

export type BusinessConversationMetadata = z.infer<typeof BusinessConversationMetadataSchema>;

export const UpdateAssignmentRequestSchema = z.object({
  assigneeWorkspaceId: z.string().uuid().nullable().optional(),
  status: ConversationAssignmentStatusSchema.optional(),
  priority: ConversationPrioritySchema.optional(),
  labels: z.array(z.string()).optional(),
});

export type UpdateAssignmentRequest = z.infer<typeof UpdateAssignmentRequestSchema>;

export const SavedReplySchema = z.object({
  id: z.string().uuid(),
  workspaceId: z.string().uuid(),
  shortcut: z.string().min(1).max(30).optional(),
  title: z.string().min(1).max(100),
  body: z.string().min(1).max(5000),
  /** Wave B — optional team scope within a business workspace. */
  teamId: z.string().uuid().nullable().optional(),
  createdAt: z.string().datetime().optional(),
  updatedAt: z.string().datetime().optional(),
});

export type SavedReply = z.infer<typeof SavedReplySchema>;

export const CreateSavedReplyRequestSchema = z.object({
  title: z.string().min(1).max(100),
  body: z.string().min(1).max(5000),
  shortcut: z.string().min(1).max(30).optional(),
  teamId: z.string().uuid().optional(),
});

export type CreateSavedReplyRequest = z.infer<typeof CreateSavedReplyRequestSchema>;

export const UpdateSavedReplyRequestSchema = z
  .object({
    title: z.string().min(1).max(100),
    body: z.string().min(1).max(5000),
    shortcut: z.string().min(1).max(30),
    teamId: z.string().uuid().nullable(),
  })
  .partial();

export type UpdateSavedReplyRequest = z.infer<typeof UpdateSavedReplyRequestSchema>;

/** Wave B — assignment persisted directly on the conversation record. */
export const SetConversationAssignmentRequestSchema = z.object({
  assigneeUserId: z.string().uuid().nullable(),
});

export type SetConversationAssignmentRequest = z.infer<typeof SetConversationAssignmentRequestSchema>;
