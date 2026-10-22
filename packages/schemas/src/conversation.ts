import { z } from 'zod';

export const ConversationKindSchema = z.enum(['direct', 'group', 'branch']);
export type ConversationKind = z.infer<typeof ConversationKindSchema>;

export const IntentModeSchema = z.enum(['standard', 'focus', 'planning', 'support', 'study', 'temporary']);
export type IntentMode = z.infer<typeof IntentModeSchema>;

export const BranchPermissionsSchema = z.object({
  conversationId: z.string().uuid(),
  workspaceId: z.string().uuid(),
  canRead: z.boolean().default(true),
  canWrite: z.boolean().default(false),
});
export type BranchPermissions = z.infer<typeof BranchPermissionsSchema>;

export const CreateBranchRequestSchema = z.object({
  sourceMessageId: z.string().uuid(),
  title: z.string().max(100).optional(),
  participantWorkspaceIds: z.array(z.string().uuid()).optional(),
  retentionDays: z.number().int().positive().optional(),
});
export type CreateBranchRequest = z.infer<typeof CreateBranchRequestSchema>;

export const ConversationStudioSettingsSchema = z.object({
  themeAccent: z.string().regex(/^#[0-9a-fA-F]{6}$/).optional(),
  density: z.enum(['compact', 'standard', 'comfortable']).default('standard'),
  bubbleRadius: z.enum(['sm', 'md', 'lg', 'full']).default('md'),
  wallpaper: z.enum(['none', 'subtle-grid', 'aurora-glow', 'warm-paper']).default('none'),
  showAvatars: z.boolean().default(true),
  soundEnabled: z.boolean().default(true),
});

export type ConversationStudioSettings = z.infer<typeof ConversationStudioSettingsSchema>;

export const ConversationParticipantSchema = z.object({
  workspaceId: z.string().uuid(),
  displayName: z.string(),
  handle: z.string(),
  avatarUrl: z.string().url().optional(),
  role: z.enum(['member', 'admin']),
  joinedAt: z.string().datetime(),
  isOnline: z.boolean().default(false),
});

export type ConversationParticipant = z.infer<typeof ConversationParticipantSchema>;

export const ConversationSchema = z.object({
  id: z.string().uuid(),
  workspaceId: z.string().uuid(), // The scoping workspace for the viewer/owner
  kind: ConversationKindSchema,
  title: z.string().max(100).optional(),
  participants: z.array(ConversationParticipantSchema),
  parentConversationId: z.string().uuid().nullable().optional(),
  sourceMessageId: z.string().uuid().nullable().optional(),
  intentMode: IntentModeSchema.default('standard'),
  studioSettings: ConversationStudioSettingsSchema.optional(),
  lastMessageSnippet: z.string().max(300).optional(),
  lastMessageAt: z.string().datetime().optional(),
  unreadCount: z.number().int().nonnegative().default(0),
  isPinned: z.boolean().default(false),
  isMuted: z.boolean().default(false),
  isArchived: z.boolean().default(false),
  isE2EE: z.boolean().default(false),
  retentionDays: z.number().int().positive().nullable().optional(),
  /** Wave B — persisted shared-inbox assignment (account-level assignee). */
  assigneeUserId: z.string().uuid().nullable().optional(),
  assignedAt: z.string().datetime().nullable().optional(),
  /** Wave B — conversation intent mode (personal vs business thread). */
  intent: z.enum(['personal', 'business']).nullable().optional(),
  // Spec 14 — group governance controls (optional; defaults applied in code)
    slowModeSeconds: z.number().int().min(0).max(86400).optional(),
    postingPermission: z.enum(['everyone', 'admins']).optional(),
    /** Spec 14 — when true, group-join requests require admin approval before membership. */
    membershipApprovalRequired: z.boolean().default(false),
    createdAt: z.string().datetime(),
  updatedAt: z.string().datetime(),
});

export type Conversation = z.infer<typeof ConversationSchema>;

export const CreateConversationRequestSchema = z.object({
  kind: ConversationKindSchema.default('direct'),
  title: z.string().max(100).optional(),
  participantWorkspaceIds: z.array(z.string().uuid()).min(1),
    intentMode: IntentModeSchema.default('standard'),
    parentConversationId: z.string().uuid().optional(),
    sourceMessageId: z.string().uuid().optional(),
    /** Spec 14 — group conversations may require admin approval for join requests. */
    membershipApprovalRequired: z.boolean().optional(),
  });

export type CreateConversationRequest = z.infer<typeof CreateConversationRequestSchema>;

export const ConversationIntentSchema = z.enum(['personal', 'business']);
export type ConversationIntent = z.infer<typeof ConversationIntentSchema>;

/**
 * PATCH /v1/conversations/:conversationId/studio-settings — partial update.
 * Missing keys keep their stored value; unknown/invalid values are rejected.
 */
export const UpdateConversationStudioSettingsRequestSchema = ConversationStudioSettingsSchema.partial();

export type UpdateConversationStudioSettingsRequest = z.infer<typeof UpdateConversationStudioSettingsRequestSchema>;

export const UpdateConversationIntentRequestSchema = z.object({
  intent: ConversationIntentSchema,
});

export type UpdateConversationIntentRequest = z.infer<typeof UpdateConversationIntentRequestSchema>;
