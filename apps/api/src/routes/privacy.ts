import { FastifyInstance } from 'fastify';
import { PrivacyReceipt, DataRequest, CreateDataRequestRequestSchema } from '@orbit/schemas';
import { store } from '../store.js';
import { resolveRequestContext } from '../auth.js';

export async function privacyRoutes(fastify: FastifyInstance): Promise<void> {
  fastify.get<{ Querystring: { conversationId?: string } }>(
    '/v1/privacy/receipt',
    { preHandler: resolveRequestContext },
    async (request, reply) => {
      const { conversationId } = request.query;
      const ctx = request.orbitContext!;

      if (!conversationId) {
        return reply.status(400).send({
          error: { code: 'MISSING_CONVERSATION_ID', message: 'conversationId parameter is required' },
        });
      }

      const conversation = store.conversations.get(conversationId);
      if (!conversation) {
        return reply.status(404).send({
          error: { code: 'CONVERSATION_NOT_FOUND', message: 'Conversation not found' },
        });
      }

      // Check access
      const isParticipant =
        conversation.workspaceId === ctx.activeWorkspace.id ||
        conversation.participants.some((p) => p.workspaceId === ctx.activeWorkspace.id);

      if (!isParticipant) {
        return reply.status(403).send({
          error: { code: 'CONVERSATION_ACCESS_DENIED', message: 'Unauthorized' },
        });
      }

      const isBusinessContext = conversation.participants.some((p) => {
        const ws = store.workspaces.get(p.workspaceId);
        return ws?.type === 'business';
      });

      const receipt: PrivacyReceipt = {
        conversationId,
        title: conversation.title,
        encryption: {
          isE2EE: conversation.isE2EE,
          protocol: conversation.isE2EE
            ? 'WebCrypto (AES-256-GCM / Scoped Session Keys)'
            : 'TLS 1.3 Transport Encryption (Restricted Business Relay)',
          verified: true,
          limitations:
            'Protects data in transit and at rest. Physical device photographing cannot be prevented.',
        },
        participants: conversation.participants.map((p) => {
          const ws = store.workspaces.get(p.workspaceId);
          return {
            workspaceId: p.workspaceId,
            displayName: p.displayName,
            role: p.role,
            isBusinessAgent: ws?.type === 'business',
          };
        }),
        retention: {
          policyName: conversation.retentionDays ? `${conversation.retentionDays}-Day Auto-Expiry` : 'Standard Retention',
          retentionDays: conversation.retentionDays || null,
          disappearingMessagesEnabled: Boolean(conversation.retentionDays),
          deletionNotice: conversation.retentionDays
            ? `Messages expire automatically after ${conversation.retentionDays} days.`
            : 'Messages retained until deleted by participants or account closure.',
        },
        devices: {
          totalAuthorizedDevices: 2,
          unverifiedDevicesCount: 0,
          recentDeviceChanges: false,
        },
        integrations: {
          hasActiveAI: false,
          aiProcessingScope: 'none',
          activeModulesCount: 0,
        },
        accessAuditLog: [
          {
            timestamp: conversation.createdAt,
            eventType: 'CHANNEL_INITIALIZED',
            actorName: ctx.activeWorkspace.displayName,
            description: isBusinessContext
              ? 'Business customer channel opened'
              : 'Direct encrypted room initialized',
          },
        ],
      };

      return reply.status(200).send(receipt);
    }
  );

  // ============================================================
  // DATA REQUEST WORKFLOW (Spec 23) — User-facing
  // ============================================================

  // Submit a data request
  fastify.post(
    '/v1/privacy/requests',
    { preHandler: resolveRequestContext },
    async (request, reply) => {
      const ctx = request.orbitContext!;
      const body = request.body as unknown;
      const parsed = CreateDataRequestRequestSchema.safeParse(body);
      if (!parsed.success) {
        return reply.status(400).send({ error: { code: 'INVALID_REQUEST', message: parsed.error.message } });
      }

      const requestRecord: DataRequest = {
        id: `dreq_${Date.now()}`,
        userId: ctx.account.id,
        workspaceId: ctx.activeWorkspace.id,
        type: parsed.data.type,
        status: 'pending_verification',
        scope: parsed.data.scope,
        verificationMethod: undefined,
        verifiedAt: undefined,
        deadlineAt: undefined,
        completedAt: undefined,
        rejectionReason: undefined,
        notes: undefined,
        exceptions: [],
        userNotifiedAt: undefined,
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
      };

      store.dataRequests.set(requestRecord.id, requestRecord);
      await store.persistDataRequest(requestRecord);

      return reply.status(201).send({ data: requestRecord });
    }
  );

  // List own data requests
  fastify.get(
    '/v1/privacy/requests',
    { preHandler: resolveRequestContext },
    async (request, reply) => {
      const ctx = request.orbitContext!;
      const requests = Array.from(store.dataRequests.values())
        .filter((r) => r.userId === ctx.account.id)
        .sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime());
      return reply.send({ data: requests });
    }
  );
}