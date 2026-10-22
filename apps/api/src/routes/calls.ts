import type { FastifyInstance } from 'fastify';
import {
  CreateCallRequestSchema,
  CallSignalSchema,
  type CallSession,
  type CallQueuedSignal,
} from '@orbit/schemas';
import { store } from '../store.js';
import { resolveRequestContext } from '../auth.js';
import { rateLimit } from '../rate-limit.js';
import { createSign, createVerify } from 'node:crypto';

// Spam control (Spec 14): bound how fast a workspace can ring others.
const callInviteRateLimiter = rateLimit({ limit: 20, windowMs: 60_000, keyPrefix: 'call-invite' });

const calls = new Map<string, CallSession>();

// Bounded per-call signaling queue (Spec 13 relay): POST .../signal appends a
// relayed signal here, GET .../signals?after=<seq> drains it for a participant.
const signalQueues = new Map<string, CallQueuedSignal[]>();
const SIGNAL_QUEUE_MAX = 50;

function isCallParticipant(workspaceId: string, call: CallSession): boolean {
  return call.callerWorkspaceId === workspaceId || call.calleeWorkspaceIds.includes(workspaceId);
}

// Handoff token secret (in production, use a proper key management system)
const HANDOFF_SECRET = process.env.HANDOFF_SECRET ?? 'dev-handoff-secret-change-in-production';

function generateHandoffToken(callId: string, fromWorkspace: string, toWorkspace: string): string {
  const header = { alg: 'HS256', typ: 'JWT' };
  const now = Math.floor(Date.now() / 1000);
  const payload = {
    callId,
    fromWorkspace,
    toWorkspace,
    iat: now,
    exp: now + 300, // 5 minutes
  };
  const encodedHeader = Buffer.from(JSON.stringify(header)).toString('base64url');
  const encodedPayload = Buffer.from(JSON.stringify(payload)).toString('base64url');
  const sign = createSign('SHA256');
  sign.update(`${encodedHeader}.${encodedPayload}`);
  const signature = sign.sign(HANDOFF_SECRET).toString('base64url');
  return `${encodedHeader}.${encodedPayload}.${signature}`;
}

function verifyHandoffToken(token: string): { callId: string; fromWorkspace: string; toWorkspace: string } | null {
  try {
    const [encodedHeader, encodedPayload, signature] = token.split('.');
    if (!encodedHeader || !encodedPayload || !signature) return null;

    const verify = createVerify('SHA256');
    verify.update(`${encodedHeader}.${encodedPayload}`);
    const isValid = verify.verify(HANDOFF_SECRET, Buffer.from(signature, 'base64url'));
    if (!isValid) return null;

    const payload = JSON.parse(Buffer.from(encodedPayload, 'base64url').toString());
    const now = Math.floor(Date.now() / 1000);
    if (payload.exp < now) return null;

    return { callId: payload.callId, fromWorkspace: payload.fromWorkspace, toWorkspace: payload.toWorkspace };
  } catch {
    return null;
  }
}

export async function callRoutes(app: FastifyInstance): Promise<void> {
  app.post('/v1/conversations/:id/calls', { preHandler: [resolveRequestContext, callInviteRateLimiter] }, async (req, reply) => {
    const ctx = req.orbitContext!;
    const workspaceId = ctx.activeWorkspace.id;
    const { id } = req.params as { id: string };
    const parsed = CreateCallRequestSchema.safeParse({ ...(req.body as object), conversationId: id });
    if (!parsed.success) {
      return reply.code(400).send({ error: 'invalid_body', details: parsed.error.issues });
    }
    const conversation = store.conversations.get(id);
    if (!conversation) {
      return reply.code(404).send({ error: 'conversation_not_found' });
    }
    const isParticipant = conversation.participants.some(
      (p: { workspaceId: string }) => p.workspaceId === workspaceId
    );
    if (!isParticipant) {
      return reply.code(403).send({ error: 'not_participant' });
    }

    // Block enforcement (Spec 14): a blocked workspace cannot initiate a call to a
    // direct conversation with the party that blocked them.
    if (conversation.kind === 'direct') {
      const others = conversation.participants.filter(
        (p: { workspaceId: string }) => p.workspaceId !== workspaceId
      );
      for (const other of others) {
        if (store.isBlockedEitherWay(workspaceId, other.workspaceId)) {
          return reply.code(403).send({ error: 'blocked' });
        }
        // Restrict unknown calls (Spec 14): callee only accepts calls from contacts.
        const otherSettings = store.workspaceSettings.get(other.workspaceId);
        const restrictUnknown = (otherSettings?.privacy as { restrictUnknownCalls?: boolean } | undefined)?.restrictUnknownCalls;
        if (restrictUnknown && !store.hasAcceptedContact(workspaceId, other.workspaceId)) {
          return reply.code(403).send({ error: 'unknown_caller' });
        }
      }
    }

    const call: CallSession = {
      id: `call-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
      conversationId: id,
      callerWorkspaceId: workspaceId,
      calleeWorkspaceIds: conversation.participants
        .filter((p: { workspaceId: string }) => p.workspaceId !== workspaceId)
        .map((p: { workspaceId: string }) => p.workspaceId),
      kind: parsed.data.kind,
      status: 'ringing',
      startedAt: new Date().toISOString(),
      endedAt: null,
      durationSeconds: 0,
      sdpOffer: null,
      sdpAnswer: null,
      iceCandidates: [],
    };
    calls.set(call.id, call);
    store.recordEvent(workspaceId, id, 'call.started', { call });
    return reply.code(201).send({ data: call });
  });

  app.get('/v1/calls/:callId', { preHandler: resolveRequestContext }, async (req, reply) => {
    const ctx = req.orbitContext!;
    const { callId } = req.params as { callId: string };
    const call = calls.get(callId);
    if (!call) return reply.code(404).send({ error: 'call_not_found' });
    if (!isCallParticipant(ctx.activeWorkspace.id, call)) {
      return reply.code(403).send({ error: 'not_participant' });
    }
    return reply.send({ data: call });
  });

  app.post('/v1/calls/:callId/signal', { preHandler: resolveRequestContext }, async (req, reply) => {
    const ctx = req.orbitContext!;
    const { callId } = req.params as { callId: string };
    const call = calls.get(callId);
    if (!call) return reply.code(404).send({ error: 'call_not_found' });
    if (!isCallParticipant(ctx.activeWorkspace.id, call)) {
      return reply.code(403).send({ error: 'not_participant' });
    }

    const parsed = CallSignalSchema.safeParse({ ...(req.body as object), callId });
    if (!parsed.success) {
      return reply.code(400).send({ error: 'invalid_body', details: parsed.error.issues });
    }

    // Relay: append a bounded, sequenced signal so the other participant can
    // poll it via GET /v1/calls/:callId/signals?after=<seq>.
    const seq = (signalQueues.get(callId)?.length ?? 0) + 1;
    const queued: CallQueuedSignal = {
      seq,
      callId,
      type: parsed.data.type,
      payload: parsed.data.payload,
      senderWorkspaceId: ctx.activeWorkspace.id,
      targetUserId: parsed.data.targetUserId ?? null,
      targetWorkspaceId: parsed.data.targetUserId ?? null,
      createdAt: new Date().toISOString(),
    };
    const queue = signalQueues.get(callId) ?? [];
    queue.push(queued);
    if (queue.length > SIGNAL_QUEUE_MAX) queue.splice(0, queue.length - SIGNAL_QUEUE_MAX);
    signalQueues.set(callId, queue);
    store.recordEvent(ctx.activeWorkspace.id, call.conversationId, 'call.signal', { ...queued });

    // Direct session mutation for offer/answer/hangup (kept for direct callers).
    const payloadStr =
      typeof parsed.data.payload === 'string' ? parsed.data.payload : JSON.stringify(parsed.data.payload);
    switch (parsed.data.type) {
      case 'offer':
        call.sdpOffer = payloadStr;
        call.status = 'active';
        break;
      case 'answer':
        call.sdpAnswer = payloadStr;
        call.status = 'active';
        break;
      case 'ice-candidate':
      case 'candidate':
        call.iceCandidates.push(payloadStr);
        break;
      case 'hangup':
        call.status = 'ended';
        call.endedAt = new Date().toISOString();
        call.durationSeconds = Math.max(
          0,
          Math.floor((new Date(call.endedAt).getTime() - new Date(call.startedAt).getTime()) / 1000)
        );
        store.recordEvent(call.callerWorkspaceId, call.conversationId, 'call.ended', { call, reason: 'hangup' });
        break;
    }
    return reply.send({ data: call });
  });

  // Drain queued signals for this participant (cursor = last seq seen).
  app.get('/v1/calls/:callId/signals', { preHandler: resolveRequestContext }, async (req, reply) => {
    const ctx = req.orbitContext!;
    const { callId } = req.params as { callId: string };
    const call = calls.get(callId);
    if (!call) return reply.code(404).send({ error: 'call_not_found' });
    if (!isCallParticipant(ctx.activeWorkspace.id, call)) {
      return reply.code(403).send({ error: 'not_participant' });
    }
    const after = Number((req.query as { after?: string } | undefined)?.after ?? 0);
    if (!Number.isFinite(after) || after < 0) {
      return reply.code(400).send({ error: 'invalid_cursor', message: 'after must be a non-negative number' });
    }
    const all = signalQueues.get(callId) ?? [];
    const mine = all.filter(
      (s) =>
        s.seq > after &&
        (s.targetUserId === null || s.targetUserId === ctx.activeWorkspace.id || s.senderWorkspaceId === ctx.activeWorkspace.id)
    );
    return reply.send({
      data: { signals: mine, nextCursor: mine.length > 0 ? mine[mine.length - 1].seq : after },
    });
  });

  app.post('/v1/calls/:callId/decline', { preHandler: resolveRequestContext }, async (req, reply) => {
    const ctx = req.orbitContext!;
    const { callId } = req.params as { callId: string };
    const call = calls.get(callId);
    if (!call) return reply.code(404).send({ error: 'call_not_found' });
    if (!isCallParticipant(ctx.activeWorkspace.id, call)) {
      return reply.code(403).send({ error: 'not_participant' });
    }
    call.status = 'declined';
    call.endedAt = new Date().toISOString();
    store.recordEvent(call.callerWorkspaceId, call.conversationId, 'call.ended', { call, reason: 'declined' });
    return reply.send({ data: call });
  });

  app.get('/v1/conversations/:id/calls', { preHandler: resolveRequestContext }, async (req, reply) => {
    const ctx = req.orbitContext!;
    const { id } = req.params as { id: string };
    const conversation = store.conversations.get(id);
    if (!conversation) return reply.code(404).send({ error: 'conversation_not_found' });
    const isParticipant = conversation.participants.some(
      (p: { workspaceId: string }) => p.workspaceId === ctx.activeWorkspace.id
    );
    if (!isParticipant) return reply.code(403).send({ error: 'not_participant' });
    const list = [...calls.values()].filter((c) => c.conversationId === id);
    return reply.send({ data: list });
  });

  // Device handoff for calls (Spec 17 Phase 5)
  app.post('/v1/calls/:callId/handoff', { preHandler: resolveRequestContext }, async (req, reply) => {
    const ctx = req.orbitContext!;
    const { callId } = req.params as { callId: string };
    const { targetWorkspaceId } = req.body as { targetWorkspaceId?: string };

    const call = calls.get(callId);
    if (!call) return reply.code(404).send({ error: 'call_not_found' });
    if (!isCallParticipant(ctx.activeWorkspace.id, call)) {
      return reply.code(403).send({ error: 'not_participant' });
    }

    // If targetWorkspaceId not provided, generate a generic token for any of user's workspaces
    const toWorkspace = targetWorkspaceId ?? ctx.activeWorkspace.id;
    const token = generateHandoffToken(callId, ctx.activeWorkspace.id, toWorkspace);

    store.recordEvent(ctx.activeWorkspace.id, call.conversationId, 'call.handoff.initiated', {
      callId,
      fromWorkspace: ctx.activeWorkspace.id,
      toWorkspace,
    });

    return reply.send({ data: { token, expiresIn: 300 } });
  });

  app.post('/v1/calls/handoff/accept', { preHandler: resolveRequestContext }, async (req, reply) => {
    const ctx = req.orbitContext!;
    const { token } = req.body as { token?: string };

    if (!token) {
      return reply.code(400).send({ error: { code: 'MISSING_TOKEN', message: 'Handoff token is required', requestId: req.id } });
    }

    const verified = verifyHandoffToken(token);
    if (!verified) {
      return reply.code(400).send({ error: { code: 'INVALID_TOKEN', message: 'Invalid or expired handoff token', requestId: req.id } });
    }

    // Verify the target workspace matches the current workspace
    if (verified.toWorkspace !== ctx.activeWorkspace.id) {
      return reply.code(403).send({ error: { code: 'WORKSPACE_MISMATCH', message: 'This token is for a different workspace', requestId: req.id } });
    }

    const call = calls.get(verified.callId);
    if (!call) return reply.code(404).send({ error: 'call_not_found' });

    // Verify the user is a participant in the call (either original or target workspace)
    if (!isCallParticipant(verified.fromWorkspace, call) && !isCallParticipant(verified.toWorkspace, call)) {
      return reply.code(403).send({ error: { code: 'NOT_PARTICIPANT', message: 'Not a participant in this call', requestId: req.id } });
    }

    store.recordEvent(ctx.activeWorkspace.id, call.conversationId, 'call.handoff.accepted', {
      callId: verified.callId,
      fromWorkspace: verified.fromWorkspace,
      toWorkspace: verified.toWorkspace,
    });

    return reply.send({ data: { call, callId: verified.callId } });
  });
}
