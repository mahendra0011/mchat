import { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify';
import {
  UserReport,
  AdminAuditLog,
  UserReportReasonSchema,
  UserReportActionSchema,
  ReportQueueTypeSchema,
  AccessGrant,
  LegalDocument,
  LegalHold,
  CreateAccessGrantRequestSchema,
  CreateLegalHoldRequestSchema,
  ProcessDataRequestRequestSchema,
  CreateLegalDocumentRequestSchema,
  LegalConsentRequestSchema,
} from '@orbit/schemas';
import { sanitizeAuditData, can } from '@orbit/domain';
import { resolveRequestContext, resolveTeamRole, resolveAdminRole, generateAdminToken } from '../auth.js';
import { store } from '../store.js';
import { featureFlags } from '../feature-flags.js';
import { jobQueue } from '../job-queue.js';

function requireAdminRole(allowedRoles: string[]) {
  return async (req: FastifyRequest, reply: FastifyReply): Promise<void> => {
    const adminRole = resolveAdminRole(req.orbitContext!);
    if (!adminRole || !allowedRoles.includes(adminRole)) {
      reply.status(403).send({
        error: {
          code: 'INSUFFICIENT_ADMIN_ROLE',
          message: `Requires admin role: ${allowedRoles.join(' or ')}`,
          requestId: req.id,
        },
      });
    }
  };
}

declare module 'fastify' {
  interface FastifyRequest {
    orbitContext?: import('../auth.js').RequestContext;
  }
}

export async function adminRoutes(app: FastifyInstance): Promise<void> {
  // Short-lived admin token issuance (no permanent admin key)
  app.post('/v1/admin/token', async (req: FastifyRequest, reply: FastifyReply) => {
    const body = (req.body ?? {}) as { adminUserId?: string; scope?: string; expiresIn?: number };
    if (!body.adminUserId || !body.scope) {
      return reply.status(400).send({ error: { code: 'INVALID_ADMIN_TOKEN_REQUEST', message: 'adminUserId and scope are required', requestId: req.id } });
    }
    const record = generateAdminToken(body.adminUserId, body.scope, body.expiresIn);
    return reply.status(201).send({ data: { token: record.token, expiresAt: record.expiresAt, adminUserId: record.adminUserId, scope: record.scope } });
  });
  // Query tamper-evident audit logs (least privilege — Spec 07/14: reviewer-only)
  app.get(
    '/v1/admin/audit-logs',
    { preHandler: [resolveRequestContext] },
    async (req: FastifyRequest, reply: FastifyReply) => {
      const role = resolveTeamRole(req.orbitContext!);
      if (!role || !can(role, 'audit.view')) {
        return reply.status(403).send({
          error: {
            code: 'INSUFFICIENT_CAPABILITY',
            message: 'You do not have permission to view audit logs.',
            requestId: req.id,
          },
        });
      }
      // Return sanitized audit logs with strictly redacted confidential fields
      const sanitizedLogs = store.adminAuditLogs.map((log) => sanitizeAuditData(log as any));
      return reply.send({ data: sanitizedLogs });
    }
  );

  // Trust & safety moderation report queue (Spec 14: reviewers only — analyst can view but not resolve)
  app.get(
    '/v1/admin/reports',
    { preHandler: [resolveRequestContext] },
    async (req: FastifyRequest, reply: FastifyReply) => {
      const role = resolveTeamRole(req.orbitContext!);
      if (!role || !can(role, 'reports.view')) {
        return reply.status(403).send({
          error: {
            code: 'INSUFFICIENT_CAPABILITY',
            message: 'You do not have permission to view the moderation queue.',
            requestId: req.id,
          },
        });
      }
      const reports = Array.from(store.userReports.values());
      return reply.send({ data: reports });
    }
  );

  // Submit report against a user or message
  app.post(
    '/v1/admin/reports',
    { preHandler: [resolveRequestContext] },
    async (req: FastifyRequest, reply: FastifyReply) => {
      const ctx = req.orbitContext!;
      const body = req.body as {
        targetUserId: string;
        targetHandle: string;
        targetConversationId?: string;
        reason: string;
        details?: string;
        evidenceMessageIds?: string[];
      };

      const reasonParsed = UserReportReasonSchema.safeParse(body.reason);
      if (!reasonParsed.success) {
        return reply.status(400).send({
          error: { code: 'INVALID_REASON', message: 'Invalid abuse report reason.' },
        });
      }

      const report: UserReport = {
        id: `rep_${Date.now()}`,
        reporterId: ctx.account.id,
        reporterHandle: ctx.activeWorkspace.handle,
        targetUserId: body.targetUserId,
        targetHandle: body.targetHandle,
        targetConversationId: body.targetConversationId,
        reason: reasonParsed.data,
        details: body.details,
        evidenceMessageIds: Array.isArray(body.evidenceMessageIds) ? body.evidenceMessageIds.slice(0, 20) : [],
        status: 'pending',
        actionTaken: 'none',
        appealStatus: 'none',
        queueType: 'user_report',
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
      };

      store.userReports.set(report.id, report);
      await store.persistUserReport(report);

      // Record audit entry for filing report
      const auditEntry: AdminAuditLog = {
        id: `aud_${Date.now()}`,
        actorId: ctx.account.id,
        actorRole: 'trust_safety',
        action: 'report.submitted',
        targetType: 'report',
        targetId: report.id,
        justification: `User filed abuse report: ${report.reason}`,
        ipHash: 'anon_ip_hash_local',
        timestamp: new Date().toISOString(),
      };
      store.adminAuditLogs.push(auditEntry);
      await store.persistAdminAuditLog(auditEntry);

      return reply.status(201).send({ data: report });
    }
  );

  // Triage and resolve abuse report (Spec 14: reviewer-only, audited)
  app.post(
    '/v1/admin/reports/:id/resolve',
    { preHandler: [resolveRequestContext] },
    async (req: FastifyRequest, reply: FastifyReply) => {
      const ctx = req.orbitContext!;
      const role = resolveTeamRole(ctx);
      if (!role || !can(role, 'reports.resolve')) {
        return reply.status(403).send({
          error: {
            code: 'INSUFFICIENT_CAPABILITY',
            message: 'You do not have permission to resolve reports.',
            requestId: req.id,
          },
        });
      }
      const { id } = req.params as { id: string };
      const body = req.body as { action: string; note: string };
      const report = store.userReports.get(id);

      if (!report) {
        return reply.status(404).send({
          error: { code: 'NOT_FOUND', message: 'Report not found.' },
        });
      }

      const actionParsed = UserReportActionSchema.safeParse(body.action);
      if (!actionParsed.success) {
        return reply.status(400).send({
          error: { code: 'INVALID_ACTION', message: 'Invalid moderation action specified.' },
        });
      }

      report.status = 'resolved';
      report.actionTaken = actionParsed.data;
      report.assignedReviewerId = ctx.account.id;
      report.resolutionNote = body.note;
      report.updatedAt = new Date().toISOString();
      store.userReports.set(report.id, report);
      await store.persistUserReport(report);

      // Enforce material restrictions on the target account (Spec 14).
      if (report.actionTaken === 'suspended' || report.actionTaken === 'temporary_hold') {
        store.suspendedAccounts.add(report.targetUserId);
      } else {
        store.suspendedAccounts.delete(report.targetUserId);
      }

      // Record privileged admin audit log
      const auditEntry: AdminAuditLog = {
        id: `aud_${Date.now()}`,
        actorId: ctx.account.id,
        actorRole: 'trust_safety',
        action: `report.resolved.${report.actionTaken}`,
        targetType: 'report',
        targetId: report.id,
        justification: body.note,
        ipHash: 'admin_local_ip',
        timestamp: new Date().toISOString(),
      };
      store.adminAuditLogs.push(auditEntry);
      await store.persistAdminAuditLog(auditEntry);

      return reply.send({ data: report });
    }
  );

  // Appeal a resolved report (Spec 14: reporter files an appeal with a reason)
  app.post(
    '/v1/admin/reports/:id/appeal',
    { preHandler: [resolveRequestContext] },
    async (req: FastifyRequest, reply: FastifyReply) => {
      const ctx = req.orbitContext!;
      const { id } = req.params as { id: string };
      const body = (req.body ?? {}) as { reason?: string };
      const report = store.userReports.get(id);

      if (!report) {
        return reply.status(404).send({
          error: { code: 'NOT_FOUND', message: 'Report not found.' },
        });
      }

      if (report.reporterId !== ctx.account.id && report.targetUserId !== ctx.account.id) {
        return reply.status(403).send({
          error: {
            code: 'NOT_PARTY',
            message: 'Only the reporter or the reported party can appeal a report decision.',
            requestId: req.id,
          },
        });
      }

      // The accused may only appeal a material restriction against them.
      const isAccused = report.targetUserId === ctx.account.id;
      if (isAccused && report.actionTaken !== 'suspended' && report.actionTaken !== 'temporary_hold') {
        return reply.status(400).send({
          error: {
            code: 'NOT_RESTRICTED',
            message: 'The reported party can only appeal a material restriction.',
            requestId: req.id,
          },
        });
      }

      if (report.status !== 'resolved' && report.status !== 'dismissed') {
        return reply.status(400).send({
          error: {
            code: 'NOT_APPEALABLE',
            message: 'Only resolved or dismissed reports can be appealed.',
            requestId: req.id,
          },
        });
      }

      if (report.appealStatus === 'filed') {
        return reply.status(409).send({
          error: { code: 'APPEAL_EXISTS', message: 'An appeal has already been filed for this report.' },
        });
      }

      report.appealStatus = 'filed';
      report.appealReason = body.reason;
      report.appealedAt = new Date().toISOString();
      report.updatedAt = report.appealedAt;
      store.userReports.set(report.id, report);
      await store.persistUserReport(report);

      const auditEntry: AdminAuditLog = {
        id: `aud_${Date.now()}`,
        actorId: ctx.account.id,
        actorRole: 'trust_safety',
        action: 'report.appeal.filed',
        targetType: 'report',
        targetId: report.id,
        justification: body.reason ?? 'Reporter filed an appeal',
        ipHash: 'anon_ip_hash_local',
        timestamp: new Date().toISOString(),
      };
      store.adminAuditLogs.push(auditEntry);
      await store.persistAdminAuditLog(auditEntry);

      return reply.send({ data: report });
    }
  );

  // Reviewer decides on an appeal (Spec 14: uphold or reject)
  app.post(
    '/v1/admin/reports/:id/appeal/resolve',
    { preHandler: [resolveRequestContext] },
    async (req: FastifyRequest, reply: FastifyReply) => {
      const ctx = req.orbitContext!;
      const role = resolveTeamRole(ctx);
      if (!role || !can(role, 'reports.resolve')) {
        return reply.status(403).send({
          error: {
            code: 'INSUFFICIENT_CAPABILITY',
            message: 'You do not have permission to resolve appeals.',
            requestId: req.id,
          },
        });
      }
      const { id } = req.params as { id: string };
      const body = req.body as { decision: string; note?: string };
      const report = store.userReports.get(id);

      if (!report) {
        return reply.status(404).send({
          error: { code: 'NOT_FOUND', message: 'Report not found.' },
        });
      }

      if (body.decision !== 'upheld' && body.decision !== 'rejected') {
        return reply.status(400).send({
          error: {
            code: 'INVALID_DECISION',
            message: 'Appeal decision must be "upheld" or "rejected".',
            requestId: req.id,
          },
        });
      }

      report.appealStatus = body.decision;
      if (body.decision === 'upheld') {
        // Release any material restriction that was applied (Spec 14).
        if (report.actionTaken === 'suspended' || report.actionTaken === 'temporary_hold') {
          store.suspendedAccounts.delete(report.targetUserId);
        }
        report.actionTaken = 'none';
        report.resolutionNote = body.note || 'Appeal upheld; action reversed.';
      }
      report.updatedAt = new Date().toISOString();
      store.userReports.set(report.id, report);
      await store.persistUserReport(report);

      const auditEntry: AdminAuditLog = {
        id: `aud_${Date.now()}`,
        actorId: ctx.account.id,
        actorRole: 'trust_safety',
        action: `report.appeal.${body.decision}`,
        targetType: 'report',
        targetId: report.id,
        justification: body.note ?? `Appeal ${body.decision}`,
        ipHash: 'admin_local_ip',
        timestamp: new Date().toISOString(),
      };
      store.adminAuditLogs.push(auditEntry);
      await store.persistAdminAuditLog(auditEntry);

      return reply.send({ data: report });
    }
  );

  // Reporter views their own reports and their statuses (Spec 14)
  app.get(
    '/v1/reports/mine',
    { preHandler: [resolveRequestContext] },
    async (req: FastifyRequest, reply: FastifyReply) => {
      const ctx = req.orbitContext!;
      const mine = Array.from(store.userReports.values()).filter((r) => r.reporterId === ctx.account.id);
      return reply.send({ data: mine });
    }
  );

  // Aggregate, privacy-safe transparency summary (Spec 14). No personal data,
  // no message content — only counts and outcome distributions.
  app.get(
    '/v1/transparency/summary',
    { preHandler: [resolveRequestContext] },
    async (_req: FastifyRequest, reply: FastifyReply) => {
      const reports = Array.from(store.userReports.values());
      const byAction: Record<string, number> = { none: 0, warning: 0, temporary_hold: 0, suspended: 0 };
      const byStatus: Record<string, number> = { pending: 0, resolved: 0, dismissed: 0 };
      const byAppeal: Record<string, number> = { none: 0, filed: 0, upheld: 0, rejected: 0 };
      for (const r of reports) {
        const action = r.actionTaken ?? 'none';
        const status = r.status ?? 'pending';
        const appeal = r.appealStatus ?? 'none';
        byAction[action] = (byAction[action] ?? 0) + 1;
        byStatus[status] = (byStatus[status] ?? 0) + 1;
        byAppeal[appeal] = (byAppeal[appeal] ?? 0) + 1;
      }
      return reply.send({
        data: {
          totalReports: reports.length,
          byAction,
          byStatus,
          byAppeal,
          retentionDays: 730,
          generatedAt: new Date().toISOString(),
        },
      });
    }
  );

  // ============================================================
  // TRUST & SAFETY QUEUE EXPANSION (Spec 23)
  // ============================================================

  // Get paginated queue by type
  app.get<{ Querystring: { queueType: string; page?: string; limit?: string } }>(
    '/v1/admin/trust-safety/queues/:queueType',
    { preHandler: [resolveRequestContext, requireAdminRole(['trust_safety', 'system_admin'])] },
    async (req: FastifyRequest, reply: FastifyReply) => {
      const { queueType } = req.params as { queueType: string };
      const queueTypeParsed = ReportQueueTypeSchema.safeParse(queueType);
      if (!queueTypeParsed.success) {
        return reply.status(400).send({ error: { code: 'INVALID_QUEUE_TYPE', message: 'Invalid queue type' } });
      }

      const page = Math.max(1, parseInt((req.query as any).page ?? '1', 10));
      const limit = Math.min(100, Math.max(1, parseInt((req.query as any).limit ?? '50', 10)));
      const offset = (page - 1) * limit;

      let items: any[] = [];

      switch (queueTypeParsed.data) {
        case 'user_report':
          items = Array.from(store.userReports.values())
            .filter((r) => r.queueType === 'user_report')
            .sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime());
          break;
        case 'spam_signal':
          items = Array.from(store.spamSignals.values())
            .sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime());
          break;
        case 'impersonation':
          items = Array.from(store.userReports.values())
            .filter((r) => r.queueType === 'impersonation' || r.reason === 'impersonation')
            .sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime());
          break;
        case 'urgent_safety':
          items = Array.from(store.urgentSafetyCases.values())
            .sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime());
          break;
        case 'repeat_offender': {
          // Workspaces with >3 resolved reports in 30 days
          const thirtyDaysAgo = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000).toISOString();
          const recentResolved = Array.from(store.userReports.values()).filter(
            (r) => r.status === 'resolved' && r.updatedAt >= thirtyDaysAgo
          );
          const workspaceCounts = new Map<string, number>();
          for (const r of recentResolved) {
            const ws = store.workspaces.get(r.targetUserId);
            if (ws) {
              workspaceCounts.set(ws.id, (workspaceCounts.get(ws.id) ?? 0) + 1);
            }
          }
          items = Array.from(workspaceCounts.entries())
            .filter(([, count]) => count > 3)
            .map(([workspaceId, count]) => ({
              workspaceId,
              displayName: store.workspaces.get(workspaceId)?.displayName ?? 'Unknown',
              reportCount: count,
              handle: store.workspaces.get(workspaceId)?.handle ?? 'unknown',
            }))
            .sort((a, b) => b.reportCount - a.reportCount);
          break;
        }
      }

      const total = items.length;
      const paginated = items.slice(offset, offset + limit);

      return reply.send({
        data: paginated,
        pagination: { page, limit, total, totalPages: Math.ceil(total / limit) },
      });
    }
  );

  // Assign reviewer to case
  app.post<{ Params: { id: string } }>(
    '/v1/admin/trust-safety/cases/:id/assign',
    { preHandler: [resolveRequestContext, requireAdminRole(['trust_safety', 'system_admin'])] },
    async (req: FastifyRequest, reply: FastifyReply) => {
      const ctx = req.orbitContext!;
      const { id } = req.params as { id: string };
      const body = req.body as { reviewerId: string };
      const report = store.userReports.get(id);
      const urgentCase = store.urgentSafetyCases.get(id);

      if (!report && !urgentCase) {
        return reply.status(404).send({ error: { code: 'NOT_FOUND', message: 'Case not found' } });
      }

      if (report) {
        report.assignedReviewerId = body.reviewerId;
        report.status = 'under_review';
        report.updatedAt = new Date().toISOString();
        store.userReports.set(report.id, report);
        await store.persistUserReport(report);
      }
      if (urgentCase) {
        urgentCase.assignedReviewer = body.reviewerId;
        urgentCase.status = 'in_progress';
        store.urgentSafetyCases.set(urgentCase.id, urgentCase);
        await store.persistUrgentSafetyCase(urgentCase);
      }

      const auditEntry: AdminAuditLog = {
        id: `aud_${Date.now()}`,
        actorId: ctx.account.id,
        actorRole: 'trust_safety',
        action: 'case.assigned',
        targetType: 'report',
        targetId: id,
        justification: `Assigned to reviewer ${body.reviewerId}`,
        ipHash: 'admin_local_ip',
        timestamp: new Date().toISOString(),
      };
      store.adminAuditLogs.push(auditEntry);
      await store.persistAdminAuditLog(auditEntry);

      return reply.send({ data: report ?? urgentCase });
    }
  );

  // Resolve case
  app.post<{ Params: { id: string } }>(
    '/v1/admin/trust-safety/cases/:id/resolve',
    { preHandler: [resolveRequestContext, requireAdminRole(['trust_safety', 'system_admin'])] },
    async (req: FastifyRequest, reply: FastifyReply) => {
      const ctx = req.orbitContext!;
      const { id } = req.params as { id: string };
      const body = req.body as { action: string; reason: string };
      const report = store.userReports.get(id);
      const urgentCase = store.urgentSafetyCases.get(id);

      if (!report && !urgentCase) {
        return reply.status(404).send({ error: { code: 'NOT_FOUND', message: 'Case not found' } });
      }

      if (report) {
        const actionParsed = UserReportActionSchema.safeParse(body.action);
        if (!actionParsed.success) {
          return reply.status(400).send({ error: { code: 'INVALID_ACTION', message: 'Invalid action' } });
        }
        report.status = 'resolved';
        report.actionTaken = actionParsed.data;
        report.assignedReviewerId = ctx.account.id;
        report.resolutionNote = body.reason;
        report.updatedAt = new Date().toISOString();
        store.userReports.set(report.id, report);
        await store.persistUserReport(report);
      }
      if (urgentCase) {
        urgentCase.status = 'resolved';
        urgentCase.resolvedAt = new Date().toISOString();
        store.urgentSafetyCases.set(urgentCase.id, urgentCase);
        await store.persistUrgentSafetyCase(urgentCase);
      }

      const auditEntry: AdminAuditLog = {
        id: `aud_${Date.now()}`,
        actorId: ctx.account.id,
        actorRole: 'trust_safety',
        action: 'case.resolved',
        targetType: 'report',
        targetId: id,
        justification: body.reason,
        ipHash: 'admin_local_ip',
        timestamp: new Date().toISOString(),
      };
      store.adminAuditLogs.push(auditEntry);
      await store.persistAdminAuditLog(auditEntry);

      return reply.send({ data: report ?? urgentCase });
    }
  );

  // Repeat offenders list
  app.get(
    '/v1/admin/trust-safety/repeat-offenders',
    { preHandler: [resolveRequestContext, requireAdminRole(['trust_safety', 'system_admin'])] },
    async (_req: FastifyRequest, reply: FastifyReply) => {
      const thirtyDaysAgo = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000).toISOString();
      const recentResolved = Array.from(store.userReports.values()).filter(
        (r) => r.status === 'resolved' && r.updatedAt >= thirtyDaysAgo
      );
      const workspaceCounts = new Map<string, { count: number; reports: UserReport[] }>();
      for (const r of recentResolved) {
        const ws = store.workspaces.get(r.targetUserId);
        if (ws) {
          const existing = workspaceCounts.get(ws.id) ?? { count: 0, reports: [] };
          existing.count++;
          existing.reports.push(r);
          workspaceCounts.set(ws.id, existing);
        }
      }
      const offenders = Array.from(workspaceCounts.entries())
        .filter(([, v]) => v.count > 3)
        .map(([workspaceId, v]) => ({
          workspaceId,
          displayName: store.workspaces.get(workspaceId)?.displayName ?? 'Unknown',
          handle: store.workspaces.get(workspaceId)?.handle ?? 'unknown',
          reportCount: v.count,
          recentReports: v.reports.slice(0, 5),
        }))
        .sort((a, b) => b.reportCount - a.reportCount);

      return reply.send({ data: offenders });
    }
  );

  // ============================================================
  // ACCESS GRANTS (Spec 23 — Time-limited, purpose-bound sensitive access)
  // ============================================================

  // Create access grant
  app.post(
    '/v1/admin/access-grants',
    { preHandler: [resolveRequestContext, requireAdminRole(['system_admin'])] },
    async (req: FastifyRequest, reply: FastifyReply) => {
      const ctx = req.orbitContext!;
      const body = req.body as unknown;
      const parsed = CreateAccessGrantRequestSchema.safeParse(body);
      if (!parsed.success) {
        return reply.status(400).send({ error: { code: 'INVALID_REQUEST', message: parsed.error.message } });
      }

      const grant: AccessGrant = {
        id: `grant_${Date.now()}`,
        targetWorkspaceId: parsed.data.targetWorkspaceId,
        grantedByUserId: ctx.account.id,
        approverUserId: parsed.data.approverUserId,
        purpose: parsed.data.purpose,
        capability: 'admin.support',
        durationMinutes: parsed.data.durationMinutes,
        status: 'active',
        createdAt: new Date().toISOString(),
        expiresAt: new Date(Date.now() + parsed.data.durationMinutes * 60 * 1000).toISOString(),
        caseId: `case_${Date.now()}`,
      };

      store.accessGrants.set(grant.id, grant);
      await store.persistAccessGrant(grant);

      const auditEntry: AdminAuditLog = {
        id: `aud_${Date.now()}`,
        actorId: ctx.account.id,
        actorRole: 'system_admin',
        action: 'access_grant.created',
        targetType: 'access_grant',
        targetId: grant.id,
        justification: `Access grant for ${grant.purpose} (${grant.durationMinutes} min)`,
        ipHash: 'admin_local_ip',
        timestamp: new Date().toISOString(),
        caseId: grant.caseId,
      };
      store.adminAuditLogs.push(auditEntry);
      await store.persistAdminAuditLog(auditEntry);

      return reply.status(201).send({ data: grant });
    }
  );

  // List active access grants
  app.get(
    '/v1/admin/access-grants',
    { preHandler: [resolveRequestContext, requireAdminRole(['system_admin', 'security_ops'])] },
    async (_req: FastifyRequest, reply: FastifyReply) => {
      const grants = Array.from(store.accessGrants.values())
        .filter((g) => g.status === 'active' && new Date(g.expiresAt).getTime() > Date.now())
        .sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime());
      return reply.send({ data: grants });
    }
  );

  // Revoke access grant early
  app.delete<{ Params: { id: string } }>(
    '/v1/admin/access-grants/:id',
    { preHandler: [resolveRequestContext, requireAdminRole(['system_admin', 'security_ops'])] },
    async (req: FastifyRequest, reply: FastifyReply) => {
      const ctx = req.orbitContext!;
      const { id } = req.params as { id: string };
      const grant = store.accessGrants.get(id);

      if (!grant) {
        return reply.status(404).send({ error: { code: 'NOT_FOUND', message: 'Access grant not found' } });
      }

      grant.status = 'revoked';
      grant.revokedAt = new Date().toISOString();
      grant.revokedBy = ctx.account.id;
      store.accessGrants.set(grant.id, grant);
      await store.persistAccessGrant(grant);

      const auditEntry: AdminAuditLog = {
        id: `aud_${Date.now()}`,
        actorId: ctx.account.id,
        actorRole: 'system_admin',
        action: 'access_grant.revoked',
        targetType: 'access_grant',
        targetId: grant.id,
        justification: 'Early revocation by admin',
        ipHash: 'admin_local_ip',
        timestamp: new Date().toISOString(),
        caseId: grant.caseId,
      };
      store.adminAuditLogs.push(auditEntry);
      await store.persistAdminAuditLog(auditEntry);

      return reply.send({ data: grant });
    }
  );

  // ============================================================
  // LEGAL DOCUMENT VERSIONING (Spec 23)
  // ============================================================

  // List current versions per type (public)
  app.get(
    '/v1/legal/documents',
    { preHandler: [resolveRequestContext] },
    async (_req: FastifyRequest, reply: FastifyReply) => {
      const docs = Array.from(store.legalDocuments.values());
      const current: Record<string, LegalDocument> = {};
      for (const doc of docs) {
        if (!current[doc.type] || new Date(doc.effectiveAt).getTime() > new Date(current[doc.type].effectiveAt).getTime()) {
          current[doc.type] = doc;
        }
      }
      return reply.send({ data: current });
    }
  );

  // Get current document by type (public)
  app.get<{ Params: { type: string } }>(
    '/v1/legal/documents/:type',
    { preHandler: [resolveRequestContext] },
    async (req: FastifyRequest, reply: FastifyReply) => {
      const { type } = req.params as { type: string };
      const docs = Array.from(store.legalDocuments.values()).filter((d) => d.type === type);
      if (docs.length === 0) {
        return reply.status(404).send({ error: { code: 'NOT_FOUND', message: 'Document type not found' } });
      }
      const current = docs.reduce((latest, doc) =>
        new Date(doc.effectiveAt).getTime() > new Date(latest.effectiveAt).getTime() ? doc : latest
      );
      return reply.send({ data: current });
    }
  );

  // Get current privacy policy (Spec 28)
  app.get(
    '/v1/legal/privacy-policy',
    { preHandler: [resolveRequestContext] },
    async (req: FastifyRequest, reply: FastifyReply) => {
      const now = new Date();
      const privacyPolicyVersion = '1.0.0';
      const privacyPolicyContent = `Orbit Chat Privacy Policy v${privacyPolicyVersion}
Generated: ${now.toISOString()}

Orbit Chat respects your privacy. We collect minimal data necessary to provide chat functionality.
This policy was last updated on ${now.toLocaleDateString()}.

For more information, contact our legal team.`;

      return reply.send({
        data: {
          version: privacyPolicyVersion,
          content: privacyPolicyContent,
          lastUpdated: now,
        },
      });
    }
  );

  // Record user consent (public)
  app.post(
    '/v1/legal/consent',
    { preHandler: [resolveRequestContext] },
    async (req: FastifyRequest, reply: FastifyReply) => {
      const ctx = req.orbitContext!;
      const body = req.body as unknown;
      const parsed = LegalConsentRequestSchema.safeParse(body);
      if (!parsed.success) {
        return reply.status(400).send({ error: { code: 'INVALID_REQUEST', message: parsed.error.message } });
      }

      const doc = store.legalDocuments.get(parsed.data.documentId);
      if (!doc) {
        return reply.status(404).send({ error: { code: 'NOT_FOUND', message: 'Document not found' } });
      }

      const consentId = `consent_${Date.now()}`;
      const consent = {
        id: consentId,
        userId: ctx.account.id,
        documentId: parsed.data.documentId,
        consentedAt: parsed.data.consentedAt,
        version: doc.version,
        ipHash: 'anon_ip_hash_local',
      };
      store.userLegalConsents.set(consentId, consent);
      await store.persistUserLegalConsent(consent);

      return reply.status(201).send({ data: consent });
    }
  );

  // Create new legal document version (system_admin only)
  app.post(
    '/v1/admin/legal/documents',
    { preHandler: [resolveRequestContext, requireAdminRole(['system_admin'])] },
    async (req: FastifyRequest, reply: FastifyReply) => {
      const ctx = req.orbitContext!;
      const body = req.body as unknown;
      const parsed = CreateLegalDocumentRequestSchema.safeParse(body);
      if (!parsed.success) {
        return reply.status(400).send({ error: { code: 'INVALID_REQUEST', message: parsed.error.message } });
      }

      const doc: LegalDocument = {
        id: `legal_${Date.now()}`,
        type: parsed.data.type,
        version: parsed.data.version,
        contentMarkdown: parsed.data.contentMarkdown,
        effectiveAt: parsed.data.effectiveAt,
        jurisdictions: parsed.data.jurisdictions,
        requiredConsent: parsed.data.requiredConsent,
        createdAt: new Date().toISOString(),
        createdBy: ctx.account.id,
      };

      store.legalDocuments.set(doc.id, doc);
      await store.persistLegalDocument(doc);

      const auditEntry: AdminAuditLog = {
        id: `aud_${Date.now()}`,
        actorId: ctx.account.id,
        actorRole: 'system_admin',
        action: 'legal_document.created',
        targetType: 'integration',
        targetId: doc.id,
        justification: `Created ${doc.type} v${doc.version}`,
        ipHash: 'admin_local_ip',
        timestamp: new Date().toISOString(),
      };
      store.adminAuditLogs.push(auditEntry);
      await store.persistAdminAuditLog(auditEntry);

      return reply.status(201).send({ data: doc });
    }
  );

  // ============================================================
  // DATA REQUEST WORKFLOW (Spec 23) — Admin view
  // ============================================================

  // Admin view: list all data requests (support, billing_support)
  app.get(
    '/v1/admin/privacy/requests',
    { preHandler: [resolveRequestContext, requireAdminRole(['support', 'billing_support', 'system_admin', 'trust_safety'])] },
    async (_req: FastifyRequest, reply: FastifyReply) => {
      const requests = Array.from(store.dataRequests.values())
        .sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime());
      return reply.send({ data: requests });
    }
  );

  // Admin: process data request
  app.post<{ Params: { id: string } }>(
    '/v1/admin/privacy/requests/:id/process',
    { preHandler: [resolveRequestContext, requireAdminRole(['support', 'billing_support', 'system_admin', 'trust_safety'])] },
    async (req: FastifyRequest, reply: FastifyReply) => {
      const ctx = req.orbitContext!;
      const { id } = req.params as { id: string };
      const body = req.body as unknown;
      const parsed = ProcessDataRequestRequestSchema.safeParse(body);
      if (!parsed.success) {
        return reply.status(400).send({ error: { code: 'INVALID_REQUEST', message: parsed.error.message } });
      }

      const request = store.dataRequests.get(id);
      if (!request) {
        return reply.status(404).send({ error: { code: 'NOT_FOUND', message: 'Data request not found' } });
      }

      request.status = parsed.data.status;
      request.notes = parsed.data.notes ?? request.notes;
      request.exceptions = parsed.data.exceptions ?? request.exceptions;
      request.updatedAt = new Date().toISOString();

      if (parsed.data.status === 'verified' && !request.verifiedAt) {
        request.verifiedAt = new Date().toISOString();
        request.deadlineAt = new Date(Date.now() + 30 * 24 * 60 * 60 * 1000).toISOString();
      }
      if (parsed.data.status === 'completed') {
        request.completedAt = new Date().toISOString();
        request.userNotifiedAt = new Date().toISOString();
      }
      if (parsed.data.status === 'rejected') {
        request.userNotifiedAt = new Date().toISOString();
      }

      store.dataRequests.set(request.id, request);
      await store.persistDataRequest(request);

      const auditEntry: AdminAuditLog = {
        id: `aud_${Date.now()}`,
        actorId: ctx.account.id,
        actorRole: resolveAdminRole(ctx) ?? 'support',
        action: `data_request.${parsed.data.status}`,
        targetType: 'privacy_request',
        targetId: request.id,
        justification: parsed.data.notes ?? `Data request ${parsed.data.status}`,
        ipHash: 'admin_local_ip',
        timestamp: new Date().toISOString(),
      };
      store.adminAuditLogs.push(auditEntry);
      await store.persistAdminAuditLog(auditEntry);

      return reply.send({ data: request });
    }
  );

  // ============================================================
  // LEGAL HOLD (Spec 23)
  // ============================================================

  // Create legal hold
  app.post(
    '/v1/admin/legal-holds',
    { preHandler: [resolveRequestContext, requireAdminRole(['system_admin', 'security_ops'])] },
    async (req: FastifyRequest, reply: FastifyReply) => {
      const ctx = req.orbitContext!;
      const body = req.body as unknown;
      const parsed = CreateLegalHoldRequestSchema.safeParse(body);
      if (!parsed.success) {
        return reply.status(400).send({ error: { code: 'INVALID_REQUEST', message: parsed.error.message } });
      }

      // Validate conversations exist
      for (const convId of parsed.data.conversationIds) {
        if (!store.conversations.has(convId)) {
          return reply.status(400).send({ error: { code: 'INVALID_CONVERSATION', message: `Conversation ${convId} not found` } });
        }
      }

      const hold: LegalHold = {
        id: `hold_${Date.now()}`,
        workspaceId: parsed.data.workspaceId,
        conversationIds: parsed.data.conversationIds,
        authorizedBy: parsed.data.authorizedBy,
        reason: parsed.data.reason,
        expiresAt: parsed.data.expiresAt,
        status: 'active',
        createdAt: new Date().toISOString(),
      };

      store.legalHolds.set(hold.id, hold);
      await store.persistLegalHold(hold);

      const auditEntry: AdminAuditLog = {
        id: `aud_${Date.now()}`,
        actorId: ctx.account.id,
        actorRole: 'system_admin',
        action: 'legal_hold.created',
        targetType: 'legal_hold',
        targetId: hold.id,
        justification: `Legal hold for ${hold.conversationIds.length} conversations`,
        ipHash: 'admin_local_ip',
        timestamp: new Date().toISOString(),
      };
      store.adminAuditLogs.push(auditEntry);
      await store.persistAdminAuditLog(auditEntry);

      return reply.status(201).send({ data: hold });
    }
  );

  // List active legal holds
  app.get(
    '/v1/admin/legal-holds',
    { preHandler: [resolveRequestContext, requireAdminRole(['system_admin', 'security_ops', 'trust_safety'])] },
    async (_req: FastifyRequest, reply: FastifyReply) => {
      const holds = Array.from(store.legalHolds.values())
        .filter((h) => h.status === 'active' && new Date(h.expiresAt).getTime() > Date.now())
        .sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime());
      return reply.send({ data: holds });
    }
  );

  // Release legal hold
  app.delete<{ Params: { id: string } }>(
    '/v1/admin/legal-holds/:id',
    { preHandler: [resolveRequestContext, requireAdminRole(['system_admin', 'security_ops'])] },
    async (req: FastifyRequest, reply: FastifyReply) => {
      const ctx = req.orbitContext!;
      const { id } = req.params as { id: string };
      const hold = store.legalHolds.get(id);

      if (!hold) {
        return reply.status(404).send({ error: { code: 'NOT_FOUND', message: 'Legal hold not found' } });
      }

      hold.status = 'released';
      hold.releasedAt = new Date().toISOString();
      hold.releasedBy = ctx.account.id;
      store.legalHolds.set(hold.id, hold);
      await store.persistLegalHold(hold);

      const auditEntry: AdminAuditLog = {
        id: `aud_${Date.now()}`,
        actorId: ctx.account.id,
        actorRole: 'system_admin',
        action: 'legal_hold.released',
        targetType: 'legal_hold',
        targetId: hold.id,
        justification: 'Legal hold released by admin',
        ipHash: 'admin_local_ip',
        timestamp: new Date().toISOString(),
      };
      store.adminAuditLogs.push(auditEntry);
      await store.persistAdminAuditLog(auditEntry);

      return reply.send({ data: hold });
    }
  );

  // ============================================================
  // SUPPORT TICKETS (Spec 28)
  // ============================================================

  // Create support ticket (admin only)
  app.post(
    '/v1/support/tickets',
    { preHandler: [resolveRequestContext, requireAdminRole(['system_admin'])] },
    async (req: FastifyRequest, reply: FastifyReply) => {
      const ctx = req.orbitContext!;
      const body = req.body as { title: string; description: string; priority?: 'low' | 'medium' | 'high' };

      if (!body.title || body.title.trim().length === 0) {
        return reply.status(400).send({
          error: { code: 'MISSING_TITLE', message: 'Title is required' },
        });
      }

      if (!body.description || body.description.trim().length === 0) {
        return reply.status(400).send({
          error: { code: 'MISSING_DESCRIPTION', message: 'Description is required' },
        });
      }

      const ticket: {
        id: string;
        title: string;
        description: string;
        priority: 'low' | 'medium' | 'high';
        status: 'open' | 'in_progress' | 'resolved';
        createdAt: string;
        createdBy: string;
      } = {
        id: `ticket_${Date.now()}`,
        title: body.title.trim(),
        description: body.description.trim(),
        priority: body.priority ?? 'medium',
        status: 'open',
        createdAt: new Date().toISOString(),
        createdBy: ctx.account.id,
      };

      store.supportTickets.set(ticket.id, ticket);
      await store.persistSupportTicket(ticket);

      const auditEntry: AdminAuditLog = {
        id: `aud_${Date.now()}`,
        actorId: ctx.account.id,
        actorRole: 'system_admin',
        action: 'support_ticket.created',
        targetType: 'report',
        targetId: ticket.id,
        justification: `Created support ticket: ${ticket.title}`,
        ipHash: 'admin_local_ip',
        timestamp: new Date().toISOString(),
      };
      store.adminAuditLogs.push(auditEntry);
      await store.persistAdminAuditLog(auditEntry);

      return reply.status(201).send({ data: ticket });
    }
  );

  // ============================================================
  // FEATURE FLAGS & KILL SWITCH (Spec 10) - existing
  // ============================================================

  app.get(
    '/v1/admin/feature-flags',
    { preHandler: [resolveRequestContext] },
    async (req: FastifyRequest, reply: FastifyReply) => {
      const role = resolveTeamRole(req.orbitContext!);
      if (!role || !can(role, 'workspace.configure')) {
        return reply.status(403).send({
          error: { code: 'FORBIDDEN', message: 'Requires workspace.configure', requestId: req.id },
        });
      }
      return reply.send({ data: featureFlags.list() });
    }
  );

  // Rollout status per feature (Spec 28)
  app.get(
    '/v1/admin/rollout-status',
    { preHandler: [resolveRequestContext] },
    async (req: FastifyRequest, reply: FastifyReply) => {
      const role = resolveTeamRole(req.orbitContext!);
      if (!role || !can(role, 'workspace.configure')) {
        return reply.status(403).send({
          error: { code: 'FORBIDDEN', message: 'Requires workspace.configure', requestId: req.id },
        });
      }
      const status = featureFlags.list().map((f) => ({
        flag: f.flag,
        enabled: f.enabled,
        rollout_percentage: f.rollout_percentage,
        rolloutStrategy: f.rolloutStrategy,
      }));
      return reply.send({ data: status });
    }
  );

  app.put<{ Params: { flag: string } }>(
    '/v1/admin/feature-flags/:flag',
    { preHandler: [resolveRequestContext] },
    async (req: FastifyRequest, reply: FastifyReply) => {
      const role = resolveTeamRole(req.orbitContext!);
      if (!role || !can(role, 'workspace.configure')) {
        return reply.status(403).send({
          error: { code: 'FORBIDDEN', message: 'Requires workspace.configure', requestId: req.id },
        });
      }
      const { flag } = req.params as { flag: string };
      const body = (req.body ?? {}) as { enabled?: boolean };
      if (typeof body.enabled !== 'boolean') {
        return reply.status(400).send({
          error: { code: 'INVALID_FLAG', message: 'enabled must be a boolean', requestId: req.id },
        });
      }
      featureFlags.setFlag(flag, body.enabled);
      return reply.send({ data: { [flag]: body.enabled } });
    }
  );

  app.put<{ Params: { flag: string; workspaceId: string } }>(
    '/v1/admin/feature-flags/:flag/workspaces/:workspaceId',
    { preHandler: [resolveRequestContext] },
    async (req: FastifyRequest, reply: FastifyReply) => {
      const role = resolveTeamRole(req.orbitContext!);
      if (!role || !can(role, 'workspace.configure')) {
        return reply.status(403).send({
          error: { code: 'FORBIDDEN', message: 'Requires workspace.configure', requestId: req.id },
        });
      }
      const { flag, workspaceId } = req.params as { flag: string; workspaceId: string };
      const body = req.body as { enabled?: boolean; rollout_percentage?: number };
      const enabled = body.enabled ?? true;
      if (typeof enabled !== 'boolean') {
        return reply.status(400).send({
          error: { code: 'INVALID_FLAG', message: 'enabled must be a boolean', requestId: req.id },
        });
      }
      featureFlags.setWorkspaceOverride(flag, workspaceId, enabled, body.rollout_percentage);
      return reply.send({ data: { [`${flag}:${workspaceId}`]: { enabled: body.enabled, rollout_percentage: body.rollout_percentage } } });
    }
  );

  // Gradual rollout control for a feature flag
  app.post(
    '/v1/admin/feature-flags/rollout',
    { preHandler: [resolveRequestContext] },
    async (req: FastifyRequest, reply: FastifyReply) => {
      const role = resolveTeamRole(req.orbitContext!);
      if (!role || !can(role, 'workspace.configure')) {
        return reply.status(403).send({
          error: { code: 'FORBIDDEN', message: 'Requires workspace.configure', requestId: req.id },
        });
      }
      const { flagId, percentage } = req.body as { flagId: string; percentage: number };
      if (typeof percentage !== 'number' || percentage < 0 || percentage > 100) {
        return reply.status(400).send({
          error: { code: 'INVALID_PERCENTAGE', message: 'percentage must be between 0 and 100', requestId: req.id },
        });
      }
      featureFlags.setFlagRolloutPercentage(flagId, percentage);
      return reply.send({ data: { flagId, rollout_percentage: percentage } });
    }
  );

  // Get user-specific feature flags
  app.get(
    '/v1/feature-flags/user/:userId',
    { preHandler: [resolveRequestContext] },
    async (_req: FastifyRequest, reply: FastifyReply) => {
      // In a full implementation, this would check user-specific flag states
      // For now, return the global flag states
      const flags = featureFlags.list();
      return reply.send({ data: flags });
    }
  );

  // Global kill switch — force-disables every flag (incident response).
  app.post(
    '/v1/admin/feature-flags/kill-switch',
    { preHandler: [resolveRequestContext] },
    async (req: FastifyRequest, reply: FastifyReply) => {
      const role = resolveTeamRole(req.orbitContext!);
      if (!role || !can(role, 'workspace.configure')) {
        return reply.status(403).send({
          error: { code: 'FORBIDDEN', message: 'Requires workspace.configure', requestId: req.id },
        });
      }
      const body = req.body as { engaged?: boolean };
      const engaged = body.engaged ?? false;
      if (typeof engaged !== 'boolean') {
        return reply.status(400).send({
          error: { code: 'INVALID_KILL_SWITCH', message: 'engaged must be a boolean', requestId: req.id },
        });
      }
      featureFlags.setKillSwitch(engaged);
      return reply.send({ data: { killSwitch: body.engaged } });
    }
  );

  // ============================================================
  // RELEASE APPROVAL GATES (Spec 27)
  // ============================================================

  // Create release approval record
  interface ReleaseApproval {
    id: string;
    featureId: string;
    approverUserId: string;
    notes: string;
    status: 'pending' | 'approved' | 'rejected';
    createdAt: string;
  }

  const releaseApprovals: ReleaseApproval[] = [];

  app.post(
    '/v1/admin/release-approval',
    { preHandler: [resolveRequestContext] },
    async (req: FastifyRequest, reply: FastifyReply) => {
      const role = resolveTeamRole(req.orbitContext!);
      if (!role || !can(role, 'workspace.configure')) {
        return reply.status(403).send({
          error: { code: 'FORBIDDEN', message: 'Requires workspace.configure', requestId: req.id },
        });
      }
      const { featureId, approverUserId, notes } = req.body as { featureId: string; approverUserId: string; notes: string };
      const approval: ReleaseApproval = {
        id: `approval_${Date.now()}`,
        featureId,
        approverUserId,
        notes,
        status: 'pending',
        createdAt: new Date().toISOString(),
      };
      releaseApprovals.push(approval);
      return reply.status(201).send({ data: approval });
    }
  );

  // List pending approvals
  app.get(
    '/v1/admin/release-approvals',
    { preHandler: [resolveRequestContext] },
    async (_req: FastifyRequest, reply: FastifyReply) => {
      const pending = releaseApprovals.filter((a) => a.status === 'pending');
      return reply.send({ data: pending });
    }
  );

  // Durable job queue visibility (Spec 10) — depth + dead-letter count.
  app.get(
    '/v1/admin/jobs',
    { preHandler: [resolveRequestContext] },
    async (req: FastifyRequest, reply: FastifyReply) => {
      const role = resolveTeamRole(req.orbitContext!);
      if (!role || !can(role, 'audit.view')) {
        return reply.status(403).send({
          error: { code: 'FORBIDDEN', message: 'Requires audit.view', requestId: req.id },
        });
      }
      const [pending, dead] = await Promise.all([jobQueue.size(), jobQueue.deadCount()]);
      return reply.send({ data: { pending, dead } });
    }
  );
}