import { FastifyInstance } from 'fastify';
import { store } from '../store.js';
import { resolveRequestContext } from '../auth.js';
import { rateLimit } from '../rate-limit.js';
import { localAIHelper, type ConversationSummary, type ReplySuggestion, type ExtractedEntities } from '@orbit/domain';

const aiRateLimiter = rateLimit({ limit: 30, windowMs: 60_000, keyPrefix: 'ai' });

interface SummarizeRequest {
  conversationId: string;
  messageIds?: string[];
}

interface SuggestReplyRequest {
  conversationId: string;
}

interface ExtractEntitiesRequest {
  conversationId: string;
  messageIds?: string[];
}

export async function aiRoutes(app: FastifyInstance): Promise<void> {
  app.post<{ Body: SummarizeRequest }>(
    '/v1/ai/summarize',
    { preHandler: [resolveRequestContext, aiRateLimiter] },
    async (request, reply) => {
      const ctx = request.orbitContext!;
      const { conversationId, messageIds } = request.body;

      const conversation = store.conversations.get(conversationId);
      if (!conversation) {
        return reply.code(404).send({
          error: { code: 'CONVERSATION_NOT_FOUND', message: 'Conversation not found', requestId: request.id },
        });
      }

      const isParticipant =
        conversation.workspaceId === ctx.activeWorkspace.id ||
        conversation.participants.some((p) => p.workspaceId === ctx.activeWorkspace.id);
      if (!isParticipant) {
        return reply.code(403).send({
          error: { code: 'NOT_PARTICIPANT', message: 'Not a participant in this conversation', requestId: request.id },
        });
      }

      let messages = Array.from(store.messages.values()).filter(
        (m) => m.conversationId === conversationId && !m.isDeleted
      );

      if (messageIds?.length) {
        const idSet = new Set(messageIds);
        messages = messages.filter((m) => idSet.has(m.id));
      }

      messages.sort((a, b) => new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime());

      const result: ConversationSummary = await localAIHelper.summarizeConversation(conversationId, messages);
      return reply.send({ data: result });
    }
  );

  app.post<{ Body: SuggestReplyRequest }>(
    '/v1/ai/suggest-reply',
    { preHandler: [resolveRequestContext, aiRateLimiter] },
    async (request, reply) => {
      const ctx = request.orbitContext!;
      const { conversationId } = request.body;

      const conversation = store.conversations.get(conversationId);
      if (!conversation) {
        return reply.code(404).send({
          error: { code: 'CONVERSATION_NOT_FOUND', message: 'Conversation not found', requestId: request.id },
        });
      }

      const isParticipant =
        conversation.workspaceId === ctx.activeWorkspace.id ||
        conversation.participants.some((p) => p.workspaceId === ctx.activeWorkspace.id);
      if (!isParticipant) {
        return reply.code(403).send({
          error: { code: 'NOT_PARTICIPANT', message: 'Not a participant in this conversation', requestId: request.id },
        });
      }

      const messages = Array.from(store.messages.values())
        .filter((m) => m.conversationId === conversationId && !m.isDeleted)
        .sort((a, b) => new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime())
        .slice(-10);

      const result: ReplySuggestion = await localAIHelper.suggestReply(conversationId, {
        recentMessages: messages,
        userWorkspaceId: ctx.activeWorkspace.id,
      });

      return reply.send({ data: result });
    }
  );

  app.post<{ Body: ExtractEntitiesRequest }>(
    '/v1/ai/extract-entities',
    { preHandler: [resolveRequestContext, aiRateLimiter] },
    async (request, reply) => {
      const ctx = request.orbitContext!;
      const { conversationId, messageIds } = request.body;

      const conversation = store.conversations.get(conversationId);
      if (!conversation) {
        return reply.code(404).send({
          error: { code: 'CONVERSATION_NOT_FOUND', message: 'Conversation not found', requestId: request.id },
        });
      }

      const isParticipant =
        conversation.workspaceId === ctx.activeWorkspace.id ||
        conversation.participants.some((p) => p.workspaceId === ctx.activeWorkspace.id);
      if (!isParticipant) {
        return reply.code(403).send({
          error: { code: 'NOT_PARTICIPANT', message: 'Not a participant in this conversation', requestId: request.id },
        });
      }

      let messages = Array.from(store.messages.values()).filter(
        (m) => m.conversationId === conversationId && !m.isDeleted
      );

      if (messageIds?.length) {
        const idSet = new Set(messageIds);
        messages = messages.filter((m) => idSet.has(m.id));
      }

      const result: ExtractedEntities = await localAIHelper.extractEntities(messages);
      return reply.send({ data: result });
    }
  );
}