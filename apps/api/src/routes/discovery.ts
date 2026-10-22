import { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify';
import {
  ContactRequest,
  InviteLink,
  ContactDiscoverySearchQuerySchema,
  ContactRequestStatusSchema,
} from '@orbit/schemas';
import {
  sanitizeSearchHandle,
  validateHandleFormat,
  canTransitionContactRequest,
} from '@orbit/domain';
import { rateLimit } from '../rate-limit.js';
import type { BusinessRole } from '@orbit/schemas';

const contactRequestRateLimiter = rateLimit({ limit: 30, windowMs: 60_000, keyPrefix: 'contact-request' });
const inviteRateLimiter = rateLimit({ limit: 30, windowMs: 60_000, keyPrefix: 'invite' });
// Anti-enumeration (Spec 14): bound handle-lookup throughput.
const discoverySearchRateLimiter = rateLimit({ limit: 30, windowMs: 60_000, keyPrefix: 'discovery-search' });
import { resolveRequestContext } from '../auth.js';
import { store } from '../store.js';
import type { GroupJoinRequest } from '../store.js';

/** Every workspace an account owns or actively shares — used for contact↔workspace resolution. */
function accessibleWorkspaceIds(accountId: string): Set<string> {
  const ids = new Set<string>();
  for (const ws of store.workspaces.values()) {
    if (ws.ownerAccountId === accountId) ids.add(ws.id);
  }
  for (const m of store.memberships.values()) {
    if (m.accountId === accountId && m.status === 'active') ids.add(m.workspaceId);
  }
  return ids;
}

/** The caller's team role inside a shared workspace (membership wins, else ownership). */
function callerRoleInWorkspace(workspaceId: string, accountId: string): BusinessRole | null {
  const membership = Array.from(store.memberships.values()).find(
    (m) => m.workspaceId === workspaceId && m.accountId === accountId && m.status === 'active'
  );
  if (membership) return membership.role;
  if (store.workspaces.get(workspaceId)?.ownerAccountId === accountId) return 'owner';
  return null;
}

export async function discoveryRoutes(app: FastifyInstance): Promise<void> {
  // Search users/workspaces by handle with anti-enumeration protection
  app.post(
    '/v1/contacts/search',
    { preHandler: [resolveRequestContext, discoverySearchRateLimiter] },
    async (req: FastifyRequest, reply: FastifyReply) => {
      const parseRes = ContactDiscoverySearchQuerySchema.safeParse(req.body);
      if (!parseRes.success) {
        return reply.status(400).send({
          error: { code: 'INVALID_SEARCH_QUERY', message: 'Invalid handle search query' },
        });
      }

      const normalized = sanitizeSearchHandle(parseRes.data.handle);
      const formatCheck = validateHandleFormat(normalized);
      if (!formatCheck.valid) {
        // Return uniform negative response to protect against enumeration
        return reply.send({
          data: {
            found: false,
            handle: normalized,
            matchedViaContactBook: false,
            workspaceIds: [],
            sharedWorkspaceIds: [],
            sharedWorkspaceId: null,
            role: null,
          },
        });
      }

      // Look up workspace by handle
      let matchedWorkspace = undefined;
      for (const ws of store.workspaces.values()) {
        if (ws.handle.toLowerCase() === normalized) {
          matchedWorkspace = ws;
          break;
        }
      }

      if (!matchedWorkspace) {
        return reply.send({
          data: {
            found: false,
            handle: normalized,
            matchedViaContactBook: false,
            workspaceIds: [],
            sharedWorkspaceIds: [],
            sharedWorkspaceId: null,
            role: null,
          },
        });
      }

      // Workspace resolution: the frontend needs an id it can hand to
      // POST /v1/conversations as `participantWorkspaceIds`, plus the workspace
      // (and role) both parties share — computed from fixture memberships.
      const ctx = req.orbitContext!;
      const callerWorkspaceIds = accessibleWorkspaceIds(ctx.account.id);
      const contactWorkspaceIds = accessibleWorkspaceIds(matchedWorkspace.ownerAccountId);
      const sharedWorkspaceIds = Array.from(callerWorkspaceIds)
        .filter((id) => contactWorkspaceIds.has(id))
        .sort();
      const sharedWorkspaceId = sharedWorkspaceIds[0] ?? null;

      return reply.send({
        data: {
          found: true,
          handle: matchedWorkspace.handle,
          displayName: matchedWorkspace.displayName,
          avatarUrl: matchedWorkspace.avatarUrl,
          bio: matchedWorkspace.bio || 'Verified Orbit User',
          matchedViaContactBook: false,
          workspaceId: matchedWorkspace.id,
          workspaceIds: [matchedWorkspace.id],
          sharedWorkspaceIds,
          sharedWorkspaceId,
          role: sharedWorkspaceId ? callerRoleInWorkspace(sharedWorkspaceId, ctx.account.id) : null,
        },
      });
    }
  );

  // Get contact requests for current user/workspace
  app.get(
    '/v1/contacts/requests',
    { preHandler: [resolveRequestContext] },
    async (req: FastifyRequest, reply: FastifyReply) => {
      const ctx = req.orbitContext!;
      const requests = Array.from(store.contactRequests.values()).filter(
        (cr) => cr.recipientId === ctx.account.id || cr.requesterId === ctx.account.id
      );

      return reply.send({
        data: requests,
      });
    }
  );

  // Send contact request
  app.post(
    '/v1/contacts/requests',
    { preHandler: [resolveRequestContext, contactRequestRateLimiter] },
    async (req: FastifyRequest, reply: FastifyReply) => {
      const ctx = req.orbitContext!;
      const body = req.body as { recipientHandle: string; introMessage?: string };

      if (!body.recipientHandle) {
        return reply.status(400).send({
          error: { code: 'MISSING_RECIPIENT', message: 'Recipient handle is required.' },
        });
      }

      const normalized = sanitizeSearchHandle(body.recipientHandle);
      let targetWorkspace = undefined;
      for (const ws of store.workspaces.values()) {
        if (ws.handle.toLowerCase() === normalized) {
          targetWorkspace = ws;
          break;
        }
      }

      if (!targetWorkspace) {
        return reply.status(404).send({
          error: { code: 'USER_NOT_FOUND', message: 'Requested user does not exist.' },
        });
      }

      // Block enforcement (Spec 14): a blocked party cannot file a contact request.
      if (store.isBlockedEitherWay(ctx.activeWorkspace.id, targetWorkspace.id)) {
        return reply.status(403).send({
          error: { code: 'BLOCKED', message: 'You cannot send a contact request to this user.' },
        });
      }

      const newRequest: ContactRequest = {
        id: `cr_${Date.now()}`,
        requesterId: ctx.account.id,
        requesterHandle: ctx.activeWorkspace.handle,
        requesterDisplayName: ctx.activeWorkspace.displayName,
        recipientId: targetWorkspace.ownerAccountId,
        recipientHandle: targetWorkspace.handle,
        status: 'pending',
        introMessage: body.introMessage,
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
      };

      store.contactRequests.set(newRequest.id, newRequest);
      await store.persistContactRequest(newRequest);
      return reply.status(201).send({ data: newRequest });
    }
  );

  // Respond to contact request (accept, ignore, block)
  app.post(
    '/v1/contacts/requests/:id/respond',
    { preHandler: [resolveRequestContext] },
    async (req: FastifyRequest, reply: FastifyReply) => {
      const { id } = req.params as { id: string };
      const body = req.body as { action: string };
      const request = store.contactRequests.get(id);

      if (!request) {
        return reply.status(404).send({
          error: { code: 'NOT_FOUND', message: 'Contact request not found.' },
        });
      }

      const statusParsed = ContactRequestStatusSchema.safeParse(body.action);
      if (!statusParsed.success) {
        return reply.status(400).send({
          error: { code: 'INVALID_STATUS', message: 'Action must be accepted, ignored, or blocked.' },
        });
      }

      if (!canTransitionContactRequest(request.status, statusParsed.data)) {
        return reply.status(400).send({
          error: {
            code: 'ILLEGAL_TRANSITION',
            message: `Cannot transition contact request from ${request.status} to ${statusParsed.data}`,
          },
        });
      }

      request.status = statusParsed.data;
      request.updatedAt = new Date().toISOString();
      store.contactRequests.set(request.id, request);
      await store.persistContactRequest(request);

      return reply.send({ data: request });
    }
  );

  // Create revocable invite link (account-level, or group-level with conversationId)
  app.post(
    '/v1/invites',
    { preHandler: [resolveRequestContext, inviteRateLimiter] },
    async (req: FastifyRequest, reply: FastifyReply) => {
      const ctx = req.orbitContext!;
      const body = (req.body as { maxUses?: number; conversationId?: string }) || {};

      // Spec 14 — group invites must target a group the caller belongs to.
      if (body.conversationId) {
        const conversation = store.conversations.get(body.conversationId);
        if (!conversation || conversation.kind !== 'group') {
          return reply.status(404).send({
            error: { code: 'NOT_A_GROUP', message: 'Group conversation not found', requestId: req.id },
          });
        }
        const caller = conversation.participants.find((p) => p.workspaceId === ctx.activeWorkspace.id);
        if (!caller) {
          return reply.status(403).send({
            error: { code: 'ACCESS_DENIED', message: 'Only group members can create invite links', requestId: req.id },
          });
        }
      }

      const code = `orbit-inv-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 7)}`;
      const invite: InviteLink = {
        id: `inv_${Date.now()}`,
        workspaceId: ctx.activeWorkspace.id,
        creatorId: ctx.account.id,
        code,
        url: `https://chat.orbit.local/invite/${code}`,
        maxUses: body.maxUses || 5,
        usedCount: 0,
        expiresAt: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000).toISOString(),
        revoked: false,
        createdAt: new Date().toISOString(),
        conversationId: body.conversationId,
      };

      store.inviteLinks.set(invite.id, invite);
      await store.persistInviteLink(invite);
      return reply.status(201).send({ data: invite });
    }
  );

  // Redeem an invite link — consumes a use, then either joins the group
  // (creating a pending request when membership approval is required) or
  // establishes an accepted contact for account-level invites (Spec 14).
  app.post(
    '/v1/invites/:code/redeem',
    { preHandler: [resolveRequestContext] },
    async (req: FastifyRequest, reply: FastifyReply) => {
      const { code } = req.params as { code: string };
      const ctx = req.orbitContext!;

      const invite = Array.from(store.inviteLinks.values()).find((i) => i.code === code);
      if (!invite) {
        return reply.status(404).send({
          error: { code: 'INVITE_NOT_FOUND', message: 'Invite not found', requestId: req.id },
        });
      }
      if (invite.revoked) {
        return reply.status(410).send({
          error: { code: 'INVITE_REVOKED', message: 'This invite has been revoked', requestId: req.id },
        });
      }
      if (new Date(invite.expiresAt).getTime() < Date.now()) {
        return reply.status(410).send({
          error: { code: 'INVITE_EXPIRED', message: 'This invite has expired', requestId: req.id },
        });
      }
      if (invite.usedCount >= invite.maxUses) {
        return reply.status(410).send({
          error: { code: 'INVITE_EXHAUSTED', message: 'This invite has reached its maximum uses', requestId: req.id },
        });
      }

      // Group invite — join (or request to join) the conversation.
      if (invite.conversationId) {
        const conversation = store.conversations.get(invite.conversationId);
        if (!conversation || conversation.kind !== 'group') {
          return reply.status(404).send({
            error: { code: 'NOT_A_GROUP', message: 'Group conversation not found', requestId: req.id },
          });
        }
        if (conversation.participants.some((p) => p.workspaceId === ctx.activeWorkspace.id)) {
          return reply.status(409).send({
            error: { code: 'ALREADY_MEMBER', message: 'You are already a member of this group', requestId: req.id },
          });
        }
        // Safety (Spec 14): blocks and the redeemer's groupInvitePermission apply.
        if (store.isBlockedEitherWay(invite.workspaceId, ctx.activeWorkspace.id)) {
          return reply.status(403).send({
            error: { code: 'BLOCKED', message: 'Cannot join a group where a block exists', requestId: req.id },
          });
        }
        const inviteSettings = store.workspaceSettings.get(ctx.activeWorkspace.id);
        const invitePerm = (inviteSettings?.privacy as { groupInvitePermission?: string } | undefined)?.groupInvitePermission ?? 'contacts';
        if (invitePerm === 'nobody') {
          return reply.status(403).send({
            error: { code: 'INVITE_NOT_ALLOWED', message: 'You do not allow group invites', requestId: req.id },
          });
        }
        if (invitePerm === 'contacts' && !store.hasAcceptedContact(invite.workspaceId, ctx.activeWorkspace.id)) {
          return reply.status(403).send({
            error: { code: 'INVITE_CONTACTS_ONLY', message: 'You only accept group invites from contacts', requestId: req.id },
          });
        }

        // Spec 14 — membership approval optional: when required, create a pending request.
        if (conversation.membershipApprovalRequired) {
          const request: GroupJoinRequest = {
            id: `gjr_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`,
            conversationId: conversation.id,
            requesterWorkspaceId: ctx.activeWorkspace.id,
            inviteId: invite.id,
            status: 'pending',
            createdAt: new Date().toISOString(),
          };
          store.groupJoinRequests.set(request.id, request);
          await store.persistGroupJoinRequest(request);
          invite.usedCount += 1;
          await store.persistInviteLink(invite);
          return reply.status(202).send({
            data: { joinRequestId: request.id, status: 'pending', approvalRequired: true },
          });
        }

        // No approval required — join directly, with a clear history-visibility statement.
        const workspace = store.workspaces.get(ctx.activeWorkspace.id)!;
        const member = {
          workspaceId: ctx.activeWorkspace.id,
          displayName: workspace.displayName,
          handle: workspace.handle,
          role: 'member' as const,
          joinedAt: new Date().toISOString(),
          isOnline: true,
        };
        conversation.participants.push(member);
        if (store.db) {
          await store.sql(
            `INSERT INTO conversation_participants (conversation_id, workspace_id, display_name, handle, role, joined_at)
             VALUES ($1,$2,$3,$4,$5,$6)
             ON CONFLICT (conversation_id, workspace_id) DO NOTHING`,
            [conversation.id, member.workspaceId, member.displayName, member.handle, member.role, member.joinedAt]
          );
        }
        store.recordEvent(invite.workspaceId, conversation.id, 'conversation.member_added', {
          workspaceId: ctx.activeWorkspace.id,
          historyVisibility: 'members_see_messages_from_join',
        });
        invite.usedCount += 1;
        await store.persistInviteLink(invite);
        return reply.status(201).send({
          data: {
            conversationId: conversation.id,
            historyVisibility: 'members_see_messages_from_join',
            historyVisibilityStatement:
              'You will see messages shared from the point you join; earlier history is not shown to you by default.',
          },
        });
      }

      // Account-level invite — establish an accepted contact relationship.
      if (invite.creatorId === ctx.account.id) {
        return reply.status(400).send({
          error: { code: 'CANNOT_REDEEM_OWN', message: 'You cannot redeem your own invite', requestId: req.id },
        });
      }
      if (store.isBlockedEitherWay(invite.creatorId, ctx.account.id)) {
        return reply.status(403).send({
          error: { code: 'BLOCKED', message: 'Cannot connect via invite when a block exists', requestId: req.id },
        });
      }
      // Record an accepted contact so the two parties can message each other.
      const alreadyConnected = store.hasAcceptedContact(invite.workspaceId, ctx.activeWorkspace.id);
      if (!alreadyConnected) {
        const creatorWorkspace = store.workspaces.get(invite.workspaceId);
        const redeemerWorkspace = store.workspaces.get(ctx.activeWorkspace.id);
        const cr: ContactRequest = {
          id: `cr_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`,
          requesterId: invite.creatorId,
          requesterHandle: creatorWorkspace?.handle ?? 'member',
          requesterDisplayName: creatorWorkspace?.displayName ?? 'Member',
          recipientId: ctx.account.id,
          recipientHandle: redeemerWorkspace?.handle ?? 'member',
          status: 'accepted',
          createdAt: new Date().toISOString(),
          updatedAt: new Date().toISOString(),
        };
        store.contactRequests.set(cr.id, cr);
        await store.persistContactRequest(cr);
      }
      invite.usedCount += 1;
      await store.persistInviteLink(invite);
      return reply.status(201).send({
        data: { connectedWithWorkspaceId: invite.workspaceId, status: 'accepted' },
      });
    }
  );

  // Revoke invite link
  app.post(
    '/v1/invites/:id/revoke',
    { preHandler: [resolveRequestContext] },
    async (req: FastifyRequest, reply: FastifyReply) => {
      const { id } = req.params as { id: string };
      const invite = store.inviteLinks.get(id);

      if (!invite) {
        return reply.status(404).send({
          error: { code: 'NOT_FOUND', message: 'Invite link not found.' },
        });
      }

      invite.revoked = true;
      store.inviteLinks.set(invite.id, invite);
      await store.persistInviteLink(invite);
      return reply.send({ data: invite });
    }
  );

  // List pending join requests for a group (admin only).
  app.get(
    '/v1/conversations/:conversationId/join-requests',
    { preHandler: [resolveRequestContext] },
    async (req: FastifyRequest, reply: FastifyReply) => {
      const { conversationId } = req.params as { conversationId: string };
      const ctx = req.orbitContext!;
      const conversation = store.conversations.get(conversationId);
      if (!conversation || conversation.kind !== 'group') {
        return reply.status(404).send({
          error: { code: 'NOT_A_GROUP', message: 'Group conversation not found', requestId: req.id },
        });
      }
      const caller = conversation.participants.find((p) => p.workspaceId === ctx.activeWorkspace.id);
      if (!caller || caller.role !== 'admin') {
        return reply.status(403).send({
          error: { code: 'FORBIDDEN', message: 'Only admins can view join requests', requestId: req.id },
        });
      }
      const requests = Array.from(store.groupJoinRequests.values()).filter(
        (r) => r.conversationId === conversationId
      );
      return reply.send({ data: requests });
    }
  );

  // Approve or decline a pending group join request (admin only).
  app.post(
    '/v1/conversations/:conversationId/join-requests/:requestId/:decision',
    { preHandler: [resolveRequestContext] },
    async (req: FastifyRequest, reply: FastifyReply) => {
      const { conversationId, requestId, decision } = req.params as {
        conversationId: string;
        requestId: string;
        decision: string;
      };
      const ctx = req.orbitContext!;
      if (decision !== 'approve' && decision !== 'decline') {
        return reply.status(400).send({
          error: { code: 'INVALID_DECISION', message: 'decision must be approve or decline', requestId: req.id },
        });
      }
      const conversation = store.conversations.get(conversationId);
      if (!conversation || conversation.kind !== 'group') {
        return reply.status(404).send({
          error: { code: 'NOT_A_GROUP', message: 'Group conversation not found', requestId: req.id },
        });
      }
      const caller = conversation.participants.find((p) => p.workspaceId === ctx.activeWorkspace.id);
      if (!caller || caller.role !== 'admin') {
        return reply.status(403).send({
          error: { code: 'FORBIDDEN', message: 'Only admins can decide join requests', requestId: req.id },
        });
      }
      const joinRequest = store.groupJoinRequests.get(requestId);
      if (!joinRequest || joinRequest.conversationId !== conversationId) {
        return reply.status(404).send({
          error: { code: 'REQUEST_NOT_FOUND', message: 'Join request not found', requestId: req.id },
        });
      }
      if (joinRequest.status !== 'pending') {
        return reply.status(409).send({
          error: { code: 'ALREADY_DECIDED', message: 'This request has already been decided', requestId: req.id },
        });
      }

      joinRequest.status = decision === 'approve' ? 'approved' : 'declined';
      joinRequest.decidedAt = new Date().toISOString();
      joinRequest.decidedByWorkspaceId = ctx.activeWorkspace.id;
      store.groupJoinRequests.set(joinRequest.id, joinRequest);
      await store.persistGroupJoinRequest(joinRequest);

      if (decision === 'approve') {
        const workspace = store.workspaces.get(joinRequest.requesterWorkspaceId);
        if (workspace && !conversation.participants.some((p) => p.workspaceId === workspace.id)) {
          const member = {
            workspaceId: workspace.id,
            displayName: workspace.displayName,
            handle: workspace.handle,
            role: 'member' as const,
            joinedAt: new Date().toISOString(),
            isOnline: true,
          };
          conversation.participants.push(member);
          if (store.db) {
            await store.sql(
              `INSERT INTO conversation_participants (conversation_id, workspace_id, display_name, handle, role, joined_at)
               VALUES ($1,$2,$3,$4,$5,$6)
               ON CONFLICT (conversation_id, workspace_id) DO NOTHING`,
              [conversation.id, member.workspaceId, member.displayName, member.handle, member.role, member.joinedAt]
            );
          }
          store.recordEvent(ctx.activeWorkspace.id, conversation.id, 'conversation.member_added', {
            workspaceId: workspace.id,
            historyVisibility: 'members_see_messages_from_join',
          });
        }
      }

      return reply.send({
        data: {
          ...joinRequest,
          historyVisibility: 'members_see_messages_from_join',
          historyVisibilityStatement:
            'Approved members see messages shared from the point they join; earlier history is not shown to them by default.',
        },
      });
    }
  );
}
