import { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import { randomUUID } from 'node:crypto';
import {
  CreateConversationRequestSchema,
  SendMessageRequestSchema,
  EditMessageRequestSchema,
  ToggleReactionRequestSchema,
  MessageEnvelope,
  ConversationParticipant,
  ConversationStudioSettingsSchema,
  UpdateConversationStudioSettingsRequestSchema,
  CreateWorkflowCardRequestSchema,
  ExecuteWorkflowActionRequestSchema,
  UpdateConversationIntentRequestSchema,
  WorkflowCard,
  CreateBranchRequestSchema,
} from '@orbit/schemas';
import {
  assertWorkspaceSenderScope,
  assertNoInternalNoteLeakage,
  createMessageSnippet,
} from '@orbit/domain';
import type { TeamRole } from '@orbit/domain';
import { isEncryptedEnvelope } from '@orbit/crypto-adapter';
import { store } from '../store.js';
import { resolveRequestContext, resolveTeamRole } from '../auth.js';
import type { RequestContext } from '../auth.js';
import { rateLimit } from '../rate-limit.js';
import { recordNotification } from './notifications.js';

const sendMessageRateLimiter = rateLimit({ limit: 120, windowMs: 60_000, keyPrefix: 'send-message' });
const createConversationRateLimiter = rateLimit({ limit: 30, windowMs: 60_000, keyPrefix: 'create-conversation' });

/** Wave B — spec 16: edits and everyone-scope deletes are windowed for non-admins. */
export const MESSAGE_EDIT_WINDOW_MS = 15 * 60 * 1000;

/**
 * Wave B (Spec 07/32) — server-side capability model for conversation routes.
 * Personal workspaces have no team roles (role === null ⇒ full capability);
 * business workspaces are role-checked. The read-only analyst ("viewer") role
 * is denied every mutating capability with 403 CAPABILITY_DENIED.
 */
export type OrbitCapability =
  | 'conversations.send'
  | 'conversations.assign'
  | 'conversations.manage'
  | 'saved_replies.use'
  | 'conversations.branch.create'
  | 'conversations.branch.read'
  | 'conversations.branch.write';

const CAPABILITY_ROLES: Record<OrbitCapability, readonly TeamRole[]> = {
  'conversations.send': ['owner', 'admin', 'agent'],
  'conversations.assign': ['owner', 'admin', 'agent'],
  'conversations.manage': ['owner', 'admin'],
  'saved_replies.use': ['owner', 'admin', 'agent'],
  'conversations.branch.create': ['owner', 'admin', 'agent'],
  'conversations.branch.read': ['owner', 'admin', 'agent', 'analyst'],
  'conversations.branch.write': ['owner', 'admin', 'agent'],
};

export function hasCapability(ctx: RequestContext, capability: OrbitCapability): boolean {
  const role = resolveTeamRole(ctx);
  if (role === null) return true; // personal workspace: no team roles apply
  return CAPABILITY_ROLES[capability].includes(role);
}

function denyCapability(
  request: FastifyRequest,
  reply: FastifyReply,
  capability: OrbitCapability
): true {
  reply.status(403).send({
    error: {
      code: 'CAPABILITY_DENIED',
      message: `Your workspace role does not include the '${capability}' capability.`,
      requestId: request.id,
    },
  });
  return true;
}

/** Wave B — owner/admin bypass the edit & delete window. */
function canBypassEditWindow(ctx: RequestContext): boolean {
  const role = resolveTeamRole(ctx);
  return role === 'owner' || role === 'admin';
}

function isWithinEditWindow(message: MessageEnvelope): boolean {
  return Date.now() - new Date(message.createdAt).getTime() <= MESSAGE_EDIT_WINDOW_MS;
}

export async function conversationRoutes(fastify: FastifyInstance): Promise<void> {
  // Create Conversation
  fastify.post('/v1/conversations', { preHandler: [resolveRequestContext, createConversationRateLimiter] }, async (request, reply) => {
    const ctx = request.orbitContext!;
    const parsed = CreateConversationRequestSchema.safeParse(request.body);
    if (!parsed.success) {
      return reply.status(400).send({
        error: {
          code: 'INVALID_CONVERSATION_PAYLOAD',
          message: parsed.error.issues[0]?.message || 'Invalid conversation payload',
          requestId: request.id,
        },
      });
    }

    const { kind, title, participantWorkspaceIds, intentMode, parentConversationId, sourceMessageId, membershipApprovalRequired } = parsed.data;

    const participants: ConversationParticipant[] = [
      {
        workspaceId: ctx.activeWorkspace.id,
        displayName: ctx.activeWorkspace.displayName,
        handle: ctx.activeWorkspace.handle,
        role: 'admin',
        joinedAt: new Date().toISOString(),
        isOnline: true,
      },
    ];

    for (const pId of participantWorkspaceIds) {
      if (pId !== ctx.activeWorkspace.id) {
        const found = store.workspaces.get(pId);
        if (found) {
          participants.push({
            workspaceId: found.id,
            displayName: found.displayName,
            handle: found.handle,
            role: 'member' as const,
            joinedAt: new Date().toISOString(),
            isOnline: false,
          });
        }
      }
    }

    // Restrict enforcement (Spec 14): a `restricted` workspace only accepts new
    // direct conversations from accepted contacts.
    if (kind === 'direct') {
      for (const pId of participantWorkspaceIds) {
        if (pId === ctx.activeWorkspace.id) continue;
        if (store.isWorkspaceRestricted(pId) && !store.hasAcceptedContact(ctx.activeWorkspace.id, pId)) {
          return reply.status(403).send({
            error: {
              code: 'RESTRICTED',
              message: 'This user only accepts messages from contacts.',
              requestId: request.id,
            },
          });
        }
      }
    }

    const newConv = {
      id: randomUUID(),
      workspaceId: ctx.activeWorkspace.id,
      kind,
      title: title || (participants.length === 2 ? participants[1]?.displayName : 'Group Discussion'),
      participants,
      parentConversationId,
      sourceMessageId,
      intentMode,
      unreadCount: 0,
      isPinned: false,
      isMuted: false,
      isArchived: false,
      isE2EE: kind === 'direct',
      membershipApprovalRequired: kind === 'group' ? (membershipApprovalRequired ?? false) : false,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    };

    store.conversations.set(newConv.id, newConv);
    await store.persistConversation(newConv, participants);
    store.recordEvent(ctx.activeWorkspace.id, newConv.id, 'conversation.created', { conversation: newConv });

    return reply.status(201).send(newConv);
  });

  // Get a single conversation (STRICT ISOLATION) — carries studioSettings for detail views
  fastify.get<{ Params: { conversationId: string } }>(
    '/v1/conversations/:conversationId',
    { preHandler: resolveRequestContext },
    async (request, reply) => {
      const { conversationId } = request.params;
      const ctx = request.orbitContext!;

      const conversation = store.conversations.get(conversationId);
      if (!conversation) {
        return reply.status(404).send({
          error: {
            code: 'CONVERSATION_NOT_FOUND',
            message: 'Conversation not found',
            requestId: request.id,
          },
        });
      }

      const isParticipant =
        conversation.workspaceId === ctx.activeWorkspace.id ||
        conversation.participants.some((p) => p.workspaceId === ctx.activeWorkspace.id);

      if (!isParticipant) {
        return reply.status(403).send({
          error: {
            code: 'CONVERSATION_ACCESS_DENIED',
            message: 'You are not a member of this conversation',
            requestId: request.id,
          },
        });
      }

      return reply.status(200).send(conversation);
    }
  );

  // Get messages for conversation (STRICT ISOLATION)
  fastify.get<{ Params: { conversationId: string } }>(
    '/v1/conversations/:conversationId/messages',
    { preHandler: resolveRequestContext },
    async (request, reply) => {
      const { conversationId } = request.params;
      const ctx = request.orbitContext!;

      const conversation = store.conversations.get(conversationId);
      if (!conversation) {
        return reply.status(404).send({
          error: {
            code: 'CONVERSATION_NOT_FOUND',
            message: 'Conversation not found',
            requestId: request.id,
          },
        });
      }

      // Check membership
      const isParticipant =
        conversation.workspaceId === ctx.activeWorkspace.id ||
        conversation.participants.some((p) => p.workspaceId === ctx.activeWorkspace.id);

      if (!isParticipant) {
        return reply.status(403).send({
          error: {
            code: 'CONVERSATION_ACCESS_DENIED',
            message: 'You are not a member of this conversation',
            requestId: request.id,
          },
        });
      }

      // Retrieve messages (Wave B: hide tombstones and delete-for-self entries)
      let messages = Array.from(store.messages.values())
        .filter(
          (m) =>
            m.conversationId === conversationId &&
            !m.isDeleted &&
            !(m.deletedFor && m.deletedFor.includes(ctx.activeWorkspace.id))
        )
        .sort((a, b) => new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime());

      // HARD SECURITY ASSERTION: Internal notes MUST NEVER leak into this customer/participant feed
      assertNoInternalNoteLeakage(messages);

      // Cursor pagination (Spec 10/11): ?limit=N&cursor=<messageId>
      const query = request.query as { limit?: string; cursor?: string };
      if (query.limit !== undefined || query.cursor !== undefined) {
        const limit = Math.min(Math.max(parseInt(query.limit ?? '50', 10) || 50, 1), 200);
        if (query.cursor) {
          const cursorIndex = messages.findIndex((m) => m.id === query.cursor);
          if (cursorIndex >= 0) {
            messages = messages.slice(cursorIndex + 1);
          }
        }
        const page = messages.slice(0, limit);
        const nextCursor = messages.length > limit ? page[page.length - 1]?.id : null;
        return reply.status(200).send({ data: page, nextCursor });
      }

      return reply.status(200).send(messages);
    }
  );

  // Send message (IDEMPOTENT & AUDITED)
  fastify.post<{ Params: { conversationId: string } }>(
    '/v1/conversations/:conversationId/messages',
    { preHandler: [resolveRequestContext, sendMessageRateLimiter] },
    async (request, reply) => {
      const { conversationId } = request.params;
      const ctx = request.orbitContext!;

      const parsed = SendMessageRequestSchema.safeParse(request.body);
      if (!parsed.success) {
        return reply.status(400).send({
          error: {
            code: 'INVALID_MESSAGE_PAYLOAD',
            message: parsed.error.issues[0]?.message || 'Invalid message payload',
            requestId: request.id,
          },
        });
      }

      const {
        idempotencyKey,
        clientMessageId,
        contentType,
        body,
        attachments,
        replyToMessageId,
        branchId,
        isEncrypted,
        savedReplyId,
        integrationId,
      } = parsed.data;

      // 1. Idempotency check: if key was processed, return cached message
      if (store.idempotency.has(idempotencyKey)) {
        const cached = store.idempotency.get(idempotencyKey)!;
        return reply.status(200).send(cached);
      }

      // 2. Validate conversation access
      const conversation = store.conversations.get(conversationId);
      if (!conversation) {
        return reply.status(404).send({
          error: {
            code: 'CONVERSATION_NOT_FOUND',
            message: 'Target conversation not found',
            requestId: request.id,
          },
        });
      }

      const isParticipant =
        conversation.workspaceId === ctx.activeWorkspace.id ||
        conversation.participants.some((p) => p.workspaceId === ctx.activeWorkspace.id);

      if (!isParticipant) {
        return reply.status(403).send({
          error: {
            code: 'CONVERSATION_ACCESS_DENIED',
            message: 'You are not authorized to post to this conversation',
            requestId: request.id,
          },
        });
      }

      // Wave B (Spec 07/32): sending requires the conversations.send capability.
      // The read-only analyst ("viewer") role is denied with CAPABILITY_DENIED.
      if (!hasCapability(ctx, 'conversations.send')) {
        return denyCapability(request, reply, 'conversations.send');
      }

      // Wave B: sending through a saved reply additionally requires saved_replies.use.
      if (savedReplyId) {
        const savedReply = store.savedReplies.get(savedReplyId);
        if (!savedReply || savedReply.workspaceId !== ctx.activeWorkspace.id) {
          return reply.status(404).send({
            error: {
              code: 'SAVED_REPLY_NOT_FOUND',
              message: 'Saved reply not found',
              requestId: request.id,
            },
          });
        }
        if (!hasCapability(ctx, 'saved_replies.use')) {
          return denyCapability(request, reply, 'saved_replies.use');
        }
      }

      // Block enforcement (Spec 14): a blocked sender cannot post to a conversation
      // with a participant who has blocked them (or whom they have blocked).
      if (conversation.kind === 'direct') {
        const otherParticipants = conversation.participants.filter(
          (p) => p.workspaceId !== ctx.activeWorkspace.id
        );
        for (const other of otherParticipants) {
          if (store.isBlockedEitherWay(ctx.activeWorkspace.id, other.workspaceId)) {
            return reply.status(403).send({
              error: {
                code: 'BLOCKED',
                message: 'You cannot send messages to this conversation due to a block.',
                requestId: request.id,
              },
            });
          }
        }
      }

      // Group governance (Spec 14): posting permissions and slow mode.
      if (conversation.kind === 'group') {
        const sender = conversation.participants.find((p) => p.workspaceId === ctx.activeWorkspace.id);
        const postingPermission = (conversation as any).postingPermission ?? 'everyone';
        const slowModeSeconds = (conversation as any).slowModeSeconds ?? 0;

        if (postingPermission === 'admins' && sender?.role !== 'admin') {
          return reply.status(403).send({
            error: {
              code: 'POSTING_NOT_ALLOWED',
              message: 'Only admins can post in this conversation.',
              requestId: request.id,
            },
          });
        }

        if (slowModeSeconds > 0) {
          let lastAt: number | null = null;
          for (const m of store.messages.values()) {
            if (m.conversationId !== conversationId) continue;
            if (m.senderWorkspaceId !== ctx.activeWorkspace.id) continue;
            const t = new Date(m.createdAt).getTime();
            if (lastAt === null || t > lastAt) lastAt = t;
          }
          if (lastAt !== null) {
            const elapsedMs = Date.now() - lastAt;
            if (elapsedMs < slowModeSeconds * 1000) {
              const retryAfter = Math.ceil((slowModeSeconds * 1000 - elapsedMs) / 1000);
              reply.header('Retry-After', String(retryAfter));
              return reply.status(429).send({
                error: {
                  code: 'SLOW_MODE',
                  message: `Slow mode is active. Try again in ${retryAfter}s.`,
                  retryAfterSeconds: retryAfter,
                  requestId: request.id,
                },
              });
            }
          }
        }
      }

      // 3. Sender workspace boundary assertion
      assertWorkspaceSenderScope(ctx.activeWorkspace.id, ctx.activeWorkspace.id);

      // Reply snippet lookup
      let replyToSnippet: string | undefined;
      let replyToSenderName: string | undefined;
      if (replyToMessageId) {
        const repliedMsg = store.messages.get(replyToMessageId);
        if (repliedMsg) {
          replyToSnippet =
          repliedMsg.isEncrypted && isEncryptedEnvelope(repliedMsg.body)
            ? 'Encrypted message'
            : createMessageSnippet(repliedMsg.body, 60);
          replyToSenderName = repliedMsg.senderName;
        }
      }

      // 4. Construct canonical message envelope (Wave B: monotonic serverSequence)
      const canonicalMessage: MessageEnvelope = {
        id: randomUUID(),
        conversationId,
        senderWorkspaceId: ctx.activeWorkspace.id,
        senderName: ctx.activeWorkspace.displayName,
        senderAvatarUrl: ctx.activeWorkspace.avatarUrl,
        idempotencyKey,
        clientMessageId,
        contentType,
        body,
        attachments: attachments || [],
        deliveryState: 'delivered',
        reactions: [],
        replyToMessageId,
        replyToSnippet,
        replyToSenderName,
        branchId,
        isEdited: false,
        isDeleted: false,
        isEncrypted: isEncrypted ?? false,
        serverSequence: store.nextServerSequence(conversationId),
        createdAt: new Date().toISOString(),
        integrationId,
      };

      // 5. Commit atomically (Spec 10): in-memory working set + durable outbox when DB is configured
      const outboxEvent = store.recordEvent(ctx.activeWorkspace.id, conversationId, 'message.created', {
        message: canonicalMessage,
      });

      try {
        await store.commitOutboundMessage(canonicalMessage, conversation, {
          eventId: outboxEvent.eventId,
          type: outboxEvent.type,
          payload: outboxEvent.payload as Record<string, unknown>,
        });
      } catch (error) {
        // Idempotency race: a concurrent retry with the same key won the unique constraint.
        const code = (error as { code?: string }).code;
        if (code === '23505') {
          const existing = await store.findByIdempotencyKey(ctx.activeWorkspace.id, idempotencyKey);
          if (existing) {
            return reply.status(200).send(existing);
          }
        }
        throw error;
      }

      // 6. Notifications pipeline (Spec 02/10): record a notification for every
      // other participant workspace, scoped to their workspace. Mentions are
      // detected from the message body so they surface as type 'mention'.
      const senderWorkspaceId = ctx.activeWorkspace.id;
      for (const participant of conversation.participants) {
        if (participant.workspaceId === senderWorkspaceId) continue;
        const mentioned = body.includes(`@${participant.handle}`);
        recordNotification({
          workspaceId: participant.workspaceId,
          conversationId,
          type: mentioned ? 'mention' : 'message',
          title: mentioned ? `${ctx.activeWorkspace.displayName} mentioned you` : ctx.activeWorkspace.displayName,
          body: body.slice(0, 200),
        });
      }

      return reply.status(201).send(canonicalMessage);
    }
  );

  // Edit message (legacy path — kept for backward compatibility)
  fastify.patch<{ Params: { messageId: string } }>(
    '/v1/messages/:messageId',
    { preHandler: resolveRequestContext },
    async (request, reply) => handleMessageEdit(request, reply, request.params.messageId)
  );

  // Wave B — Edit message nested under its conversation (15-min window + ownership)
  fastify.patch<{ Params: { conversationId: string; messageId: string } }>(
    '/v1/conversations/:conversationId/messages/:messageId',
    { preHandler: resolveRequestContext },
    async (request, reply) => handleMessageEdit(request, reply, request.params.messageId)
  );

  // Delete message (legacy path — kept for backward compatibility)
  fastify.delete<{ Params: { messageId: string } }>(
    '/v1/messages/:messageId',
    { preHandler: resolveRequestContext },
    async (request, reply) => handleMessageDelete(request, reply, request.params.messageId)
  );

  // Wave B — Delete message nested under its conversation with ?scope=self|everyone
  fastify.delete<{ Params: { conversationId: string; messageId: string } }>(
    '/v1/conversations/:conversationId/messages/:messageId',
    { preHandler: resolveRequestContext },
    async (request, reply) => handleMessageDelete(request, reply, request.params.messageId)
  );

  // Wave B — PATCH conversation intent mode (personal vs business thread)
  fastify.patch<{ Params: { conversationId: string } }>(
    '/v1/conversations/:conversationId/intent',
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
          error: {
            code: 'CONVERSATION_ACCESS_DENIED',
            message: 'You are not a participant of this conversation',
            requestId: request.id,
          },
        });
      }

      const parsed = UpdateConversationIntentRequestSchema.safeParse(request.body);
      if (!parsed.success) {
        return reply.status(400).send({
          error: { code: 'INVALID_INTENT', message: 'intent must be personal or business', requestId: request.id },
        });
      }

      const previousIntent = conversation.intent ?? null;
      conversation.intent = parsed.data.intent;
      conversation.updatedAt = new Date().toISOString();
      if (store.db) {
        await store.sql('UPDATE conversations SET intent = $2, updated_at = $3 WHERE id = $1', [
          conversationId,
          conversation.intent,
          conversation.updatedAt,
        ]);
      }

      store.recordEvent(ctx.activeWorkspace.id, conversationId, 'conversation.intent_changed', {
        conversationId,
        intent: conversation.intent,
        previousIntent,
      });

      return reply.status(200).send({
        conversationId,
        intent: conversation.intent,
        previousIntent,
      });
    }
  );

  // PATCH conversation studio settings (density / radius / accent / wallpaper / …)
  fastify.patch<{ Params: { conversationId: string } }>(
    '/v1/conversations/:conversationId/studio-settings',
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
          error: {
            code: 'CONVERSATION_ACCESS_DENIED',
            message: 'You are not a participant of this conversation',
            requestId: request.id,
          },
        });
      }

      const parsed = UpdateConversationStudioSettingsRequestSchema.safeParse(request.body);
      if (!parsed.success) {
        return reply.status(400).send({
          error: {
            code: 'INVALID_STUDIO_SETTINGS',
            message: parsed.error.issues[0]?.message || 'Invalid studio settings',
            requestId: request.id,
          },
        });
      }

      // Partial patch: merge over the stored settings, then re-validate the
      // full record so schema defaults fill anything never set.
      const merged = ConversationStudioSettingsSchema.safeParse({
        ...conversation.studioSettings,
        ...parsed.data,
      });
      if (!merged.success) {
        return reply.status(400).send({
          error: {
            code: 'INVALID_STUDIO_SETTINGS',
            message: merged.error.issues[0]?.message || 'Invalid studio settings',
            requestId: request.id,
          },
        });
      }

      conversation.studioSettings = merged.data;
      conversation.updatedAt = new Date().toISOString();
      if (store.db) {
        await store.sql('UPDATE conversations SET studio_settings = $2::jsonb, updated_at = $3 WHERE id = $1', [
          conversationId,
          JSON.stringify(conversation.studioSettings),
          conversation.updatedAt,
        ]);
      }

      store.recordEvent(ctx.activeWorkspace.id, conversationId, 'conversation.updated', {
        conversationId,
        changes: { studioSettings: conversation.studioSettings },
      });

      return reply.status(200).send({
        success: true,
        conversationId,
        studioSettings: conversation.studioSettings,
        conversation,
      });
    }
  );

  // Wave B — Execute a workflow action exposed by a card definition
  fastify.post<{ Params: { workflowCardId: string } }>(
    '/v1/workflows/:workflowCardId/actions',
    { preHandler: resolveRequestContext },
    async (request, reply) => {
      const { workflowCardId } = request.params;
      const ctx = request.orbitContext!;
      const card = store.workflowCards.get(workflowCardId);
      if (!card) {
        return reply.status(404).send({
          error: { code: 'WORKFLOW_CARD_NOT_FOUND', message: 'Workflow card not found', requestId: request.id },
        });
      }
      const conversation = store.conversations.get(card.conversationId);
      const isParticipant =
        conversation &&
        (conversation.workspaceId === ctx.activeWorkspace.id ||
          conversation.participants.some((p) => p.workspaceId === ctx.activeWorkspace.id));
      if (!isParticipant) {
        return reply.status(403).send({
          error: {
            code: 'CONVERSATION_ACCESS_DENIED',
            message: 'You are not a participant of this conversation',
            requestId: request.id,
          },
        });
      }

      const parsed = ExecuteWorkflowActionRequestSchema.safeParse(request.body);
      if (!parsed.success) {
        return reply.status(400).send({
          error: {
            code: 'INVALID_WORKFLOW_ACTION',
            message: parsed.error.issues[0]?.message || 'Invalid workflow action payload',
            requestId: request.id,
          },
        });
      }
      const { actionId, payload } = parsed.data;

      // Wave B: the action must exist in the card's workflow definition.
      const allowedActions: Record<WorkflowCard['cardType'], string[]> = {
        approval: ['approve', 'reject'],
        task: ['start', 'complete'],
        agenda: ['complete'],
        checklist: ['toggle_option'],
        poll: ['toggle_option'],
      };
      if (!allowedActions[card.cardType].includes(actionId)) {
        return reply.status(403).send({
          error: {
            code: 'WORKFLOW_ACTION_NOT_ALLOWED',
            message: `Action '${actionId}' is not part of the '${card.cardType}' workflow definition`,
            requestId: request.id,
          },
        });
      }

      const now = new Date().toISOString();
      if (actionId === 'toggle_option') {
        const optionId = typeof payload?.optionId === 'string' ? payload.optionId : undefined;
        const option = card.options?.find((o) => o.id === optionId);
        if (!option) {
          return reply.status(404).send({
            error: { code: 'WORKFLOW_OPTION_NOT_FOUND', message: 'Option not found on card', requestId: request.id },
          });
        }
        option.checked = !option.checked;
        if (card.cardType === 'poll') option.votes = option.checked ? option.votes + 1 : Math.max(0, option.votes - 1);
      } else if (actionId === 'approve') {
        card.status = 'approved';
      } else if (actionId === 'reject') {
        card.status = 'rejected';
      } else if (actionId === 'start') {
        card.status = 'in_progress';
      } else if (actionId === 'complete') {
        card.status = 'completed';
      }

      card.history = [
        ...(card.history ?? []),
        {
          actionId: randomUUID(),
          actorWorkspaceId: ctx.activeWorkspace.id,
          actorName: ctx.activeWorkspace.displayName,
          action: actionId,
          comment: typeof payload?.comment === 'string' ? payload.comment : undefined,
          timestamp: now,
        },
      ];
      card.schemaVersion = card.schemaVersion ?? 1;
      card.updatedAt = now;
      await store.persistWorkflowCard(card);

      store.recordEvent(ctx.activeWorkspace.id, card.conversationId, 'workflow_card.updated', { card });

      return reply.status(200).send(card);
    }
  );

  // Toggle reaction
  fastify.post<{ Params: { messageId: string } }>(
    '/v1/messages/:messageId/reactions',
    { preHandler: resolveRequestContext },
    async (request, reply) => {
      const { messageId } = request.params;
      const ctx = request.orbitContext!;

      const message = store.messages.get(messageId);
      if (!message) {
        return reply.status(404).send({
          error: { code: 'MESSAGE_NOT_FOUND', message: 'Message not found', requestId: request.id },
        });
      }

      const parsed = ToggleReactionRequestSchema.safeParse(request.body);
      if (!parsed.success) {
        return reply.status(400).send({
          error: { code: 'INVALID_EMOJI', message: 'Invalid emoji format', requestId: request.id },
        });
      }

      const { emoji } = parsed.data;
      const existingReaction = message.reactions.find((r) => r.emoji === emoji);

      if (existingReaction) {
        const hasReacted = existingReaction.workspaceIds.includes(ctx.activeWorkspace.id);
        if (hasReacted) {
          existingReaction.workspaceIds = existingReaction.workspaceIds.filter(
            (id) => id !== ctx.activeWorkspace.id
          );
          existingReaction.count -= 1;
          if (existingReaction.count <= 0) {
            message.reactions = message.reactions.filter((r) => r.emoji !== emoji);
          }
        } else {
          existingReaction.workspaceIds.push(ctx.activeWorkspace.id);
          existingReaction.count += 1;
        }
      } else {
        message.reactions.push({
          emoji,
          count: 1,
          workspaceIds: [ctx.activeWorkspace.id],
        });
      }

      store.recordEvent(ctx.activeWorkspace.id, message.conversationId, 'message.reaction_changed', {
        messageId,
        reactions: message.reactions,
      });

      return reply.status(200).send(message);
    }
  );

  // Get Workflow Cards
  fastify.get<{ Params: { conversationId: string } }>(
    '/v1/conversations/:conversationId/workflows',
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
          error: { code: 'CONVERSATION_ACCESS_DENIED', message: 'You are not a participant of this conversation', requestId: request.id },
        });
      }
      const cards = Array.from(store.workflowCards.values()).filter(
        (c) => c.conversationId === conversationId
      );
      return reply.status(200).send(cards);
    }
  );

  // Create Workflow Card (Spec 25/26)
  fastify.post<{ Params: { conversationId: string } }>(
    '/v1/conversations/:conversationId/workflows',
    { preHandler: resolveRequestContext },
    async (request, reply) => {
      const { conversationId } = request.params;
      const ctx = request.orbitContext!;
      const parsed = CreateWorkflowCardRequestSchema.safeParse(request.body);
      if (!parsed.success) {
        return reply.status(400).send({
          error: { code: 'INVALID_WORKFLOW_CARD', message: 'Invalid payload', requestId: request.id },
        });
      }

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
          error: { code: 'CONVERSATION_ACCESS_DENIED', message: 'You are not a participant of this conversation', requestId: request.id },
        });
      }

      const now = new Date().toISOString();
      const card: WorkflowCard = {
        id: `wf_${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
        conversationId,
        creatorWorkspaceId: ctx.activeWorkspace.id,
        creatorName: ctx.activeWorkspace.displayName,
        cardType: parsed.data.cardType,
        title: parsed.data.title,
        description: parsed.data.description,
        status: 'pending',
        assigneeWorkspaceId: parsed.data.assigneeWorkspaceId ?? null,
        dueDate: parsed.data.dueDate ?? null,
        options: parsed.data.options?.map((o) => ({ ...o, votes: 0, checked: false })),
        history: [],
        schemaVersion: 1,
        createdAt: now,
        updatedAt: now,
      };

      store.workflowCards.set(card.id, card);
      await store.persistWorkflowCard(card);
      store.recordEvent(ctx.activeWorkspace.id, conversationId, 'workflow_card.created', { card });

      return reply.status(201).send(card);
    }
  );

  // POST /v1/conversations/:id/branches — Create a branch conversation from a source message
  fastify.post<{ Params: { conversationId: string } }>(
    '/v1/conversations/:conversationId/branches',
    { preHandler: [resolveRequestContext] },
    async (request, reply) => {
      const { conversationId } = request.params;
      const ctx = request.orbitContext!;

      const parsed = CreateBranchRequestSchema.safeParse(request.body);
      if (!parsed.success) {
        return reply.status(400).send({
          error: {
            code: 'INVALID_BRANCH_PAYLOAD',
            message: parsed.error.issues[0]?.message || 'Invalid branch payload',
            requestId: request.id,
          },
        });
      }

      // Check source conversation exists and user is a participant
      const sourceConversation = store.conversations.get(conversationId);
      if (!sourceConversation) {
        return reply.status(404).send({
          error: { code: 'CONVERSATION_NOT_FOUND', message: 'Source conversation not found', requestId: request.id },
        });
      }

      const isParticipant =
        sourceConversation.workspaceId === ctx.activeWorkspace.id ||
        sourceConversation.participants.some((p) => p.workspaceId === ctx.activeWorkspace.id);

      if (!isParticipant) {
        return reply.status(403).send({
          error: {
            code: 'CONVERSATION_ACCESS_DENIED',
            message: 'You are not a participant of the source conversation',
            requestId: request.id,
          },
        });
      }

      // Check branch create capability
      if (!hasCapability(ctx, 'conversations.branch.create')) {
        return denyCapability(request, reply, 'conversations.branch.create');
      }

      // Source conversation must not be a branch itself
      if (sourceConversation.kind === 'branch') {
        return reply.status(400).send({
          error: { code: 'CANNOT_BRANCH_BRANCH', message: 'Cannot create a branch from a branch conversation', requestId: request.id },
        });
      }

      const { sourceMessageId, title, participantWorkspaceIds, retentionDays } = parsed.data;

      // Verify source message exists in the conversation
      const sourceMessage = store.messages.get(sourceMessageId);
      if (!sourceMessage || sourceMessage.conversationId !== conversationId) {
        return reply.status(404).send({
          error: { code: 'SOURCE_MESSAGE_NOT_FOUND', message: 'Source message not found in conversation', requestId: request.id },
        });
      }

      // Determine participants: inherit from source or use provided subset
      let participants: ConversationParticipant[] = [];
      if (participantWorkspaceIds && participantWorkspaceIds.length > 0) {
        // Use provided subset, must be subset of source participants
        const sourceParticipantIds = new Set(sourceConversation.participants.map((p) => p.workspaceId));
        for (const pId of participantWorkspaceIds) {
          if (!sourceParticipantIds.has(pId)) {
            return reply.status(400).send({
              error: { code: 'INVALID_PARTICIPANT', message: `Workspace ${pId} is not a participant of the source conversation`, requestId: request.id },
            });
          }
          const sourceParticipant = sourceConversation.participants.find((p) => p.workspaceId === pId);
          if (sourceParticipant) {
            participants.push({
              ...sourceParticipant,
              role: pId === ctx.activeWorkspace.id ? 'admin' : sourceParticipant.role,
              joinedAt: new Date().toISOString(),
            });
          }
        }
      } else {
        // Inherit all participants
        participants = sourceConversation.participants.map((p) => ({
          ...p,
          role: p.workspaceId === ctx.activeWorkspace.id ? 'admin' : p.role,
          joinedAt: new Date().toISOString(),
        }));
      }

      // Ensure the creator is included
      if (!participants.some((p) => p.workspaceId === ctx.activeWorkspace.id)) {
        const creatorWorkspace = store.workspaces.get(ctx.activeWorkspace.id);
        if (creatorWorkspace) {
          participants.unshift({
            workspaceId: ctx.activeWorkspace.id,
            displayName: creatorWorkspace.displayName,
            handle: creatorWorkspace.handle,
            role: 'admin',
            joinedAt: new Date().toISOString(),
            isOnline: true,
          });
        }
      }

      const newBranch = {
        id: randomUUID(),
        workspaceId: ctx.activeWorkspace.id,
        kind: 'branch' as const,
        title: title || `Branch from ${sourceMessage.senderName}'s message`,
        participants,
        parentConversationId: conversationId,
        sourceMessageId,
        intentMode: sourceConversation.intentMode,
        studioSettings: sourceConversation.studioSettings,
        unreadCount: 0,
        isPinned: false,
        isMuted: false,
        isArchived: false,
        isE2EE: sourceConversation.isE2EE,
        membershipApprovalRequired: false,
        retentionDays: retentionDays ?? sourceConversation.retentionDays ?? null,
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
      };

      store.conversations.set(newBranch.id, newBranch);
      await store.persistConversation(newBranch, participants);
      store.recordEvent(ctx.activeWorkspace.id, newBranch.id, 'conversation.branch_created', {
        branch: newBranch,
        sourceConversationId: conversationId,
        sourceMessageId,
      });

      // Create default branch permissions for all participants
      for (const participant of participants) {
        const permission = {
          conversationId: newBranch.id,
          workspaceId: participant.workspaceId,
          canRead: true,
          canWrite: participant.role === 'admin',
        };
        const permKey = `bp_${newBranch.id}_${participant.workspaceId}`;
        // Store in a branchPermissions map (we'll add this to store)
        if (!store.branchPermissions) {
          store.branchPermissions = new Map();
        }
        store.branchPermissions.set(permKey, permission);
      }

      return reply.status(201).send(newBranch);
    }
  );

  // GET /v1/conversations/:id/branches — List branches for a conversation
  fastify.get<{ Params: { conversationId: string } }>(
    '/v1/conversations/:conversationId/branches',
    { preHandler: resolveRequestContext },
    async (request, reply) => {
      const { conversationId } = request.params;
      const ctx = request.orbitContext!;

      const sourceConversation = store.conversations.get(conversationId);
      if (!sourceConversation) {
        return reply.status(404).send({
          error: { code: 'CONVERSATION_NOT_FOUND', message: 'Conversation not found', requestId: request.id },
        });
      }

      const requestedWorkspaceId = request.headers['x-workspace-id'] as string | undefined;
      if (requestedWorkspaceId && requestedWorkspaceId !== ctx.activeWorkspace.id) {
        return reply.status(404).send({
          error: { code: 'CONVERSATION_NOT_FOUND', message: 'Conversation not found', requestId: request.id },
        });
      }

      const isParticipant =
        sourceConversation.workspaceId === ctx.activeWorkspace.id ||
        sourceConversation.participants.some((p) => p.workspaceId === ctx.activeWorkspace.id);

      if (!isParticipant) {
        return reply.status(403).send({
          error: {
            code: 'CONVERSATION_ACCESS_DENIED',
            message: 'You are not a participant of this conversation',
            requestId: request.id,
          },
        });
      }

      if (!hasCapability(ctx, 'conversations.branch.read')) {
        return denyCapability(request, reply, 'conversations.branch.read');
      }

      // Find all branches where parentConversationId matches
      const branches = Array.from(store.conversations.values()).filter(
        (c) => c.kind === 'branch' && c.parentConversationId === conversationId
      );

      // Filter to only branches the user has read permission for
      const accessibleBranches = branches.filter((branch) => {
        const permKey = `bp_${branch.id}_${ctx.activeWorkspace.id}`;
        const perm = store.branchPermissions?.get(permKey);
        return perm?.canRead ?? false;
      });

      return reply.status(200).send(accessibleBranches);
    }
  );
}

async function handleMessageEdit(
  request: FastifyRequest,
  reply: FastifyReply,
  messageId: string
): Promise<void> {
  const ctx = request.orbitContext!;

  const message = store.messages.get(messageId);
  if (!message) {
    await reply.status(404).send({
      error: { code: 'MESSAGE_NOT_FOUND', message: 'Message not found', requestId: request.id },
    });
    return;
  }

  // Sender check (ownership)
  if (message.senderWorkspaceId !== ctx.activeWorkspace.id) {
    await reply.status(403).send({
      error: {
        code: 'MESSAGE_EDIT_FORBIDDEN',
        message: 'You can only edit your own messages',
        requestId: request.id,
      },
    });
    return;
  }

  // Wave B (Spec 07/32): editing requires the conversations.send capability.
  if (!hasCapability(ctx, 'conversations.send')) {
    denyCapability(request, reply, 'conversations.send');
    return;
  }

  // Wave B: 15-minute edit window (workspace owner/admin may bypass).
  if (!isWithinEditWindow(message) && !canBypassEditWindow(ctx)) {
    await reply.status(403).send({
      error: {
        code: 'EDIT_WINDOW_EXPIRED',
        message: 'Messages can only be edited within 15 minutes of sending.',
        requestId: request.id,
      },
    });
    return;
  }

  const parsed = EditMessageRequestSchema.safeParse(request.body);
  if (!parsed.success) {
    await reply.status(400).send({
      error: { code: 'INVALID_BODY', message: 'Invalid body parameter', requestId: request.id },
    });
    return;
  }

  await store.editMessageDurable(message, parsed.data.body);

  store.recordEvent(ctx.activeWorkspace.id, message.conversationId, 'message.updated', { message });

  await reply.status(200).send(message);
}

async function handleMessageDelete(
  request: FastifyRequest,
  reply: FastifyReply,
  messageId: string
): Promise<void> {
  const ctx = request.orbitContext!;

  const message = store.messages.get(messageId);
  if (!message) {
    await reply.status(404).send({
      error: { code: 'MESSAGE_NOT_FOUND', message: 'Message not found', requestId: request.id },
    });
    return;
  }

  const isOwner = message.senderWorkspaceId === ctx.activeWorkspace.id;
  const canModerate = canBypassEditWindow(ctx);
  if (!isOwner && !canModerate) {
    await reply.status(403).send({
      error: { code: 'MESSAGE_DELETE_FORBIDDEN', message: 'Permission denied', requestId: request.id },
    });
    return;
  }

  // Wave B: deleting requires the conversations.send capability.
  if (!hasCapability(ctx, 'conversations.send')) {
    denyCapability(request, reply, 'conversations.send');
    return;
  }

  // Wave B — ?scope=self|everyone (default: everyone, matching the legacy route).
  const query = (request.query ?? {}) as { scope?: string };
  const scope = query.scope === 'self' ? 'self' : 'everyone';

  if (scope === 'self') {
    // Delete-for-self: the message disappears only for the caller's workspace.
    message.deletedFor = message.deletedFor ?? [];
    if (!message.deletedFor.includes(ctx.activeWorkspace.id)) {
      message.deletedFor.push(ctx.activeWorkspace.id);
    }
    store.recordEvent(ctx.activeWorkspace.id, message.conversationId, 'message.deleted', {
      messageId,
      scope: 'self',
      deletedFor: message.deletedFor,
    });
    await reply.status(200).send({ success: true, messageId, scope: 'self' });
    return;
  }

  // Everyone-scope: windowed for non-admins (admins/owners may always delete).
  if (!isWithinEditWindow(message) && !canModerate) {
    await reply.status(403).send({
      error: {
        code: 'DELETE_WINDOW_EXPIRED',
        message: 'Messages can only be deleted for everyone within 15 minutes of sending.',
        requestId: request.id,
      },
    });
    return;
  }

  await store.softDeleteMessageDurable(message);
  store.recordEvent(ctx.activeWorkspace.id, message.conversationId, 'message.deleted', {
    messageId,
    scope: 'everyone',
  });

  await reply.status(200).send({ success: true, messageId, scope: 'everyone' });
}
