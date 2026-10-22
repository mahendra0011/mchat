import { FastifyInstance } from 'fastify';
import { store } from '../store.js';
import { resolveRequestContext } from '../auth.js';
import { rateLimit } from '../rate-limit.js';
import {
  buildSemanticIndex,
  semanticSearch,
  type SemanticSearchHit,
  type E2eeIndexMessage,
} from '@orbit/domain';

const semanticSearchRateLimiter = rateLimit({ limit: 30, windowMs: 60_000, keyPrefix: 'search-semantic' });

// In-memory semantic index cache per workspace
const semanticIndexCache = new Map<string, {
  index: ReturnType<typeof buildSemanticIndex>;
  messages: Map<string, E2eeIndexMessage>;
  builtAt: number;
}>();

const CACHE_TTL_MS = 5 * 60 * 1000; // 5 minutes

function getOrBuildSemanticIndex(workspaceId: string) {
  const now = Date.now();
  const cached = semanticIndexCache.get(workspaceId);
  if (cached && now - cached.builtAt < CACHE_TTL_MS) {
    return cached;
  }

  // Build index from all messages in conversations the workspace participates in
  const messages = new Map<string, E2eeIndexMessage>();
  for (const conv of store.conversations.values()) {
    const isParticipant = conv.workspaceId === workspaceId || conv.participants.some((p) => p.workspaceId === workspaceId);
    if (!isParticipant) continue;

    for (const msg of store.messages.values()) {
      if (msg.conversationId !== conv.id) continue;
      if (msg.isDeleted) continue;
      if (!msg.body?.trim()) continue;

      messages.set(msg.id, {
        id: msg.id,
        conversationId: msg.conversationId,
        senderWorkspaceId: msg.senderWorkspaceId,
        sentAt: new Date(msg.createdAt).getTime(),
        text: msg.body,
      });
    }
  }

  const index = buildSemanticIndex(messages.values());
  const entry = { index, messages, builtAt: now };
  semanticIndexCache.set(workspaceId, entry);
  return entry;
}

export async function semanticSearchRoutes(app: FastifyInstance): Promise<void> {
  app.post<{
    Body: { query: string; conversationId?: string; limit?: number };
  }>(
    '/v1/search/semantic',
    { preHandler: [resolveRequestContext, semanticSearchRateLimiter] },
    async (request, reply) => {
      const ctx = request.orbitContext!;
      const { query, conversationId, limit } = request.body;

      if (!query || query.trim().length < 2) {
        return reply.status(400).send({
          error: {
            code: 'INVALID_SEARCH_QUERY',
            message: 'Search query must be at least 2 characters',
            requestId: request.id,
          },
        });
      }

      const { index, messages } = getOrBuildSemanticIndex(ctx.activeWorkspace.id);
      const hits: SemanticSearchHit[] = semanticSearch(index, query.trim(), messages, {
        limit: limit ?? 50,
        conversationId,
      });

      return reply.send({ data: hits, query: query.trim(), count: hits.length });
    }
  );

  // Admin/debug endpoint to rebuild index
  app.post(
    '/v1/search/semantic/rebuild',
    { preHandler: resolveRequestContext },
    async (request, reply) => {
      const ctx = request.orbitContext!;
      semanticIndexCache.delete(ctx.activeWorkspace.id);
      getOrBuildSemanticIndex(ctx.activeWorkspace.id); // Force rebuild
      return reply.send({ data: { status: 'rebuilt' } });
    }
  );
}