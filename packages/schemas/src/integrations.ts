import { z } from 'zod';

export const IntegrationScopeSchema = z.enum([
  'messages.read_scoped',
  'messages.send',
  'workflow.cards',
  'webhooks.receive',
]);
export type IntegrationScope = z.infer<typeof IntegrationScopeSchema>;

export const IntegrationCategorySchema = z.enum([
  'bot',
  'workflow',
  'crm',
  'calendar',
  'storage',
]);
export type IntegrationCategory = z.infer<typeof IntegrationCategorySchema>;

export const IntegrationStatusSchema = z.enum([
  'available',
  'installed',
  'revoked',
]);
export type IntegrationStatus = z.infer<typeof IntegrationStatusSchema>;

export const IntegrationManifestSchema = z.object({
  id: z.string(),
  workspaceId: z.string().optional(),
  name: z.string(),
  description: z.string(),
  icon: z.string(),
  category: IntegrationCategorySchema,
  scopes: z.array(IntegrationScopeSchema),
  botIdentity: z
    .object({
      name: z.string(),
      handle: z.string(),
      avatar: z.string(),
      badge: z.string(),
    })
    .optional(),
  webhookUrl: z.string().url().optional(),
  webhookSecret: z.string().optional(),
  installedAt: z.string().optional(),
  status: IntegrationStatusSchema.default('available'),
  dataPolicyUrl: z.string(),
});
export type IntegrationManifest = z.infer<typeof IntegrationManifestSchema>;

export const BotPermissionsSchema = z.object({
  canJoin: z.boolean().default(true),
  canReadHistory: z.boolean().default(false),
  canSend: z.boolean().default(false),
});
export type BotPermissions = z.infer<typeof BotPermissionsSchema>;

export const ConversationModuleGrantSchema = z.object({
  id: z.string(),
  integrationId: z.string(),
  conversationId: z.string(),
  scopes: z.array(IntegrationScopeSchema),
  botPermissions: BotPermissionsSchema,
  grantedBy: z.string(),
  grantedAt: z.string(),
});
export type ConversationModuleGrant = z.infer<typeof ConversationModuleGrantSchema>;

export const CreateConversationGrantSchema = z.object({
  conversationId: z.string(),
  scopes: z.array(IntegrationScopeSchema),
  botPermissions: BotPermissionsSchema.optional(),
});
export type CreateConversationGrant = z.infer<typeof CreateConversationGrantSchema>;

export const GrantConversationModuleRequestSchema = z.object({
  conversationId: z.string().uuid(),
  scopes: z.array(z.string()).min(1),
});
export type GrantConversationModuleRequest = z.infer<typeof GrantConversationModuleRequestSchema>;
