import { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify';
import { BillingPlanTierSchema } from '@orbit/schemas';
import { evaluateEntitlement, EntitlementAction } from '@orbit/domain';
import { store } from '../store.js';
import { resolveRequestContext, RequestContext } from '../auth.js';
import type { TeamRole } from '@orbit/domain';
import { can } from '@orbit/domain';
import { getBillingProvider, MockBillingProvider, getMockBillingProvider } from '../billing-provider.js';
import { randomUUID } from 'node:crypto';

const GRACE_PERIOD_DAYS = 7;

function roleForWorkspace(ctx: RequestContext, workspaceId: string): TeamRole | null {
  const workspace = store.workspaces.get(workspaceId);
  if (!workspace) return null;
  if (workspace.ownerAccountId === ctx.account.id) return 'owner';
  const membership = Array.from(store.memberships.values()).find(
    (m) => m.workspaceId === workspaceId && m.accountId === ctx.account.id && m.status === 'active'
  );
  return (membership?.role as TeamRole | undefined) ?? null;
}

function requireBillingAccess(ctx: RequestContext, workspaceId: string): { allowed: boolean; error?: { code: string; message: string } } {
  const role = roleForWorkspace(ctx, workspaceId);
  
  if (!role || !can(role, 'workspace.billing')) {
    return { allowed: false, error: { code: 'BILLING_ACCESS_DENIED', message: 'You do not have permission to manage billing for this workspace.' } };
  }
  
  return { allowed: true };
}

function requireBillingOwner(ctx: RequestContext, workspaceId: string): { allowed: boolean; error?: { code: string; message: string } } {
  const entitlement = store.billingEntitlements.get(workspaceId);
  if (!entitlement) {
    return { allowed: false, error: { code: 'NOT_FOUND', message: 'Billing record not found.' } };
  }
  
  if (entitlement.billingOwnerUserId !== ctx.account.id) {
    return { allowed: false, error: { code: 'BILLING_OWNER_REQUIRED', message: 'Only the billing owner can perform this action.' } };
  }
  
  return { allowed: true };
}

function applyPlanDefaults(entitlement: any, plan: string, seats?: number): void {
  entitlement.plan = plan;
  if (plan === 'business_scale') {
    entitlement.seatsAllocated = seats || 25;
    entitlement.storageQuotaBytes = 250 * 1024 * 1024 * 1024;
    entitlement.maxFileSizeMB = 250;
    entitlement.customThemesAllowed = true;
    entitlement.workflowCardsAllowed = true;
    entitlement.auditExportAllowed = true;
    entitlement.maxIntegrationsAllowed = 50;
  } else if (plan === 'business_starter') {
    entitlement.seatsAllocated = seats || 5;
    entitlement.storageQuotaBytes = 50 * 1024 * 1024 * 1024;
    entitlement.maxFileSizeMB = 100;
    entitlement.customThemesAllowed = true;
    entitlement.workflowCardsAllowed = true;
    entitlement.auditExportAllowed = false;
    entitlement.maxIntegrationsAllowed = 10;
  } else if (plan === 'personal_plus') {
    entitlement.seatsAllocated = 1;
    entitlement.storageQuotaBytes = 10 * 1024 * 1024 * 1024;
    entitlement.maxFileSizeMB = 50;
    entitlement.customThemesAllowed = true;
    entitlement.workflowCardsAllowed = false;
    entitlement.auditExportAllowed = false;
    entitlement.maxIntegrationsAllowed = 5;
  } else {
    entitlement.seatsAllocated = 1;
    entitlement.storageQuotaBytes = 1024 * 1024 * 1024;
    entitlement.maxFileSizeMB = 25;
    entitlement.customThemesAllowed = false;
    entitlement.workflowCardsAllowed = false;
    entitlement.auditExportAllowed = false;
    entitlement.maxIntegrationsAllowed = 2;
  }
}

function recordBillingEvent(workspaceId: string, type: string, planId: string | null, amount: number, currency: string, status: string, metadata: Record<string, unknown>): void {
  const event = {
    id: `be_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`,
    workspaceId,
    type,
    planId,
    amount,
    currency,
    status,
    metadata,
    createdAt: new Date().toISOString(),
  };
  store.billingEvents.set(event.id, event);
}

function getUsageData(workspaceId: string): { seats: { used: number; limit: number; resetDate: string }; storage: { usedBytes: number; limitBytes: number }; apiCalls: { used: number; limit: number; resetDate: string }; automations: { used: number; limit: number } } {
  const entitlement = store.billingEntitlements.get(workspaceId);
  if (!entitlement) {
    return {
      seats: { used: 0, limit: 1, resetDate: new Date().toISOString() },
      storage: { usedBytes: 0, limitBytes: 1024 * 1024 * 1024 },
      apiCalls: { used: 0, limit: 1000, resetDate: new Date().toISOString() },
      automations: { used: 0, limit: 10 },
    };
  }
  
  return {
    seats: {
      used: entitlement.seatsUsed,
      limit: entitlement.seatsAllocated,
      resetDate: entitlement.renewalDate,
    },
    storage: {
      usedBytes: entitlement.storageUsedBytes,
      limitBytes: entitlement.storageQuotaBytes,
    },
    apiCalls: {
      used: 0,
      limit: entitlement.plan === 'business_scale' ? 100000 : entitlement.plan === 'business_starter' ? 10000 : 1000,
      resetDate: entitlement.renewalDate,
    },
    automations: {
      used: entitlement.activeIntegrationsCount,
      limit: entitlement.maxIntegrationsAllowed,
    },
  };
}

export async function billingRoutes(app: FastifyInstance): Promise<void> {
  // Get active entitlements for workspace
  app.get('/v1/workspaces/:workspaceId/billing/entitlements', { preHandler: resolveRequestContext }, async (req: FastifyRequest, reply: FastifyReply) => {
    const { workspaceId } = req.params as { workspaceId: string };
    const ctx = req.orbitContext!;
    
    if (!accountOwnsOrIsMember(ctx.account.id, workspaceId)) {
      return reply.status(403).send({ error: { code: 'FORBIDDEN', message: 'Access denied to workspace billing.' } });
    }
    
    const entitlement = store.billingEntitlements.get(workspaceId);
    if (!entitlement || entitlement.metadata?.cleanedUp === true) {
      return reply.status(404).send({ error: { code: 'NOT_FOUND', message: 'Billing record for workspace not found.' } });
    }
    
    const usage = getUsageData(workspaceId);
    return reply.send({ data: { ...entitlement, usage } });
  });

  // Check quota for an action
  app.post('/v1/workspaces/:workspaceId/billing/check-quota', { preHandler: resolveRequestContext }, async (req: FastifyRequest, reply: FastifyReply) => {
    const { workspaceId } = req.params as { workspaceId: string };
    const body = req.body as { action: EntitlementAction; params?: { fileSizeMB?: number } };
    const entitlement = store.billingEntitlements.get(workspaceId);

    if (!entitlement) {
      return reply.status(404).send({ error: { code: 'NOT_FOUND', message: 'Billing record for workspace not found.' } });
    }

    const check = evaluateEntitlement(entitlement, body.action, body.params);
    return reply.send({ data: check });
  });

  // Provider status
  app.get('/v1/billing/provider-status', { preHandler: resolveRequestContext }, async (req: FastifyRequest, reply: FastifyReply) => {
    const provider = getBillingProvider();
    const mockProvider = getMockBillingProvider();
    return reply.send({ data: {
      provider: provider instanceof MockBillingProvider ? 'mock' : 'stripe',
      configured: !!mockProvider,
      status: mockProvider ? 'operational' : 'not configured',
    } });
  });

  // Root-level webhook handler (for platform-wide webhook registration)
  app.post('/v1/webhooks/billing', {
    onRequest: (request: FastifyRequest, _reply: FastifyReply, done: () => void) => {
      if (!request.headers['content-type']) request.headers['content-type'] = 'text/plain';
      done();
    },
  }, async (req: FastifyRequest, reply: FastifyReply) => {
    const signature = req.headers['stripe-signature'] as string || req.headers['x-webhook-signature'] as string || '';
    const payload = typeof req.body === 'string' ? req.body : JSON.stringify(req.body);
    
    const provider = getBillingProvider();
    if (!provider.validateWebhook(signature)) {
      return reply.status(400).send({ error: { code: 'INVALID_SIGNATURE', message: 'Invalid webhook signature.' } });
    }
    
    try {
      const event = await provider.handleWebhook(payload, signature);
      await handleBillingWebhook(event, (workspaceId: string) => {
        const entitlement = store.billingEntitlements.get(workspaceId);
        return entitlement;
      });
      return reply.send({ received: true });
    } catch (err: any) {
      return reply.status(500).send({ error: { code: 'WEBHOOK_HANDLER_FAILED', message: err.message } });
    }
  });

  // Create checkout session
  app.post('/v1/workspaces/:workspaceId/billing/checkout', { preHandler: resolveRequestContext }, async (req: FastifyRequest, reply: FastifyReply) => {
    const { workspaceId } = req.params as { workspaceId: string };
    const body = req.body as { planId: string; successUrl: string; cancelUrl: string };
    const ctx = req.orbitContext!;
    
    const access = requireBillingAccess(ctx, workspaceId);
    if (!access.allowed) return reply.status(403).send({ error: access.error });
    
    const planParse = BillingPlanTierSchema.safeParse(body.planId);
    if (!planParse.success) {
      return reply.status(400).send({ error: { code: 'INVALID_PLAN', message: 'Invalid plan tier specified.' } });
    }
    
    const provider = getBillingProvider();
    try {
      const session = await provider.createCheckoutSession(planParse.data, workspaceId, body.successUrl, body.cancelUrl);
      return reply.send({ data: session });
    } catch (err: any) {
      return reply.status(500).send({ error: { code: 'CHECKOUT_FAILED', message: err.message } });
    }
  });

  // Create portal session
  app.post('/v1/workspaces/:workspaceId/billing/portal', { preHandler: resolveRequestContext }, async (req: FastifyRequest, reply: FastifyReply) => {
    const { workspaceId } = req.params as { workspaceId: string };
    const ctx = req.orbitContext!;
    
    const access = requireBillingAccess(ctx, workspaceId);
    if (!access.allowed) return reply.status(403).send({ error: access.error });
    
    const provider = getBillingProvider();
    try {
      const session = await provider.createPortalSession(workspaceId);
      return reply.send({ data: session });
    } catch (err: any) {
      return reply.status(500).send({ error: { code: 'PORTAL_FAILED', message: err.message } });
    }
  });

  // Webhook handler
  app.post('/v1/billing/webhook', {
    onRequest: (request: FastifyRequest, _reply: FastifyReply, done: () => void) => {
      if (!request.headers['content-type']) request.headers['content-type'] = 'text/plain';
      done();
    },
  }, async (req: FastifyRequest, reply: FastifyReply) => {
    const signature = req.headers['stripe-signature'] as string || req.headers['x-webhook-signature'] as string || '';
    const payload = typeof req.body === 'string' ? req.body : JSON.stringify(req.body);
    
    const provider = getBillingProvider();
    if (!provider.validateWebhook(signature)) {
      return reply.status(400).send({ error: { code: 'INVALID_SIGNATURE', message: 'Invalid webhook signature.' } });
    }
    
    try {
      const event = await provider.handleWebhook(payload, signature);
      await handleBillingWebhook(event, workspaceId => {
        const entitlement = store.billingEntitlements.get(workspaceId);
        return entitlement;
      });
      return reply.send({ received: true });
    } catch (err: any) {
      return reply.status(500).send({ error: { code: 'WEBHOOK_HANDLER_FAILED', message: err.message } });
    }
  });

  // Plan change (upgrade/downgrade with proration)
  app.post('/v1/workspaces/:workspaceId/billing/subscription/change', { preHandler: resolveRequestContext }, async (req: FastifyRequest, reply: FastifyReply) => {
    const { workspaceId } = req.params as { workspaceId: string };
    const body = req.body as { newPlanId: string; prorationBehavior: 'none' | 'credit' | 'charge'; prorationDate?: string };
    const ctx = req.orbitContext!;
    
    const access = requireBillingAccess(ctx, workspaceId);
    if (!access.allowed) return reply.status(403).send({ error: access.error });
    
    const entitlement = store.billingEntitlements.get(workspaceId);
    if (!entitlement) {
      return reply.status(404).send({ error: { code: 'NOT_FOUND', message: 'Billing record not found.' } });
    }
    
    const planParse = BillingPlanTierSchema.safeParse(body.newPlanId);
    if (!planParse.success) {
      return reply.status(400).send({ error: { code: 'INVALID_PLAN', message: 'Invalid plan tier specified.' } });
    }
    
    const oldPlan = entitlement.plan;
    const newPlan = planParse.data;
    
    if (oldPlan === newPlan) {
      return reply.status(400).send({ error: { code: 'SAME_PLAN', message: 'Already on this plan.' } });
    }
    
    const isUpgrade = planHierarchy(newPlan) > planHierarchy(oldPlan);
    
    applyPlanDefaults(entitlement, newPlan);
    entitlement.status = 'active';
    
    store.billingEntitlements.set(workspaceId, entitlement);
    await store.persistBillingEntitlement(entitlement);
    
    const amountCents = calculatePlanAmount(newPlan, entitlement.seatsAllocated);
    const invoice = {
      id: `inv_${Date.now()}`,
      workspaceId,
      invoiceNumber: `INV-${Date.now()}`,
      amountCents: isUpgrade ? amountCents : 0,
      currency: 'USD',
      date: new Date().toISOString(),
      status: 'open' as const,
      description: `Plan change: ${oldPlan} → ${newPlan} (proration: ${body.prorationBehavior})`,
    };
    store.invoices.set(invoice.id, invoice);
    await store.persistInvoice(invoice);
    
    recordBillingEvent(workspaceId, 'plan_change', newPlan, amountCents, 'USD', 'processed', { oldPlan, newPlan, prorationBehavior: body.prorationBehavior, prorationDate: body.prorationDate });
    
    return reply.send({ data: { ...entitlement, invoice } });
  });

  // Cancel subscription
  app.post('/v1/workspaces/:workspaceId/billing/subscription/cancel', { preHandler: resolveRequestContext }, async (req: FastifyRequest, reply: FastifyReply) => {
    const { workspaceId } = req.params as { workspaceId: string };
    const body = req.body as { cancelAtPeriodEnd: boolean };
    const ctx = req.orbitContext!;
    
    const access = requireBillingOwner(ctx, workspaceId);
    if (!access.allowed) return reply.status(403).send({ error: access.error });
    
    const entitlement = store.billingEntitlements.get(workspaceId);
    if (!entitlement) {
      return reply.status(404).send({ error: { code: 'NOT_FOUND', message: 'Billing record not found.' } });
    }
    
    if (entitlement.status === 'cancelled') {
      return reply.status(400).send({ error: { code: 'ALREADY_CANCELLED', message: 'Subscription already cancelled.' } });
    }
    
    entitlement.cancelAtPeriodEnd = body.cancelAtPeriodEnd;
    if (body.cancelAtPeriodEnd) {
      entitlement.status = 'active';
    } else {
      entitlement.status = 'cancelled';
      entitlement.plan = 'personal_free';
      applyPlanDefaults(entitlement, 'personal_free');
    }
    
    store.billingEntitlements.set(workspaceId, entitlement);
    await store.persistBillingEntitlement(entitlement);
    
    recordBillingEvent(workspaceId, 'subscription_cancel', entitlement.plan, 0, 'USD', 'processed', { cancelAtPeriodEnd: body.cancelAtPeriodEnd });
    
    return reply.send({ data: entitlement });
  });

  // Resume subscription
  app.post('/v1/workspaces/:workspaceId/billing/subscription/resume', { preHandler: resolveRequestContext }, async (req: FastifyRequest, reply: FastifyReply) => {
    const { workspaceId } = req.params as { workspaceId: string };
    const ctx = req.orbitContext!;
    
    const access = requireBillingOwner(ctx, workspaceId);
    if (!access.allowed) return reply.status(403).send({ error: access.error });
    
    const entitlement = store.billingEntitlements.get(workspaceId);
    if (!entitlement) {
      return reply.status(404).send({ error: { code: 'NOT_FOUND', message: 'Billing record not found.' } });
    }
    
    if (entitlement.status !== 'cancelled' && entitlement.status !== 'past_due') {
      return reply.status(400).send({ error: { code: 'INVALID_STATE', message: 'Subscription is not cancelled or past due.' } });
    }
    
    entitlement.status = 'active';
    entitlement.plan = 'business_starter';
    entitlement.cancelAtPeriodEnd = false;
    applyPlanDefaults(entitlement, 'business_starter');
    entitlement.renewalDate = new Date(Date.now() + 30 * 24 * 60 * 60 * 1000).toISOString();
    
    store.billingEntitlements.set(workspaceId, entitlement);
    await store.persistBillingEntitlement(entitlement);
    
    recordBillingEvent(workspaceId, 'subscription_resume', entitlement.plan, 0, 'USD', 'processed', {});
    
    return reply.send({ data: entitlement });
  });

  // Grace period - extend grace period on payment failure
  app.post('/v1/workspaces/:workspaceId/billing/subscription/grace-period', { preHandler: resolveRequestContext }, async (req: FastifyRequest, reply: FastifyReply) => {
    const { workspaceId } = req.params as { workspaceId: string };
    const ctx = req.orbitContext!;
    
    const access = requireBillingOwner(ctx, workspaceId);
    if (!access.allowed) return reply.status(403).send({ error: access.error });
    
    const entitlement = store.billingEntitlements.get(workspaceId);
    if (!entitlement) {
      return reply.status(404).send({ error: { code: 'NOT_FOUND', message: 'Billing record not found.' } });
    }
    
    if (entitlement.status !== 'grace_period') {
      return reply.status(400).send({ error: { code: 'INVALID_STATE', message: 'Subscription is not in grace period.' } });
    }
    
    const graceEnd = new Date(Date.now() + GRACE_PERIOD_DAYS * 24 * 60 * 60 * 1000).toISOString();
    entitlement.metadata = { ...entitlement.metadata, gracePeriodEnd: graceEnd };
    entitlement.status = 'grace_period';
    
    store.billingEntitlements.set(workspaceId, entitlement);
    await store.persistBillingEntitlement(entitlement);
    
    recordBillingEvent(workspaceId, 'grace_period_extended', entitlement.plan, 0, 'USD', 'grace_period', { gracePeriodEnd: graceEnd });
    
    return reply.send({ data: entitlement });
  });

  // Seat management
  app.get('/v1/workspaces/:workspaceId/billing/seats', { preHandler: resolveRequestContext }, async (req: FastifyRequest, reply: FastifyReply) => {
    const { workspaceId } = req.params as { workspaceId: string };
    const ctx = req.orbitContext!;
    
    if (!accountOwnsOrIsMember(ctx.account.id, workspaceId)) {
      return reply.status(403).send({ error: { code: 'FORBIDDEN', message: 'Access denied.' } });
    }
    
    const entitlement = store.billingEntitlements.get(workspaceId);
    if (!entitlement) {
      return reply.status(404).send({ error: { code: 'NOT_FOUND', message: 'Billing record not found.' } });
    }
    
    const memberships = Array.from(store.memberships.values()).filter(m => m.workspaceId === workspaceId && m.status === 'active');
    
    return reply.send({
      data: {
        allocated: entitlement.seatsAllocated,
        used: entitlement.seatsUsed,
        available: entitlement.seatsAllocated - entitlement.seatsUsed,
        members: memberships.map(m => ({ userId: m.accountId, role: m.role, joinedAt: m.joinedAt })),
      },
    });
  });

  app.post('/v1/workspaces/:workspaceId/billing/seats', { preHandler: resolveRequestContext }, async (req: FastifyRequest, reply: FastifyReply) => {
    const { workspaceId } = req.params as { workspaceId: string };
    const body = req.body as { quantity: number };
    const ctx = req.orbitContext!;
    
    const access = requireBillingAccess(ctx, workspaceId);
    if (!access.allowed) return reply.status(403).send({ error: access.error });
    
    // Check billing.manage_seats capability
    const canManageSeats = can(roleForWorkspace(ctx, workspaceId) ?? 'agent', 'billing.manage_seats');
    if (!canManageSeats) {
      return reply.status(403).send({ error: { code: 'INSUFFICIENT_CAPABILITY', message: 'You do not have the billing.manage_seats capability.' } });
    }
    
    const entitlement = store.billingEntitlements.get(workspaceId);
    if (!entitlement) {
      return reply.status(404).send({ error: { code: 'NOT_FOUND', message: 'Billing record not found.' } });
    }
    
    if (body.quantity < entitlement.seatsUsed) {
      return reply.status(400).send({ error: { code: 'INVALID_QUANTITY', message: `Cannot reduce seats below current usage (${entitlement.seatsUsed}).` } });
    }
    
    if (body.quantity > 1000) {
      return reply.status(400).send({ error: { code: 'INVALID_QUANTITY', message: 'Maximum seat limit is 1000.' } });
    }
    
    const oldSeats = entitlement.seatsAllocated;
    entitlement.seatsAllocated = body.quantity;
    
    store.billingEntitlements.set(workspaceId, entitlement);
    await store.persistBillingEntitlement(entitlement);
    
    const proratedAmount = calculateProratedSeatAmount(oldSeats, body.quantity, entitlement.plan);
    const invoice = {
      id: `inv_${Date.now()}`,
      workspaceId,
      invoiceNumber: `INV-${Date.now()}`,
      amountCents: proratedAmount,
      currency: 'USD',
      date: new Date().toISOString(),
      status: 'open' as const,
      description: `Seat change: ${oldSeats} → ${body.quantity}`,
    };
    store.invoices.set(invoice.id, invoice);
    await store.persistInvoice(invoice);
    
    recordBillingEvent(workspaceId, 'seat_change', entitlement.plan, proratedAmount, 'USD', 'processed', { oldSeats, newSeats: body.quantity });
    
    return reply.send({ data: entitlement, invoice });
  });

  app.post('/v1/workspaces/:workspaceId/billing/seats/invite', { preHandler: resolveRequestContext }, async (req: FastifyRequest, reply: FastifyReply) => {
    const { workspaceId } = req.params as { workspaceId: string };
    const body = req.body as { email: string; role: 'admin' | 'agent' | 'analyst' };
    const ctx = req.orbitContext!;
    
    const access = requireBillingAccess(ctx, workspaceId);
    if (!access.allowed) return reply.status(403).send({ error: access.error });
    
    // Check billing.manage_seats capability
    const canManageSeats = can(roleForWorkspace(ctx, workspaceId) ?? 'agent', 'billing.manage_seats');
    if (!canManageSeats) {
      return reply.status(403).send({ error: { code: 'INSUFFICIENT_CAPABILITY', message: 'You do not have the billing.manage_seats capability.' } });
    }
    
    const entitlement = store.billingEntitlements.get(workspaceId);
    if (!entitlement) {
      return reply.status(404).send({ error: { code: 'NOT_FOUND', message: 'Billing record not found.' } });
    }
    
    if (entitlement.seatsUsed >= entitlement.seatsAllocated) {
      return reply.status(400).send({ error: { code: 'SEAT_LIMIT_EXCEEDED', message: 'No available seats. Increase seat allocation first.' } });
    }
    
    const token = randomUUID();
    const invitation = {
      id: randomUUID(),
      workspaceId,
      email: body.email,
      role: body.role,
      token,
      status: 'pending' as const,
      invitedByAccountId: ctx.account.id,
      createdAt: new Date().toISOString(),
      acceptedAt: null,
      acceptedAccountId: null,
    };
    
    store.invitations.set(invitation.id, invitation);
    await store.persistWorkspaceInvitation(invitation);
    
    return reply.status(201).send({ data: invitation });
  });

  app.delete('/v1/workspaces/:workspaceId/billing/seats/:userId', { preHandler: resolveRequestContext }, async (req: FastifyRequest, reply: FastifyReply) => {
    const { workspaceId, userId } = req.params as { workspaceId: string; userId: string };
    const ctx = req.orbitContext!;
    
    const access = requireBillingAccess(ctx, workspaceId);
    if (!access.allowed) return reply.status(403).send({ error: access.error });
    
    // Check billing.manage_seats capability
    const canManageSeats = can(roleForWorkspace(ctx, workspaceId) ?? 'agent', 'billing.manage_seats');
    if (!canManageSeats) {
      return reply.status(403).send({ error: { code: 'INSUFFICIENT_CAPABILITY', message: 'You do not have the billing.manage_seats capability.' } });
    }
    
    const entitlement = store.billingEntitlements.get(workspaceId);
    if (!entitlement) {
      return reply.status(404).send({ error: { code: 'NOT_FOUND', message: 'Billing record not found.' } });
    }
    
    if (userId === ctx.account.id) {
      return reply.status(400).send({ error: { code: 'CANNOT_REMOVE_SELF', message: 'Cannot remove yourself. Transfer ownership first.' } });
    }
    
    const membership = Array.from(store.memberships.values()).find(m => m.workspaceId === workspaceId && m.accountId === userId && m.status === 'active');
    if (!membership) {
      return reply.status(404).send({ error: { code: 'MEMBER_NOT_FOUND', message: 'Active member not found.' } });
    }
    
    membership.status = 'revoked';
    await store.persistMembership(membership);
    
    entitlement.seatsUsed = Math.max(0, entitlement.seatsUsed - 1);
    store.billingEntitlements.set(workspaceId, entitlement);
    await store.persistBillingEntitlement(entitlement);
    
    return reply.send({ data: { success: true, seatsUsed: entitlement.seatsUsed } });
  });

  // Invoice access (billing owner/admin only)
  app.get('/v1/workspaces/:workspaceId/billing/invoices', { preHandler: resolveRequestContext }, async (req: FastifyRequest, reply: FastifyReply) => {
    const { workspaceId } = req.params as { workspaceId: string };
    const ctx = req.orbitContext!;
    
    const entitlement = store.billingEntitlements.get(workspaceId);
    if (!entitlement) {
      return reply.status(404).send({ error: { code: 'NOT_FOUND', message: 'Billing record not found.' } });
    }
    
    const isBillingOwner = entitlement.billingOwnerUserId === ctx.account.id;
    const isWorkspaceOwner = ctx.activeWorkspace.ownerAccountId === ctx.account.id;
    const membership = ctx.membership;
    const isAdmin = membership?.role === 'admin';
    
    if (!isBillingOwner && !isWorkspaceOwner && !isAdmin) {
      return reply.status(403).send({ error: { code: 'INVOICE_ACCESS_DENIED', message: 'Only billing owner, workspace owner, or admin can view invoices.' } });
    }
    
    const invoices = Array.from(store.invoices.values()).filter(inv => inv.workspaceId === workspaceId);
    return reply.send({ data: invoices });
  });

  app.get('/v1/workspaces/:workspaceId/billing/invoices/:id', { preHandler: resolveRequestContext }, async (req: FastifyRequest, reply: FastifyReply) => {
    const { workspaceId, id } = req.params as { workspaceId: string; id: string };
    const ctx = req.orbitContext!;
    
    const entitlement = store.billingEntitlements.get(workspaceId);
    if (!entitlement) {
      return reply.status(404).send({ error: { code: 'NOT_FOUND', message: 'Billing record not found.' } });
    }
    
    const isBillingOwner = entitlement.billingOwnerUserId === ctx.account.id;
    const isWorkspaceOwner = ctx.activeWorkspace.ownerAccountId === ctx.account.id;
    const membership = ctx.membership;
    const isAdmin = membership?.role === 'admin';
    
    if (!isBillingOwner && !isWorkspaceOwner && !isAdmin) {
      return reply.status(403).send({ error: { code: 'INVOICE_ACCESS_DENIED', message: 'Only billing owner, workspace owner, or admin can download invoices.' } });
    }
    
    const invoice = store.invoices.get(id);
    if (!invoice || invoice.workspaceId !== workspaceId) {
      return reply.status(404).send({ error: { code: 'NOT_FOUND', message: 'Invoice not found.' } });
    }
    
    const html = generateInvoiceHtml(invoice, entitlement);
    reply.header('Content-Type', 'text/html');
    return reply.send(html);
  });

  // Billing owner transfer
  app.post('/v1/workspaces/:workspaceId/billing/ownership/transfer', { preHandler: resolveRequestContext }, async (req: FastifyRequest, reply: FastifyReply) => {
    const { workspaceId } = req.params as { workspaceId: string };
    const body = req.body as { newOwnerUserId: string };
    const ctx = req.orbitContext!;
    
    const entitlement = store.billingEntitlements.get(workspaceId);
    if (!entitlement) {
      return reply.status(404).send({ error: { code: 'NOT_FOUND', message: 'Billing record not found.' } });
    }
    
    if (entitlement.billingOwnerUserId !== ctx.account.id) {
      return reply.status(403).send({ error: { code: 'BILLING_OWNER_REQUIRED', message: 'Only the current billing owner can transfer ownership.' } });
    }
    
    const targetWorkspace = store.workspaces.get(workspaceId);
    if (!targetWorkspace || targetWorkspace.type !== 'business') {
      return reply.status(400).send({ error: { code: 'INVALID_WORKSPACE', message: 'Billing ownership transfer only available for business workspaces.' } });
    }
    
    const membership = Array.from(store.memberships.values()).find(m => m.workspaceId === workspaceId && m.accountId === body.newOwnerUserId && m.status === 'active');
    if (!membership) {
      return reply.status(400).send({ error: { code: 'INVALID_USER', message: 'New billing owner must be an active member of this workspace.' } });
    }
    
    const oldOwnerId = entitlement.billingOwnerUserId;
    entitlement.billingOwnerUserId = body.newOwnerUserId;
    
    store.billingEntitlements.set(workspaceId, entitlement);
    await store.persistBillingEntitlement(entitlement);
    
    recordBillingEvent(workspaceId, 'billing_owner_transfer', entitlement.plan, 0, 'USD', 'processed', { oldOwnerId, newOwnerId: body.newOwnerUserId });
    
    return reply.send({ data: entitlement });
  });

  // Workspace deletion billing cleanup
  app.post('/v1/workspaces/:workspaceId/billing/cleanup-on-delete', { preHandler: resolveRequestContext }, async (req: FastifyRequest, reply: FastifyReply) => {
    const { workspaceId } = req.params as { workspaceId: string };
    const ctx = req.orbitContext!;
    const workspace = store.workspaces.get(workspaceId);
    
    if (!workspace || workspace.ownerAccountId !== ctx.account.id) {
      return reply.status(403).send({ error: { code: 'OWNER_REQUIRED', message: 'Only workspace owner can trigger deletion cleanup.' } });
    }
    
    const entitlement = store.billingEntitlements.get(workspaceId);
    if (!entitlement) {
      return reply.send({ data: { success: true, message: 'No billing record to clean up.' } });
    }
    
    const mockProvider = getMockBillingProvider();
    if (mockProvider) {
      mockProvider.deleteSubscription(workspaceId);
    }
    
    const proratedRefund = calculateProratedRefund(entitlement);
    entitlement.status = 'cancelled';
    entitlement.plan = 'personal_free';
    entitlement.metadata = { ...entitlement.metadata, cleanedUp: true };
    applyPlanDefaults(entitlement, 'personal_free');
    
    store.billingEntitlements.set(workspaceId, entitlement);
    await store.persistBillingEntitlement(entitlement);
    
    if (proratedRefund > 0) {
      const invoice = {
        id: `inv_${Date.now()}`,
        workspaceId,
        invoiceNumber: `INV-${Date.now()}`,
        amountCents: -proratedRefund,
        currency: 'USD',
        date: new Date().toISOString(),
        status: 'refunded' as const,
        description: `Prorated refund on workspace deletion`,
      };
      store.invoices.set(invoice.id, invoice);
      await store.persistInvoice(invoice);
    }
    
    recordBillingEvent(workspaceId, 'workspace_deletion', entitlement.plan, -proratedRefund, 'USD', 'processed', { refunded: proratedRefund > 0 });
    
    return reply.send({ data: { success: true, refunded: proratedRefund > 0, refundAmountCents: proratedRefund } });
  });
}

function accountOwnsOrIsMember(accountId: string, workspaceId: string): boolean {
  const ws = store.workspaces.get(workspaceId);
  if (ws && ws.ownerAccountId === accountId) return true;
  for (const m of store.memberships.values()) {
    if (m.workspaceId === workspaceId && m.accountId === accountId && m.status === 'active') return true;
  }
  return false;
}

function planHierarchy(plan: string): number {
  const hierarchy: Record<string, number> = {
    'personal_free': 0,
    'personal_plus': 1,
    'business_starter': 2,
    'business_scale': 3,
  };
  return hierarchy[plan] ?? 0;
}

function calculatePlanAmount(plan: string, seats: number): number {
  const baseAmounts: Record<string, number> = {
    'personal_free': 0,
    'personal_plus': 900,
    'business_starter': 1800,
    'business_scale': 4900,
  };
  return (baseAmounts[plan] ?? 0) * Math.max(1, seats);
}

function calculateProratedSeatAmount(oldSeats: number, newSeats: number, plan: string): number {
  if (newSeats <= oldSeats) return 0;
  const seatPrice = plan === 'business_scale' ? 1960 : plan === 'business_starter' ? 360 : 900;
  return (newSeats - oldSeats) * seatPrice;
}

function calculateProratedRefund(entitlement: any): number {
  if (entitlement.plan === 'personal_free') return 0;
  const now = new Date();
  const renewal = new Date(entitlement.renewalDate);
  const daysRemaining = Math.max(0, Math.ceil((renewal.getTime() - now.getTime()) / (24 * 60 * 60 * 1000)));
  if (daysRemaining <= 0) return 0;
  
  const monthlyAmount = calculatePlanAmount(entitlement.plan, entitlement.seatsAllocated);
  return Math.round(monthlyAmount * (daysRemaining / 30));
}

function generateInvoiceHtml(invoice: any, entitlement: any): string {
  return `
<!DOCTYPE html>
<html>
<head>
  <meta charset="utf-8">
  <title>Invoice ${invoice.invoiceNumber}</title>
  <style>
    body { font-family: system-ui, sans-serif; max-width: 800px; margin: 0 auto; padding: 40px; }
    .header { display: flex; justify-content: space-between; margin-bottom: 40px; }
    .details { margin-bottom: 20px; }
    .line-items { width: 100%; border-collapse: collapse; margin-bottom: 20px; }
    .line-items th, .line-items td { padding: 12px; text-align: left; border-bottom: 1px solid #e0e0e0; }
    .total { text-align: right; font-size: 1.2em; font-weight: bold; }
    .footer { margin-top: 40px; color: #666; font-size: 0.9em; }
  </style>
</head>
<body>
  <div class="header">
    <div>
      <h1>Orbit Chat</h1>
      <p>Invoice ${invoice.invoiceNumber}</p>
    </div>
    <div style="text-align: right;">
      <p>Date: ${new Date(invoice.date).toLocaleDateString()}</p>
      <p>Status: ${invoice.status}</p>
    </div>
  </div>
  <div class="details">
    <h3>Bill To</h3>
    <p>Workspace ID: ${entitlement.workspaceId}</p>
    <p>Plan: ${entitlement.plan}</p>
    <p>Billing Owner: ${entitlement.billingOwnerUserId}</p>
  </div>
  <table class="line-items">
    <thead>
      <tr><th>Description</th><th>Amount</th></tr>
    </thead>
    <tbody>
      <tr><td>${invoice.description}</td><td>$${(invoice.amountCents / 100).toFixed(2)} ${invoice.currency}</td></tr>
    </tbody>
  </table>
  <div class="total">
    Total: $${(invoice.amountCents / 100).toFixed(2)} ${invoice.currency}
  </div>
  <div class="footer">
    <p>This is a generated invoice. For official tax documents, contact billing@orbit.chat</p>
  </div>
</body>
</html>
  `.trim();
}

async function handleBillingWebhook(event: any, getEntitlement: (workspaceId: string) => any): Promise<void> {
  const { type, data } = event;
  
  switch (type) {
    case 'invoice.payment_failed': {
      const workspaceId = data.workspaceId as string;
      const entitlement = getEntitlement(workspaceId);
      if (entitlement) {
        entitlement.status = 'grace_period';
        const graceEnd = new Date(Date.now() + GRACE_PERIOD_DAYS * 24 * 60 * 60 * 1000).toISOString();
        entitlement.metadata = { ...entitlement.metadata, gracePeriodEnd: graceEnd };
        store.billingEntitlements.set(workspaceId, entitlement);
        await store.persistBillingEntitlement(entitlement);
        
        recordBillingEvent(workspaceId, 'payment_failed', entitlement.plan, 0, 'USD', 'grace_period', { gracePeriodEnd: graceEnd });
        
        scheduleGracePeriodCheck(workspaceId);
      }
      break;
    }
    case 'charge.refunded': {
      const workspaceId = data.workspaceId as string;
      const entitlement = getEntitlement(workspaceId);
      if (entitlement) {
        const amount = data.amount_refunded as number || 0;
        recordBillingEvent(workspaceId, 'refund', entitlement.plan, amount, 'USD', 'refunded', data);
      }
      break;
    }
    case 'charge.dispute.created': {
      const workspaceId = data.workspaceId as string;
      const entitlement = getEntitlement(workspaceId);
      if (entitlement) {
        const amount = data.amount as number || 0;
        recordBillingEvent(workspaceId, 'chargeback', entitlement.plan, amount, 'USD', 'disputed', data);
      }
      break;
    }
    case 'invoice.payment_succeeded': {
      const workspaceId = data.workspaceId as string;
      const entitlement = getEntitlement(workspaceId);
      if (entitlement) {
        entitlement.status = 'active';
        entitlement.renewalDate = new Date(Date.now() + 30 * 24 * 60 * 60 * 1000).toISOString();
        store.billingEntitlements.set(workspaceId, entitlement);
        await store.persistBillingEntitlement(entitlement);
        
        recordBillingEvent(workspaceId, 'payment_succeeded', entitlement.plan, data.amount_paid as number, 'USD', 'active', data);
      }
      break;
    }
    case 'customer.subscription.deleted': {
      const workspaceId = data.workspaceId as string;
      const entitlement = getEntitlement(workspaceId);
      if (entitlement) {
        entitlement.status = 'cancelled';
        entitlement.plan = 'personal_free';
        applyPlanDefaults(entitlement, 'personal_free');
        store.billingEntitlements.set(workspaceId, entitlement);
        await store.persistBillingEntitlement(entitlement);
        
        recordBillingEvent(workspaceId, 'subscription_ended', entitlement.plan, 0, 'USD', 'cancelled', data);
      }
      break;
    }
  }
}

const gracePeriodTimers = new Map<string, NodeJS.Timeout>();

function scheduleGracePeriodCheck(workspaceId: string): void {
  if (gracePeriodTimers.has(workspaceId)) return;
  
  const timer = setInterval(async () => {
    const entitlement = store.billingEntitlements.get(workspaceId);
    if (!entitlement || entitlement.status !== 'grace_period') {
      clearInterval(timer);
      gracePeriodTimers.delete(workspaceId);
      return;
    }
    
    const graceEnd = entitlement.metadata?.gracePeriodEnd ? new Date(entitlement.metadata.gracePeriodEnd as string).getTime() : 0;
    if (Date.now() >= graceEnd) {
      entitlement.status = 'past_due';
      entitlement.plan = 'personal_free';
      applyPlanDefaults(entitlement, 'personal_free');
      store.billingEntitlements.set(workspaceId, entitlement);
      await store.persistBillingEntitlement(entitlement);
      
      recordBillingEvent(workspaceId, 'grace_period_expired', entitlement.plan, 0, 'USD', 'past_due', {});
      
      clearInterval(timer);
      gracePeriodTimers.delete(workspaceId);
    } else {
      const mockProvider = getMockBillingProvider();
      if (mockProvider) {
        const sub = mockProvider.getSubscription(workspaceId);
        if (sub && sub.status === 'active') {
          entitlement.status = 'active';
          store.billingEntitlements.set(workspaceId, entitlement);
          await store.persistBillingEntitlement(entitlement);
          
          recordBillingEvent(workspaceId, 'payment_recovered', entitlement.plan, 0, 'USD', 'active', {});
          
          clearInterval(timer);
          gracePeriodTimers.delete(workspaceId);
        }
      }
    }
  }, 24 * 60 * 60 * 1000);
  
  gracePeriodTimers.set(workspaceId, timer);
}

declare global {
  var store: any;
  var mockBillingProvider: MockBillingProvider;
}