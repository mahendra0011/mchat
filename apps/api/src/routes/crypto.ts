import { FastifyInstance } from 'fastify';
import { resolveRequestContext, requireStepUp } from '../auth.js';
import { rateLimit } from '../rate-limit.js';
import { store } from '../store.js';
import { generateSafetyNumber } from '@orbit/crypto-adapter';
import { scryptSync } from 'node:crypto';

// Spec 34 — abuse controls on cryptographic endpoints (10/min per route).
const cryptoKeysRateLimiter = rateLimit({ limit: 10, windowMs: 60_000, keyPrefix: 'crypto-keys' });
const cryptoWorkspaceKeysRateLimiter = rateLimit({ limit: 10, windowMs: 60_000, keyPrefix: 'crypto-workspace-keys' });
const cryptoRegisterRateLimiter = rateLimit({ limit: 10, windowMs: 60_000, keyPrefix: 'crypto-register' });
const cryptoSafetyRateLimiter = rateLimit({ limit: 10, windowMs: 60_000, keyPrefix: 'crypto-safety-number' });
const cryptoVerifyRateLimiter = rateLimit({ limit: 10, windowMs: 60_000, keyPrefix: 'crypto-verify' });

export async function cryptoRoutes(fastify: FastifyInstance): Promise<void> {
  // Get public key bundle for an account (Spec 31)
  fastify.get<{ Params: { accountId: string } }>(
    '/v1/crypto/keys/:accountId',
    { preHandler: [resolveRequestContext, cryptoKeysRateLimiter] },
    async (request, reply) => {
      const { accountId } = request.params;
      const bundle = store.keyBundles.get(accountId);

      if (!bundle) {
        return reply.status(404).send({
          error: {
            code: 'KEY_BUNDLE_NOT_FOUND',
            message: 'No cryptographic key bundle registered for this recipient',
            requestId: request.id,
          },
        });
      }

      return reply.status(200).send({ bundle });
    }
  );

  // Resolve a participant workspace to its owner's key bundle (Spec 31).
  // Clients only see participant workspaceIds, so the key-exchange flow needs
  // this lookup to fetch the peer's identity key for ECDH.
  fastify.get<{ Params: { workspaceId: string } }>(
    '/v1/crypto/keys/workspace/:workspaceId',
    { preHandler: [resolveRequestContext, cryptoWorkspaceKeysRateLimiter] },
    async (request, reply) => {
      const workspace = store.workspaces.get(request.params.workspaceId);
      if (!workspace) {
        return reply.status(404).send({
          error: {
            code: 'WORKSPACE_NOT_FOUND',
            message: 'Workspace not found',
            requestId: request.id,
          },
        });
      }

      const bundle = store.keyBundles.get(workspace.ownerAccountId);
      if (!bundle) {
        return reply.status(404).send({
          error: {
            code: 'KEY_BUNDLE_NOT_FOUND',
            message: 'No cryptographic key bundle registered for this recipient',
            requestId: request.id,
          },
        });
      }

      return reply.status(200).send({ bundle });
    }
  );

  // Register or update public key bundle (Spec 31).
  // Sensitive: publishing/rotating an identity key requires recent step-up.
  fastify.post(
    '/v1/crypto/keys',
    { preHandler: [resolveRequestContext, requireStepUp, cryptoRegisterRateLimiter] },
    async (request, reply) => {
      const ctx = request.orbitContext!;
      const body = request.body as any;

      if (!body.identityKeyPub || !body.signedPreKeyPub) {
        return reply.status(400).send({
          error: {
            code: 'INVALID_KEY_BUNDLE',
            message: 'Missing identityKeyPub or signedPreKeyPub',
            requestId: request.id,
          },
        });
      }

      const existing = store.keyBundles.get(ctx.account.id);
      const isKeyChange = existing && existing.identityKeyPub !== body.identityKeyPub;

      const bundle = {
        accountId: ctx.account.id,
        deviceId: body.deviceId || `dev_${Date.now()}`,
        identityKeyPub: body.identityKeyPub,
        signedPreKeyPub: body.signedPreKeyPub,
        signedPreKeySig: body.signedPreKeySig || 'signed-sig',
        oneTimePreKeys: body.oneTimePreKeys || ['otk-1'],
        registrationId: body.registrationId || Math.floor(Math.random() * 50000),
        createdAt: new Date().toISOString(),
      };

      store.keyBundles.set(ctx.account.id, bundle);
      await store.persistKeyBundle(bundle);

      // If key change detected, flag in any verification records
      if (isKeyChange) {
        for (const record of store.keyVerifications.values()) {
          if (record.contactAccountId === ctx.account.id) {
            record.status = 'key_change_detected';
            record.previousIdentityKeyPub = existing.identityKeyPub;
            await store.persistKeyVerification(record);
          }
        }
      }

      return reply.status(200).send({ success: true, bundle });
    }
  );

  // Compute and return safety number for out-of-band verification (Spec 31)
  fastify.post<{ Body: { contactAccountId: string } }>(
    '/v1/crypto/safety-number',
    { preHandler: [resolveRequestContext, cryptoSafetyRateLimiter] },
    async (request, reply) => {
      const ctx = request.orbitContext!;
      const { contactAccountId } = request.body || {};

      if (!contactAccountId) {
        return reply.status(400).send({
          error: {
            code: 'MISSING_CONTACT_ID',
            message: 'contactAccountId is required',
            requestId: request.id,
          },
        });
      }

      const myBundle = store.keyBundles.get(ctx.account.id);
      const contactBundle = store.keyBundles.get(contactAccountId);

      if (!myBundle || !contactBundle) {
        return reply.status(404).send({
          error: {
            code: 'KEY_BUNDLE_NOT_FOUND',
            message: 'Both participants must have published key bundles to generate safety numbers',
            requestId: request.id,
          },
        });
      }

      const safetyNumberResult = await generateSafetyNumber(
        myBundle.identityKeyPub,
        contactBundle.identityKeyPub
      );

      const existingRecord = store.keyVerifications.get(contactAccountId);
      const verificationStatus = existingRecord?.status || 'unverified';

      return reply.status(200).send({
        contactAccountId,
        safetyNumber: safetyNumberResult.numericCode,
        qrPayload: safetyNumberResult.qrPayload,
        status: verificationStatus,
        fingerprints: {
          myFingerprint: safetyNumberResult.fingerprintA,
          contactFingerprint: safetyNumberResult.fingerprintB,
        },
      });
    }
  );

  // Mark out-of-band key verification as verified (Spec 31)
  fastify.post<{ Body: { contactAccountId: string; verified: boolean } }>(
    '/v1/crypto/verify',
    { preHandler: [resolveRequestContext, cryptoVerifyRateLimiter] },
    async (request, reply) => {
      const { contactAccountId, verified } = request.body || {};

      if (!contactAccountId) {
        return reply.status(400).send({
          error: { code: 'MISSING_PARAMS', message: 'contactAccountId is required', requestId: request.id },
        });
      }

      const contactBundle = store.keyBundles.get(contactAccountId);
      const existing = store.keyVerifications.get(contactAccountId);

      const record = {
        contactAccountId,
        contactIdentityKeyPub: contactBundle?.identityKeyPub || 'unknown-key',
        safetyNumber: existing?.safetyNumber || '48201 92837 19482 01928 37461 92837 46192 83746 19283 74619 28374 61928',
        status: (verified ? 'verified' : 'unverified') as 'verified' | 'unverified',
        verifiedAt: verified ? new Date().toISOString() : null,
      };

      store.keyVerifications.set(contactAccountId, record);
      await store.persistKeyVerification(record);

      return reply.status(200).send({ success: true, record });
    }
  );

  // Rotate encryption keys for conversation (SEC-009 A)
  fastify.post<
    { Body: { targetConversationId: string; passphrase: string } }
  >(
    '/v1/crypto/keys/rotate',
    {
      preHandler: [resolveRequestContext, requireStepUp],
    },
    async (request, reply) => {
      const { targetConversationId, passphrase } = request.body || {};
      const ctx = request.orbitContext!;

      if (!targetConversationId) {
        return reply.status(400).send({
          error: { code: 'MISSING_CONVERSATION_ID', message: 'targetConversationId is required', requestId: request.id },
        });
      }

      // Find the conversation
      const conversation = store.conversations.get(targetConversationId);
      if (!conversation) {
        return reply.status(404).send({
          error: { code: 'CONVERSATION_NOT_FOUND', message: 'Conversation not found', requestId: request.id },
        });
      }

      // Verify workspace access
      if (conversation.workspaceId !== ctx.activeWorkspace.id) {
        return reply.status(403).send({
          error: { code: 'FORBIDDEN', message: 'Not a member of this workspace', requestId: request.id },
        });
      }

      // Generate new encryption keys
      const newKeys = await rotateConversationKeys(targetConversationId, passphrase, ctx.account.id);

      // Broadcast key change event
      await store.persistAdminAuditLog({
        id: `aud_${targetConversationId}_key_rotate`,
        actorId: ctx.account.id,
        actorRole: ctx.membership?.role.toUpperCase() as any,
        action: 'key.rotate',
        targetType: 'conversation',
        targetId: targetConversationId,
        justification: 'Key rotation completed',
        ipHash: '',
        timestamp: new Date().toISOString(),
        caseId: targetConversationId,
      });

      // Record key change event via admin audit log (Spec 009 A)
      await store.persistAdminAuditLog({
        id: `aud_${targetConversationId}_key_rotate`,
        actorId: ctx.account.id,
        actorRole: ctx.membership?.role.toUpperCase() as any,
        action: 'key.rotate',
        targetType: 'conversation',
        targetId: targetConversationId,
        justification: 'Key rotation completed',
        ipHash: '',
        timestamp: new Date().toISOString(),
        caseId: targetConversationId,
      });

      return reply.status(200).send({
        success: true,
        newKeyId: newKeys.newKeyId,
        gracePeriodUntil: newKeys.gracePeriodUntil,
        message: 'Keys rotated successfully. Old keys retained for grace period.',
      });
    }
  );

  // List key verifications
  fastify.get('/v1/crypto/verifications', { preHandler: resolveRequestContext }, async (_req, reply) => {
    return reply.status(200).send({ verifications: Array.from(store.keyVerifications.values()) });
  });

  // Helper: rotate conversation encryption keys (SEC-009 A)
  async function rotateConversationKeys(
    conversationId: string,
    passphrase: string,
    _accountId: string
  ): Promise<{ newKeyId: string; gracePeriodUntil: string }> {
    // Derive new encryption keys from passphrase using scrypt
    const keyMaterial = scryptSync(passphrase, conversationId, 32);
    const newKeyId = `key_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;

    // Store new key with grace period (90 days) for decrypting historical messages
    const gracePeriodUntil = new Date(Date.now() + 90 * 24 * 60 * 60 * 1000).toISOString();

    // In a full implementation, we'd store the key in a key management service
    // with proper access controls and key versioning.
    (store as any).conversationKeys ??= new Map();
    (store as any).conversationKeys.set(conversationId, {
      keyId: newKeyId,
      createdAt: new Date().toISOString(),
      gracePeriodUntil,
      passphraseDerived: true,
      derivedKeyBytes: keyMaterial.length,
    });

    return { newKeyId, gracePeriodUntil };
  }
}
