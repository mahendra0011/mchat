import { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify';
import { randomUUID, randomInt } from 'node:crypto';
import {
  SubmitBusinessVerificationRequestSchema,
  ResolveBusinessVerificationRequestSchema,
  AppealBusinessVerificationRequestSchema,
  ResolveBusinessVerificationAppealRequestSchema,
  SendOtpCodeRequestSchema,
  VerifyOtpCodeRequestSchema,
  type BusinessVerification,
  type OtpChannel,
} from '@orbit/schemas';
import { resolveRequestContext, resolveTeamRole, requireStepUp } from '../auth.js';
import { rateLimit } from '../rate-limit.js';
import { can } from '@orbit/domain';
import { store } from '../store.js';

/**
 * Business trust & safety (Spec 14):
 * - A workspace is only "verified" (badge shown) after a trust & safety
 *   reviewer approves a verification application.
 * - Payment or plan upgrades NEVER set the verified badge on their own.
 * - Rejected businesses can appeal; reviewers decide appeals.
 */

// ---------------------------------------------------------------------------
// OTP code delivery (Spec 30 — second factor / phone & email verification).
// Code sending sits behind a provider interface so a real SMS/ESP provider
// can be dropped in without touching route handlers.
// ---------------------------------------------------------------------------

export interface OtpCodeProvider {
  sendSmsCode(phone: string, code: string): Promise<void>;
  sendEmailCode(email: string, code: string): Promise<void>;
}

/** Dev provider: logs the code (never a real delivery channel). */
export const devOtpProvider: OtpCodeProvider = {
  async sendSmsCode(phone: string, code: string): Promise<void> {
    console.log(`[orbit:otp] SMS to ${phone}: your verification code is ${code}`);
  },
  async sendEmailCode(email: string, code: string): Promise<void> {
    console.log(`[orbit:otp] Email to ${email}: your verification code is ${code}`);
  },
};

let otpProvider: OtpCodeProvider = devOtpProvider;

/** Swap in a real SMS/ESP provider (production wiring). */
export function setOtpProvider(provider: OtpCodeProvider): void {
  otpProvider = provider;
}

const OTP_TTL_MS = 5 * 60 * 1000;
const OTP_MAX_ATTEMPTS = 5;

interface OtpRecord {
  code: string;
  channel: OtpChannel;
  destination: string;
  expiresAt: number;
  attempts: number;
  consumed: boolean;
}

const otpCodes = new Map<string, OtpRecord>();
const verifiedPhones = new Map<string, { phone: string; verifiedAt: string }>();

export function getVerifiedPhone(accountId: string): { phone: string; verifiedAt: string } | null {
  return verifiedPhones.get(accountId) ?? null;
}

function otpKey(channel: OtpChannel, destination: string): string {
  return `${channel}:${destination}`;
}

const otpSendRateLimiter = rateLimit({ limit: 3, windowMs: 60_000, keyPrefix: 'otp-send' });

function canManageWorkspace(workspaceId: string, accountAccountId: string): boolean {
  const workspace = store.workspaces.get(workspaceId);
  if (!workspace) return false;
  if (workspace.ownerAccountId === accountAccountId) return true;
  for (const m of store.memberships.values()) {
    if (m.workspaceId === workspaceId && m.accountId === accountAccountId && m.role === 'admin') {
      return true;
    }
  }
  return false;
}

export async function verificationRoutes(app: FastifyInstance): Promise<void> {
  // Send an OTP verification code (Spec 30). Codes expire after 5 minutes,
  // are single-use and attempt-limited (5 tries).
  app.post(
    '/v1/verification/codes',
    { preHandler: [resolveRequestContext, otpSendRateLimiter] },
    async (req: FastifyRequest, reply: FastifyReply) => {
      const parsed = SendOtpCodeRequestSchema.safeParse(req.body);
      if (!parsed.success) {
        return reply.status(400).send({
          error: {
            code: 'INVALID_VERIFICATION',
            message: parsed.error.issues[0]?.message || 'Invalid payload',
            requestId: req.id,
          },
        });
      }
      const { channel, destination } = parsed.data;
      const code = randomInt(0, 1000000).toString().padStart(6, '0');
      otpCodes.set(otpKey(channel, destination), {
        code,
        channel,
        destination,
        expiresAt: Date.now() + OTP_TTL_MS,
        attempts: 0,
        consumed: false,
      });

      if (channel === 'sms') {
        await otpProvider.sendSmsCode(destination, code);
      } else {
        await otpProvider.sendEmailCode(destination, code);
      }

      const payload: Record<string, unknown> = {
        channel,
        destination,
        expiresInSeconds: OTP_TTL_MS / 1000,
      };
      // Local/dev convenience only — real providers never echo the code.
      if (process.env.NODE_ENV !== 'production') {
        payload.code = code;
      }
      return reply.status(202).send({ data: payload });
    }
  );

  // Verify an OTP code. Successful phone verification binds the number to the
  // account so it can be set on the profile via PATCH /v1/me.
  app.post(
    '/v1/verification/codes/verify',
    { preHandler: resolveRequestContext },
    async (req: FastifyRequest, reply: FastifyReply) => {
      const ctx = req.orbitContext!;
      const parsed = VerifyOtpCodeRequestSchema.safeParse(req.body);
      if (!parsed.success) {
        return reply.status(400).send({
          error: {
            code: 'INVALID_VERIFICATION',
            message: parsed.error.issues[0]?.message || 'Invalid payload',
            requestId: req.id,
          },
        });
      }
      const { channel, destination, code } = parsed.data;
      const record = otpCodes.get(otpKey(channel, destination));

      if (!record || record.consumed) {
        return reply.status(400).send({
          error: { code: 'OTP_INVALID', message: 'No active verification code for this destination.', requestId: req.id },
        });
      }
      if (record.expiresAt <= Date.now()) {
        otpCodes.delete(otpKey(channel, destination));
        return reply.status(400).send({
          error: { code: 'OTP_EXPIRED', message: 'Verification code has expired. Request a new one.', requestId: req.id },
        });
      }
      record.attempts += 1;
      if (record.attempts > OTP_MAX_ATTEMPTS) {
        record.consumed = true; // burn the code after too many attempts
        return reply.status(400).send({
          error: {
            code: 'OTP_ATTEMPTS_EXCEEDED',
            message: 'Too many incorrect attempts. Request a new verification code.',
            requestId: req.id,
          },
        });
      }
      if (record.code !== code) {
        return reply.status(400).send({
          error: { code: 'OTP_INVALID', message: 'Incorrect verification code.', requestId: req.id },
        });
      }

      record.consumed = true; // single-use
      if (channel === 'sms') {
        verifiedPhones.set(ctx.account.id, { phone: destination, verifiedAt: new Date().toISOString() });
      }

      return reply.status(200).send({ data: { verified: true, channel, destination } });
    }
  );

  // Submit (or resubmit) a business verification application — never sets the badge.
  app.post<{ Params: { workspaceId: string } }>(
    '/v1/business/:workspaceId/verification',
    { preHandler: resolveRequestContext },
    async (req: FastifyRequest, reply: FastifyReply) => {
      const { workspaceId } = req.params as { workspaceId: string };
      const ctx = req.orbitContext!;
      if (!canManageWorkspace(workspaceId, ctx.account.id)) {
        return reply.status(403).send({
          error: { code: 'ACCESS_DENIED', message: 'Only the workspace owner or an admin can submit verification', requestId: req.id },
        });
      }
      const parsed = SubmitBusinessVerificationRequestSchema.safeParse(req.body);
      if (!parsed.success) {
        return reply.status(400).send({
          error: { code: 'INVALID_VERIFICATION', message: parsed.error.issues[0]?.message || 'Invalid payload', requestId: req.id },
        });
      }

      const existing = Array.from(store.businessVerifications.values()).find(
        (v) => v.workspaceId === workspaceId
      );
      const now = new Date().toISOString();
      const verification: BusinessVerification = existing
        ? {
            ...existing,
            ...parsed.data,
            status: 'under_review',
            submittedAt: now,
            appealReason: undefined,
            updatedAt: now,
          }
        : {
            id: randomUUID(),
            workspaceId,
            ...parsed.data,
            status: 'under_review',
            submittedAt: now,
            createdAt: now,
            updatedAt: now,
          };

      store.businessVerifications.set(verification.id, verification);
      await store.persistBusinessVerification(verification);

      // Spec 14 — paid ≠ verified: submitting never flips the badge.
      return reply.status(201).send({ data: verification });
    }
  );

  // View own verification application.
  app.get<{ Params: { workspaceId: string } }>(
    '/v1/business/:workspaceId/verification',
    { preHandler: resolveRequestContext },
    async (req: FastifyRequest, reply: FastifyReply) => {
      const { workspaceId } = req.params as { workspaceId: string };
      const ctx = req.orbitContext!;
      if (!canManageWorkspace(workspaceId, ctx.account.id)) {
        return reply.status(403).send({
          error: { code: 'ACCESS_DENIED', message: 'Not allowed to view this verification', requestId: req.id },
        });
      }
      const verification = Array.from(store.businessVerifications.values()).find(
        (v) => v.workspaceId === workspaceId
      );
      const workspace = store.workspaces.get(workspaceId);
      return reply.send({
        data: {
          verification: verification ?? null,
          isVerifiedBadge: Boolean(workspace?.isVerified),
        },
      });
    }
  );

  // Reviewer resolves a verification application (approve sets the badge).
  // Admin action: requires recent step-up re-authentication (Spec 30/32).
  app.post<{ Params: { id: string } }>(
    '/v1/admin/business-verifications/:id/resolve',
    { preHandler: [resolveRequestContext, requireStepUp] },
    async (req: FastifyRequest, reply: FastifyReply) => {
      const { id } = req.params as { id: string };
      const ctx = req.orbitContext!;
      const role = resolveTeamRole(ctx);
      if (!role || !can(role, 'reports.resolve')) {
        return reply.status(403).send({
          error: { code: 'FORBIDDEN', message: 'Requires trust & safety reviewer role', requestId: req.id },
        });
      }
      const verification = store.businessVerifications.get(id);
      if (!verification) {
        return reply.status(404).send({
          error: { code: 'NOT_FOUND', message: 'Verification not found', requestId: req.id },
        });
      }
      if (verification.status !== 'under_review' && verification.status !== 'submitted') {
        return reply.status(409).send({
          error: { code: 'NOT_REVIEWABLE', message: 'This verification is not awaiting review', requestId: req.id },
        });
      }
      const parsed = ResolveBusinessVerificationRequestSchema.safeParse(req.body);
      if (!parsed.success) {
        return reply.status(400).send({
          error: { code: 'INVALID_DECISION', message: 'decision must be approve or reject', requestId: req.id },
        });
      }

      const now = new Date().toISOString();
      verification.status = parsed.data.decision === 'approve' ? 'approved' : 'rejected';
      verification.reviewerId = ctx.account.id;
      verification.decidedAt = now;
      verification.decisionNote = parsed.data.note;
      verification.updatedAt = now;
      store.businessVerifications.set(verification.id, verification);
      await store.persistBusinessVerification(verification);

      // Only an approval sets the verified badge.
      if (parsed.data.decision === 'approve') {
        const workspace = store.workspaces.get(verification.workspaceId);
        if (workspace) {
          workspace.isVerified = true;
          await store.persistWorkspace(workspace);
        }
      }

      store.adminAuditLogs.push({
        id: `audit_${Date.now()}`,
        actorUserId: ctx.account.id,
        actorRole: 'trust_safety',
        action: `business_verification.${parsed.data.decision}`,
        targetType: 'business_verification',
        targetId: verification.id,
        workspaceId: verification.workspaceId,
        createdAt: now,
      } as never);

      return reply.send({ data: verification });
    }
  );

  // Business appeals a rejected verification.
  app.post<{ Params: { id: string } }>(
    '/v1/admin/business-verifications/:id/appeal',
    { preHandler: resolveRequestContext },
    async (req: FastifyRequest, reply: FastifyReply) => {
      const { id } = req.params as { id: string };
      const ctx = req.orbitContext!;
      const verification = store.businessVerifications.get(id);
      if (!verification) {
        return reply.status(404).send({
          error: { code: 'NOT_FOUND', message: 'Verification not found', requestId: req.id },
        });
      }
      if (!canManageWorkspace(verification.workspaceId, ctx.account.id)) {
        return reply.status(403).send({
          error: { code: 'ACCESS_DENIED', message: 'Only the business can appeal its own verification', requestId: req.id },
        });
      }
      if (verification.status !== 'rejected') {
        return reply.status(409).send({
          error: { code: 'NOT_APPEALABLE', message: 'Only a rejected verification can be appealed', requestId: req.id },
        });
      }
      const parsed = AppealBusinessVerificationRequestSchema.safeParse(req.body);
      if (!parsed.success) {
        return reply.status(400).send({
          error: { code: 'INVALID_APPEAL', message: parsed.error.issues[0]?.message || 'Invalid appeal', requestId: req.id },
        });
      }

      const now = new Date().toISOString();
      verification.status = 'appealed';
      verification.appealReason = parsed.data.reason;
      verification.updatedAt = now;
      store.businessVerifications.set(verification.id, verification);
      await store.persistBusinessVerification(verification);

      return reply.send({ data: verification });
    }
  );

  // Reviewer decides an appeal (uphold rejection or overturn + approve).
  // Admin action: requires recent step-up re-authentication (Spec 30/32).
  app.post<{ Params: { id: string } }>(
    '/v1/admin/business-verifications/:id/appeal/resolve',
    { preHandler: [resolveRequestContext, requireStepUp] },
    async (req: FastifyRequest, reply: FastifyReply) => {
      const { id } = req.params as { id: string };
      const ctx = req.orbitContext!;
      const role = resolveTeamRole(ctx);
      if (!role || !can(role, 'reports.resolve')) {
        return reply.status(403).send({
          error: { code: 'FORBIDDEN', message: 'Requires trust & safety reviewer role', requestId: req.id },
        });
      }
      const verification = store.businessVerifications.get(id);
      if (!verification) {
        return reply.status(404).send({
          error: { code: 'NOT_FOUND', message: 'Verification not found', requestId: req.id },
        });
      }
      if (verification.status !== 'appealed') {
        return reply.status(409).send({
          error: { code: 'NO_APPEAL', message: 'This verification has no pending appeal', requestId: req.id },
        });
      }
      const parsed = ResolveBusinessVerificationAppealRequestSchema.safeParse(req.body);
      if (!parsed.success) {
        return reply.status(400).send({
          error: { code: 'INVALID_DECISION', message: 'decision must be uphold_rejection or overturn_and_approve', requestId: req.id },
        });
      }

      const now = new Date().toISOString();
      verification.reviewerId = ctx.account.id;
      verification.decidedAt = now;
      verification.decisionNote = parsed.data.note;
      verification.updatedAt = now;
      if (parsed.data.decision === 'overturn_and_approve') {
        verification.status = 'approved';
        const workspace = store.workspaces.get(verification.workspaceId);
        if (workspace) {
          workspace.isVerified = true;
          await store.persistWorkspace(workspace);
        }
      } else {
        verification.status = 'rejected';
      }
      store.businessVerifications.set(verification.id, verification);
      await store.persistBusinessVerification(verification);

      return reply.send({ data: verification });
    }
  );
}
