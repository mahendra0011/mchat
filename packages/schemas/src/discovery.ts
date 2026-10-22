import { z } from 'zod';

export const ContactRequestStatusSchema = z.enum([
  'pending',
  'accepted',
  'ignored',
  'blocked',
]);
export type ContactRequestStatus = z.infer<typeof ContactRequestStatusSchema>;

export const ContactRequestSchema = z.object({
  id: z.string(),
  requesterId: z.string(),
  requesterHandle: z.string(),
  requesterDisplayName: z.string(),
  recipientId: z.string(),
  recipientHandle: z.string(),
  status: ContactRequestStatusSchema,
  introMessage: z.string().optional(),
  createdAt: z.string(),
  updatedAt: z.string(),
});
export type ContactRequest = z.infer<typeof ContactRequestSchema>;

export const ContactDiscoverySearchQuerySchema = z.object({
  handle: z.string().min(2).max(32),
});
export type ContactDiscoverySearchQuery = z.infer<typeof ContactDiscoverySearchQuerySchema>;

export const ContactDiscoveryResultSchema = z.object({
  found: z.boolean(),
  handle: z.string(),
  displayName: z.string().optional(),
  avatarUrl: z.string().optional(),
  bio: z.string().optional(),
  // Never expose raw phone or email
  matchedViaContactBook: z.boolean().default(false),
  /** The contact's resolved workspace (the identity that answers a direct thread). */
  workspaceId: z.string().optional(),
  /** Drop-in `participantWorkspaceIds` for POST /v1/conversations. Empty when not found. */
  workspaceIds: z.array(z.string()).default([]),
  /** Workspaces accessible to both the caller and the contact. */
  sharedWorkspaceIds: z.array(z.string()).default([]),
  /** First shared workspace (or null when the two accounts share none). */
  sharedWorkspaceId: z.string().nullable().default(null),
  /** The caller's team role inside `sharedWorkspaceId` (null when none/not shared). */
  role: z.enum(['owner', 'admin', 'agent', 'analyst']).nullable().default(null),
});
export type ContactDiscoveryResult = z.infer<typeof ContactDiscoveryResultSchema>;

export const InviteLinkSchema = z.object({
    id: z.string(),
    workspaceId: z.string(),
    creatorId: z.string(),
    code: z.string(),
    url: z.string(),
    maxUses: z.number().int().positive(),
    usedCount: z.number().int().nonnegative().default(0),
    expiresAt: z.string(),
    revoked: z.boolean().default(false),
    createdAt: z.string(),
    /** Spec 14 — group invites target a conversation; account invites omit this. */
    conversationId: z.string().optional(),
  });
export type InviteLink = z.infer<typeof InviteLinkSchema>;
