import { FastifyInstance } from 'fastify';
import multipart from '@fastify/multipart';
import { createReadStream, createWriteStream } from 'node:fs';
import { mkdir, stat, readFile, writeFile, open, unlink } from 'node:fs/promises';
import { join, extname } from 'node:path';
import { randomBytes } from 'node:crypto';
import { pipeline } from 'node:stream/promises';
import { store } from '../store.js';
import { resolveRequestContext } from '../auth.js';
import { rateLimit } from '../rate-limit.js';
import { stripJpegExif, looksLikeJpeg } from '../exif.js';
import { scanBlob, quarantineFile } from '../malware-scan.js';
import { createScopedMediaUrl, verifyScopedMediaAccess } from '../signed-url.js';
import type { MessageAttachment } from '@orbit/schemas';

const UPLOAD_DIR = process.env.ORBIT_UPLOAD_DIR || join(process.cwd(), 'uploads');
const MAX_FILE_SIZE = 25 * 1024 * 1024; // 25 MB

// Ensure upload directory exists
async function ensureUploadDir(): Promise<void> {
  try {
    await mkdir(UPLOAD_DIR, { recursive: true });
  } catch {
    // already exists
  }
}

function asciiAt(buffer: Buffer, start: number, text: string): boolean {
  if (buffer.length < start + text.length) return false;
  for (let i = 0; i < text.length; i++) {
    if (buffer[start + i] !== text.charCodeAt(i)) return false;
  }
  return true;
}

/**
 * Spec 14/34 — magic-byte content sniffing. Never trust a client-declared
 * Content-Type: inspect the leading bytes of the stored buffer and return the
 * true MIME type, or null when no known signature matches.
 */
export function sniffMimeType(buffer: Buffer): string | null {
  if (buffer.length >= 8 && asciiAt(buffer, 0, '\x89PNG\r\n\x1a\n')) return 'image/png';
  if (buffer.length >= 3 && buffer[0] === 0xff && buffer[1] === 0xd8 && buffer[2] === 0xff) return 'image/jpeg';
  if (asciiAt(buffer, 0, 'GIF87a') || asciiAt(buffer, 0, 'GIF89a')) return 'image/gif';
  if (asciiAt(buffer, 0, 'RIFF') && asciiAt(buffer, 8, 'WEBP')) return 'image/webp';
  if (asciiAt(buffer, 0, 'RIFF') && asciiAt(buffer, 8, 'WAVE')) return 'audio/wav';
  if (asciiAt(buffer, 0, '%PDF-')) return 'application/pdf';
  if (asciiAt(buffer, 0, 'OggS')) return 'audio/ogg';
  if (buffer.length >= 12 && asciiAt(buffer, 4, 'ftyp')) {
    // ISO BMFF: brand at offset 8. 'M4A ' is the audio m4a brand.
    return asciiAt(buffer, 8, 'M4A') ? 'audio/mp4' : 'video/mp4';
  }
  return null;
}

/** Read the first bytes of a stored file and sniff its MIME type. */
async function sniffFileMimeType(path: string): Promise<string | null> {
  const handle = await open(path, 'r');
  try {
    const buffer = Buffer.alloc(16);
    const { bytesRead } = await handle.read(buffer, 0, 16, 0);
    return sniffMimeType(buffer.subarray(0, bytesRead));
  } finally {
    await handle.close();
  }
}

function safeFilename(name: string): string {
  return name.replace(/[^a-zA-Z0-9._-]/g, '_').slice(0, 120) || 'download';
}

/** Shared authorization: owner workspace, its owner, or a conversation participant. */
function attachmentHasAccess(
  attachmentId: string,
  ownerWorkspaceId: string | null,
  activeWorkspaceId: string,
  accountId: string
): boolean {
  if (!ownerWorkspaceId) return true; // legacy rows without an owner column
  if (activeWorkspaceId === ownerWorkspaceId) return true;
  if (accountId === store.workspaces.get(ownerWorkspaceId)?.ownerAccountId) return true;
  for (const msg of store.messages.values()) {
    if (!msg.attachments?.some((a) => a.id === attachmentId)) continue;
    const conv = store.conversations.get(msg.conversationId);
    if (!conv) continue;
    const isParticipant =
      conv.workspaceId === activeWorkspaceId ||
      conv.participants.some((p) => p.workspaceId === activeWorkspaceId);
    if (isParticipant) return true;
  }
  return false;
}

const uploadRateLimiter = rateLimit({ limit: 30, windowMs: 60_000, keyPrefix: 'media-upload' });

export async function mediaRoutes(fastify: FastifyInstance): Promise<void> {
  await fastify.register(multipart, {
    limits: {
      fileSize: MAX_FILE_SIZE,
      files: 1,
    },
  });

  // Upload a media attachment
  fastify.post(
    '/v1/media/upload',
    { preHandler: [resolveRequestContext, uploadRateLimiter] },
    async (request, reply) => {
      const ctx = request.orbitContext!;
      await ensureUploadDir();

      const file = await request.file();
      if (!file) {
        return reply.status(400).send({
          error: {
            code: 'NO_FILE',
            message: 'No file provided. Use multipart/form-data with a "file" field.',
            requestId: request.id,
          },
        });
      }

      const fileId = `att_${Date.now()}-${randomBytes(6).toString('hex')}`;
      const ext = extname(file.filename) || '.bin';
      const storedName = `${fileId}${ext}`;
      const storedPath = join(UPLOAD_DIR, storedName);

      try {
        await pipeline(file.file, createWriteStream(storedPath));
      } catch (err) {
        if ((err as { code?: string }).code === 'FST_REQ_FILE_TOO_LARGE') {
          return reply.status(413).send({
            error: {
              code: 'FILE_TOO_LARGE',
              message: `File exceeds maximum size of ${MAX_FILE_SIZE / (1024 * 1024)} MB`,
              requestId: request.id,
            },
          });
        }
        throw err;
      }

      // Content-type sniffing (Spec 14/34): the client-declared MIME type is
      // never trusted — the stored bytes decide the served type.
      const sniffedMime = await sniffFileMimeType(storedPath);
      const mimeType: MessageAttachment['mimeType'] = sniffedMime ?? 'application/octet-stream';

      // Media safety / privacy (Spec 14): strip EXIF metadata (incl. location)
      // from JPEG images before they are stored or served.
      if (mimeType === 'image/jpeg') {
        try {
          const original = await readFile(storedPath);
          if (looksLikeJpeg(original)) {
            const stripped = stripJpegExif(original);
            if (stripped.length !== original.length) {
              await writeFile(storedPath, stripped);
            }
          }
        } catch {
          // Best-effort: if stripping fails, keep the original bytes.
        }
      }

      // Malware scanning (Spec 34): scan before accepting.
      const scanBuffer = await readFile(storedPath);
      const scanBlobObj = new Blob([scanBuffer], { type: mimeType });
      const scanResult = await scanBlob(scanBlobObj);
      if (scanResult.isMalicious) {
        await quarantineFile(fileId).catch(() => {});
        await unlink(storedPath).catch(() => {});
        return reply.status(422).send({
          error: {
            code: 'MALWARE_DETECTED',
            message: 'File rejected by malware scan.',
            requestId: request.id,
          },
        });
      }

      const stats = await stat(storedPath);
      const attachment: MessageAttachment = {
        id: fileId,
        name: file.filename,
        mimeType,
        sizeBytes: stats.size,
        url: `/v1/media/${fileId}`,
      };

      // Persist metadata (in-memory index + write-through to SQL when configured).
      await store.persistMediaAttachment({
        id: attachment.id,
        workspaceId: ctx.activeWorkspace.id,
        filename: attachment.name,
        mimeType: attachment.mimeType,
        sizeBytes: attachment.sizeBytes,
        storedPath,
        createdAt: new Date().toISOString(),
      });

      return reply.status(201).send({ data: attachment });
    }
  );

  // Mint a short-lived, signed URL for an attachment (Spec 10 — scoped URLs).
  fastify.get<{ Params: { attachmentId: string }; Querystring: { ttlMs?: string } }>(
    '/v1/media/:attachmentId/scoped-url',
    { preHandler: resolveRequestContext },
    async (request, reply) => {
      const { attachmentId } = request.params;
      const ctx = request.orbitContext!;

      const rec = await store.getMediaAttachment(attachmentId);
      if (!rec) {
        return reply.status(404).send({
          error: { code: 'NOT_FOUND', message: 'Attachment not found', requestId: request.id },
        });
      }
      const ownerWorkspaceId = rec.workspaceId || null;

      if (!attachmentHasAccess(attachmentId, ownerWorkspaceId, ctx.activeWorkspace.id, ctx.account.id)) {
        return reply.status(403).send({
          error: { code: 'FORBIDDEN', message: 'You do not have access to this attachment.', requestId: request.id },
        });
      }

      const query = request.query as { ttlMs?: string };
      const ttlMs = query.ttlMs ? Number(query.ttlMs) : undefined;
      const scoped = createScopedMediaUrl(attachmentId, Number.isFinite(ttlMs) ? { ttlMs } : {});
      return reply.send({
        data: { url: scoped.path, expiresAt: scoped.expiresAt },
      });
    }
  );

  // Download/serve a media attachment
  fastify.get<{ Params: { attachmentId: string } }>(
    '/v1/media/:attachmentId',
    { preHandler: resolveRequestContext },
    async (request, reply) => {
      const { attachmentId } = request.params;

      const rec = await store.getMediaAttachment(attachmentId);
      const storedPath = rec?.storedPath ?? null;
      const mimeType = rec?.mimeType ?? 'application/octet-stream';
      const filename = rec?.filename ?? 'download';
      const ownerWorkspaceId = rec?.workspaceId || null;

      if (!storedPath) {
        return reply.status(404).send({
          error: { code: 'NOT_FOUND', message: 'Attachment not found', requestId: request.id },
        });
      }

      // Scoped URL (Spec 10): a valid, unexpired HMAC signature grants access
      // to this single attachment without a session membership check.
      const query = request.query as { exp?: string; sig?: string };
      const scoped = verifyScopedMediaAccess(attachmentId, query.exp, query.sig);
      if (scoped.valid) {
        // proceed to serve below
      } else if (query.exp || query.sig) {
        // A signature was presented but is invalid/expired -> reject outright.
        return reply.status(403).send({
          error: { code: 'FORBIDDEN', message: `Scoped URL not valid: ${scoped.reason}`, requestId: request.id },
        });
      } else {
        // No scoped signature: fall back to session-based authorization.
        const ctx = request.orbitContext!;
        if (!attachmentHasAccess(attachmentId, ownerWorkspaceId, ctx.activeWorkspace.id, ctx.account.id)) {
          return reply.status(403).send({
            error: {
              code: 'FORBIDDEN',
              message: 'You do not have access to this attachment.',
              requestId: request.id,
            },
          });
        }
      }

      try {
        const stats = await stat(storedPath);
        const dispositionName = safeFilename(filename);
        reply.header('Content-Type', mimeType);
        reply.header('Content-Length', stats.size);
        reply.header('Content-Disposition', `attachment; filename="${dispositionName}"`);
        return reply.send(createReadStream(storedPath));
      } catch {
        return reply.status(404).send({
          error: { code: 'FILE_MISSING', message: 'Attachment file not found on disk', requestId: request.id },
        });
      }
    }
  );
}
