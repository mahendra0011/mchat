import { FastifyInstance } from 'fastify';
import {
  CreateVaultCollectionRequestSchema,
  CreateVaultItemRequestSchema,
  UpdateConversationVaultRequestSchema,
  VaultCollection,
  VaultItem,
  ConversationVaultSettings,
} from '@orbit/schemas';
import { store } from '../store.js';
import { resolveRequestContext, requireStepUp } from '../auth.js';

export async function vaultRoutes(fastify: FastifyInstance): Promise<void> {
  // Get collections for active workspace
  fastify.get('/v1/vault/collections', { preHandler: resolveRequestContext }, async (request, reply) => {
    const ctx = request.orbitContext!;
    const collections = Array.from(store.vaultCollections.values()).filter(
      (c) => c.workspaceId === ctx.activeWorkspace.id
    );
    return reply.status(200).send(collections);
  });

  // Create collection
  fastify.post('/v1/vault/collections', { preHandler: resolveRequestContext }, async (request, reply) => {
    const ctx = request.orbitContext!;
    const parsed = CreateVaultCollectionRequestSchema.safeParse(request.body);
    if (!parsed.success) {
      return reply.status(400).send({
        error: { code: 'INVALID_COLLECTION_PAYLOAD', message: 'Invalid payload', requestId: request.id },
      });
    }

    const collection: VaultCollection = {
      id: `vault-coll-${Date.now()}`,
      workspaceId: ctx.activeWorkspace.id,
      name: parsed.data.name,
      description: parsed.data.description,
      icon: parsed.data.icon || 'folder',
      visibility: parsed.data.visibility || 'private',
      itemCount: 0,
      createdAt: new Date().toISOString(),
    };

    store.vaultCollections.set(collection.id, collection);
    await store.persistVaultCollection(collection);
    return reply.status(201).send(collection);
  });

  // Get items in collection
  fastify.get<{ Params: { collectionId: string } }>(
    '/v1/vault/collections/:collectionId/items',
    { preHandler: resolveRequestContext },
    async (request, reply) => {
      const { collectionId } = request.params;
      const ctx = request.orbitContext!;

      const collection = store.vaultCollections.get(collectionId);
      if (!collection || collection.workspaceId !== ctx.activeWorkspace.id) {
        return reply.status(404).send({
          error: { code: 'COLLECTION_NOT_FOUND', message: 'Collection not found', requestId: request.id },
        });
      }

      const items = Array.from(store.vaultItems.values()).filter(
        (i) => i.collectionId === collectionId
      );
      return reply.status(200).send(items);
    }
  );

  // Save item into vault
  fastify.post('/v1/vault/items', { preHandler: resolveRequestContext }, async (request, reply) => {
    const ctx = request.orbitContext!;
    const parsed = CreateVaultItemRequestSchema.safeParse(request.body);
    if (!parsed.success) {
      return reply.status(400).send({
        error: { code: 'INVALID_ITEM_PAYLOAD', message: 'Invalid payload', requestId: request.id },
      });
    }

    const {
      collectionId,
      itemType,
      sourceConversationId,
      sourceConversationTitle,
      sourceMessageId,
      authorName,
      title,
      content,
      tags,
      userNote,
      reminderAt,
    } = parsed.data;

    const collection = store.vaultCollections.get(collectionId);
    if (!collection) {
      return reply.status(404).send({
        error: { code: 'COLLECTION_NOT_FOUND', message: 'Target collection not found', requestId: request.id },
      });
    }

    const item: VaultItem = {
      id: `vault-item-${Date.now()}`,
      collectionId,
      workspaceId: ctx.activeWorkspace.id,
      itemType,
      sourceConversationId,
      sourceConversationTitle,
      sourceMessageId,
      authorName,
      title,
      content,
      tags,
      userNote,
      reminderAt: reminderAt || null,
      savedAt: new Date().toISOString(),
    };

    store.vaultItems.set(item.id, item);
    collection.itemCount += 1;
    await store.persistVaultItem(item);
    await store.persistVaultCollection(collection);

    return reply.status(201).send(item);
  });

  // ---- Wave B — conversation vault (saved conversations) ----

  // GET a conversation's vault entry: visibility + saved items + availability.
  fastify.get<{ Params: { conversationId: string } }>(
    '/v1/vault/:conversationId',
    { preHandler: resolveRequestContext },
    async (request, reply) => {
      const { conversationId } = request.params;
      const ctx = request.orbitContext!;
      const conversation = store.conversations.get(conversationId);
      const settings = store.conversationVault.get(conversationId);
      const visibility = settings?.visibility ?? 'workspace';
      const memberIds = settings?.memberIds ?? [];

      if (conversation) {
        const isParticipant =
          conversation.workspaceId === ctx.activeWorkspace.id ||
          conversation.participants.some((p) => p.workspaceId === ctx.activeWorkspace.id);
        const isExplicitMember = memberIds.includes(ctx.account.id) || memberIds.includes(ctx.activeWorkspace.id);
        const isVisible =
          visibility === 'all' || isParticipant || isExplicitMember || settings?.workspaceId === ctx.activeWorkspace.id;
        if (!isVisible) {
          return reply.status(403).send({
            error: { code: 'VAULT_ACCESS_DENIED', message: 'This vault entry is not visible to you', requestId: request.id },
          });
        }
      } else if (!settings) {
        // Conversation deleted and never saved into the vault — nothing to show.
        return reply.status(404).send({
          error: { code: 'CONVERSATION_NOT_FOUND', message: 'Conversation not found', requestId: request.id },
        });
      } else if (settings.workspaceId !== ctx.activeWorkspace.id && visibility !== 'all') {
        return reply.status(403).send({
          error: { code: 'VAULT_ACCESS_DENIED', message: 'This vault entry is not visible to you', requestId: request.id },
        });
      }

      const items = Array.from(store.vaultItems.values()).filter((i) => i.sourceConversationId === conversationId);

      return reply.status(200).send({
        conversationId,
        availabilityStatus: conversation ? 'available' : 'unavailable',
        visibility,
        memberIds,
        items,
      });
    }
  );

  // PATCH a conversation's vault visibility (sensitive: requires step-up re-auth).
  fastify.patch<{ Params: { conversationId: string } }>(
    '/v1/vault/:conversationId',
    { preHandler: [resolveRequestContext, requireStepUp] },
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

      const parsed = UpdateConversationVaultRequestSchema.safeParse(request.body);
      if (!parsed.success) {
        return reply.status(400).send({
          error: {
            code: 'INVALID_VAULT_PAYLOAD',
            message: parsed.error.issues[0]?.message || 'Invalid vault payload',
            requestId: request.id,
          },
        });
      }

      const settings: ConversationVaultSettings = {
        conversationId,
        workspaceId: ctx.activeWorkspace.id,
        visibility: parsed.data.visibility,
        memberIds: parsed.data.memberIds ?? [],
        updatedAt: new Date().toISOString(),
      };
      store.conversationVault.set(conversationId, settings);
      await store.persistConversationVault(settings);

      return reply.status(200).send({
        conversationId,
        availabilityStatus: 'available',
        visibility: settings.visibility,
        memberIds: settings.memberIds,
      });
    }
  );
}
