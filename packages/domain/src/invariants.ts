import { BusinessRole, BusinessInternalNote, MessageEnvelope } from '@orbit/schemas';
import { canPerformAction } from './permissions.js';

export class DomainSecurityError extends Error {
  constructor(public code: string, message: string) {
    super(message);
    this.name = 'DomainSecurityError';
  }
}

/**
 * Ensures sender workspace matches the active workspace context
 */
export function assertWorkspaceSenderScope(
  activeWorkspaceId: string,
  requestWorkspaceId: string
): void {
  if (activeWorkspaceId !== requestWorkspaceId) {
    throw new DomainSecurityError(
      'CROSS_WORKSPACE_VIOLATION',
      'Action workspace does not match the active session workspace'
    );
  }
}

/**
 * Asserts that a user has permissions to view or create business internal notes
 */
export function assertInternalNoteAccess(
  isBusinessWorkspace: boolean,
  userRole?: BusinessRole
): void {
  if (!isBusinessWorkspace) {
    throw new DomainSecurityError(
      'INTERNAL_NOTE_NOT_ALLOWED',
      'Internal notes can only be created or viewed in a business workspace context'
    );
  }

  if (!userRole || !canPerformAction(userRole, 'view_internal_notes')) {
    throw new DomainSecurityError(
      'INSUFFICIENT_ROLE_PERMISSIONS',
      'User lacks required role to access business internal notes'
    );
  }
}

/**
 * CRITICAL INVARIANT: Asserts that an array of messages intended for customer delivery
 * contains ZERO internal notes.
 */
export function assertNoInternalNoteLeakage(
  messages: (MessageEnvelope | BusinessInternalNote | Record<string, unknown>)[]
): void {
  for (const item of messages) {
    if ('resourceType' in item && item.resourceType === 'business_internal_note') {
      throw new DomainSecurityError(
        'INTERNAL_NOTE_LEAKAGE_DETECTED',
        'Critical security violation: Internal note found in public message array'
      );
    }
  }
}
