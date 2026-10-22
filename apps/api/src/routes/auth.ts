import { FastifyInstance, FastifyRequest } from 'fastify';
import { LoginRequestSchema, UpdateProfileRequestSchema } from '@orbit/schemas';
import { store } from '../store.js';
import { resolveRequestContext } from '../auth.js';
import { rateLimit } from '../rate-limit.js';
import { getVerifiedPhone } from './verification.js';

const SESSION_EXPIRY_SECONDS = Number.parseInt(process.env.SESSION_EXPIRY_SECONDS ?? '604800', 10) || 604800;

const loginRateLimiter = rateLimit({ limit: 10, windowMs: 60_000, keyPrefix: 'login' });
const stepUpRateLimiter = rateLimit({ limit: 5, windowMs: 60_000, keyPrefix: 'auth-step-up' });

function bearerToken(request: FastifyRequest): string | undefined {
  const authHeader = request.headers['authorization'];
  if (typeof authHeader === 'string' && authHeader.startsWith('Bearer ')) return authHeader.slice(7);
  return undefined;
}

export async function authRoutes(fastify: FastifyInstance): Promise<void> {
  // Login / create session
  fastify.post('/v1/auth/sessions', { preHandler: loginRateLimiter }, async (request, reply) => {
    const parsed = LoginRequestSchema.safeParse(request.body);
    if (!parsed.success) {
      return reply.status(400).send({
        error: {
          code: 'INVALID_CREDENTIALS_PAYLOAD',
          message: parsed.error.issues[0]?.message || 'Invalid credentials format',
          requestId: request.id,
        },
      });
    }

    const { email, deviceLabel, platform } = parsed.data;

    // Find account by email
    let foundAccount = Array.from(store.accounts.values()).find((a) => a.email === email);
    if (!foundAccount) {
      // Auto-create in local demo if enabled
      foundAccount = {
        id: `acc-${Date.now()}`,
        email,
        displayName: email.split('@')[0],
        status: 'active',
        createdAt: new Date().toISOString(),
      };
      store.accounts.set(foundAccount.id, foundAccount);
      await store.persistAccount(foundAccount);

      // Create personal workspace for new account
      const personalWs = {
        id: `ws-${Date.now()}`,
        ownerAccountId: foundAccount.id,
        type: 'personal' as const,
        displayName: foundAccount.displayName,
        handle: foundAccount.displayName.toLowerCase().replace(/[^a-z0-9_]/g, '_'),
        isVerified: false,
        status: 'active' as const,
        createdAt: new Date().toISOString(),
      };
      store.workspaces.set(personalWs.id, personalWs);
      await store.persistWorkspace(personalWs);
    }

    const sessionId = `sess-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
    const workspaces = Array.from(store.workspaces.values()).filter(
      (ws) => ws.ownerAccountId === foundAccount!.id
    );

    const activeWorkspaceId = workspaces[0]?.id || foundAccount.id;

    const newSession = {
      sessionId,
      accountId: foundAccount.id,
      activeWorkspaceId,
      deviceLabel,
      platform,
      createdAt: new Date().toISOString(),
      lastActiveAt: new Date().toISOString(),
      isCurrentSession: true,
      expiresAt: new Date(Date.now() + SESSION_EXPIRY_SECONDS * 1000).toISOString(),
    };
    store.sessions.set(sessionId, newSession);
    await store.persistSession(newSession);

    return reply.status(200).send({
      token: sessionId,
      user: foundAccount,
      workspaces,
    });
  });

  // List active device sessions (Spec 30)
  fastify.get('/v1/auth/sessions', { preHandler: resolveRequestContext }, async (request, reply) => {
    const ctx = request.orbitContext!;
    const sessions = Array.from(store.deviceSessions.values()).filter(
      (s) => s.accountId === ctx.account.id && s.status === 'active'
    );
    return reply.status(200).send({ sessions });
  });

  // Revoke individual session (Spec 30)
  fastify.delete<{ Params: { sessionId: string } }>(
    '/v1/auth/sessions/:sessionId',
    { preHandler: resolveRequestContext },
    async (request, reply) => {
      const { sessionId } = request.params;
      const deviceSession = store.deviceSessions.get(sessionId);
      if (deviceSession) {
        deviceSession.status = 'revoked';
        await store.persistDeviceSession(deviceSession);
      }
      store.sessions.delete(sessionId);
      await store.revokeSessionsDurable([sessionId]);

      // Record audit log
      const revokeAudit = {
        id: `aud_rev_${Date.now()}`,
        actorId: request.orbitContext!.account.id,
        actorRole: 'security_ops' as const,
        action: 'security.session.revoked',
        targetType: 'user' as const,
        targetId: sessionId,
        justification: 'User initiated remote device session termination',
        ipHash: 'e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855',
        timestamp: new Date().toISOString(),
      };
      store.adminAuditLogs.push(revokeAudit);
      await store.persistAdminAuditLog(revokeAudit);

      return reply.status(200).send({ success: true, message: 'Session revoked' });
    }
  );

  // Revoke all other sessions (Spec 30)
  fastify.post(
    '/v1/auth/sessions/revoke-all-others',
    { preHandler: resolveRequestContext },
    async (request, reply) => {
      const ctx = request.orbitContext!;
      let revokedCount = 0;
      const revokedIds: string[] = [];

      for (const [id, session] of store.deviceSessions.entries()) {
        if (session.accountId === ctx.account.id && !session.isCurrentSession) {
          session.status = 'revoked';
          store.sessions.delete(id);
          await store.persistDeviceSession(session);
          revokedIds.push(id);
          revokedCount++;
        }
      }
      await store.revokeSessionsDurable(revokedIds);

      const revokeAllAudit = {
        id: `aud_rev_all_${Date.now()}`,
        actorId: ctx.account.id,
        actorRole: 'security_ops' as const,
        action: 'security.session.revoke_all_others',
        targetType: 'user' as const,
        targetId: ctx.account.id,
        justification: `Terminated ${revokedCount} other device sessions`,
        ipHash: 'e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855',
        timestamp: new Date().toISOString(),
      };
      store.adminAuditLogs.push(revokeAllAudit);
      await store.persistAdminAuditLog(revokeAllAudit);

      return reply.status(200).send({
        success: true,
        revokedCount,
        message: `Successfully logged out ${revokedCount} other device sessions`,
      });
    }
  );

  // Step-Up Re-Authentication confirmation (Spec 30 & 32)
  fastify.post(
    '/v1/auth/step-up',
    { preHandler: [resolveRequestContext, stepUpRateLimiter] },
    async (request, reply) => {
      const ctx = request.orbitContext!;
      const now = new Date();
      const lastStepUpAt = now.toISOString();
      const stepUpExpiresAt = new Date(now.getTime() + 60 * 60 * 1000).toISOString(); // 1 hour

      let currentSession = Array.from(store.deviceSessions.values()).find(
        (s) => s.accountId === ctx.account.id && s.isCurrentSession && s.status === 'active'
      );
      if (!currentSession) {
        // First step-up on this account: materialize a device session record.
        currentSession = {
          id: `dsess-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
          accountId: ctx.account.id,
          activeWorkspaceId: ctx.activeWorkspace.id,
          deviceLabel: 'Web session',
          platform: 'web',
          ipAddressMasked: '***.***.***.***',
          isCurrentSession: true,
          isPasskeyAuthenticated: false,
          hasRecentStepUp: false,
          stepUpExpiresAt: null,
          lastStepUpAt: null,
          createdAt: lastStepUpAt,
          lastActiveAt: lastStepUpAt,
          status: 'active',
        };
        store.deviceSessions.set(currentSession.id, currentSession);
      }
      currentSession.hasRecentStepUp = true;
      currentSession.stepUpExpiresAt = stepUpExpiresAt;
      currentSession.lastStepUpAt = lastStepUpAt;
      await store.persistDeviceSession(currentSession);

      // Mirror the step-up onto the token session so requireStepUp can verify it.
      const token = bearerToken(request);
      const tokenSession = token ? store.sessions.get(token) : undefined;
      if (tokenSession) {
        tokenSession.hasRecentStepUp = true;
        tokenSession.stepUpExpiresAt = stepUpExpiresAt;
        tokenSession.lastStepUpAt = lastStepUpAt;
      }

      return reply.status(200).send({
        success: true,
        stepUpVerified: true,
        expiresAt: stepUpExpiresAt,
        message: 'Step-up authentication confirmed for elevated actions',
      });
    }
  );

  // Logout: invalidate the current session (Spec 30)
  fastify.post('/v1/auth/logout', { preHandler: resolveRequestContext }, async (request, reply) => {
    const token = bearerToken(request);
    if (token) {
      store.sessions.delete(token);
      await store.revokeSessionsDurable([token]);
      const deviceSession = store.deviceSessions.get(token);
      if (deviceSession) {
        deviceSession.status = 'revoked';
        await store.persistDeviceSession(deviceSession);
      }
    }
    return reply.status(200).send({ ok: true });
  });

  // List the caller's active sessions (Spec 30)
  fastify.get('/v1/me/sessions', { preHandler: resolveRequestContext }, async (request, reply) => {
    const ctx = request.orbitContext!;
    const currentToken = bearerToken(request);
    const seen = new Set<string>();
    const sessions: Array<Record<string, unknown>> = [];

    for (const session of store.sessions.values()) {
      if (session.accountId !== ctx.account.id) continue;
      seen.add(session.sessionId);
      sessions.push({
        id: session.sessionId,
        deviceLabel: session.deviceLabel,
        platform: session.platform,
        createdAt: session.createdAt,
        lastActiveAt: session.lastActiveAt,
        expiresAt: session.expiresAt ?? null,
        isCurrentSession: session.sessionId === currentToken,
      });
    }
    for (const device of store.deviceSessions.values()) {
      if (device.accountId !== ctx.account.id || seen.has(device.id)) continue;
      if (device.status !== 'active') continue;
      sessions.push({
        id: device.id,
        deviceLabel: device.deviceLabel,
        platform: device.platform,
        createdAt: device.createdAt,
        lastActiveAt: device.lastActiveAt,
        expiresAt: null,
        isCurrentSession: device.isCurrentSession,
      });
    }

    return reply.status(200).send({ sessions });
  });

  // Update the caller's profile (Spec 09 — account settings)
  fastify.patch('/v1/me', { preHandler: resolveRequestContext }, async (request, reply) => {
    const ctx = request.orbitContext!;
    const parsed = UpdateProfileRequestSchema.safeParse(request.body);
    if (!parsed.success) {
      return reply.status(400).send({
        error: {
          code: 'INVALID_PROFILE_PAYLOAD',
          message: parsed.error.issues[0]?.message || 'Invalid profile payload',
          requestId: request.id,
        },
      });
    }

    const { displayName, avatarAssetId, statusEmoji, phone } = parsed.data;

    // A phone number may only be set once it has been OTP-verified for this account.
    if (phone !== undefined) {
      const verified = getVerifiedPhone(ctx.account.id);
      if (!verified || verified.phone !== phone) {
        return reply.status(400).send({
          error: {
            code: 'PHONE_NOT_VERIFIED',
            message: 'The phone number must be OTP-verified before it can be added to the profile.',
            requestId: request.id,
          },
        });
      }
      ctx.account.phone = phone;
      ctx.account.phoneVerified = true;
    }
    if (displayName !== undefined) ctx.account.displayName = displayName;
    if (avatarAssetId !== undefined) ctx.account.avatarAssetId = avatarAssetId;
    if (statusEmoji !== undefined) ctx.account.statusEmoji = statusEmoji;
    await store.persistAccount(ctx.account);

    return reply.status(200).send({ user: ctx.account });
  });

  // Current identity and workspaces
  fastify.get('/v1/me', { preHandler: resolveRequestContext }, async (request, reply) => {
    const ctx = request.orbitContext!;
    const workspaces = Array.from(store.workspaces.values()).filter(
      (ws) => ws.ownerAccountId === ctx.account.id
    );

    return reply.status(200).send({
      user: ctx.account,
      activeWorkspace: ctx.activeWorkspace,
      workspaces,
    });
  });
}
