import { BusinessRole } from '@orbit/schemas';

export type WorkspaceAction =
  | 'view_conversations'
  | 'send_message'
  | 'edit_own_message'
  | 'delete_message'
  | 'view_internal_notes'
  | 'create_internal_note'
  | 'assign_conversation'
  | 'manage_team'
  | 'manage_settings'
  | 'export_data'
  | 'delete_workspace'
  | 'create_branch'
  | 'read_branch'
  | 'write_branch';

const ROLE_PERMISSIONS: Record<BusinessRole, Set<WorkspaceAction>> = {
  owner: new Set<WorkspaceAction>([
    'view_conversations',
    'send_message',
    'edit_own_message',
    'delete_message',
    'view_internal_notes',
    'create_internal_note',
    'assign_conversation',
    'manage_team',
    'manage_settings',
    'export_data',
    'delete_workspace',
    'create_branch',
    'read_branch',
    'write_branch',
  ]),
  admin: new Set<WorkspaceAction>([
    'view_conversations',
    'send_message',
    'edit_own_message',
    'delete_message',
    'view_internal_notes',
    'create_internal_note',
    'assign_conversation',
    'manage_team',
    'manage_settings',
    'export_data',
    'create_branch',
    'read_branch',
    'write_branch',
  ]),
  agent: new Set<WorkspaceAction>([
    'view_conversations',
    'send_message',
    'edit_own_message',
    'view_internal_notes',
    'create_internal_note',
    'assign_conversation',
    'read_branch',
    'write_branch',
  ]),
  analyst: new Set<WorkspaceAction>([
    'view_conversations',
    'read_branch',
  ]),
};

export function canPerformAction(role: BusinessRole, action: WorkspaceAction): boolean {
  return ROLE_PERMISSIONS[role]?.has(action) ?? false;
}

export function canCreateBranch(role: BusinessRole): boolean {
  return canPerformAction(role, 'create_branch');
}

export function canReadBranch(role: BusinessRole): boolean {
  return canPerformAction(role, 'read_branch');
}

export function canWriteBranch(role: BusinessRole): boolean {
  return canPerformAction(role, 'write_branch');
}
