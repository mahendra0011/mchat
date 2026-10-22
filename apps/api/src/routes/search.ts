import { FastifyInstance } from 'fastify';
import { store } from '../store.js';
import { resolveRequestContext } from '../auth.js';
import { rateLimit } from '../rate-limit.js';
import type { MessageEnvelope } from '@orbit/schemas';

// Anti-enumeration / scraping (Spec 14): bound how fast search can be queried.
const searchRateLimiter = rateLimit({ limit: 60, windowMs: 60_000, keyPrefix: 'search' });

export interface MessageSearchHit {
  message: MessageEnvelope;
  conversationId: string;
  conversationTitle: string;
  workspaceId: string;
  snippet: string;
}

export interface ConversationSearchHit {
  conversationId: string;
  title: string;
  kind: string;
  lastMessageSnippet: string | undefined;
  lastMessageAt: string | undefined;
  unreadCount: number;
  isPinned: boolean;
  isMuted: boolean;
}

/**
 * Global + scoped search (Spec 02 P0: message search; Spec 04: search scope).
 * Search is scoped to conversations the caller is a participant of —
 * never leaks across workspace boundaries.
 */
export async function searchRoutes(fastify: FastifyInstance): Promise<void> {
  // Message search across all eligible conversations for the active workspace
  fastify.get<{
    Querystring: { q?: string; scope?: string; conversationId?: string; limit?: string };
  }>('/v1/search/messages', { preHandler: [resolveRequestContext, searchRateLimiter] }, async (request, reply) => {
    const ctx = request.orbitContext!;
    const { q, scope, conversationId } = request.query;
    const limit = Math.min(Math.max(parseInt(request.query.limit ?? '25', 10) || 25, 1), 100);

    if (!q || q.trim().length < 2) {
      return reply.status(400).send({
        error: {
          code: 'INVALID_SEARCH_QUERY',
          message: 'Search query must be at least 2 characters',
          requestId: request.id,
        },
      });
    }

    const needle = q.trim().toLowerCase();
    const eligible = new Set<string>();
    for (const conv of store.conversations.values()) {
      const isParticipant =
        conv.workspaceId === ctx.activeWorkspace.id ||
        conv.participants.some((p) => p.workspaceId === ctx.activeWorkspace.id);
      if (!isParticipant) continue;
      if (conversationId && conv.id !== conversationId) continue;
      if (scope === 'workspace' && conv.workspaceId !== ctx.activeWorkspace.id) continue;
      eligible.add(conv.id);
    }

    const hits: MessageSearchHit[] = [];
    for (const msg of store.messages.values()) {
      if (!eligible.has(msg.conversationId)) continue;
      if (msg.isDeleted) continue;
      if (!msg.body.toLowerCase().includes(needle)) continue;

      const conv = store.conversations.get(msg.conversationId);
      hits.push({
        message: msg,
        conversationId: msg.conversationId,
        conversationTitle: conv?.title ?? 'Conversation',
        workspaceId: conv?.workspaceId ?? '',
        snippet: msg.body.slice(0, 120),
      });
      if (hits.length >= limit) break;
    }

    return reply.send({ data: hits, query: q, count: hits.length });
  });

  // Conversation search (title + snippet) for the active workspace
  fastify.get<{ Querystring: { q?: string; limit?: string } }>(
    '/v1/search/conversations',
    { preHandler: [resolveRequestContext, searchRateLimiter] },
    async (request, reply) => {
      const ctx = request.orbitContext!;
      const { q } = request.query;
      const limit = Math.min(Math.max(parseInt(request.query.limit ?? '25', 10) || 25, 1), 100);

      if (!q || q.trim().length < 2) {
        return reply.status(400).send({
          error: {
            code: 'INVALID_SEARCH_QUERY',
            message: 'Search query must be at least 2 characters',
            requestId: request.id,
          },
        });
      }

      const needle = q.trim().toLowerCase();
      const hits: ConversationSearchHit[] = [];
      for (const conv of store.conversations.values()) {
        const isParticipant =
          conv.workspaceId === ctx.activeWorkspace.id ||
          conv.participants.some((p) => p.workspaceId === ctx.activeWorkspace.id);
        if (!isParticipant) continue;

        const titleMatch = (conv.title ?? '').toLowerCase().includes(needle);
        const snippetMatch = (conv.lastMessageSnippet ?? '').toLowerCase().includes(needle);
        if (!titleMatch && !snippetMatch) continue;

        hits.push({
          conversationId: conv.id,
          title: conv.title ?? 'Conversation',
          kind: conv.kind,
          lastMessageSnippet: conv.lastMessageSnippet,
          lastMessageAt: conv.lastMessageAt,
          unreadCount: conv.unreadCount,
          isPinned: conv.isPinned,
          isMuted: conv.isMuted,
        });
        if (hits.length >= limit) break;
      }

      return reply.send({ data: hits, query: q, count: hits.length });
    }
  );
}
