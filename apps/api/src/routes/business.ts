import { FastifyInstance } from 'fastify';
import { randomUUID } from 'node:crypto';
import {
  CreateInternalNoteRequestSchema,
  UpdateAssignmentRequestSchema,
  SetConversationAssignmentRequestSchema,
  CreateSavedReplyRequestSchema,
  UpdateSavedReplyRequestSchema,
  BusinessInternalNote,
  SavedReply,
} from '@orbit/schemas';
import { assertInternalNoteAccess } from '@orbit/domain';
import { store } from '../store.js';
import { resolveRequestContext } from '../auth.js';
import { hasCapability } from './conversations.js';

export async function businessRoutes(fastify: FastifyInstance): Promise<void> {
  // Get Internal Notes (STRICT PRIVILEGE ENFORCEMENT)
  fastify.get<{ Params: { workspaceId: string; conversationId: string } }>(
    '/v1/business/:workspaceId/conversations/:conversationId/internal-notes',
    { preHandler: resolveRequestContext },
    async (request, reply) => {
      const { workspaceId, conversationId } = request.params;
      const ctx = request.orbitContext!;

      // 1. Verify workspace exists and is a business workspace
      const targetWorkspace = store.workspaces.get(workspaceId);
      if (!targetWorkspace || targetWorkspace.type !== 'business') {
        return reply.status(400).send({
          error: {
            code: 'NOT_A_BUSINESS_WORKSPACE',
            message: 'Internal notes are only available for business workspaces',
            requestId: request.id,
          },
        });
      }

      // 2. Verify requester has membership in this business workspace
      const membership = Array.from(store.memberships.values()).find(
        (m) => m.workspaceId === workspaceId && m.accountId === ctx.account.id && m.status === 'active'
      );

      const isOwner = targetWorkspace.ownerAccountId === ctx.account.id;
      const effectiveRole = isOwner ? 'owner' : membership?.role;

      // 3. Domain invariant assertion
      try {
        assertInternalNoteAccess(true, effectiveRole);
      } catch (err: any) {
        return reply.status(403).send({
          error: {
            code: err.code || 'ACCESS_DENIED',
            message: err.message || 'You do not have permission to view internal notes',
            requestId: request.id,
          },
        });
      }

      // Return notes strictly filtered to this conversation and business workspace
      const notes = Array.from(store.internalNotes.values()).filter(
        (n) => n.workspaceId === workspaceId && n.conversationId === conversationId
      );

      return reply.status(200).send(notes);
    }
  );

  // Create Internal Note
  fastify.post<{ Params: { workspaceId: string; conversationId: string } }>(
    '/v1/business/:workspaceId/conversations/:conversationId/internal-notes',
    { preHandler: resolveRequestContext },
    async (request, reply) => {
      const { workspaceId, conversationId } = request.params;
      const ctx = request.orbitContext!;

      const targetWorkspace = store.workspaces.get(workspaceId);
      if (!targetWorkspace || targetWorkspace.type !== 'business') {
        return reply.status(400).send({
          error: {
            code: 'NOT_A_BUSINESS_WORKSPACE',
            message: 'Internal notes are only available for business workspaces',
            requestId: request.id,
          },
        });
      }

      const membership = Array.from(store.memberships.values()).find(
        (m) => m.workspaceId === workspaceId && m.accountId === ctx.account.id && m.status === 'active'
      );

      const isOwner = targetWorkspace.ownerAccountId === ctx.account.id;
      const effectiveRole = isOwner ? 'owner' : membership?.role;

      try {
        assertInternalNoteAccess(true, effectiveRole);
      } catch (err: any) {
        return reply.status(403).send({
          error: {
            code: err.code || 'ACCESS_DENIED',
            message: err.message || 'You do not have permission to create internal notes',
            requestId: request.id,
          },
        });
      }

      const parsed = CreateInternalNoteRequestSchema.safeParse(request.body);
      if (!parsed.success) {
        return reply.status(400).send({
          error: {
            code: 'INVALID_NOTE_PAYLOAD',
            message: parsed.error.issues[0]?.message || 'Invalid note payload',
            requestId: request.id,
          },
        });
      }

      const note: BusinessInternalNote = {
        id: `note-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
        conversationId,
        workspaceId,
        authorWorkspaceId: ctx.activeWorkspace.id,
        authorName: `${ctx.activeWorkspace.displayName} (${effectiveRole})`,
        authorAvatarUrl: ctx.activeWorkspace.avatarUrl,
        body: parsed.data.body,
        createdAt: new Date().toISOString(),
        resourceType: 'business_internal_note',
      };

      store.internalNotes.set(note.id, note);
      // Durable: isolated table only — never message_envelopes (Spec 07/11)
      await store.persistInternalNote(note);

      // Emit internal event (only for business team listeners)
      store.recordEvent(workspaceId, conversationId, 'business.internal_note_created', { note });

      return reply.status(201).send(note);
    }
  );

  // Update shared inbox assignment & metadata
  fastify.post<{ Params: { workspaceId: string; conversationId: string } }>(
    '/v1/business/:workspaceId/conversations/:conversationId/assignments',
    { preHandler: resolveRequestContext },
    async (request, reply) => {
      const { workspaceId, conversationId } = request.params;
      const ctx = request.orbitContext!;

      // Authz (Spec 14): only active members of this business workspace may set labels/status.
      const targetWorkspace = store.workspaces.get(workspaceId);
      if (!targetWorkspace || targetWorkspace.type !== 'business') {
        return reply.status(400).send({
          error: {
            code: 'NOT_A_BUSINESS_WORKSPACE',
            message: 'Assignments are only available for business workspaces',
            requestId: request.id,
          },
        });
      }
      const membership = Array.from(store.memberships.values()).find(
        (m) => m.workspaceId === workspaceId && m.accountId === ctx.account.id && m.status === 'active'
      );
      const isOwner = targetWorkspace.ownerAccountId === ctx.account.id;
      if (!isOwner && !membership) {
        return reply.status(403).send({
          error: {
            code: 'ACCESS_DENIED',
            message: 'You are not a member of this business workspace',
            requestId: request.id,
          },
        });
      }

      const parsed = UpdateAssignmentRequestSchema.safeParse(request.body);
      if (!parsed.success) {
        return reply.status(400).send({
          error: { code: 'INVALID_ASSIGNMENT_PAYLOAD', message: 'Invalid payload', requestId: request.id },
        });
      }

      const { assigneeWorkspaceId, status, priority, labels } = parsed.data;

      // Wave B — assignment must PERSIST on the conversation record so inbox
      // listings (and restarts, when a DB is configured) reflect ownership.
      const conversation = store.conversations.get(conversationId);
      const assigneeUserId = assigneeWorkspaceId
        ? (store.workspaces.get(assigneeWorkspaceId)?.ownerAccountId ?? null)
        : null;
      if (conversation) {
        conversation.assigneeUserId = assigneeUserId;
        conversation.assignedAt = assigneeWorkspaceId ? new Date().toISOString() : null;
        conversation.updatedAt = new Date().toISOString();
        await store.sql(
          'UPDATE conversations SET assignee_user_id = $2, assigned_at = $3, updated_at = $3 WHERE id = $1',
          [conversationId, conversation.assigneeUserId, conversation.assignedAt]
        );
      }

      const metadata = {
        conversationId,
        workspaceId,
        assigneeWorkspaceId: assigneeWorkspaceId ?? null,
        assigneeUserId,
        status: status || 'open',
        priority: priority || 'normal',
        labels: labels || [],
        updatedAt: new Date().toISOString(),
      };

      store.recordEvent(workspaceId, conversationId, 'business.assignment_changed', { metadata });
      store.recordEvent(workspaceId, conversationId, 'business.conversation.assigned', {
        conversationId,
        assigneeUserId,
        assignedAt: conversation?.assignedAt ?? null,
      });
      return reply.status(200).send(metadata);
    }
  );

  // Wave B — canonical assignment endpoint: PUT /v1/conversations/:id/assignment
  fastify.put<{ Params: { conversationId: string } }>(
    '/v1/conversations/:conversationId/assignment',
    { preHandler: resolveRequestContext },
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

      // Wave B (Spec 07/32): assignment requires the conversations.assign capability.
      if (!hasCapability(ctx, 'conversations.assign')) {
        reply.status(403).send({
          error: {
            code: 'CAPABILITY_DENIED',
            message: "Your workspace role does not include the 'conversations.assign' capability.",
            requestId: request.id,
          },
        });
        return;
      }

      const parsed = SetConversationAssignmentRequestSchema.safeParse(request.body);
      if (!parsed.success) {
        return reply.status(400).send({
          error: {
            code: 'INVALID_ASSIGNMENT_PAYLOAD',
            message: parsed.error.issues[0]?.message || 'Invalid payload',
            requestId: request.id,
          },
        });
      }

      const { assigneeUserId } = parsed.data;
      if (assigneeUserId) {
        const isMember =
          conversation.workspaceId === ctx.activeWorkspace.id &&
          (store.workspaces.get(conversation.workspaceId)?.ownerAccountId === assigneeUserId ||
            Array.from(store.memberships.values()).some(
              (m) =>
                m.workspaceId === conversation.workspaceId &&
                m.accountId === assigneeUserId &&
                m.status === 'active'
            ));
        if (!isMember) {
          return reply.status(400).send({
            error: {
              code: 'ASSIGNEE_NOT_A_MEMBER',
              message: 'assigneeUserId must be an active member of the conversation workspace',
              requestId: request.id,
            },
          });
        }
      }

      conversation.assigneeUserId = assigneeUserId ?? null;
      conversation.assignedAt = assigneeUserId ? new Date().toISOString() : null;
      conversation.updatedAt = new Date().toISOString();
      await store.sql('UPDATE conversations SET assignee_user_id = $2, assigned_at = $3, updated_at = $3 WHERE id = $1', [
        conversationId,
        conversation.assigneeUserId,
        conversation.assignedAt,
      ]);

      store.recordEvent(conversation.workspaceId, conversationId, 'business.conversation.assigned', {
        conversationId,
        assigneeUserId: conversation.assigneeUserId,
        assignedAt: conversation.assignedAt,
      });

      return reply.status(200).send({
        conversationId,
        assigneeUserId: conversation.assigneeUserId,
        assignedAt: conversation.assignedAt,
      });
    }
  );

  // ---- Wave B — saved replies (canned responses), scoped to the active workspace ----

  // Create a saved reply
  fastify.post('/v1/saved-replies', { preHandler: resolveRequestContext }, async (request, reply) => {
    const ctx = request.orbitContext!;
    if (!hasCapability(ctx, 'saved_replies.use')) {
      reply.status(403).send({
        error: {
          code: 'CAPABILITY_DENIED',
          message: "Your workspace role does not include the 'saved_replies.use' capability.",
          requestId: request.id,
        },
      });
      return;
    }
    const parsed = CreateSavedReplyRequestSchema.safeParse(request.body);
    if (!parsed.success) {
      return reply.status(400).send({
        error: {
          code: 'INVALID_SAVED_REPLY_PAYLOAD',
          message: parsed.error.issues[0]?.message || 'Invalid saved reply payload',
          requestId: request.id,
        },
      });
    }

    if (
      parsed.data.shortcut &&
      Array.from(store.savedReplies.values()).some(
        (r) => r.workspaceId === ctx.activeWorkspace.id && r.shortcut === parsed.data.shortcut
      )
    ) {
      return reply.status(409).send({
        error: {
          code: 'SAVED_REPLY_SHORTCUT_TAKEN',
          message: 'A saved reply with this shortcut already exists in this workspace',
          requestId: request.id,
        },
      });
    }

    const now = new Date().toISOString();
    const savedReply: SavedReply = {
      id: randomUUID(),
      workspaceId: ctx.activeWorkspace.id,
      shortcut: parsed.data.shortcut,
      title: parsed.data.title,
      body: parsed.data.body,
      teamId: parsed.data.teamId ?? null,
      createdAt: now,
      updatedAt: now,
    };
    store.savedReplies.set(savedReply.id, savedReply);
    await store.persistSavedReply(savedReply);
    return reply.status(201).send(savedReply);
  });

  // List saved replies for the active workspace
  fastify.get('/v1/saved-replies', { preHandler: resolveRequestContext }, async (request, reply) => {
    const ctx = request.orbitContext!;
    const list = Array.from(store.savedReplies.values()).filter((r) => r.workspaceId === ctx.activeWorkspace.id);
    return reply.status(200).send(list);
  });

  // Update a saved reply
  fastify.patch<{ Params: { savedReplyId: string } }>(
    '/v1/saved-replies/:savedReplyId',
    { preHandler: resolveRequestContext },
    async (request, reply) => {
      const { savedReplyId } = request.params;
      const ctx = request.orbitContext!;
      const savedReply = store.savedReplies.get(savedReplyId);
      if (!savedReply || savedReply.workspaceId !== ctx.activeWorkspace.id) {
        return reply.status(404).send({
          error: { code: 'SAVED_REPLY_NOT_FOUND', message: 'Saved reply not found', requestId: request.id },
        });
      }
      if (!hasCapability(ctx, 'saved_replies.use')) {
        reply.status(403).send({
          error: {
            code: 'CAPABILITY_DENIED',
            message: "Your workspace role does not include the 'saved_replies.use' capability.",
            requestId: request.id,
          },
        });
        return;
      }

      const parsed = UpdateSavedReplyRequestSchema.safeParse(request.body);
      if (!parsed.success) {
        return reply.status(400).send({
          error: {
            code: 'INVALID_SAVED_REPLY_PAYLOAD',
            message: parsed.error.issues[0]?.message || 'Invalid saved reply payload',
            requestId: request.id,
          },
        });
      }
      if (parsed.data.title !== undefined) savedReply.title = parsed.data.title;
      if (parsed.data.body !== undefined) savedReply.body = parsed.data.body;
      if (parsed.data.shortcut !== undefined) savedReply.shortcut = parsed.data.shortcut;
      if (parsed.data.teamId !== undefined) savedReply.teamId = parsed.data.teamId;
      savedReply.updatedAt = new Date().toISOString();
      await store.persistSavedReply(savedReply);
      return reply.status(200).send(savedReply);
    }
  );

  // Delete a saved reply
  fastify.delete<{ Params: { savedReplyId: string } }>(
    '/v1/saved-replies/:savedReplyId',
    { preHandler: resolveRequestContext },
    async (request, reply) => {
      const { savedReplyId } = request.params;
      const ctx = request.orbitContext!;
      const savedReply = store.savedReplies.get(savedReplyId);
      if (!savedReply || savedReply.workspaceId !== ctx.activeWorkspace.id) {
        return reply.status(404).send({
          error: { code: 'SAVED_REPLY_NOT_FOUND', message: 'Saved reply not found', requestId: request.id },
        });
      }
      if (!hasCapability(ctx, 'saved_replies.use')) {
        reply.status(403).send({
          error: {
            code: 'CAPABILITY_DENIED',
            message: "Your workspace role does not include the 'saved_replies.use' capability.",
            requestId: request.id,
          },
        });
        return;
      }
      store.savedReplies.delete(savedReplyId);
      await store.sql('DELETE FROM saved_replies WHERE id = $1', [savedReplyId]);
      return reply.status(200).send({ success: true, savedReplyId });
    }
  );

  // ---- SLA workflow (Spec 33-35) ----

  function slaDeadline(slaType: string): string {
    const now = Date.now();
    const hours = slaType === 'response' ? 1 : slaType === 'escalation' ? 4 : 24;
    return new Date(now + hours * 60 * 60 * 1000).toISOString();
  }

  function autoEscalate(sla: any): void {
    if (sla.status !== 'breach' || sla.resolvedAt) return;
    const breachedFor = Date.now() - new Date(sla.createdAt).getTime();
    if (breachedFor > 24 * 60 * 60 * 1000) {
      sla.status = 'escalated';
      sla.breachCount = (sla.breachCount ?? 0) + 1;
      sla.updatedAt = new Date().toISOString();
      store.workflowSlas.set(sla.id, sla);
      void store.persistWorkflowSla(sla);
      store.adminAuditLogs.push({
        id: `aud_${Date.now()}`,
        actorId: 'system',
        actorRole: 'system_admin',
        action: 'sla.auto_escalated',
        targetType: 'conversation',
        targetId: sla.id,
        justification: `SLA breached >24h; escalated conversation ${sla.conversationId}`,
        ipHash: 'system',
        timestamp: new Date().toISOString(),
      });
    }
  }

  fastify.post('/v1/business/assignments', { preHandler: resolveRequestContext }, async (request, reply) => {
    const body = request.body as { conversationId: string; assigneeUserId: string; slaType: string };
    const { conversationId, assigneeUserId, slaType } = body ?? ({} as any);
    if (!conversationId || !assigneeUserId || !slaType) {
      return reply.status(400).send({ error: { code: 'INVALID_ASSIGNMENT', message: 'conversationId, assigneeUserId, slaType required', requestId: request.id } });
    }
    const sla = {
      id: `sla-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
      conversationId,
      slaType,
      deadline: slaDeadline(slaType),
      status: 'active',
      resolvedAt: null,
      breachCount: 0,
      createdAt: new Date().toISOString(),
    };
    store.workflowSlas.set(sla.id, sla);
    await store.persistWorkflowSla(sla);

    const conversation = store.conversations.get(conversationId);
    if (conversation) {
      conversation.assigneeUserId = assigneeUserId;
      conversation.assignedAt = new Date().toISOString();
      conversation.updatedAt = new Date().toISOString();
      await store.sql('UPDATE conversations SET assignee_user_id = $2, assigned_at = $3, updated_at = $3 WHERE id = $1', [conversationId, assigneeUserId, conversation.assignedAt]);
    }

    return reply.status(201).send({ assignment: { conversationId, assigneeUserId }, sla });
  });

  fastify.get<{ Params: { conversationId: string } }>('/v1/business/sla/:conversationId', { preHandler: resolveRequestContext }, async (request, reply) => {
    const { conversationId } = request.params;
    const slas = Array.from(store.workflowSlas.values()).filter((s: any) => s.conversationId === conversationId);
    for (const s of slas) {
      if (s.status !== 'resolved' && s.status !== 'escalated' && new Date(s.deadline).getTime() < Date.now()) {
        s.status = 'breach';
        store.workflowSlas.set(s.id, s);
        void store.persistWorkflowSla(s);
      }
      autoEscalate(s);
    }
    const latest = slas.length ? slas[slas.length - 1] : null;
    return reply.status(200).send({ data: latest, slas });
  });

  fastify.post<{ Params: { conversationId: string } }>('/v1/business/sla/:conversationId/resolve', { preHandler: resolveRequestContext }, async (request, reply) => {
    const { conversationId } = request.params;
    const body = request.body as { resolvedAt?: string };
    const slas = Array.from(store.workflowSlas.values()).filter((s: any) => s.conversationId === conversationId && s.status !== 'resolved');
    if (slas.length === 0) {
      return reply.status(404).send({ error: { code: 'SLA_NOT_FOUND', message: 'No active SLA for conversation', requestId: request.id } });
    }
    const resolvedAt = body?.resolvedAt ?? new Date().toISOString();
    for (const s of slas) {
      s.status = 'resolved';
      s.resolvedAt = resolvedAt;
      store.workflowSlas.set(s.id, s);
      await store.persistWorkflowSla(s);
    }
    const latest = slas.length ? slas[slas.length - 1] : null;
    return reply.status(200).send({ data: latest, slas, resolvedAt, status: latest?.status });
  });
}
