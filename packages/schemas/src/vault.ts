import { z } from 'zod';

export const VaultCollectionVisibilitySchema = z.enum(['private', 'workspace_shared']);
export type VaultCollectionVisibility = z.infer<typeof VaultCollectionVisibilitySchema>;

export const VaultCollectionSchema = z.object({
  id: z.string().uuid(),
  workspaceId: z.string().uuid(),
  name: z.string().min(1).max(80),
  description: z.string().max(200).optional(),
  icon: z.string().default('folder'),
  visibility: VaultCollectionVisibilitySchema.default('private'),
  itemCount: z.number().int().nonnegative().default(0),
  createdAt: z.string().datetime(),
});

export type VaultCollection = z.infer<typeof VaultCollectionSchema>;

export const VaultItemTypeSchema = z.enum(['message', 'file', 'link', 'decision', 'workflow']);
export type VaultItemType = z.infer<typeof VaultItemTypeSchema>;

export const VaultItemSchema = z.object({
  id: z.string().uuid(),
  collectionId: z.string().uuid(),
  workspaceId: z.string().uuid(),
  itemType: VaultItemTypeSchema.default('message'),
  sourceConversationId: z.string().uuid().optional(),
  sourceConversationTitle: z.string().optional(),
  sourceMessageId: z.string().uuid().optional(),
  authorName: z.string().optional(),
  title: z.string().max(200).optional(),
  content: z.string().max(20000),
  tags: z.array(z.string()).default([]),
  userNote: z.string().max(2000).optional(),
  reminderAt: z.string().datetime().nullable().optional(),
  savedAt: z.string().datetime(),
});

export type VaultItem = z.infer<typeof VaultItemSchema>;

export const CreateVaultCollectionRequestSchema = z.object({
  name: z.string().min(1).max(80),
  description: z.string().max(200).optional(),
  icon: z.string().optional(),
  visibility: VaultCollectionVisibilitySchema.default('private'),
});

export type CreateVaultCollectionRequest = z.infer<typeof CreateVaultCollectionRequestSchema>;

export const CreateVaultItemRequestSchema = z.object({
  collectionId: z.string().uuid(),
  itemType: VaultItemTypeSchema.default('message'),
  sourceConversationId: z.string().uuid().optional(),
  sourceConversationTitle: z.string().optional(),
  sourceMessageId: z.string().uuid().optional(),
  authorName: z.string().optional(),
  title: z.string().max(200).optional(),
  content: z.string().min(1).max(20000),
  tags: z.array(z.string()).default([]),
  userNote: z.string().max(2000).optional(),
  reminderAt: z.string().datetime().optional(),
});

export type CreateVaultItemRequest = z.infer<typeof CreateVaultItemRequestSchema>;

/** Wave B — conversation vault (saved conversations) visibility. */
export const ConversationVaultVisibilitySchema = z.enum(['participants', 'all', 'workspace']);
export type ConversationVaultVisibility = z.infer<typeof ConversationVaultVisibilitySchema>;

export const ConversationVaultSettingsSchema = z.object({
  conversationId: z.string().uuid(),
  workspaceId: z.string().uuid(),
  visibility: ConversationVaultVisibilitySchema.default('workspace'),
  memberIds: z.array(z.string().uuid()).default([]),
  updatedAt: z.string().datetime(),
});

export type ConversationVaultSettings = z.infer<typeof ConversationVaultSettingsSchema>;

export const UpdateConversationVaultRequestSchema = z.object({
  visibility: ConversationVaultVisibilitySchema,
  memberIds: z.array(z.string().uuid()).optional(),
});

export type UpdateConversationVaultRequest = z.infer<typeof UpdateConversationVaultRequestSchema>;
