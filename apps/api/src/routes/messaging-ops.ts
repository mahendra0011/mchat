import { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify';
import { randomUUID } from 'node:crypto';
import { store } from '../store.js';
import type { BlockEntry, ScheduledMessage } from '../store.js';
import { resolveRequestContext } from '../auth.js';
import { rateLimit } from '../rate-limit.js';
import { fetchLinkPreview } from '../link-preview.js';
import { ScheduleMessageRequestSchema } from '@orbit/schemas';
import type { MessageEnvelope } from '@orbit/schemas';
import { hasCapability } from './conversations.js';

const linkPreviewRateLimiter = rateLimit({ limit: 30, windowMs: 60_000, keyPrefix: 'link-preview' });

/**
 * Messaging organization & safety operations (Spec 02 P0):
 * - Forwarding with attribution
 * - Pin/unpin messages & conversations
 * - Folders (chat organization)
 * - Mentions
 * - Mute/archive/block/leave-group
 * - Group roles & permissions
 */

export interface ForwardedMessage {
  originalMessageId: string;
  originalSenderName: string;
  originalConversationId: string;
  forwardedByWorkspaceId: string;
  forwardedAt: string;
}

export interface ChatFolder {
  id: string;
  workspaceId: string;
  name: string;
  color: string;
  conversationIds: string[];
  createdAt: string;
}

const folders = new Map<string, ChatFolder>();

export async function messagingOpsRoutes(fastify: FastifyInstance): Promise<void> {
  // ---- Forward message with attribution ----
  fastify.post<{ Params: { messageId: string }; Body: { targetConversationId: string; note?: string } }>(
    '/v1/messages/:messageId/forward',
    { preHandler: resolveRequestContext },
    async (request, reply) => {
      const { messageId } = request.params;
      const ctx = request.orbitContext!;
      const { targetConversationId, note } = (request.body ?? {}) as {
        targetConversationId?: string;
        note?: string;
      };

      if (!targetConversationId) {
        return reply.status(400).send({
          error: { code: 'MISSING_TARGET', message: 'targetConversationId is required', requestId: request.id },
        });
      }

      const original = store.messages.get(messageId);
      if (!original || original.isDeleted) {
        return reply.status(404).send({
          error: { code: 'MESSAGE_NOT_FOUND', message: 'Message not found', requestId: request.id },
        });
      }

      const target = store.conversations.get(targetConversationId);
      if (!target) {
        return reply.status(404).send({
          error: { code: 'CONVERSATION_NOT_FOUND', message: 'Target conversation not found', requestId: request.id },
        });
      }

      const isParticipant =
        target.workspaceId === ctx.activeWorkspace.id ||
        target.participants.some((p) => p.workspaceId === ctx.activeWorkspace.id);
      if (!isParticipant) {
        return reply.status(403).send({
          error: { code: 'ACCESS_DENIED', message: 'Not a member of target conversation', requestId: request.id },
        });
      }

      // Wave B (Spec 07/32): forwarding posts a new message — send capability required.
      if (!hasCapability(ctx, 'conversations.send')) {
        return reply.status(403).send({
          error: {
            code: 'CAPABILITY_DENIED',
            message: "Your workspace role does not include the 'conversations.send' capability.",
            requestId: request.id,
          },
        });
      }

      // Block enforcement (Spec 14): cannot forward into a direct conversation
      // with a participant who has blocked the forwarder (or vice versa).
      if (target.kind === 'direct') {
        const others = target.participants.filter((p) => p.workspaceId !== ctx.activeWorkspace.id);
        for (const other of others) {
          if (store.isBlockedEitherWay(ctx.activeWorkspace.id, other.workspaceId)) {
            return reply.status(403).send({
              error: { code: 'BLOCKED', message: 'You cannot forward into this conversation due to a block.', requestId: request.id },
            });
          }
        }
      }

      const forwarded: ForwardedMessage = {
        originalMessageId: original.id,
        originalSenderName: original.senderName,
        originalConversationId: original.conversationId,
        forwardedByWorkspaceId: ctx.activeWorkspace.id,
        forwardedAt: new Date().toISOString(),
      };

      const newMessage: MessageEnvelope = {
        id: randomUUID(),
        conversationId: targetConversationId,
        senderWorkspaceId: ctx.activeWorkspace.id,
        senderName: ctx.activeWorkspace.displayName,
        idempotencyKey: `fwd_${original.id}_${Date.now()}`,
        clientMessageId: `fwd_${original.id}`,
        contentType: original.contentType,
        body: note ? `${note}\n\n> ${original.body}` : original.body,
        attachments: original.attachments,
        deliveryState: 'sent',
        reactions: [],
        isEdited: false,
        isDeleted: false,
        isEncrypted: original.isEncrypted,
        serverSequence: store.nextServerSequence(targetConversationId),
        createdAt: new Date().toISOString(),
      };

      // Store forward attribution in the message body metadata via recordEvent
      store.messages.set(newMessage.id, newMessage);
      await store.commitOutboundMessage(newMessage, target, {
        eventId: `evt_fwd_${Date.now()}`,
        type: 'message.forwarded',
        payload: { messageId: newMessage.id, forwarded },
      });

      return reply.status(201).send({ data: newMessage, forwarded });
    }
  );

  // ---- Pin / unpin a message ----
  fastify.post<{ Params: { messageId: string } }>(
    '/v1/messages/:messageId/pin',
    { preHandler: resolveRequestContext },
    async (request, reply) => {
      const { messageId } = request.params;
      const message = store.messages.get(messageId);
      if (!message) {
        return reply.status(404).send({
          error: { code: 'MESSAGE_NOT_FOUND', message: 'Message not found', requestId: request.id },
        });
      }
      // Store pinned state via events (no dedicated column; pins list lives in conversation metadata)
      store.recordEvent(request.orbitContext!.activeWorkspace.id, message.conversationId, 'message.pinned', {
        messageId,
        pinnedBy: request.orbitContext!.activeWorkspace.id,
      });
      return reply.send({ success: true, messageId, pinned: true });
    }
  );

  // ---- Pin / unpin a conversation ----
  fastify.post<{ Params: { conversationId: string } }>(
    '/v1/conversations/:conversationId/pin',
    { preHandler: resolveRequestContext },
    async (request, reply) => {
      const { conversationId } = request.params;
      const conversation = store.conversations.get(conversationId);
      if (!conversation) {
        return reply.status(404).send({
          error: { code: 'CONVERSATION_NOT_FOUND', message: 'Conversation not found', requestId: request.id },
        });
      }
      conversation.isPinned = !conversation.isPinned;
      if (store.db) {
        await store.sql('UPDATE conversations SET is_pinned = $2 WHERE id = $1', [
          conversationId,
          conversation.isPinned,
        ]);
      }
      store.recordEvent(request.orbitContext!.activeWorkspace.id, conversationId, 'conversation.updated', {
        conversationId,
        changes: { isPinned: conversation.isPinned },
      });
      return reply.send({ success: true, conversationId, isPinned: conversation.isPinned });
    }
  );

  // ---- Mute / unmute a conversation ----
  fastify.post<{ Params: { conversationId: string } }>(
    '/v1/conversations/:conversationId/mute',
    { preHandler: resolveRequestContext },
    async (request, reply) => {
      const { conversationId } = request.params;
      const conversation = store.conversations.get(conversationId);
      if (!conversation) {
        return reply.status(404).send({
          error: { code: 'CONVERSATION_NOT_FOUND', message: 'Conversation not found', requestId: request.id },
        });
      }
      conversation.isMuted = !conversation.isMuted;
      if (store.db) {
        await store.sql('UPDATE conversations SET is_muted = $2 WHERE id = $1', [
          conversationId,
          conversation.isMuted,
        ]);
      }
      store.recordEvent(request.orbitContext!.activeWorkspace.id, conversationId, 'conversation.updated', {
        conversationId,
        changes: { isMuted: conversation.isMuted },
      });
      return reply.send({ success: true, conversationId, isMuted: conversation.isMuted });
    }
  );

  // ---- Archive / unarchive a conversation ----
  fastify.post<{ Params: { conversationId: string } }>(
    '/v1/conversations/:conversationId/archive',
    { preHandler: resolveRequestContext },
    async (request, reply) => {
      const { conversationId } = request.params;
      const conversation = store.conversations.get(conversationId);
      if (!conversation) {
        return reply.status(404).send({
          error: { code: 'CONVERSATION_NOT_FOUND', message: 'Conversation not found', requestId: request.id },
        });
      }
      conversation.isArchived = !conversation.isArchived;
      if (store.db) {
        await store.sql('UPDATE conversations SET is_archived = $2 WHERE id = $1', [
          conversationId,
          conversation.isArchived,
        ]);
      }
      store.recordEvent(request.orbitContext!.activeWorkspace.id, conversationId, 'conversation.updated', {
        conversationId,
        changes: { isArchived: conversation.isArchived },
      });
      return reply.send({ success: true, conversationId, isArchived: conversation.isArchived });
    }
  );

  // ---- Leave / exit a conversation ----
  // Groups: the member leaves. Direct/business: the customer exits on their side.
  fastify.post<{ Params: { conversationId: string } }>(
    '/v1/conversations/:conversationId/leave',
    { preHandler: resolveRequestContext },
    async (request, reply) => {
      const { conversationId } = request.params;
      const ctx = request.orbitContext!;
      const conversation = store.conversations.get(conversationId);
      if (!conversation) {
        return reply.status(404).send({
          error: { code: 'CONVERSATION_NOT_FOUND', message: 'Conversation not found', requestId: request.id },
        });
      }
      const isParticipant =
        conversation.workspaceId === ctx.activeWorkspace.id ||
        conversation.participants.some((p) => p.workspaceId === ctx.activeWorkspace.id);
      if (!isParticipant) {
        return reply.status(403).send({
          error: { code: 'ACCESS_DENIED', message: 'You are not a participant of this conversation', requestId: request.id },
        });
      }
      conversation.participants = conversation.participants.filter(
        (p) => p.workspaceId !== ctx.activeWorkspace.id
      );
      if (store.db) {
        await store.sql(
          'DELETE FROM conversation_participants WHERE conversation_id = $1 AND workspace_id = $2',
          [conversationId, ctx.activeWorkspace.id]
        );
      }
      store.recordEvent(ctx.activeWorkspace.id, conversationId, 'conversation.member_left', {
        workspaceId: ctx.activeWorkspace.id,
        kind: conversation.kind,
      });
      return reply.send({ success: true, conversationId });
    }
  );

  // ---- Block / unblock a workspace ----
  fastify.post<{ Params: { workspaceId: string } }>(
    '/v1/blocks/:workspaceId',
    { preHandler: resolveRequestContext },
    async (request, reply) => {
      const { workspaceId } = request.params;
      const ctx = request.orbitContext!;
      const key = `${ctx.activeWorkspace.id}:${workspaceId}`;
      if (store.blocks.has(key)) {
        store.blocks.delete(key);
        if (store.db) {
          await store.sql('DELETE FROM blocked_workspaces WHERE workspace_id = $1 AND blocked_workspace_id = $2', [
            ctx.activeWorkspace.id,
            workspaceId,
          ]);
        }
        return reply.send({ success: true, blocked: false });
      }
      const block: BlockEntry = {
        id: `blk_${Date.now()}`,
        workspaceId: ctx.activeWorkspace.id,
        blockedWorkspaceId: workspaceId,
        createdAt: new Date().toISOString(),
      };
      store.blocks.set(key, block);
      if (store.db) {
        await store.sql(
          `INSERT INTO blocked_workspaces (id, workspace_id, blocked_workspace_id, created_at)
           VALUES ($1,$2,$3,$4)
           ON CONFLICT (workspace_id, blocked_workspace_id) DO NOTHING`,
          [block.id, block.workspaceId, block.blockedWorkspaceId, block.createdAt]
        );
      }
      return reply.send({ success: true, blocked: true });
    }
  );

  // ---- List blocked workspaces ----
  fastify.get(
    '/v1/blocks',
    { preHandler: resolveRequestContext },
    async (request, reply) => {
      const ctx = request.orbitContext!;
      const list = Array.from(store.blocks.values()).filter((b) => b.workspaceId === ctx.activeWorkspace.id);
      return reply.send({ data: list });
    }
  );

  // ---- Folders (chat organization) ----
  fastify.post<{ Body: { name: string; color?: string; conversationIds?: string[] } }>(
    '/v1/folders',
    { preHandler: resolveRequestContext },
    async (request, reply) => {
      const ctx = request.orbitContext!;
      const { name, color, conversationIds } = (request.body ?? {}) as {
        name?: string;
        color?: string;
        conversationIds?: string[];
      };
      if (!name || name.trim().length === 0) {
        return reply.status(400).send({
          error: { code: 'INVALID_FOLDER', message: 'Folder name is required', requestId: request.id },
        });
      }
      const folder: ChatFolder = {
        id: `fld_${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
        workspaceId: ctx.activeWorkspace.id,
        name: name.trim(),
        color: color ?? '#6366f1',
        conversationIds: conversationIds ?? [],
        createdAt: new Date().toISOString(),
      };
      folders.set(folder.id, folder);
      if (store.db) {
        await store.sql(
          `INSERT INTO chat_folders (id, workspace_id, name, color, conversation_ids, created_at)
           VALUES ($1,$2,$3,$4,$5::jsonb,$6)
           ON CONFLICT (id) DO NOTHING`,
          [folder.id, folder.workspaceId, folder.name, folder.color, JSON.stringify(folder.conversationIds), folder.createdAt]
        );
      }
      return reply.status(201).send({ data: folder });
    }
  );

  // ---- List folders ----
  fastify.get(
    '/v1/folders',
    { preHandler: resolveRequestContext },
    async (request, reply) => {
      const ctx = request.orbitContext!;
      const list = Array.from(folders.values()).filter((f) => f.workspaceId === ctx.activeWorkspace.id);
      return reply.send({ data: list });
    }
  );

  // ---- Update folder ----
  fastify.patch<{ Params: { folderId: string }; Body: { name?: string; color?: string; conversationIds?: string[] } }>(
    '/v1/folders/:folderId',
    { preHandler: resolveRequestContext },
    async (request, reply) => {
      const { folderId } = request.params;
      const ctx = request.orbitContext!;
      const folder = folders.get(folderId);
      if (!folder || folder.workspaceId !== ctx.activeWorkspace.id) {
        return reply.status(404).send({
          error: { code: 'NOT_FOUND', message: 'Folder not found', requestId: request.id },
        });
      }
      const body = (request.body ?? {}) as { name?: string; color?: string; conversationIds?: string[] };
      if (body.name !== undefined) folder.name = body.name;
      if (body.color !== undefined) folder.color = body.color;
      if (body.conversationIds !== undefined) folder.conversationIds = body.conversationIds;
      if (store.db) {
        await store.sql(
          'UPDATE chat_folders SET name = $2, color = $3, conversation_ids = $4::jsonb WHERE id = $1',
          [folder.id, folder.name, folder.color, JSON.stringify(folder.conversationIds)]
        );
      }
      return reply.send({ data: folder });
    }
  );

  // ---- Delete folder ----
  fastify.delete<{ Params: { folderId: string } }>(
    '/v1/folders/:folderId',
    { preHandler: resolveRequestContext },
    async (request, reply) => {
      const { folderId } = request.params;
      const ctx = request.orbitContext!;
      const folder = folders.get(folderId);
      if (!folder || folder.workspaceId !== ctx.activeWorkspace.id) {
        return reply.status(404).send({
          error: { code: 'NOT_FOUND', message: 'Folder not found', requestId: request.id },
        });
      }
      folders.delete(folderId);
      if (store.db) {
        await store.sql('DELETE FROM chat_folders WHERE id = $1', [folderId]);
      }
      return reply.send({ success: true });
    }
  );

  // ---- Mentions: @mention a workspace in a conversation ----
  fastify.post<{ Params: { conversationId: string }; Body: { mentionedWorkspaceIds: string[]; messageId: string } }>(
    '/v1/conversations/:conversationId/mentions',
    { preHandler: resolveRequestContext },
    async (request, reply) => {
      const { conversationId } = request.params;
      const ctx = request.orbitContext!;
      const { mentionedWorkspaceIds, messageId } = (request.body ?? {}) as {
        mentionedWorkspaceIds?: string[];
        messageId?: string;
      };
      if (!mentionedWorkspaceIds?.length || !messageId) {
        return reply.status(400).send({
          error: {
            code: 'INVALID_MENTION',
            message: 'mentionedWorkspaceIds and messageId are required',
            requestId: request.id,
          },
        });
      }
      store.recordEvent(ctx.activeWorkspace.id, conversationId, 'message.mentioned', {
        messageId,
        mentionedWorkspaceIds,
      });
      return reply.send({ success: true, mentionedWorkspaceIds });
    }
  );

  // ---- Set group member role ----
  fastify.put<{ Params: { conversationId: string; workspaceId: string }; Body: { role: 'member' | 'admin' } }>(
    '/v1/conversations/:conversationId/members/:workspaceId/role',
    { preHandler: resolveRequestContext },
    async (request, reply) => {
      const { conversationId, workspaceId } = request.params;
      const ctx = request.orbitContext!;
      const { role } = (request.body ?? {}) as { role?: string };
      if (role !== 'member' && role !== 'admin') {
        return reply.status(400).send({
          error: { code: 'INVALID_ROLE', message: 'role must be member or admin', requestId: request.id },
        });
      }
      const conversation = store.conversations.get(conversationId);
      if (!conversation) {
        return reply.status(404).send({
          error: { code: 'CONVERSATION_NOT_FOUND', message: 'Conversation not found', requestId: request.id },
        });
      }
      // Only conversation owner (creator workspace) or admin can change roles
      const callerParticipant = conversation.participants.find((p) => p.workspaceId === ctx.activeWorkspace.id);
      if (!callerParticipant || callerParticipant.role !== 'admin') {
        return reply.status(403).send({
          error: { code: 'FORBIDDEN', message: 'Only admins can change member roles', requestId: request.id },
        });
      }
      const target = conversation.participants.find((p) => p.workspaceId === workspaceId);
      if (!target) {
        return reply.status(404).send({
          error: { code: 'MEMBER_NOT_FOUND', message: 'Member not found', requestId: request.id },
        });
      }
      target.role = role;
      if (store.db) {
        await store.sql(
          'UPDATE conversation_participants SET role = $3 WHERE conversation_id = $1 AND workspace_id = $2',
          [conversationId, workspaceId, role]
        );
      }
      store.recordEvent(ctx.activeWorkspace.id, conversationId, 'conversation.role_changed', {
        workspaceId,
        role,
      });
      return reply.send({ success: true, workspaceId, role });
    }
  );

  // ---- Set group governance (slow mode + posting permission + membership approval) — admin only ----
  fastify.put<{ Params: { conversationId: string }; Body: { slowModeSeconds?: number; postingPermission?: 'everyone' | 'admins'; membershipApprovalRequired?: boolean } }>(
    '/v1/conversations/:conversationId/governance',
    { preHandler: resolveRequestContext },
    async (request, reply) => {
      const { conversationId } = request.params;
      const ctx = request.orbitContext!;
      const body = (request.body ?? {}) as { slowModeSeconds?: number; postingPermission?: string; membershipApprovalRequired?: boolean };
      const conversation = store.conversations.get(conversationId);
      if (!conversation || conversation.kind !== 'group') {
        return reply.status(404).send({
          error: { code: 'NOT_A_GROUP', message: 'Group conversation not found', requestId: request.id },
        });
      }
      const caller = conversation.participants.find((p) => p.workspaceId === ctx.activeWorkspace.id);
      if (!caller || caller.role !== 'admin') {
        return reply.status(403).send({
          error: { code: 'FORBIDDEN', message: 'Only admins can change group governance', requestId: request.id },
        });
      }
      if (body.slowModeSeconds !== undefined) {
        const v = Number(body.slowModeSeconds);
        if (!Number.isInteger(v) || v < 0 || v > 86400) {
          return reply.status(400).send({
            error: { code: 'INVALID_SLOW_MODE', message: 'slowModeSeconds must be an integer between 0 and 86400', requestId: request.id },
          });
        }
        (conversation as any).slowModeSeconds = v;
      }
      if (body.postingPermission !== undefined) {
        if (body.postingPermission !== 'everyone' && body.postingPermission !== 'admins') {
          return reply.status(400).send({
            error: { code: 'INVALID_POSTING_PERMISSION', message: 'postingPermission must be everyone or admins', requestId: request.id },
          });
        }
        (conversation as any).postingPermission = body.postingPermission;
      }
      if (body.membershipApprovalRequired !== undefined) {
        conversation.membershipApprovalRequired = Boolean(body.membershipApprovalRequired);
      }
      if (store.db) {
        await store.sql(
          'UPDATE conversations SET slow_mode_seconds = $2, posting_permission = $3, membership_approval_required = $4 WHERE id = $1',
          [conversationId, (conversation as any).slowModeSeconds ?? 0, (conversation as any).postingPermission ?? 'everyone', conversation.membershipApprovalRequired ?? false]
        );
      }
      store.recordEvent(ctx.activeWorkspace.id, conversationId, 'conversation.updated', {
        conversationId,
        changes: {
          slowModeSeconds: (conversation as any).slowModeSeconds ?? 0,
          postingPermission: (conversation as any).postingPermission ?? 'everyone',
          membershipApprovalRequired: conversation.membershipApprovalRequired ?? false,
        },
      });
      return reply.send({
        success: true,
        conversationId,
        slowModeSeconds: (conversation as any).slowModeSeconds ?? 0,
        postingPermission: (conversation as any).postingPermission ?? 'everyone',
        membershipApprovalRequired: conversation.membershipApprovalRequired ?? false,
      });
    }
  );

  // ---- Add a member to a group (admin only; respects groupInvitePermission) ----
  fastify.post<{ Params: { conversationId: string }; Body: { workspaceId: string } }>(
    '/v1/conversations/:conversationId/members',
    { preHandler: resolveRequestContext },
    async (request, reply) => {
      const { conversationId } = request.params;
      const ctx = request.orbitContext!;
      const { workspaceId } = (request.body ?? {}) as { workspaceId?: string };
      if (!workspaceId) {
        return reply.status(400).send({
          error: { code: 'MISSING_WORKSPACE', message: 'workspaceId is required', requestId: request.id },
        });
      }
      const conversation = store.conversations.get(conversationId);
      if (!conversation || conversation.kind !== 'group') {
        return reply.status(404).send({
          error: { code: 'NOT_A_GROUP', message: 'Group conversation not found', requestId: request.id },
        });
      }
      const caller = conversation.participants.find((p) => p.workspaceId === ctx.activeWorkspace.id);
      if (!caller || caller.role !== 'admin') {
        return reply.status(403).send({
          error: { code: 'FORBIDDEN', message: 'Only admins can add members', requestId: request.id },
        });
      }
      if (conversation.participants.some((p) => p.workspaceId === workspaceId)) {
        return reply.status(409).send({
          error: { code: 'ALREADY_MEMBER', message: 'Workspace is already a member', requestId: request.id },
        });
      }
      const target = store.workspaces.get(workspaceId);
      if (!target) {
        return reply.status(404).send({
          error: { code: 'WORKSPACE_NOT_FOUND', message: 'Target workspace not found', requestId: request.id },
        });
      }
      // Safety (Spec 14): cannot add a blocked party; respect the target's groupInvitePermission.
      if (store.isBlockedEitherWay(ctx.activeWorkspace.id, workspaceId)) {
        return reply.status(403).send({
          error: { code: 'BLOCKED', message: 'Cannot add a blocked workspace', requestId: request.id },
        });
      }
      const inviteSettings = store.workspaceSettings.get(workspaceId);
      const invitePerm = (inviteSettings?.privacy as { groupInvitePermission?: string } | undefined)?.groupInvitePermission ?? 'contacts';
      if (invitePerm === 'nobody') {
        return reply.status(403).send({
          error: { code: 'INVITE_NOT_ALLOWED', message: 'This user does not allow group invites', requestId: request.id },
        });
      }
      if (invitePerm === 'contacts' && !store.hasAcceptedContact(ctx.activeWorkspace.id, workspaceId)) {
        return reply.status(403).send({
          error: { code: 'INVITE_CONTACTS_ONLY', message: 'This user only accepts group invites from contacts', requestId: request.id },
        });
      }
      const member = {
        workspaceId,
        displayName: target.displayName,
        handle: target.handle,
        role: 'member' as const,
        joinedAt: new Date().toISOString(),
        isOnline: false,
      };
      // Spec 14 — history visibility statement: new members see messages shared
      // from the point they join; earlier history is not back-filled to them.
      const historyVisibility = 'members_see_messages_from_join';
      const historyVisibilityStatement =
        'New members see messages shared from the point they join; earlier history is not shown to them by default.';

      conversation.participants.push(member);
      if (store.db) {
        await store.sql(
          `INSERT INTO conversation_participants (conversation_id, workspace_id, display_name, handle, role, joined_at)
           VALUES ($1,$2,$3,$4,$5,$6)
           ON CONFLICT (conversation_id, workspace_id) DO NOTHING`,
          [conversationId, workspaceId, member.displayName, member.handle, member.role, member.joinedAt]
        );
      }
      store.recordEvent(ctx.activeWorkspace.id, conversationId, 'conversation.member_added', {
        workspaceId,
        historyVisibility,
      });
      return reply.status(201).send({
        success: true,
        conversationId,
        workspaceId,
        historyVisibility,
        historyVisibilityStatement,
      });
    }
  );

  // ---- Remove a member from a group (admin only, or self-leave) ----
  fastify.delete<{ Params: { conversationId: string; workspaceId: string } }>(
    '/v1/conversations/:conversationId/members/:workspaceId',
    { preHandler: resolveRequestContext },
    async (request, reply) => {
      const { conversationId, workspaceId } = request.params;
      const ctx = request.orbitContext!;
      const conversation = store.conversations.get(conversationId);
      if (!conversation || conversation.kind !== 'group') {
        return reply.status(404).send({
          error: { code: 'NOT_A_GROUP', message: 'Group conversation not found', requestId: request.id },
        });
      }
      const caller = conversation.participants.find((p) => p.workspaceId === ctx.activeWorkspace.id);
      const isSelf = workspaceId === ctx.activeWorkspace.id;
      if (!isSelf && (!caller || caller.role !== 'admin')) {
        return reply.status(403).send({
          error: { code: 'FORBIDDEN', message: 'Only admins can remove other members', requestId: request.id },
        });
      }
      const idx = conversation.participants.findIndex((p) => p.workspaceId === workspaceId);
      if (idx === -1) {
        return reply.status(404).send({
          error: { code: 'MEMBER_NOT_FOUND', message: 'Member not found', requestId: request.id },
        });
      }
      conversation.participants.splice(idx, 1);
      if (store.db) {
        await store.sql('DELETE FROM conversation_participants WHERE conversation_id = $1 AND workspace_id = $2', [
          conversationId,
          workspaceId,
        ]);
      }
      store.recordEvent(ctx.activeWorkspace.id, conversationId, 'conversation.member_removed', { workspaceId });
      return reply.send({ success: true, conversationId, workspaceId });
    }
  );

  // ---- Hardened link preview (Spec 14/34) — SSRF-safe, bounded, suspicious-aware ----
  fastify.post<{ Body: { url: string } }>(
    '/v1/link-previews',
    { preHandler: [resolveRequestContext, linkPreviewRateLimiter] },
    async (request: FastifyRequest, reply: FastifyReply) => {
      const { url } = (request.body ?? {}) as { url?: string };
      if (!url || typeof url !== 'string') {
        return reply.status(400).send({
          error: { code: 'MISSING_URL', message: 'url is required', requestId: request.id },
        });
      }
      const preview = await fetchLinkPreview(url);
      return reply.send({ data: preview });
    }
  );

  // ---- Wave B — scheduled messages ----

  // Schedule a message for future delivery
  fastify.post<{ Params: { conversationId: string } }>(
    '/v1/conversations/:conversationId/messages/schedule',
    { preHandler: resolveRequestContext },
    async (request, reply) => {
      const { conversationId } = request.params;
      const ctx = request.orbitContext!;
      const conversation = store.conversations.get(conversationId);
      if (!conversation) {
        return reply.status(404).send({
          error: { code: 'CONVERSATION_NOT_FOUND', message: 'Conversation not found', requestId: request.id },
        });
      }
      const isParticipant =
        conversation.workspaceId === ctx.activeWorkspace.id ||
        conversation.participants.some((p) => p.workspaceId === ctx.activeWorkspace.id);
      if (!isParticipant) {
        return reply.status(403).send({
          error: { code: 'ACCESS_DENIED', message: 'You are not a participant of this conversation', requestId: request.id },
        });
      }
      if (!hasCapability(ctx, 'conversations.send')) {
        return reply.status(403).send({
          error: {
            code: 'CAPABILITY_DENIED',
            message: "Your workspace role does not include the 'conversations.send' capability.",
            requestId: request.id,
          },
        });
      }

      const parsed = ScheduleMessageRequestSchema.safeParse(request.body);
      if (!parsed.success) {
        return reply.status(400).send({
          error: {
            code: 'INVALID_SCHEDULED_MESSAGE',
            message: parsed.error.issues[0]?.message || 'Invalid scheduled message payload',
            requestId: request.id,
          },
        });
      }
      if (new Date(parsed.data.scheduledFor).getTime() <= Date.now()) {
        return reply.status(400).send({
          error: {
            code: 'INVALID_SCHEDULE_TIME',
            message: 'scheduledFor must be in the future',
            requestId: request.id,
          },
        });
      }

      const scheduled: ScheduledMessage = {
        id: randomUUID(),
        conversationId,
        workspaceId: ctx.activeWorkspace.id,
        senderName: ctx.activeWorkspace.displayName,
        senderAvatarUrl: ctx.activeWorkspace.avatarUrl,
        body: parsed.data.body,
        scheduledFor: parsed.data.scheduledFor,
        status: 'scheduled',
        createdAt: new Date().toISOString(),
      };
      store.scheduledMessages.set(scheduled.id, scheduled);
      store.recordEvent(ctx.activeWorkspace.id, conversationId, 'message.scheduled', { scheduled });

      return reply.status(201).send(scheduled);
    }
  );

  // List scheduled messages for a conversation
  fastify.get<{ Params: { conversationId: string } }>(
    '/v1/conversations/:conversationId/scheduled',
    { preHandler: resolveRequestContext },
    async (request, reply) => {
      const { conversationId } = request.params;
      const ctx = request.orbitContext!;
      const conversation = store.conversations.get(conversationId);
      if (!conversation) {
        return reply.status(404).send({
          error: { code: 'CONVERSATION_NOT_FOUND', message: 'Conversation not found', requestId: request.id },
        });
      }
      const list = Array.from(store.scheduledMessages.values()).filter(
        (s) => s.conversationId === conversationId && s.workspaceId === ctx.activeWorkspace.id
      );
      return reply.send({ data: list });
    }
  );

  // Cancel a scheduled message
  fastify.delete<{ Params: { conversationId: string; scheduledId: string } }>(
    '/v1/conversations/:conversationId/scheduled/:scheduledId',
    { preHandler: resolveRequestContext },
    async (request, reply) => {
      const { conversationId, scheduledId } = request.params;
      const ctx = request.orbitContext!;
      const scheduled = store.scheduledMessages.get(scheduledId);
      if (!scheduled || scheduled.conversationId !== conversationId || scheduled.workspaceId !== ctx.activeWorkspace.id) {
        return reply.status(404).send({
          error: { code: 'SCHEDULED_MESSAGE_NOT_FOUND', message: 'Scheduled message not found', requestId: request.id },
        });
      }
      if (scheduled.status !== 'scheduled') {
        return reply.status(409).send({
          error: {
            code: 'SCHEDULED_MESSAGE_NOT_PENDING',
            message: `This scheduled message already has status '${scheduled.status}'`,
            requestId: request.id,
          },
        });
      }
      scheduled.status = 'cancelled';
      store.scheduledMessages.delete(scheduledId);
      return reply.send({ success: true, scheduledId, status: 'cancelled' });
    }
  );
}

/**
 * Wave B — delivery tick for scheduled messages. Sends every due message as a
 * normal message.created event (with a fresh serverSequence) and marks it sent.
 * Invoked on a 30s interval from the server bootstrap; also callable in tests.
 */
export async function processScheduledMessages(now = new Date()): Promise<number> {
  let sent = 0;
  for (const scheduled of Array.from(store.scheduledMessages.values())) {
    if (scheduled.status !== 'scheduled') continue;
    if (new Date(scheduled.scheduledFor).getTime() > now.getTime()) continue;

    scheduled.status = 'sent';
    scheduled.sentAt = now.toISOString();

    const conversation = store.conversations.get(scheduled.conversationId);
    if (!conversation) continue;

    const message: MessageEnvelope = {
      id: randomUUID(),
      conversationId: scheduled.conversationId,
      senderWorkspaceId: scheduled.workspaceId,
      senderName: scheduled.senderName,
      senderAvatarUrl: scheduled.senderAvatarUrl,
      idempotencyKey: `sched_${scheduled.id}`,
      clientMessageId: `sched_${scheduled.id}`,
      contentType: 'text',
      body: scheduled.body,
      attachments: [],
      deliveryState: 'delivered',
      reactions: [],
      isEdited: false,
      isDeleted: false,
      isEncrypted: false,
      serverSequence: store.nextServerSequence(scheduled.conversationId),
      scheduledFor: scheduled.scheduledFor,
      createdAt: scheduled.sentAt,
    };

    const outboxEvent = store.recordEvent(scheduled.workspaceId, scheduled.conversationId, 'message.created', {
      message,
    });
    await store.commitOutboundMessage(message, conversation, {
      eventId: outboxEvent.eventId,
      type: outboxEvent.type,
      payload: outboxEvent.payload as Record<string, unknown>,
    });
    sent++;
  }
  return sent;
}
