import { z } from 'zod';

export const WorkspaceTypeSchema = z.enum(['personal', 'business']);
export type WorkspaceType = z.infer<typeof WorkspaceTypeSchema>;

export const BusinessRoleSchema = z.enum(['owner', 'admin', 'agent', 'analyst']);
export type BusinessRole = z.infer<typeof BusinessRoleSchema>;

export const IdentityWorkspaceSchema = z.object({
  id: z.string().uuid(),
  ownerAccountId: z.string().uuid(),
  type: WorkspaceTypeSchema,
  displayName: z.string().min(1).max(100),
  handle: z.string().min(3).max(30).regex(/^[a-zA-Z0-9_]+$/, 'Handle must be alphanumeric or underscore'),
  avatarUrl: z.string().url().optional(),
  bio: z.string().max(280).optional(),
  colorCue: z.string().regex(/^#[0-9a-fA-F]{6}$/).optional(),
  status: z.enum(['active', 'archived']),
  createdAt: z.string().datetime(),
  // Business-specific fields
  category: z.string().max(50).optional(),
  businessHours: z.string().max(100).optional(),
  website: z.string().url().optional(),
  isVerified: z.boolean().default(false),
});

export type IdentityWorkspace = z.infer<typeof IdentityWorkspaceSchema>;

export const WorkspaceMembershipSchema = z.object({
  id: z.string().uuid(),
  workspaceId: z.string().uuid(),
  accountId: z.string().uuid(),
  role: BusinessRoleSchema,
  status: z.enum(['active', 'invited', 'suspended', 'revoked']),
  joinedAt: z.string().datetime(),
});

export type WorkspaceMembership = z.infer<typeof WorkspaceMembershipSchema>;

export const CreateBusinessWorkspaceRequestSchema = z.object({
  displayName: z.string().min(2).max(100),
  handle: z.string().min(3).max(30).regex(/^[a-zA-Z0-9_]+$/),
  category: z.string().min(2).max(50),
  bio: z.string().max(280).optional(),
  website: z.string().url().optional(),
  businessHours: z.string().max(100).optional(),
  colorCue: z.string().regex(/^#[0-9a-fA-F]{6}$/).optional(),
});

export type CreateBusinessWorkspaceRequest = z.infer<typeof CreateBusinessWorkspaceRequestSchema>;

/** Wave B — member list projection returned by GET /v1/workspaces/:id/members. */
export const WorkspaceMemberSchema = z.object({
  userId: z.string().uuid(),
  displayName: z.string(),
  email: z.string().nullable(),
  role: BusinessRoleSchema,
  joinedAt: z.string().datetime(),
});

export type WorkspaceMember = z.infer<typeof WorkspaceMemberSchema>;

export const WorkspaceInvitationStatusSchema = z.enum(['pending', 'accepted', 'revoked']);
export type WorkspaceInvitationStatus = z.infer<typeof WorkspaceInvitationStatusSchema>;

export const WorkspaceInvitationSchema = z.object({
  id: z.string().uuid(),
  workspaceId: z.string().uuid(),
  email: z.string().email(),
  role: BusinessRoleSchema,
  token: z.string().min(16).max(128),
  status: WorkspaceInvitationStatusSchema.default('pending'),
  invitedByAccountId: z.string().uuid(),
  createdAt: z.string().datetime(),
  acceptedAt: z.string().datetime().nullable().optional(),
  acceptedAccountId: z.string().uuid().nullable().optional(),
});

export type WorkspaceInvitation = z.infer<typeof WorkspaceInvitationSchema>;

export const CreateWorkspaceInvitationRequestSchema = z.object({
  email: z.string().email(),
  role: BusinessRoleSchema.default('agent'),
});

export type CreateWorkspaceInvitationRequest = z.infer<typeof CreateWorkspaceInvitationRequestSchema>;

export const AcceptWorkspaceInvitationRequestSchema = z.object({
  token: z.string().min(1).max(128),
});

export type AcceptWorkspaceInvitationRequest = z.infer<typeof AcceptWorkspaceInvitationRequestSchema>;

export const UpdateMemberRoleRequestSchema = z.object({
  role: BusinessRoleSchema,
});

export type UpdateMemberRoleRequest = z.infer<typeof UpdateMemberRoleRequestSchema>;
