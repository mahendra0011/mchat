import { z } from 'zod';

export const PolicyPrincipalSchema = z.object({
  accountId: z.string().uuid(),
  activeWorkspaceId: z.string().uuid(),
  activeWorkspaceType: z.enum(['PERSONAL', 'BUSINESS']),
  role: z.enum(['OWNER', 'ADMIN', 'SUPERVISOR', 'AGENT', 'MEMBER']),
  hasRecentStepUp: z.boolean().default(false),
});

export type PolicyPrincipal = z.infer<typeof PolicyPrincipalSchema>;

export const PolicyResourceSchema = z.object({
  type: z.enum([
    'conversation',
    'message',
    'internal_note',
    'attachment',
    'workspace',
    'billing',
    'export',
    'integration',
    'session',
  ]),
  id: z.string(),
  workspaceId: z.string().uuid(),
  isInternalNote: z.boolean().default(false),
  isUnderLegalHold: z.boolean().default(false),
  ownerAccountId: z.string().uuid().optional(),
});

export type PolicyResource = z.infer<typeof PolicyResourceSchema>;

export const PolicyActionSchema = z.enum([
  'conversation.read',
  'conversation.create',
  'message.send',
  'message.delete',
  'internal_note.read',
  'internal_note.create',
  'attachment.download',
  'attachment.upload',
  'workspace.manage',
  'workspace.ownership.transfer',
  'billing.view',
  'billing.manage',
  'export.create',
  'export.download',
  'integration.install',
  'integration.revoke',
  'security.session.revoke',
]);

export type PolicyAction = z.infer<typeof PolicyActionSchema>;

export const PolicyDecisionSchema = z.object({
  allowed: z.boolean(),
  reason: z.string(),
  requiresStepUp: z.boolean().default(false),
  evaluatedAt: z.string().datetime(),
});

export type PolicyDecision = z.infer<typeof PolicyDecisionSchema>;
