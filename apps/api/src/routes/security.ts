import { FastifyInstance } from 'fastify';
import { randomBytes } from 'node:crypto';
import { RegisterSecurityKeyRequestSchema, type SecurityKey } from '@orbit/schemas';
import { resolveRequestContext } from '../auth.js';
import { store } from '../store.js';
import { validateSafeUrl, PolicyEngine } from '@orbit/domain';
import { PolicyPrincipal, PolicyResource, PolicyAction } from '@orbit/schemas';

const SECURITY_KEY_CHALLENGE_TTL_MS = 5 * 60 * 1000;
const securityKeyChallenges = new Map<string, { challenge: string; expiresAt: number }>();

export async function securityRoutes(fastify: FastifyInstance): Promise<void> {
  const policyEngine = new PolicyEngine();

  // Validate URL destination safety against SSRF attacks (Spec 34)
  fastify.post<{ Body: { url: string; context?: string } }>(
    '/v1/security/ssrf-validate',
    { preHandler: resolveRequestContext },
    async (request, reply) => {
      const { url } = request.body || {};

      if (!url) {
        return reply.status(400).send({
          error: { code: 'MISSING_URL', message: 'Target url parameter is required', requestId: request.id },
        });
      }

      const result = validateSafeUrl(url);
      return reply.status(200).send({ result });
    }
  );

  // List active deletion tombstones for workspace (Spec 37 & 41)
  fastify.get(
    '/v1/security/retention/tombstones',
    { preHandler: resolveRequestContext },
    async (request, reply) => {
      const ctx = request.orbitContext!;
      const allTombstones = store.tombstoneLedger.getAllTombstones();
      const workspaceTombstones = allTombstones.filter(
        (t) => t.workspaceId === ctx.activeWorkspace.id
      );

      return reply.status(200).send({
        tombstones: workspaceTombstones,
        totalTombstonesCount: workspaceTombstones.length,
      });
    }
  );

  // Execute restore reconciliation test against tombstone ledger (Spec 41)
  fastify.post<{ Body: { candidateRecords: Array<{ id: string; [key: string]: any }> } }>(
    '/v1/security/retention/reconcile',
    { preHandler: resolveRequestContext },
    async (request, reply) => {
      const { candidateRecords } = request.body || {};

      if (!Array.isArray(candidateRecords)) {
        return reply.status(400).send({
          error: { code: 'INVALID_PAYLOAD', message: 'candidateRecords must be an array of objects with id', requestId: request.id },
        });
      }

      const { preservedRecords, report } = store.tombstoneLedger.reconcileRestore(candidateRecords);

      return reply.status(200).send({
        preservedRecords,
        report,
        message: `Reconciliation complete: ${report.suppressedTombstoneCount} tombstoned record(s) suppressed from restoration.`,
      });
    }
  );

  // Evaluate RBAC + ABAC policy decision (Spec 32)
  fastify.post<{
    Body: {
      action: PolicyAction;
      resource: PolicyResource;
    };
  }>(
    '/v1/security/policy/check',
    { preHandler: resolveRequestContext },
    async (request, reply) => {
      const ctx = request.orbitContext!;
      const { action, resource } = request.body || {};

      if (!action || !resource) {
        return reply.status(400).send({
          error: { code: 'INVALID_POLICY_REQUEST', message: 'action and resource are required', requestId: request.id },
        });
      }

      const currentSession = Array.from(store.deviceSessions.values()).find(
        (s) => s.accountId === ctx.account.id && s.isCurrentSession
      );

      const principal: PolicyPrincipal = {
        accountId: ctx.account.id,
        activeWorkspaceId: ctx.activeWorkspace.id,
        activeWorkspaceType: ctx.activeWorkspace.type === 'business' ? 'BUSINESS' : 'PERSONAL',
        role: (ctx.membership?.role.toUpperCase() as any) || 'MEMBER',
        hasRecentStepUp: currentSession?.hasRecentStepUp ?? false,
      };

      const decision = policyEngine.evaluate(principal, action, resource);
      return reply.status(200).send({ decision });
    }
  );

  // ---- Security keys / passkeys (Spec 30 — lightweight registration flow) ----
  // NOTE: this records client-asserted credential material behind a
  // server-issued challenge. Full WebAuthn attestation & assertion
  // verification is a documented follow-up.

  // Issue a registration challenge for the caller.
  fastify.post(
    '/v1/security/keys/register-challenge',
    { preHandler: resolveRequestContext },
    async (request, reply) => {
      const ctx = request.orbitContext!;
      const challenge = randomBytes(32).toString('base64url');
      const expiresAt = Date.now() + SECURITY_KEY_CHALLENGE_TTL_MS;
      securityKeyChallenges.set(ctx.account.id, { challenge, expiresAt });

      return reply.status(200).send({
        data: {
          challenge,
          rpId: 'orbit.local',
          rpName: 'Orbit',
          userId: ctx.account.id,
          timeout: SECURITY_KEY_CHALLENGE_TTL_MS,
          expiresAt: new Date(expiresAt).toISOString(),
        },
      });
    }
  );

  // Register a security key (consumes the outstanding challenge).
  fastify.post(
    '/v1/security/keys',
    { preHandler: resolveRequestContext },
    async (request, reply) => {
      const ctx = request.orbitContext!;
      const pending = securityKeyChallenges.get(ctx.account.id);
      if (!pending || pending.expiresAt <= Date.now()) {
        securityKeyChallenges.delete(ctx.account.id);
        return reply.status(409).send({
          error: {
            code: 'CHALLENGE_REQUIRED',
            message: 'Request a registration challenge before registering a security key.',
            requestId: request.id,
          },
        });
      }
      securityKeyChallenges.delete(ctx.account.id);

      const parsed = RegisterSecurityKeyRequestSchema.safeParse(request.body);
      if (!parsed.success) {
        return reply.status(400).send({
          error: {
            code: 'INVALID_SECURITY_KEY',
            message: parsed.error.issues[0]?.message || 'Invalid payload',
            requestId: request.id,
          },
        });
      }

      const keys = store.securityKeys.get(ctx.account.id) ?? [];
      const key: SecurityKey = {
        id: `sk_${Date.now()}-${randomBytes(4).toString('hex')}`,
        accountId: ctx.account.id,
        label: parsed.data.label,
        credentialId: parsed.data.credentialId,
        publicKey: parsed.data.publicKey,
        createdAt: new Date().toISOString(),
        lastUsedAt: null,
      };
      keys.push(key);
      store.securityKeys.set(ctx.account.id, keys);

      return reply.status(201).send({ data: key });
    }
  );

  // List the caller's registered security keys.
  fastify.get(
    '/v1/security/keys',
    { preHandler: resolveRequestContext },
    async (request, reply) => {
      const ctx = request.orbitContext!;
      return reply.status(200).send({ data: store.securityKeys.get(ctx.account.id) ?? [] });
    }
  );

  // Remove a registered security key.
  fastify.delete<{ Params: { keyId: string } }>(
    '/v1/security/keys/:keyId',
    { preHandler: resolveRequestContext },
    async (request, reply) => {
      const ctx = request.orbitContext!;
      const keys = store.securityKeys.get(ctx.account.id) ?? [];
      const index = keys.findIndex((k) => k.id === request.params.keyId);
      if (index === -1) {
        return reply.status(404).send({
          error: { code: 'NOT_FOUND', message: 'Security key not found', requestId: request.id },
        });
      }
      keys.splice(index, 1);
      store.securityKeys.set(ctx.account.id, keys);
      return reply.status(200).send({ success: true });
    }
  );
}
