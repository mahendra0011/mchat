/**
 * Workspace capability matrix (Spec 07 — Team roles MVP).
 * Every API must enforce these capabilities server-side; UI hiding alone is insufficient.
 */

export type TeamRole = 'owner' | 'admin' | 'agent' | 'analyst';

export type AdminRole = 'support' | 'trust_safety' | 'security_ops' | 'billing_support' | 'system_admin';

export type Capability =
  | 'workspace.configure'
  | 'workspace.billing'
  | 'workspace.ownership.transfer'
  | 'workspace.export'
  | 'workspace.delete'
  | 'billing.manage_seats'
  | 'team.invite'
  | 'team.remove_member'
  | 'team.change_role'
  | 'inbox.view_assigned'
  | 'inbox.view_all'
  | 'inbox.assign'
  | 'inbox.send_reply'
  | 'inbox.add_internal_note'
  | 'inbox.apply_label'
  | 'inbox.handoff'
  | 'reports.view'
  | 'reports.resolve'
  | 'reports.export'
  | 'audit.view'
  | 'admin.support'
  | 'admin.trust_safety'
  | 'admin.security_ops'
  | 'admin.billing_support'
  | 'admin.system'
  | 'admin.legal'
  | 'admin.privacy';

const CAPABILITIES: Record<TeamRole | AdminRole, ReadonlySet<Capability>> = {
  owner: new Set([
    'workspace.configure',
    'workspace.billing',
    'workspace.ownership.transfer',
    'workspace.export',
    'workspace.delete',
    'billing.manage_seats',
    'team.invite',
    'team.remove_member',
    'team.change_role',
    'inbox.view_assigned',
    'inbox.view_all',
    'inbox.assign',
    'inbox.send_reply',
    'inbox.add_internal_note',
    'inbox.apply_label',
    'inbox.handoff',
    'reports.view',
    'reports.resolve',
    'reports.export',
    'audit.view',
  ]),
  admin: new Set([
    'workspace.configure',
    'team.invite',
    'team.remove_member',
    'team.change_role',
    'inbox.view_assigned',
    'inbox.view_all',
    'inbox.assign',
    'inbox.send_reply',
    'inbox.add_internal_note',
    'inbox.apply_label',
    'inbox.handoff',
    'reports.view',
    'reports.resolve',
    'reports.export',
    'audit.view',
  ]),
  agent: new Set([
    'inbox.view_assigned',
    'inbox.send_reply',
    'inbox.add_internal_note',
    'inbox.apply_label',
    'inbox.handoff',
  ]),
  analyst: new Set(['reports.view']),

  // Admin console roles (Spec 23)
  support: new Set(['admin.support']),
  trust_safety: new Set(['admin.trust_safety', 'reports.view', 'reports.resolve']),
  security_ops: new Set(['admin.security_ops']),
  billing_support: new Set(['admin.billing_support']),
  system_admin: new Set(['admin.system', 'workspace.configure', 'admin.legal', 'admin.privacy']),
};

export function can(role: TeamRole | AdminRole, capability: Capability): boolean {
  const capabilities = CAPABILITIES[role];
  return capabilities?.has(capability) ?? false;
}

export function capabilitiesFor(role: TeamRole | AdminRole): Capability[] {
  return [...CAPABILITIES[role]];
}

/**
 * Atomic assignment: one primary assignee + optional watchers.
 * Ownership change must be auditable.
 */
export interface ConversationAssignment {
  conversationId: string;
  primaryAssigneeWorkspaceId: string | null;
  watcherWorkspaceIds: string[];
  changedByWorkspaceId: string;
  changedAt: string;
}

export function assignPrimary(
  current: ConversationAssignment,
  newAssigneeWorkspaceId: string,
  actorWorkspaceId: string
): ConversationAssignment {
  return {
    ...current,
    primaryAssigneeWorkspaceId: newAssigneeWorkspaceId,
    changedByWorkspaceId: actorWorkspaceId,
    changedAt: new Date().toISOString(),
  };
}

export function addWatcher(
  current: ConversationAssignment,
  watcherWorkspaceId: string,
  actorWorkspaceId: string
): ConversationAssignment {
  if (current.watcherWorkspaceIds.includes(watcherWorkspaceId)) return current;
  return {
    ...current,
    watcherWorkspaceIds: [...current.watcherWorkspaceIds, watcherWorkspaceId],
    changedByWorkspaceId: actorWorkspaceId,
    changedAt: new Date().toISOString(),
  };
}

export function removeWatcher(
  current: ConversationAssignment,
  watcherWorkspaceId: string,
  actorWorkspaceId: string
): ConversationAssignment {
  return {
    ...current,
    watcherWorkspaceIds: current.watcherWorkspaceIds.filter((w) => w !== watcherWorkspaceId),
    changedByWorkspaceId: actorWorkspaceId,
    changedAt: new Date().toISOString(),
  };
}
