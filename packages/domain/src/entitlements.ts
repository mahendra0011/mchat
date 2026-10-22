import type { BillingEntitlement } from '@orbit/schemas';

export type EntitlementAction =
  | 'add_seat'
  | 'upload_file'
  | 'install_integration'
  | 'use_custom_theme'
  | 'use_workflow_cards'
  | 'audit_export';

export interface EntitlementCheckResult {
  allowed: boolean;
  reason?: string;
}

export function evaluateEntitlement(
  entitlement: BillingEntitlement,
  action: EntitlementAction,
  params?: { fileSizeMB?: number }
): EntitlementCheckResult {
  if (entitlement.status === 'past_due' || entitlement.status === 'cancelled') {
    return {
      allowed: false,
      reason: `Workspace billing is ${entitlement.status}. Please resolve billing to proceed.`,
    };
  }

  switch (action) {
    case 'add_seat': {
      if (entitlement.seatsUsed >= entitlement.seatsAllocated) {
        return {
          allowed: false,
          reason: `Seat quota exceeded (${entitlement.seatsUsed}/${entitlement.seatsAllocated}). Upgrade plan or add seats.`,
        };
      }
      return { allowed: true };
    }

    case 'upload_file': {
      const sizeMB = params?.fileSizeMB ?? 0;
      if (sizeMB > entitlement.maxFileSizeMB) {
        return {
          allowed: false,
          reason: `File size (${sizeMB}MB) exceeds plan maximum of ${entitlement.maxFileSizeMB}MB.`,
        };
      }
      return { allowed: true };
    }

    case 'install_integration': {
      if (entitlement.activeIntegrationsCount >= entitlement.maxIntegrationsAllowed) {
        return {
          allowed: false,
          reason: `Active integrations limit reached (${entitlement.activeIntegrationsCount}/${entitlement.maxIntegrationsAllowed}).`,
        };
      }
      return { allowed: true };
    }

    case 'use_custom_theme': {
      if (!entitlement.customThemesAllowed) {
        return {
          allowed: false,
          reason: 'Custom themes require Personal Plus or Business plans.',
        };
      }
      return { allowed: true };
    }

    case 'use_workflow_cards': {
      if (!entitlement.workflowCardsAllowed) {
        return {
          allowed: false,
          reason: 'Interactive workflow cards require a Business plan.',
        };
      }
      return { allowed: true };
    }

    case 'audit_export': {
      if (!entitlement.auditExportAllowed) {
        return {
          allowed: false,
          reason: 'Compliance audit exports require Business Scale tier.',
        };
      }
      return { allowed: true };
    }

    default:
      return { allowed: true };
  }
}
