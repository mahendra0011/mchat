import { FastifyInstance } from 'fastify';
import { IntegrationManifest, CreateConversationGrantSchema } from '@orbit/schemas';
import { resolveRequestContext } from '../auth.js';
import { rateLimit } from '../rate-limit.js';
import { store } from '../store.js';

// Spam control (Spec 14): bound how fast module install prompts can fire.
const installRateLimiter = rateLimit({ limit: 15, windowMs: 60_000, keyPrefix: 'integration-install' });

export async function integrationRoutes(app: FastifyInstance): Promise<void> {
  // List all integrations
  app.get(
    '/v1/integrations',
    { preHandler: [resolveRequestContext] },
    async (req, reply) => {
      const ctx = req.orbitContext!;
      const items = Array.from(store.integrations.values()).filter(
        (int) => !int.workspaceId || int.workspaceId === ctx.activeWorkspace.id
      );
      return reply.send({ data: items });
    }
  );

  // Install an integration to active workspace
  app.post(
    '/v1/integrations/:id/install',
    { preHandler: [resolveRequestContext, installRateLimiter] },
    async (req, reply) => {
      const ctx = req.orbitContext!;
      const { id } = req.params as { id: string };
      const item = store.integrations.get(id);

      if (!item) {
        return reply.status(404).send({
          error: { code: 'NOT_FOUND', message: 'Integration not found.' },
        });
      }

      item.workspaceId = ctx.activeWorkspace.id;
      item.status = 'installed';
      item.installedAt = new Date().toISOString();
      store.integrations.set(item.id, item);
      await store.persistIntegration(item);

      return reply.send({ data: item });
    }
  );

  // Revoke an integration
  app.post(
    '/v1/integrations/:id/revoke',
    { preHandler: [resolveRequestContext] },
    async (req, reply) => {
      const { id } = req.params as { id: string };
      const item = store.integrations.get(id);

      if (!item) {
        return reply.status(404).send({
          error: { code: 'NOT_FOUND', message: 'Integration not found.' },
        });
      }

      item.status = 'revoked';
      store.integrations.set(item.id, item);
      await store.persistIntegration(item);

      return reply.send({ data: item });
    }
  );

  // Register a new custom integration
  app.post(
    '/v1/integrations',
    { preHandler: [resolveRequestContext] },
    async (req, reply) => {
      const ctx = req.orbitContext!;
      const body = req.body as Partial<IntegrationManifest>;

      if (!body.name || !body.scopes) {
        return reply.status(400).send({
          error: { code: 'INVALID_MANIFEST', message: 'Name and scopes are required.' },
        });
      }

      const manifest: IntegrationManifest = {
        id: `int_${Date.now()}`,
        workspaceId: ctx.activeWorkspace.id,
        name: body.name,
        description: body.description || '',
        icon: body.icon || 'bot',
        category: body.category || 'workflow',
        scopes: body.scopes,
        status: 'installed',
        installedAt: new Date().toISOString(),
        webhookUrl: body.webhookUrl,
        webhookSecret: `whsec_${Math.random().toString(36).slice(2)}`,
        dataPolicyUrl: body.dataPolicyUrl || 'https://orbit.local/data-policy',
      };

      store.integrations.set(manifest.id, manifest);
      await store.persistIntegration(manifest);
      return reply.status(201).send({ data: manifest });
    }
  );

  // Per-conversation module grants (Spec 24)

  // POST /v1/integrations/:id/grants/conversations — Grant scopes to a conversation
  app.post<{ Params: { id: string } }>(
    '/v1/integrations/:id/grants/conversations',
    { preHandler: [resolveRequestContext] },
    async (req, reply) => {
      const ctx = req.orbitContext!;
      const { id: integrationId } = req.params as { id: string };

      const integration = store.integrations.get(integrationId);
      if (!integration || integration.workspaceId !== ctx.activeWorkspace.id) {
        return reply.status(404).send({
          error: { code: 'INTEGRATION_NOT_FOUND', message: 'Integration not found or not installed in this workspace' },
        });
      }

      const membership = Array.from(store.memberships.values()).find(
        (m) => m.workspaceId === ctx.activeWorkspace.id && m.accountId === ctx.account.id
      );
      if (!membership || !['owner', 'admin'].includes(membership.role)) {
        return reply.status(403).send({
          error: { code: 'INSUFFICIENT_ROLE', message: 'Only workspace owners and admins can manage per-conversation grants' },
        });
      }

      const parsed = CreateConversationGrantSchema.safeParse(req.body);
      if (!parsed.success) {
        return reply.status(400).send({
          error: { code: 'INVALID_GRANT_PAYLOAD', message: parsed.error.issues[0]?.message || 'Invalid grant payload' },
        });
      }

      const { conversationId, scopes, botPermissions } = parsed.data;

      const conversation = store.conversations.get(conversationId);
      if (!conversation) {
        return reply.status(404).send({
          error: { code: 'CONVERSATION_NOT_FOUND', message: 'Conversation not found' },
        });
      }

      const isParticipant =
        conversation.workspaceId === ctx.activeWorkspace.id ||
        conversation.participants.some((p) => p.workspaceId === ctx.activeWorkspace.id);

      if (!isParticipant) {
        return reply.status(403).send({
          error: { code: 'CONVERSATION_ACCESS_DENIED', message: 'You are not a participant of this conversation' },
        });
      }

      const invalidScopes = scopes.filter((s) => !integration.scopes.includes(s));
      if (invalidScopes.length > 0) {
        return reply.status(400).send({
          error: { code: 'INVALID_SCOPES', message: `Scopes not allowed by integration: ${invalidScopes.join(', ')}` },
        });
      }

      const grantKey = `${integrationId}_${conversationId}`;
      const grant = {
        id: `grant_${Date.now()}`,
        integrationId,
        conversationId,
        grantedBy: ctx.activeWorkspace.id,
        grantedAt: new Date().toISOString(),
        scopes,
        botPermissions: botPermissions ?? { canJoin: true, canReadHistory: false, canSend: false },
      };

      store.conversationModuleGrants.set(grantKey, grant);

      await store.persistConversationGrant(grant);

      return reply.status(201).send({ data: grant });
    }
  );

  // DELETE /v1/integrations/:id/grants/conversations/:conversationId — Revoke per-conversation grant
  app.delete<{ Params: { id: string; conversationId: string } }>(
    '/v1/integrations/:id/grants/conversations/:conversationId',
    { preHandler: [resolveRequestContext] },
    async (req, reply) => {
      const ctx = req.orbitContext!;
      const { id: integrationId, conversationId } = req.params as { id: string; conversationId: string };

      const integration = store.integrations.get(integrationId);
      if (!integration || integration.workspaceId !== ctx.activeWorkspace.id) {
        return reply.status(404).send({
          error: { code: 'INTEGRATION_NOT_FOUND', message: 'Integration not found or not installed in this workspace' },
        });
      }

      const membership = Array.from(store.memberships.values()).find(
        (m) => m.workspaceId === ctx.activeWorkspace.id && m.accountId === ctx.account.id
      );
      if (!membership || !['owner', 'admin'].includes(membership.role)) {
        return reply.status(403).send({
          error: { code: 'INSUFFICIENT_ROLE', message: 'Only workspace owners and admins can manage per-conversation grants' },
        });
      }

      const grantKey = `${integrationId}_${conversationId}`;
      const grant = store.conversationModuleGrants.get(grantKey);
      if (!grant) {
        return reply.status(404).send({
          error: { code: 'GRANT_NOT_FOUND', message: 'Per-conversation grant not found' },
        });
      }

      store.conversationModuleGrants.delete(grantKey);

      if (store.db) {
        await store.sql(
          'DELETE FROM conversation_module_grants WHERE integration_id = $1 AND conversation_id = $2',
          [integrationId, conversationId]
        );
      }

      return reply.status(200).send({ success: true });
    }
  );

  // GET /v1/integrations/:id/grants/conversations — List per-conversation grants
  app.get<{ Params: { id: string } }>(
    '/v1/integrations/:id/grants/conversations',
    { preHandler: [resolveRequestContext] },
    async (req, reply) => {
      const ctx = req.orbitContext!;
      const { id: integrationId } = req.params as { id: string };

      const integration = store.integrations.get(integrationId);
      if (!integration || integration.workspaceId !== ctx.activeWorkspace.id) {
        return reply.status(404).send({
          error: { code: 'INTEGRATION_NOT_FOUND', message: 'Integration not found or not installed in this workspace' },
        });
      }

      const grants = Array.from(store.conversationModuleGrants.values()).filter(
        (g) => g.integrationId === integrationId
      );

      return reply.status(200).send({ data: grants });
    }
  );
}
