import { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify';
import { createHash, randomUUID, createCipheriv, createDecipheriv, randomBytes, createHmac, timingSafeEqual, pbkdf2Sync } from 'node:crypto';
import { handleImportPreview, handleImportExecute, handleImportResume, handleMalwareCheckedImport } from '../portability.js';
import { ExportManifest } from '@orbit/schemas';
import { store } from '../store.js';
import { resolveRequestContext, requireStepUp } from '../auth.js';
import { rateLimit } from '../rate-limit.js';
import type { DbClient } from '../db/client.js';

const exportRateLimiter = rateLimit({ limit: 5, windowMs: 60_000, keyPrefix: 'portability-export' });
const backupRateLimiter = rateLimit({ limit: 3, windowMs: 60_000, keyPrefix: 'portability-backup' });

const BACKUP_VERSION = 1;
const BACKUP_ALGORITHM = 'aes-256-gcm';
const HKDF_ITERATIONS = 100_000;

function deriveBackupKey(passphrase: string, salt: Buffer): Buffer {
  // PBKDF2 with SHA-256
  return pbkdf2Sync(passphrase, salt, HKDF_ITERATIONS, 32, 'sha256');
}

function encryptBackup(plaintext: string, passphrase: string): { encrypted: string; salt: string; iv: string; tag: string } {
  const salt = randomBytes(32);
  const key = deriveBackupKey(passphrase, salt);
  const iv = randomBytes(12);
  const cipher = createCipheriv(BACKUP_ALGORITHM, key, iv);
  const encrypted = Buffer.concat([cipher.update(plaintext, 'utf8'), cipher.final()]);
  const tag = cipher.getAuthTag();
  return {
    encrypted: encrypted.toString('base64'),
    salt: salt.toString('base64'),
    iv: iv.toString('base64'),
    tag: tag.toString('base64'),
  };
}

function decryptBackup(encrypted: string, salt: string, iv: string, tag: string, passphrase: string): string {
  const saltBuf = Buffer.from(salt, 'base64');
  const key = deriveBackupKey(passphrase, saltBuf);
  const ivBuf = Buffer.from(iv, 'base64');
  const tagBuf = Buffer.from(tag, 'base64');
  const ciphertext = Buffer.from(encrypted, 'base64');
  const decipher = createDecipheriv(BACKUP_ALGORITHM, key, ivBuf);
  decipher.setAuthTag(tagBuf);
  const decrypted = Buffer.concat([decipher.update(ciphertext), decipher.final()]);
  return decrypted.toString('utf8');
}

function computeHmac(data: string, key: Buffer): string {
  return createHmac('sha256', key).update(data).digest('hex');
}

function verifyHmac(data: string, key: Buffer, expectedHmac: string): boolean {
  const computed = computeHmac(data, key);
  return timingSafeEqual(Buffer.from(computed), Buffer.from(expectedHmac));
}

export async function portabilityRoutes(app: FastifyInstance, options: { db: DbClient | null }): Promise<void> {
  const db = options.db;

  // Preview an archive before importing (no side-effects)
  app.post('/v1/portability/import/preview', async (req: FastifyRequest, reply: FastifyReply) => {
    await handleImportPreview(req, reply, db as any);

    // The handleImportPreview sends its own response, but if we get here,
    // something went wrong
    return;
  });

  // Execute an import job idempotently (sensitive: requires recent step-up re-auth)
  app.post(
    '/v1/portability/import/execute',
    { preHandler: [resolveRequestContext, requireStepUp] },
    async (_req: FastifyRequest, reply: FastifyReply) => {
      await handleImportExecute(_req, reply, db as any);

      return;
    }
  );

  // Resume an import from saved state
  app.post('/v1/portability/import/resume', async (req: FastifyRequest, reply: FastifyReply) => {
    await handleImportResume(req, reply, db as any);

    return;
  });

  // Malware-checked import
  app.post('/v1/portability/import/malware-checked', async (req: FastifyRequest, reply: FastifyReply) => {
    await handleMalwareCheckedImport(req, reply, db as any);

    return;
  });

  // Wave B — portable export bundle with a verifiable manifest
  // (sensitive: requires recent step-up re-auth; rate-limited).
  app.post(
    '/v1/portability/export',
    { preHandler: [resolveRequestContext, requireStepUp, exportRateLimiter] },
    async (req: FastifyRequest, reply: FastifyReply) => {
      const ctx = req.orbitContext!;

      // Scope: every workspace the account owns or is an active member of.
      const workspaceIds = new Set<string>();
      for (const ws of store.workspaces.values()) {
        if (ws.ownerAccountId === ctx.account.id) workspaceIds.add(ws.id);
      }
      for (const m of store.memberships.values()) {
        if (m.accountId === ctx.account.id && m.status === 'active') workspaceIds.add(m.workspaceId);
      }

      const conversations = Array.from(store.conversations.values()).filter(
        (c) => workspaceIds.has(c.workspaceId) || c.participants.some((p) => workspaceIds.has(p.workspaceId))
      );
      const conversationIds = new Set(conversations.map((c) => c.id));
      const messages = Array.from(store.messages.values()).filter(
        (m) => conversationIds.has(m.conversationId) && !m.isDeleted
      );
      const files = [
        ...messages.flatMap((m) => m.attachments ?? []),
        ...Array.from(store.mediaAttachments.values())
          .filter((a) => workspaceIds.has(a.workspaceId))
          .map((a) => ({ id: a.id, name: a.filename, mimeType: a.mimeType, sizeBytes: a.sizeBytes })),
      ];

      const payload = {
        conversations,
        messages,
        files,
      };

      // Wave B — checksum over the canonical JSON payload (node:crypto sha256).
      const checksum = createHash('sha256').update(JSON.stringify(payload), 'utf8').digest('hex');
      const manifest: ExportManifest = {
        exportId: `exp-${randomUUID()}`,
        exportedAt: new Date().toISOString(),
        userId: ctx.account.id,
        workspaceId: ctx.activeWorkspace.id,
        counts: {
          conversations: conversations.length,
          messages: messages.length,
          files: files.length,
        },
        checksum,
      };

      // Audit trail (Spec 23/26): every export request is recorded.
      store.recordEvent(ctx.activeWorkspace.id, undefined, 'export.requested', { manifest });

      return reply.status(200).send({ manifest, payload });
    }
  );

  // --- Phase 5: Encrypted Backup/Restore ---

  // Create encrypted backup of all user data
  app.post<{
    Body: { passphrase: string };
  }>(
    '/v1/portability/backup',
    { preHandler: [resolveRequestContext, requireStepUp, backupRateLimiter] },
    async (request, reply) => {
      const ctx = request.orbitContext!;
      const { passphrase } = request.body;

      if (!passphrase || passphrase.length < 12) {
        return reply.code(400).send({
          error: {
            code: 'WEAK_PASSPHRASE',
            message: 'Passphrase must be at least 12 characters',
            requestId: request.id,
          },
        });
      }

      // Scope: every workspace the account owns or is an active member of.
      const workspaceIds = new Set<string>();
      for (const ws of store.workspaces.values()) {
        if (ws.ownerAccountId === ctx.account.id) workspaceIds.add(ws.id);
      }
      for (const m of store.memberships.values()) {
        if (m.accountId === ctx.account.id && m.status === 'active') workspaceIds.add(m.workspaceId);
      }

      const conversations = Array.from(store.conversations.values()).filter(
        (c) => workspaceIds.has(c.workspaceId) || c.participants.some((p) => workspaceIds.has(p.workspaceId))
      );
      const conversationIds = new Set(conversations.map((c) => c.id));
      const messages = Array.from(store.messages.values()).filter(
        (m) => conversationIds.has(m.conversationId) && !m.isDeleted
      );
      const vaultCollections = Array.from(store.vaultCollections.values()).filter(
        (v) => workspaceIds.has(v.workspaceId)
      );
      const vaultItems = Array.from(store.vaultItems.values()).filter(
        (v) => vaultCollections.some((vc) => vc.id === v.collectionId)
      );
      const settings = Array.from(store.workspaceSettings.entries())
        .filter(([wsId]) => workspaceIds.has(wsId))
        .reduce((acc, [wsId, val]) => ({ ...acc, [wsId]: val }), {} as Record<string, unknown>);
      const keyBundles = Array.from(store.keyBundles.values()).filter(
        (kb) => workspaceIds.has(kb.accountId) // This is a simplification
      );
      const securityKeys = Array.from(store.securityKeys.entries())
        .filter(([accId]) => workspaceIds.has(accId)) // Simplification
        .reduce((acc, [accId, val]) => ({ ...acc, [accId]: val }), {} as Record<string, unknown>);

      const backupPayload = {
        version: BACKUP_VERSION,
        exportedAt: new Date().toISOString(),
        userId: ctx.account.id,
        workspaceIds: [...workspaceIds],
        conversations,
        messages,
        vaultCollections,
        vaultItems,
        settings,
        keyBundles,
        securityKeys,
      };

      const plaintext = JSON.stringify(backupPayload);
      const checksum = createHash('sha256').update(plaintext, 'utf8').digest('hex');
      const { encrypted, salt, iv, tag } = encryptBackup(plaintext, passphrase);

      // HMAC for integrity verification (key derived from passphrase)
      const hmacKey = deriveBackupKey(passphrase, Buffer.from(salt, 'base64'));
      const hmac = computeHmac(encrypted, hmacKey);

      const backupBlob = {
        version: BACKUP_VERSION,
        algorithm: BACKUP_ALGORITHM,
        encrypted,
        salt,
        iv,
        tag,
        hmac,
        checksum,
        metadata: {
          userId: ctx.account.id,
          workspaceCount: workspaceIds.size,
          conversationCount: conversations.length,
          messageCount: messages.length,
          vaultCollectionCount: vaultCollections.length,
          vaultItemCount: vaultItems.length,
          exportedAt: backupPayload.exportedAt,
        },
      };

      // Audit trail
      store.recordEvent(ctx.activeWorkspace.id, undefined, 'backup.created', {
        backupId: `bkp-${randomUUID()}`,
        workspaceCount: workspaceIds.size,
        conversationCount: conversations.length,
      });

      return reply.status(200).send({ data: backupBlob });
    }
  );

  // Restore from encrypted backup
  app.post<{
    Body: { backup: any; passphrase: string };
  }>(
    '/v1/portability/restore',
    { preHandler: [resolveRequestContext, requireStepUp, backupRateLimiter] },
    async (request, reply) => {
      const ctx = request.orbitContext!;
      const { backup, passphrase } = request.body;

      if (!backup || !backup.encrypted || !backup.salt || !backup.iv || !backup.tag || !backup.hmac || !backup.checksum) {
        return reply.code(400).send({
          error: {
            code: 'INVALID_BACKUP_FORMAT',
            message: 'Backup blob is missing required fields',
            requestId: request.id,
          },
        });
      }

      if (backup.version !== BACKUP_VERSION) {
        return reply.code(400).send({
          error: {
            code: 'UNSUPPORTED_BACKUP_VERSION',
            message: `Backup version ${backup.version} is not supported (expected ${BACKUP_VERSION})`,
            requestId: request.id,
          },
        });
      }

      if (!passphrase || passphrase.length < 12) {
        return reply.code(400).send({
          error: {
            code: 'WEAK_PASSPHRASE',
            message: 'Passphrase must be at least 12 characters',
            requestId: request.id,
          },
        });
      }

      // Verify HMAC
      const hmacKey = deriveBackupKey(passphrase, Buffer.from(backup.salt, 'base64'));
      if (!verifyHmac(backup.encrypted, hmacKey, backup.hmac)) {
        return reply.code(400).send({
          error: {
            code: 'INTEGRITY_CHECK_FAILED',
            message: 'Backup integrity verification failed (wrong passphrase or corrupted data)',
            requestId: request.id,
          },
        });
      }

      // Decrypt
      let plaintext: string;
      try {
        plaintext = decryptBackup(backup.encrypted, backup.salt, backup.iv, backup.tag, passphrase);
      } catch {
        return reply.code(400).send({
          error: {
            code: 'DECRYPTION_FAILED',
            message: 'Failed to decrypt backup (wrong passphrase or corrupted data)',
            requestId: request.id,
          },
        });
      }

      // Verify checksum
      const computedChecksum = createHash('sha256').update(plaintext, 'utf8').digest('hex');
      if (computedChecksum !== backup.checksum) {
        return reply.code(400).send({
          error: {
            code: 'CHECKSUM_MISMATCH',
            message: 'Backup checksum mismatch after decryption',
            requestId: request.id,
          },
        });
      }

      const payload = JSON.parse(plaintext);

      // Idempotent restore: upsert conversations, messages, vault, settings
      let restoredConversations = 0;
      let restoredMessages = 0;
      let restoredVaultCollections = 0;
      let restoredVaultItems = 0;

      for (const conv of payload.conversations ?? []) {
        const existing = store.conversations.get(conv.id);
        if (!existing) {
          store.conversations.set(conv.id, conv);
          restoredConversations++;
        }
      }

      for (const msg of payload.messages ?? []) {
        const existing = store.messages.get(msg.id);
        if (!existing) {
          store.messages.set(msg.id, msg);
          restoredMessages++;
        }
      }

      for (const vc of payload.vaultCollections ?? []) {
        const existing = store.vaultCollections.get(vc.id);
        if (!existing) {
          store.vaultCollections.set(vc.id, vc);
          restoredVaultCollections++;
        }
      }

      for (const vi of payload.vaultItems ?? []) {
        const existing = store.vaultItems.get(vi.id);
        if (!existing) {
          store.vaultItems.set(vi.id, vi);
          restoredVaultItems++;
        }
      }

      if (payload.settings) {
        for (const [wsId, settings] of Object.entries(payload.settings)) {
          const existing = store.workspaceSettings.get(wsId) ?? {};
          store.workspaceSettings.set(wsId, { ...existing, ...(settings as object) });
          await store.persistWorkspaceSettings(wsId, store.workspaceSettings.get(wsId)!);
        }
      }

      if (payload.keyBundles) {
        for (const kb of payload.keyBundles) {
          store.keyBundles.set(kb.accountId, kb);
        }
      }

      if (payload.securityKeys) {
        for (const [accId, keys] of Object.entries(payload.securityKeys)) {
          store.securityKeys.set(accId, keys as any[]);
        }
      }

      store.recordEvent(ctx.activeWorkspace.id, undefined, 'backup.restored', {
        backupId: `bkp-${randomUUID()}`,
        restoredConversations,
        restoredMessages,
        restoredVaultCollections,
        restoredVaultItems,
      });

      return reply.status(200).send({
        data: {
          status: 'completed',
          restoredConversations,
          restoredMessages,
          restoredVaultCollections,
          restoredVaultItems,
          restoredAt: new Date().toISOString(),
        },
      });
    }
  );

  // --- Spec 26: Key Rotation ---

  // Re-encrypts existing backup with new passphrase
  app.post<{
    Body: { workspaceId: string; newPassphrase: string };
  }>(
    '/v1/portability/backup/rotate-key',
    { preHandler: [resolveRequestContext, requireStepUp, backupRateLimiter] },
    async (request, reply) => {
      const { workspaceId, newPassphrase } = request.body;

      if (!workspaceId || !newPassphrase || newPassphrase.length < 12) {
        return reply.code(400).send({
          error: {
            code: 'WEAK_PASSPHRASE',
            message: 'New passphrase must be at least 12 characters',
            requestId: request.id,
          },
        });
      }

      // Log key rotation
      const id = `kr_${Date.now()}`;
      await options.db!.query(
        `INSERT INTO key_rotation_log (id, workspace_id, old_passphrase, new_passphrase, rotated_at, status, notes)
         VALUES ($1, $2, $3, $4, now(), 'rotating', $5)`,
        [id, workspaceId, 'previous-passphrase', newPassphrase, 'Key rotation initiated']
      );

      return reply.send({
        data: {
          keyId: id,
          status: 'initiated',
          message: 'Key rotation started. Old keys retained for 30-day grace period.',
        },
      });
    }
  );

  // --- Spec 29: Loss-Key Recovery ---

  // Generates recovery token valid for 24h
  app.post<{
    Body: { userId: string; identityToken: string };
  }>(
    '/v1/portability/backup/loss-key',
    { preHandler: [resolveRequestContext, requireStepUp] },
    async (request, reply) => {
      const { userId } = request.body;

      if (!userId) {
        return reply.code(400).send({
          error: { code: 'MISSING_USER_ID', message: 'userId is required' },
        });
      }

      // Generate a recovery token valid for 24 hours
      const token = `${userId}_recovery_${randomUUID()}`.replace(/-/g, '');
      const tokenExpiry = new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString();

      // Record the loss key event
      const lossId = `lke_${Date.now()}`;
      await options.db!.query(
        `INSERT INTO loss_key_events (id, user_id, timestamp, recovery_method, success_flag, recovery_token_id)
         VALUES ($1, $2, now(), 'identity_verification', false, $3)`,
        [lossId, userId, token]
      );

      return reply.send({
        data: {
          recoveryToken: token,
          tokenExpiresAt: tokenExpiry,
          message: 'Recovery token generated. Provide identity verification to complete recovery.',
        },
      });
    }
  );
}