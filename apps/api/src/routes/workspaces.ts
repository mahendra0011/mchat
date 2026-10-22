import { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify';
import { randomUUID } from 'node:crypto';
import {
  CreateBusinessWorkspaceRequestSchema,
  CreateWorkspaceInvitationRequestSchema,
  AcceptWorkspaceInvitationRequestSchema,
  UpdateMemberRoleRequestSchema,
  WorkspaceMember,
  WorkspaceInvitation,
  BusinessRole,
} from '@orbit/schemas';
import { store } from '../store.js';
import { resolveRequestContext } from '../auth.js';

/** Wave B — effective team role of an account in a workspace (owner is implicit). */
function resolveWorkspaceRole(workspaceId: string, accountId: string): BusinessRole | null {
  const ws = store.workspaces.get(workspaceId);
  if (!ws) return null;
  for (const m of store.memberships.values()) {
    if (m.workspaceId === workspaceId && m.accountId === accountId && m.status === 'active') {
      return m.role;
    }
  }
  if (ws.ownerAccountId === accountId) return 'owner';
  return null;
}

/** Wave B — distinct account ids that hold the owner role in a workspace. */
function ownerAccountIds(workspaceId: string): Set<string> {
  const ws = store.workspaces.get(workspaceId);
  const owners = new Set<string>();
  if (ws?.ownerAccountId) owners.add(ws.ownerAccountId);
  for (const m of store.memberships.values()) {
    if (m.workspaceId === workspaceId && m.status === 'active' && m.role === 'owner') {
      owners.add(m.accountId);
    }
  }
  return owners;
}

function isWorkspaceAdmin(workspaceId: string, accountId: string): boolean {
  const role = resolveWorkspaceRole(workspaceId, accountId);
  return role === 'owner' || role === 'admin';
}

function workspaceMember(accountId: string, role: BusinessRole, joinedAt: string): WorkspaceMember {
  const account = store.accounts.get(accountId);
  return {
    userId: accountId,
    displayName: account?.displayName ?? 'Unknown member',
    email: account?.email ?? null,
    role,
    joinedAt,
  };
}

function encodeConversationCursor(conversation: { lastMessageAt?: string; createdAt: string; id: string }): string {
  return Buffer.from(`${conversation.lastMessageAt || conversation.createdAt}|${conversation.id}`, 'utf8').toString(
    'base64url'
  );
}

export async function workspaceRoutes(fastify: FastifyInstance): Promise<void> {
  // List workspaces available to account
  fastify.get('/v1/workspaces', { preHandler: resolveRequestContext }, async (request, reply) => {
    const ctx = request.orbitContext!;
    const workspaces = Array.from(store.workspaces.values()).filter((ws) => {
      if (ws.ownerAccountId === ctx.account.id) return true;
      // Also check team memberships
      return Array.from(store.memberships.values()).some(
        (m) => m.workspaceId === ws.id && m.accountId === ctx.account.id && m.status === 'active'
      );
    });

    return reply.status(200).send(workspaces);
  });

  // Create new business workspace
  fastify.post('/v1/workspaces/business', { preHandler: resolveRequestContext }, async (request, reply) => {
    const ctx = request.orbitContext!;
    const parsed = CreateBusinessWorkspaceRequestSchema.safeParse(request.body);
    if (!parsed.success) {
      return reply.status(400).send({
        error: {
          code: 'INVALID_WORKSPACE_PAYLOAD',
          message: parsed.error.issues[0]?.message || 'Invalid business workspace parameters',
          requestId: request.id,
        },
      });
    }

    const { displayName, handle, category, bio, website, businessHours, colorCue } = parsed.data;

    // Check unique handle
    const existing = Array.from(store.workspaces.values()).find(
      (w) => w.handle.toLowerCase() === handle.toLowerCase()
    );
    if (existing) {
      return reply.status(409).send({
        error: {
          code: 'WORKSPACE_HANDLE_TAKEN',
          message: `Handle @${handle} is already taken`,
          requestId: request.id,
        },
      });
    }

    const newWorkspace = {
      id: `ws-biz-${Date.now()}`,
      ownerAccountId: ctx.account.id,
      type: 'business' as const,
      displayName,
      handle,
      category,
      bio,
      website,
      businessHours,
      colorCue: colorCue || '#805AD5',
      isVerified: false,
      status: 'active' as const,
      createdAt: new Date().toISOString(),
    };

    store.workspaces.set(newWorkspace.id, newWorkspace);
    await store.persistWorkspace(newWorkspace);

    // Register owner membership
    const membership = {
      id: `m-owner-${newWorkspace.id}`,
      workspaceId: newWorkspace.id,
      accountId: ctx.account.id,
      role: 'owner' as const,
      status: 'active' as const,
      joinedAt: new Date().toISOString(),
    };
    store.memberships.set(membership.id, membership);
    await store.persistMembership(membership);

    store.recordEvent(newWorkspace.id, undefined, 'workspace.created', { workspace: newWorkspace });

    return reply.status(201).send(newWorkspace);
  });

  // List conversations for a specific workspace
  fastify.get<{ Params: { workspaceId: string } }>(
    '/v1/workspaces/:workspaceId/conversations',
    { preHandler: resolveRequestContext },
    async (request, reply) => {
      const { workspaceId } = request.params;
      const ctx = request.orbitContext!;

      // Verify access to workspace
      const targetWorkspace = store.workspaces.get(workspaceId);
      if (!targetWorkspace) {
        return reply.status(404).send({
          error: {
            code: 'WORKSPACE_NOT_FOUND',
            message: 'Target workspace not found',
            requestId: request.id,
          },
        });
      }

      // Authorization check: account must own it or be an active member
      const isOwner = targetWorkspace.ownerAccountId === ctx.account.id;
      const isMember = Array.from(store.memberships.values()).some(
        (m) => m.workspaceId === workspaceId && m.accountId === ctx.account.id && m.status === 'active'
      );

      if (!isOwner && !isMember) {
        return reply.status(403).send({
          error: {
            code: 'WORKSPACE_ACCESS_DENIED',
            message: 'You do not have access to this workspace',
            requestId: request.id,
          },
        });
      }

      // Filter conversations belonging to this workspace or where this workspace is a participant
      const conversations = Array.from(store.conversations.values()).filter((c) => {
        if (c.workspaceId === workspaceId) return true;
        return c.participants.some((p) => p.workspaceId === workspaceId);
      });

      // Sort by recent activity
      conversations.sort((a, b) => {
        const timeA = new Date(a.lastMessageAt || a.createdAt).getTime();
        const timeB = new Date(b.lastMessageAt || b.createdAt).getTime();
        if (timeB !== timeA) return timeB - timeA;
        return a.id < b.id ? 1 : a.id > b.id ? -1 : 0;
      });

      // Wave B — opaque cursor pagination (?cursor=&limit=). Without either
      // parameter the legacy bare-array response is preserved for compat.
      const query = request.query as { cursor?: string; limit?: string };
      if (query.cursor !== undefined || query.limit !== undefined) {
        const limit = Math.min(Math.max(parseInt(query.limit ?? '50', 10) || 50, 1), 100);
        let start = 0;
        if (query.cursor) {
          let decoded: string;
          try {
            decoded = Buffer.from(query.cursor, 'base64url').toString('utf8');
          } catch {
            decoded = '';
          }
          const [cursorTime, cursorId] = decoded.split('|');
          if (!cursorTime || !cursorId) {
            return reply.status(400).send({
              error: { code: 'INVALID_CURSOR', message: 'Malformed pagination cursor', requestId: request.id },
            });
          }
          const idx = conversations.findIndex((c) => c.id === cursorId);
          if (idx === -1) {
            return reply.status(400).send({
              error: { code: 'INVALID_CURSOR', message: 'Cursor does not match this conversation list', requestId: request.id },
            });
          }
          start = idx + 1;
        }
        const page = conversations.slice(start, start + limit);
        const hasMore = start + limit < conversations.length;
        const nextCursor = hasMore && page.length > 0 ? encodeConversationCursor(page[page.length - 1]!) : null;
        return reply.status(200).send({ conversations: page, nextCursor });
      }

      return reply.status(200).send(conversations);
    }
  );

  // Wave B — list workspace members with role projections
  fastify.get<{ Params: { workspaceId: string } }>(
    '/v1/workspaces/:workspaceId/members',
    { preHandler: resolveRequestContext },
    async (request, reply) => {
      const { workspaceId } = request.params;
      const ctx = request.orbitContext!;
      const ws = store.workspaces.get(workspaceId);
      if (!ws) {
        return reply.status(404).send({
          error: { code: 'WORKSPACE_NOT_FOUND', message: 'Workspace not found', requestId: request.id },
        });
      }
      if (!isWorkspaceAdmin(workspaceId, ctx.account.id) && resolveWorkspaceRole(workspaceId, ctx.account.id) === null) {
        return reply.status(403).send({
          error: {
            code: 'WORKSPACE_ACCESS_DENIED',
            message: 'You do not have access to this workspace',
            requestId: request.id,
          },
        });
      }

      const members: WorkspaceMember[] = [];
      const seen = new Set<string>();
      members.push(workspaceMember(ws.ownerAccountId, 'owner', ws.createdAt));
      seen.add(ws.ownerAccountId);
      for (const m of store.memberships.values()) {
        if (m.workspaceId !== workspaceId || m.status !== 'active' || seen.has(m.accountId)) continue;
        seen.add(m.accountId);
        members.push(workspaceMember(m.accountId, m.role, m.joinedAt));
      }
      return reply.status(200).send(members);
    }
  );

  // Wave B — create an invitation (owner/admin only)
  fastify.post<{ Params: { workspaceId: string } }>(
    '/v1/workspaces/:workspaceId/invitations',
    { preHandler: resolveRequestContext },
    async (request, reply) => {
      const { workspaceId } = request.params;
      const ctx = request.orbitContext!;
      const ws = store.workspaces.get(workspaceId);
      if (!ws) {
        return reply.status(404).send({
          error: { code: 'WORKSPACE_NOT_FOUND', message: 'Workspace not found', requestId: request.id },
        });
      }
      if (!isWorkspaceAdmin(workspaceId, ctx.account.id)) {
        return reply.status(403).send({
          error: {
            code: 'WORKSPACE_ACCESS_DENIED',
            message: 'Only workspace owners and admins can invite members',
            requestId: request.id,
          },
        });
      }

      const parsed = CreateWorkspaceInvitationRequestSchema.safeParse(request.body);
      if (!parsed.success) {
        return reply.status(400).send({
          error: {
            code: 'INVALID_INVITATION_PAYLOAD',
            message: parsed.error.issues[0]?.message || 'Invalid invitation payload',
            requestId: request.id,
          },
        });
      }

      const now = new Date().toISOString();
      const invitation: WorkspaceInvitation = {
        id: randomUUID(),
        workspaceId,
        email: parsed.data.email,
        role: parsed.data.role,
        token: randomUUID().replace(/-/g, ''),
        status: 'pending',
        invitedByAccountId: ctx.account.id,
        createdAt: now,
      };

      store.invitations.set(invitation.id, invitation);
      await store.persistWorkspaceInvitation(invitation);
      store.recordEvent(workspaceId, undefined, 'workspace.invitation.created', { invitation });

      return reply.status(201).send(invitation);
    }
  );

  // Wave B — list invitations (owner/admin only)
  fastify.get<{ Params: { workspaceId: string } }>(
    '/v1/workspaces/:workspaceId/invitations',
    { preHandler: resolveRequestContext },
    async (request, reply) => {
      const { workspaceId } = request.params;
      const ctx = request.orbitContext!;
      const ws = store.workspaces.get(workspaceId);
      if (!ws) {
        return reply.status(404).send({
          error: { code: 'WORKSPACE_NOT_FOUND', message: 'Workspace not found', requestId: request.id },
        });
      }
      if (!isWorkspaceAdmin(workspaceId, ctx.account.id)) {
        return reply.status(403).send({
          error: {
            code: 'WORKSPACE_ACCESS_DENIED',
            message: 'Only workspace owners and admins can list invitations',
            requestId: request.id,
          },
        });
      }
      const invitations = Array.from(store.invitations.values()).filter((i) => i.workspaceId === workspaceId);
      return reply.status(200).send(invitations);
    }
  );

  // Wave B — revoke an invitation (owner/admin only)
  fastify.delete<{ Params: { workspaceId: string; invitationId: string } }>(
    '/v1/workspaces/:workspaceId/invitations/:invitationId',
    { preHandler: resolveRequestContext },
    async (request, reply) => {
      const { workspaceId, invitationId } = request.params;
      const ctx = request.orbitContext!;
      const ws = store.workspaces.get(workspaceId);
      if (!ws) {
        return reply.status(404).send({
          error: { code: 'WORKSPACE_NOT_FOUND', message: 'Workspace not found', requestId: request.id },
        });
      }
      if (!isWorkspaceAdmin(workspaceId, ctx.account.id)) {
        return reply.status(403).send({
          error: {
            code: 'WORKSPACE_ACCESS_DENIED',
            message: 'Only workspace owners and admins can revoke invitations',
            requestId: request.id,
          },
        });
      }
      const invitation = store.invitations.get(invitationId);
      if (!invitation || invitation.workspaceId !== workspaceId) {
        return reply.status(404).send({
          error: { code: 'INVITATION_NOT_FOUND', message: 'Invitation not found', requestId: request.id },
        });
      }
      if (invitation.status === 'accepted') {
        return reply.status(409).send({
          error: {
            code: 'INVITATION_ALREADY_ACCEPTED',
            message: 'This invitation has already been accepted',
            requestId: request.id,
          },
        });
      }
      invitation.status = 'revoked';
      await store.persistWorkspaceInvitation(invitation);
      return reply.status(200).send(invitation);
    }
  );

  // Wave B — accept an invitation by token (adds membership with the invited role)
  fastify.post(
    '/v1/workspaces/invitations/accept',
    { preHandler: resolveRequestContext },
    async (request, reply) => {
      const ctx = request.orbitContext!;
      const parsed = AcceptWorkspaceInvitationRequestSchema.safeParse(request.body);
      if (!parsed.success) {
        return reply.status(400).send({
          error: { code: 'INVALID_TOKEN', message: 'A valid invitation token is required', requestId: request.id },
        });
      }

      const invitation = Array.from(store.invitations.values()).find((i) => i.token === parsed.data.token);
      if (!invitation) {
        return reply.status(404).send({
          error: { code: 'INVITATION_NOT_FOUND', message: 'Invitation not found', requestId: request.id },
        });
      }
      if (invitation.status === 'revoked') {
        return reply.status(403).send({
          error: { code: 'INVITATION_REVOKED', message: 'This invitation was revoked', requestId: request.id },
        });
      }
      if (invitation.status === 'accepted') {
        return reply.status(409).send({
          error: {
            code: 'INVITATION_ALREADY_ACCEPTED',
            message: 'This invitation has already been accepted',
            requestId: request.id,
          },
        });
      }

      const existing = Array.from(store.memberships.values()).find(
        (m) => m.workspaceId === invitation.workspaceId && m.accountId === ctx.account.id && m.status === 'active'
      );
      if (existing || store.workspaces.get(invitation.workspaceId)?.ownerAccountId === ctx.account.id) {
        invitation.status = 'accepted';
        invitation.acceptedAt = new Date().toISOString();
        invitation.acceptedAccountId = ctx.account.id;
        await store.persistWorkspaceInvitation(invitation);
        return reply.status(409).send({
          error: { code: 'ALREADY_A_MEMBER', message: 'You are already a member of this workspace', requestId: request.id },
        });
      }

      const membership = {
        id: randomUUID(),
        workspaceId: invitation.workspaceId,
        accountId: ctx.account.id,
        role: invitation.role,
        status: 'active' as const,
        joinedAt: new Date().toISOString(),
      };
      store.memberships.set(membership.id, membership);
      await store.persistMembership(membership);

      invitation.status = 'accepted';
      invitation.acceptedAt = membership.joinedAt;
      invitation.acceptedAccountId = ctx.account.id;
      await store.persistWorkspaceInvitation(invitation);

      store.recordEvent(invitation.workspaceId, undefined, 'workspace.membership_changed', {
        workspaceId: invitation.workspaceId,
        userId: ctx.account.id,
        role: membership.role,
        change: 'added',
        source: 'invitation',
      });

      return reply.status(200).send({ membership, invitation });
    }
  );

  // Wave B — change a member's role (owner/admin only; cannot demote the last owner)
  fastify.patch<{ Params: { workspaceId: string; userId: string } }>(
    '/v1/workspaces/:workspaceId/members/:userId',
    { preHandler: resolveRequestContext },
    async (request, reply) => handleChangeMemberRole(request, reply)
  );

  // Wave B — remove a member (owner/admin only; cannot remove the last owner)
  fastify.delete<{ Params: { workspaceId: string; userId: string } }>(
    '/v1/workspaces/:workspaceId/members/:userId',
    { preHandler: resolveRequestContext },
    async (request, reply) => handleRemoveMember(request, reply, request.params.userId)
  );

  // Wave B — self-leave (same last-owner guard applies)
  fastify.delete<{ Params: { workspaceId: string } }>(
    '/v1/workspaces/:workspaceId/members/me',
    { preHandler: resolveRequestContext },
    async (request, reply) => {
      const ctx = request.orbitContext!;
      return handleRemoveMember(request, reply, ctx.account.id);
    }
  );
}

async function handleChangeMemberRole(
  request: FastifyRequest,
  reply: FastifyReply
): Promise<void> {
  const { workspaceId, userId } = request.params as { workspaceId: string; userId: string };
  const ctx = request.orbitContext!;
  const ws = store.workspaces.get(workspaceId);
  if (!ws) {
    await reply.status(404).send({
      error: { code: 'WORKSPACE_NOT_FOUND', message: 'Workspace not found', requestId: request.id },
    });
    return;
  }
  if (!isWorkspaceAdmin(workspaceId, ctx.account.id)) {
    await reply.status(403).send({
      error: {
        code: 'WORKSPACE_ACCESS_DENIED',
        message: 'Only workspace owners and admins can change member roles',
        requestId: request.id,
      },
    });
    return;
  }

  const parsed = UpdateMemberRoleRequestSchema.safeParse(request.body);
  if (!parsed.success) {
    await reply.status(400).send({
      error: { code: 'INVALID_ROLE', message: 'role must be owner, admin, agent or analyst', requestId: request.id },
    });
    return;
  }

  const membership = Array.from(store.memberships.values()).find(
    (m) => m.workspaceId === workspaceId && m.accountId === userId && m.status === 'active'
  );
  const isImplicitOwner = !membership && ws.ownerAccountId === userId;
  if (!membership && !isImplicitOwner) {
    await reply.status(404).send({
      error: { code: 'MEMBER_NOT_FOUND', message: 'Member not found in this workspace', requestId: request.id },
    });
    return;
  }

  const currentRole: BusinessRole = membership ? membership.role : 'owner';
  // Wave B guard: the last owner can never be demoted.
  if (currentRole === 'owner' && parsed.data.role !== 'owner' && ownerAccountIds(workspaceId).size <= 1) {
    await reply.status(403).send({
      error: {
        code: 'LAST_OWNER',
        message: 'The last owner of a workspace cannot be demoted. Promote another member to owner first.',
        requestId: request.id,
      },
    });
    return;
  }

  if (membership) {
    membership.role = parsed.data.role;
    await store.persistMembership(membership);
  } else {
    // Promote the implicit (primary) owner into an explicit membership record.
    const created = {
      id: randomUUID(),
      workspaceId,
      accountId: userId,
      role: parsed.data.role,
      status: 'active' as const,
      joinedAt: ws.createdAt,
    };
    store.memberships.set(created.id, created);
    await store.persistMembership(created);
  }

  store.recordEvent(workspaceId, undefined, 'workspace.membership_changed', {
    workspaceId,
    userId,
    role: parsed.data.role,
    previousRole: currentRole,
    change: 'role_changed',
    changedBy: ctx.account.id,
  });

  await reply.status(200).send({ workspaceId, userId, role: parsed.data.role, previousRole: currentRole });
}

async function handleRemoveMember(
  request: FastifyRequest,
  reply: FastifyReply,
  userId: string
): Promise<void> {
  const { workspaceId } = request.params as { workspaceId: string };
  const ctx = request.orbitContext!;
  const ws = store.workspaces.get(workspaceId);
  if (!ws) {
    await reply.status(404).send({
      error: { code: 'WORKSPACE_NOT_FOUND', message: 'Workspace not found', requestId: request.id },
    });
    return;
  }

  const isSelf = userId === ctx.account.id;
  if (!isSelf && !isWorkspaceAdmin(workspaceId, ctx.account.id)) {
    await reply.status(403).send({
      error: {
        code: 'WORKSPACE_ACCESS_DENIED',
        message: 'Only workspace owners and admins can remove members',
        requestId: request.id,
      },
    });
    return;
  }

  const membership = Array.from(store.memberships.values()).find(
    (m) => m.workspaceId === workspaceId && m.accountId === userId && m.status === 'active'
  );
  const isImplicitOwner = !membership && ws.ownerAccountId === userId;
  if (!membership && !isImplicitOwner) {
    await reply.status(404).send({
      error: { code: 'MEMBER_NOT_FOUND', message: 'Member not found in this workspace', requestId: request.id },
    });
    return;
  }

  const currentRole: BusinessRole = membership ? membership.role : 'owner';
  // Wave B guard: the last owner can never be removed or leave.
  if (currentRole === 'owner' && ownerAccountIds(workspaceId).size <= 1) {
    await reply.status(403).send({
      error: {
        code: 'LAST_OWNER',
        message: 'The last owner of a workspace cannot be removed. Promote another member to owner first.',
        requestId: request.id,
      },
    });
    return;
  }

  if (membership) {
    membership.status = 'revoked';
    store.memberships.delete(membership.id);
    await store.sql('DELETE FROM workspace_memberships WHERE id = $1', [membership.id]).catch(() => undefined);
  }

  store.recordEvent(workspaceId, undefined, 'workspace.membership_changed', {
    workspaceId,
    userId,
    role: currentRole,
    change: isSelf ? 'left' : 'removed',
    changedBy: ctx.account.id,
  });

  await reply.status(200).send({ success: true, workspaceId, userId });
}
