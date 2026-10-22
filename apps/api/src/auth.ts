import { FastifyRequest, FastifyReply } from 'fastify';
import { randomUUID } from 'node:crypto';
import { UserAccount, IdentityWorkspace, WorkspaceMembership } from '@orbit/schemas';
import type { TeamRole, AdminRole } from '@orbit/domain';
import { store } from './store.js';
import { FIXTURE_IDS } from '@orbit/test-fixtures';

export interface RequestContext {
  account: UserAccount;
  activeWorkspace: IdentityWorkspace;
  membership?: WorkspaceMembership;
  adminRole?: AdminRole;
}

declare module 'fastify' {
  interface FastifyRequest {
    orbitContext?: RequestContext;
  }
}

function accountOwnsOrIsMember(accountId: string, workspaceId: string): boolean {
  const ws = store.workspaces.get(workspaceId);
  if (ws && ws.ownerAccountId === accountId) return true;
  for (const m of store.memberships.values()) {
    if (m.workspaceId === workspaceId && m.accountId === accountId && m.status === 'active') return true;
  }
  return false;
}

/**
 * Spec 07/14 — resolve the caller's team role in the active workspace.
 * Personal workspaces have no team roles (return null).
 */
export function resolveTeamRole(ctx: RequestContext): TeamRole | null {
  if (ctx.activeWorkspace.type !== 'business') return null;
  if (ctx.membership) return ctx.membership.role as TeamRole;
  if (ctx.activeWorkspace.ownerAccountId === ctx.account.id) return 'owner';
  return null;
}

/**
 * Spec 23 — resolve the caller's platform admin role.
 * Admin roles are separate from workspace team roles.
 */
export function resolveAdminRole(ctx: RequestContext): AdminRole | null {
  return ctx.adminRole ?? null;
}

export function accountHasWorkspaceAccess(accountId: string, workspaceId: string): boolean {
  return accountOwnsOrIsMember(accountId, workspaceId);
}

/** Spec 30 — sensitive operations require a step-up completed within this window. */
export const STEP_UP_MAX_AGE_MS = 5 * 60 * 1000;

/**
 * Spec 07/12 — ALLOW_WORKSPACE_FALLBACK controls whether an unknown or
 * inaccessible `x-workspace-id` header is silently ignored (fallback to the
 * account's own workspace). Defaults to true outside production; in strict
 * mode an unknown workspace id is rejected with 403 WORKSPACE_FORBIDDEN.
 */
function workspaceFallbackAllowed(): boolean {
  const raw = process.env.ALLOW_WORKSPACE_FALLBACK;
  if (raw === undefined || raw.trim() === '') return process.env.NODE_ENV !== 'production';
  const value = raw.trim().toLowerCase();
  return value !== 'false' && value !== '0' && value !== 'no';
}

function stepUpWithinWindow(
  hasRecentStepUp: boolean | undefined,
  stepUpExpiresAt: string | null | undefined,
  lastStepUpAt: string | null | undefined
): boolean {
  if (!hasRecentStepUp) return false;
  if (!stepUpExpiresAt || new Date(stepUpExpiresAt).getTime() <= Date.now()) return false;
  if (!lastStepUpAt) return false;
  return Date.now() - new Date(lastStepUpAt).getTime() <= STEP_UP_MAX_AGE_MS;
}

/**
 * Spec 30/32 — preHandler that demands recent re-authentication (step-up
 * within the last 5 minutes) before a sensitive operation proceeds.
 * Use after resolveRequestContext: `preHandler: [resolveRequestContext, requireStepUp]`.
 */
export async function requireStepUp(request: FastifyRequest, reply: FastifyReply): Promise<void> {
  const ctx = request.orbitContext;
  if (!ctx) {
    reply.status(401).send({
      error: {
        code: 'UNAUTHORIZED',
        message: 'Authentication context is required before step-up verification.',
        requestId: request.id,
      },
    });
    return;
  }

  const authHeader = request.headers['authorization'];
  const token = authHeader && authHeader.startsWith('Bearer ') ? authHeader.slice(7) : undefined;
  const tokenSession = token ? store.sessions.get(token) : undefined;
  const deviceSession = Array.from(store.deviceSessions.values()).find(
    (s) => s.accountId === ctx.account.id && s.isCurrentSession && s.status !== 'revoked'
  );

  const ok =
    (tokenSession != null &&
      stepUpWithinWindow(tokenSession.hasRecentStepUp, tokenSession.stepUpExpiresAt, tokenSession.lastStepUpAt)) ||
    (deviceSession != null &&
      stepUpWithinWindow(deviceSession.hasRecentStepUp, deviceSession.stepUpExpiresAt, deviceSession.lastStepUpAt));

  if (!ok) {
    reply.status(403).send({
      error: {
        code: 'STEP_UP_REQUIRED',
        message: 'Recent re-authentication is required for this action. Complete step-up verification and retry.',
        requestId: request.id,
      },
    });
    return;
  }
}

export async function resolveRequestContext(
  request: FastifyRequest,
  reply: FastifyReply
): Promise<void> {
  // Check for header or fallback to seeded test Alex
  const authHeader = request.headers['authorization'];
  const requestedWorkspaceId = request.headers['x-workspace-id'] as string | undefined;

  let account = store.accounts.get(FIXTURE_IDS.accountAlex)!;
  if (authHeader && authHeader.startsWith('Bearer ')) {
    const token = authHeader.slice(7);
    const session = store.sessions.get(token);
    if (session) {
      // Spec 30 — an expired session must never authenticate, even if the
      // record is still present in the store.
      if (session.expiresAt && new Date(session.expiresAt).getTime() <= Date.now()) {
        reply.status(401).send({
          error: {
            code: 'SESSION_EXPIRED',
            message: 'Session has expired. Please sign in again.',
            requestId: request.id,
          },
        });
        return;
      }
      const foundAccount = store.accounts.get(session.accountId);
      if (foundAccount) {
        account = foundAccount;
      }
      session.lastActiveAt = new Date().toISOString();
    }
  }

  // Spec 14 — moderation: a suspended account may not act on the platform,
  // but must retain the ability to appeal its own restriction.
  const isAppealRoute = request.url.includes('/appeal');
  if (store.suspendedAccounts.has(account.id) && !isAppealRoute) {
    reply.status(403).send({
      error: {
        code: 'ACCOUNT_SUSPENDED',
        message: 'This account is restricted by moderation and cannot perform actions.',
        requestId: request.id,
      },
    });
    return;
  }

  // Determine active workspace: default to personal workspace of account unless specified.
  // Spec 10/12: a requested workspace must be owned by or member-shared with the account —
  // otherwise it is ignored (prevents workspace spoofing via header) when fallback is
  // allowed, or rejected with 403 WORKSPACE_FORBIDDEN in strict mode.
  let activeWorkspace: IdentityWorkspace | undefined;
  if (requestedWorkspaceId) {
    if (accountOwnsOrIsMember(account.id, requestedWorkspaceId)) {
      activeWorkspace = store.workspaces.get(requestedWorkspaceId);
    } else if (!workspaceFallbackAllowed()) {
      reply.status(403).send({
        error: {
          code: 'WORKSPACE_FORBIDDEN',
          message: 'The requested workspace is unknown or not accessible for this account.',
          requestId: request.id,
        },
      });
      return;
    }
  }

  if (!activeWorkspace) {
    // Find personal workspace owned by account
    for (const ws of store.workspaces.values()) {
      if (ws.ownerAccountId === account.id && ws.type === 'personal') {
        activeWorkspace = ws;
        break;
      }
    }
  }

  if (!activeWorkspace) {
    // Fallback to first workspace owned
    for (const ws of store.workspaces.values()) {
      if (ws.ownerAccountId === account.id) {
        activeWorkspace = ws;
        break;
      }
    }
  }

  if (!activeWorkspace) {
    reply.status(401).send({
      error: {
        code: 'WORKSPACE_NOT_FOUND',
        message: 'No valid active workspace associated with session',
        requestId: request.id,
      },
    });
    return;
  }

  // Check membership if active workspace is a business workspace
  let membership: WorkspaceMembership | undefined;
  if (activeWorkspace.type === 'business') {
    for (const m of store.memberships.values()) {
      if (m.workspaceId === activeWorkspace.id && m.accountId === account.id) {
        membership = m;
        break;
      }
    }
    // If owner, grant implicit owner membership if not found
    if (!membership && activeWorkspace.ownerAccountId === account.id) {
      membership = {
        id: `m-owner-${activeWorkspace.id}`,
        workspaceId: activeWorkspace.id,
        accountId: account.id,
        role: 'owner',
        status: 'active',
        joinedAt: activeWorkspace.createdAt,
      };
    }
  }

  request.orbitContext = {
    account,
    activeWorkspace,
    membership,
    adminRole: resolveAdminRoleFromHeader(request),
  };
}

function resolveAdminRoleFromHeader(request: FastifyRequest): AdminRole | undefined {
  const adminRoleHeader = request.headers['x-admin-role'] as string | undefined;
  if (adminRoleHeader) {
    const validRoles: AdminRole[] = ['support', 'trust_safety', 'security_ops', 'billing_support', 'system_admin'];
    if (validRoles.includes(adminRoleHeader as AdminRole)) {
      return adminRoleHeader as AdminRole;
    }
  }
  return undefined;
}

// Short-lived admin tokens (no permanent admin key).
export interface AdminTokenRecord {
  token: string;
  adminUserId: string;
  scope: string;
  expiresAt: string;
  revoked: boolean;
  createdAt: string;
}

const adminTokenStore = new Map<string, AdminTokenRecord>();

export function generateAdminToken(adminUserId: string, scope: string, expiresIn: number = 900): AdminTokenRecord {
  const token = randomUUID();
  const now = Date.now();
  const ttlMs = Math.max(1, Number(expiresIn) || 900) * 1000;
  const record: AdminTokenRecord = {
    token,
    adminUserId,
    scope,
    expiresAt: new Date(now + ttlMs).toISOString(),
    revoked: false,
    createdAt: new Date(now).toISOString(),
  };
  adminTokenStore.set(token, record);
  return record;
}

export function createAdminToken(adminUserId: string, scope: string, expiresIn?: number): AdminTokenRecord {
  return generateAdminToken(adminUserId, scope, expiresIn);
}

export function issueAdminToken(adminUserId: string, scope: string, expiresIn?: number): AdminTokenRecord {
  return generateAdminToken(adminUserId, scope, expiresIn);
}

export function mintAdminToken(adminUserId: string, scope: string, expiresIn?: number): AdminTokenRecord {
  return generateAdminToken(adminUserId, scope, expiresIn);
}

export function verifyAdminToken(token: string): AdminTokenRecord | null {
  const record = adminTokenStore.get(token);
  if (!record) return null;
  if (record.revoked) return null;
  if (new Date(record.expiresAt).getTime() <= Date.now()) return null;
  return record;
}

export function revokeAdminToken(token: string): boolean {
  const record = adminTokenStore.get(token);
  if (!record) return false;
  record.revoked = true;
  adminTokenStore.set(token, record);
  return true;
}
