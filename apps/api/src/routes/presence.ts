import { FastifyInstance } from 'fastify';
import { store } from '../store.js';
import { resolveRequestContext } from '../auth.js';
import { presencePubSub } from '../presence-pubsub.js';

/**
 * Typing indicator + presence + read receipts (Spec 02 P0).
 * Backed by PresencePubSub (in-memory fallback / Redis in prod, WAVE-H).
 */

export function isTyping(conversationId: string, workspaceId: string): boolean {
  return presencePubSub.getTypingWorkspaceIds(conversationId).includes(workspaceId);
}

export function typingWorkspaces(conversationId: string): string[] {
  return presencePubSub.getTypingWorkspaceIds(conversationId);
}

export function setTyping(conversationId: string, workspaceId: string): void {
  presencePubSub.setOnline(workspaceId, conversationId);
  presencePubSub.setTyping(workspaceId, conversationId);
}

export function clearTyping(conversationId: string, workspaceId: string): void {
  presencePubSub.clearTyping(workspaceId, conversationId);
}

export async function presenceRoutes(fastify: FastifyInstance): Promise<void> {
  // Start/refresh typing indicator
  fastify.post<{ Params: { conversationId: string } }>(
    '/v1/conversations/:conversationId/typing',
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

      setTyping(conversationId, ctx.activeWorkspace.id);
      const typers = typingWorkspaces(conversationId).filter((ws) => ws !== ctx.activeWorkspace.id);

      store.recordEvent(ctx.activeWorkspace.id, conversationId, 'conversation.typing', {
        conversationId,
        typingWorkspaceIds: typers,
      });

      return reply.send({ success: true, typingWorkspaceIds: typers });
    }
  );

  // Stop typing
  fastify.delete<{ Params: { conversationId: string } }>(
    '/v1/conversations/:conversationId/typing',
    { preHandler: resolveRequestContext },
    async (request, reply) => {
      const { conversationId } = request.params;
      const ctx = request.orbitContext!;
      clearTyping(conversationId, ctx.activeWorkspace.id);

      store.recordEvent(ctx.activeWorkspace.id, conversationId, 'conversation.typing_stopped', {
        conversationId,
        typingWorkspaceIds: typingWorkspaces(conversationId).filter((ws) => ws !== ctx.activeWorkspace.id),
      });

      return reply.send({ success: true });
    }
  );

  // Mark messages as read (read receipts)
  fastify.post<{ Params: { conversationId: string }; Body: { upToMessageId?: string } }>(
    '/v1/conversations/:conversationId/read',
    { preHandler: resolveRequestContext },
    async (request, reply) => {
      const { conversationId } = request.params;
      const ctx = request.orbitContext!;
      const body = (request.body ?? {}) as { upToMessageId?: string };

      const conversation = store.conversations.get(conversationId);
      if (!conversation) {
        return reply.status(404).send({
          error: { code: 'CONVERSATION_NOT_FOUND', message: 'Conversation not found', requestId: request.id },
        });
      }

      let markedCount = 0;
      for (const msg of store.messages.values()) {
        if (msg.conversationId !== conversationId) continue;
        if (msg.senderWorkspaceId === ctx.activeWorkspace.id) continue;
        if (body.upToMessageId && msg.id !== body.upToMessageId) {
          // Mark everything up to and including upToMessageId
          const target = store.messages.get(body.upToMessageId);
          if (!target || new Date(msg.createdAt) > new Date(target.createdAt)) continue;
        }
        if (msg.deliveryState !== 'read') {
          msg.deliveryState = 'read';
          markedCount++;
          if (store.db) {
            await store.sql('UPDATE message_envelopes SET delivery_state = $2 WHERE id = $1', [
              msg.id,
              'read',
            ]);
          }
        }
      }

      // Reset unread count for this workspace's view
      conversation.unreadCount = 0;

      store.recordEvent(ctx.activeWorkspace.id, conversationId, 'conversation.read', {
        conversationId,
        readByWorkspaceId: ctx.activeWorkspace.id,
        markedCount,
      });
      if (markedCount > 0) {
        store.recordEvent(ctx.activeWorkspace.id, conversationId, 'message.delivery_state_changed', {
          conversationId,
          state: 'read',
          markedCount,
        });
      }

      return reply.send({ success: true, markedCount });
    }
  );

  // Get online presence for conversation participants
  fastify.get<{ Params: { conversationId: string } }>(
    '/v1/conversations/:conversationId/presence',
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

      const typing = typingWorkspaces(conversationId);
      const participants = conversation.participants.map((p) => ({
        workspaceId: p.workspaceId,
        displayName: p.displayName,
        handle: p.handle,
        isOnline: p.workspaceId === ctx.activeWorkspace.id || typing.includes(p.workspaceId),
      }));

      return reply.send({ participants, typingWorkspaceIds: typing });
    }
  );
}
