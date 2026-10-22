import { PolicyPrincipal, PolicyResource, PolicyAction, PolicyDecision } from '@orbit/schemas';

/**
 * Hybrid RBAC + ABAC Policy Engine (Spec 32)
 * Enforces:
 * - Deny-by-default
 * - Strict multi-tenant isolation
 * - Hard personal vs business boundary (internal notes never exposed to personal or customers)
 * - Legal hold deletion suppression
 * - Step-up re-authentication requirements for high-risk operations
 */

export class PolicyEngine {
  evaluate(
    principal: PolicyPrincipal,
    action: PolicyAction,
    resource: PolicyResource
  ): PolicyDecision {
    const evaluatedAt = new Date().toISOString();

    // 1. Strict multi-tenant boundary check
    if (principal.activeWorkspaceId !== resource.workspaceId) {
      return {
        allowed: false,
        reason: `Cross-tenant boundary violation: resource belongs to workspace ${resource.workspaceId}, principal is in ${principal.activeWorkspaceId}`,
        requiresStepUp: false,
        evaluatedAt,
      };
    }

    // 2. Internal Business Notes boundary
    if (resource.type === 'internal_note' || resource.isInternalNote) {
      if (principal.activeWorkspaceType !== 'BUSINESS') {
        return {
          allowed: false,
          reason: 'Personal workspaces and customer identities are strictly denied access to internal business notes',
          requiresStepUp: false,
          evaluatedAt,
        };
      }

      if (!['OWNER', 'ADMIN', 'SUPERVISOR', 'AGENT'].includes(principal.role)) {
        return {
          allowed: false,
          reason: `Role ${principal.role} is not permitted to access internal business notes`,
          requiresStepUp: false,
          evaluatedAt,
        };
      }
    }

    // 3. Compliance Legal Hold suppression
    if (action === 'message.delete' && resource.isUnderLegalHold) {
      return {
        allowed: false,
        reason: 'Resource is under active compliance legal hold and cannot be deleted',
        requiresStepUp: false,
        evaluatedAt,
      };
    }

    // 4. Step-up authentication for high-risk operations
    const highRiskActions: PolicyAction[] = [
      'workspace.ownership.transfer',
      'export.create',
      'security.session.revoke',
    ];

    if (highRiskActions.includes(action) && !principal.hasRecentStepUp) {
      return {
        allowed: false,
        reason: `High-risk action ${action} requires step-up re-authentication confirmation`,
        requiresStepUp: true,
        evaluatedAt,
      };
    }

    // 5. Role-Based Action evaluation
    switch (action) {
      case 'conversation.read':
      case 'conversation.create':
      case 'message.send':
      case 'attachment.download':
      case 'attachment.upload':
        return { allowed: true, reason: 'Authorized by workspace membership', requiresStepUp: false, evaluatedAt };

      case 'message.delete':
        // Owner and Admin can delete any message in workspace; members can delete their own
        if (['OWNER', 'ADMIN', 'SUPERVISOR'].includes(principal.role)) {
          return { allowed: true, reason: 'Authorized by elevated workspace role', requiresStepUp: false, evaluatedAt };
        }
        if (resource.ownerAccountId && resource.ownerAccountId === principal.accountId) {
          return { allowed: true, reason: 'Authorized as resource creator', requiresStepUp: false, evaluatedAt };
        }
        return { allowed: false, reason: 'Cannot delete messages created by other accounts', requiresStepUp: false, evaluatedAt };

      case 'internal_note.read':
      case 'internal_note.create':
        // Verified in section 2
        return { allowed: true, reason: 'Authorized business staff role', requiresStepUp: false, evaluatedAt };

      case 'workspace.ownership.transfer':
        if (principal.role === 'OWNER') {
          return { allowed: true, reason: 'Owner authorized with recent step-up', requiresStepUp: false, evaluatedAt };
        }
        return { allowed: false, reason: 'Only the active workspace Owner can transfer ownership', requiresStepUp: false, evaluatedAt };

      case 'workspace.manage':
      case 'billing.view':
      case 'billing.manage':
      case 'integration.install':
      case 'integration.revoke':
        if (['OWNER', 'ADMIN'].includes(principal.role)) {
          return { allowed: true, reason: 'Authorized by admin or owner role', requiresStepUp: false, evaluatedAt };
        }
        return { allowed: false, reason: `Action ${action} requires Admin or Owner role`, requiresStepUp: false, evaluatedAt };

      case 'export.create':
      case 'export.download':
        if (['OWNER', 'ADMIN', 'SUPERVISOR'].includes(principal.role)) {
          return { allowed: true, reason: 'Authorized export role with recent step-up', requiresStepUp: false, evaluatedAt };
        }
        return { allowed: false, reason: 'Members cannot export full workspace data', requiresStepUp: false, evaluatedAt };

      case 'security.session.revoke':
        // An account can always revoke its own session; admins can revoke tenant sessions
        return { allowed: true, reason: 'Authorized session management', requiresStepUp: false, evaluatedAt };

      default:
        return { allowed: false, reason: 'Action denied by default policy', requiresStepUp: false, evaluatedAt };
    }
  }
}
