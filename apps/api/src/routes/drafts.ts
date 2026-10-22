import { FastifyInstance } from 'fastify';
import { store } from '../store.js';
import { resolveRequestContext } from '../auth.js';

/**
 * Drafts persistence (Spec 02 P0: drafts).
 * Drafts are scoped per (workspace, conversation) and survive restarts via SQL.
 */

export interface Draft {
  id: string;
  workspaceId: string;
  conversationId: string;
  body: string;
  updatedAt: string;
}

// In-memory working set; SQL-backed when DB configured
const drafts = new Map<string, Draft>();

function draftKey(workspaceId: string, conversationId: string): string {
  return `${workspaceId}:${conversationId}`;
}

export async function loadDrafts(): Promise<void> {
  if (!store.db) return;
  const rows = await store.sql('SELECT * FROM drafts');
  for (const row of rows.rows) {
    const draft: Draft = {
      id: String(row.id),
      workspaceId: String(row.workspace_id),
      conversationId: String(row.conversation_id),
      body: String(row.body ?? ''),
      updatedAt: new Date(String(row.updated_at)).toISOString(),
    };
    drafts.set(draftKey(draft.workspaceId, draft.conversationId), draft);
  }
}

export async function draftRoutes(fastify: FastifyInstance): Promise<void> {
  // Get draft for a conversation
  fastify.get<{ Params: { conversationId: string } }>(
    '/v1/conversations/:conversationId/draft',
    { preHandler: resolveRequestContext },
    async (request, reply) => {
      const { conversationId } = request.params;
      const ctx = request.orbitContext!;
      const draft = drafts.get(draftKey(ctx.activeWorkspace.id, conversationId));
      return reply.send({ data: draft ?? null });
    }
  );

  // Upsert draft (create or update)
  fastify.put<{ Params: { conversationId: string }; Body: { body: string } }>(
    '/v1/conversations/:conversationId/draft',
    { preHandler: resolveRequestContext },
    async (request, reply) => {
      const { conversationId } = request.params;
      const ctx = request.orbitContext!;
      const { body } = (request.body ?? {}) as { body?: string };

      if (typeof body !== 'string' || body.length > 10000) {
        return reply.status(400).send({
          error: {
            code: 'INVALID_DRAFT',
            message: 'body must be a string of at most 10000 characters',
            requestId: request.id,
          },
        });
      }

      const key = draftKey(ctx.activeWorkspace.id, conversationId);
      const existing = drafts.get(key);
      const draft: Draft = {
        id: existing?.id ?? `draft_${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
        workspaceId: ctx.activeWorkspace.id,
        conversationId,
        body,
        updatedAt: new Date().toISOString(),
      };
      drafts.set(key, draft);

      if (store.db) {
        await store.sql(
          `INSERT INTO drafts (id, workspace_id, conversation_id, body, updated_at)
           VALUES ($1, $2, $3, $4, $5)
           ON CONFLICT (workspace_id, conversation_id)
           DO UPDATE SET body = EXCLUDED.body, updated_at = EXCLUDED.updated_at`,
          [draft.id, draft.workspaceId, draft.conversationId, draft.body, draft.updatedAt]
        );
      }

      return reply.send({ data: draft });
    }
  );

  // Delete draft (after send or user discard)
  fastify.delete<{ Params: { conversationId: string } }>(
    '/v1/conversations/:conversationId/draft',
    { preHandler: resolveRequestContext },
    async (request, reply) => {
      const { conversationId } = request.params;
      const ctx = request.orbitContext!;
      const key = draftKey(ctx.activeWorkspace.id, conversationId);
      const existing = drafts.get(key);
      drafts.delete(key);

      if (store.db && existing) {
        await store.sql('DELETE FROM drafts WHERE workspace_id = $1 AND conversation_id = $2', [
          ctx.activeWorkspace.id,
          conversationId,
        ]);
      }

      return reply.send({ success: true });
    }
  );
}
