import type { BillingPlanTier } from '@orbit/schemas';

export interface CheckoutSessionResult {
  sessionId: string;
  url: string;
}

export interface PortalSessionResult {
  url: string;
}

export interface WebhookEvent {
  type: string;
  data: Record<string, unknown>;
  rawPayload: string;
}

export interface BillingProvider {
  createCheckoutSession(
    planId: BillingPlanTier,
    workspaceId: string,
    successUrl: string,
    cancelUrl: string
  ): Promise<CheckoutSessionResult>;

  createPortalSession(workspaceId: string): Promise<PortalSessionResult>;

  handleWebhook(payload: string, signature: string): Promise<WebhookEvent>;

  validateWebhook(signature: string): boolean;
}

export interface SubscriptionRecord {
  workspaceId: string;
  planId: BillingPlanTier;
  status: 'active' | 'cancelled' | 'past_due' | 'grace_period';
  seats: number;
  currentPeriodEnd: string;
  cancelAtPeriodEnd: boolean;
  paymentMethodId?: string;
  customerId?: string;
}

export class MockBillingProvider implements BillingProvider {
  private subscriptions = new Map<string, SubscriptionRecord>();
  private checkoutSessions = new Map<string, { planId: BillingPlanTier; workspaceId: string; successUrl: string; cancelUrl: string }>();
  private portalSessions = new Map<string, string>();

  async createCheckoutSession(
    planId: BillingPlanTier,
    workspaceId: string,
    successUrl: string,
    cancelUrl: string
  ): Promise<CheckoutSessionResult> {
    const sessionId = `cs_mock_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
    this.checkoutSessions.set(sessionId, { planId, workspaceId, successUrl, cancelUrl });
    return {
      sessionId,
      url: 'https://checkout.stripe.com/payment-session/mock',
    };
  }

  async createPortalSession(workspaceId: string): Promise<PortalSessionResult> {
    const sessionId = `ps_mock_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
    this.portalSessions.set(sessionId, workspaceId);
    return {
      url: `https://billing.mock/orbit/portal/${sessionId}`,
    };
  }

  async handleWebhook(payload: string, signature: string): Promise<WebhookEvent> {
    let parsed: { type?: unknown; data?: Record<string, unknown> };
    try {
      parsed = JSON.parse(payload) as { type?: unknown; data?: Record<string, unknown> };
    } catch {
      parsed = {};
    }
    return {
      type: typeof parsed.type === 'string' ? parsed.type : 'mock.webhook_received',
      data: parsed.data ?? { payload, signature },
      rawPayload: payload,
    };
  }

  validateWebhook(signature: string): boolean {
    return signature.startsWith('mock_') || signature.includes('mock') || signature === 'test_signature';
  }

  getSubscription(workspaceId: string): SubscriptionRecord | undefined {
    return this.subscriptions.get(workspaceId);
  }

  setSubscription(subscription: SubscriptionRecord): void {
    this.subscriptions.set(subscription.workspaceId, subscription);
  }

  deleteSubscription(workspaceId: string): boolean {
    return this.subscriptions.delete(workspaceId);
  }

  getAllSubscriptions(): SubscriptionRecord[] {
    return Array.from(this.subscriptions.values());
  }

  simulatePaymentSuccess(workspaceId: string): void {
    const sub = this.subscriptions.get(workspaceId);
    if (sub) {
      sub.status = 'active';
      sub.currentPeriodEnd = new Date(Date.now() + 30 * 24 * 60 * 60 * 1000).toISOString();
    }
  }

  simulatePaymentFailure(workspaceId: string): void {
    const sub = this.subscriptions.get(workspaceId);
    if (sub) {
      sub.status = 'grace_period';
    }
  }
}

export class StripeBillingProvider implements BillingProvider {
  private configured = false;

  constructor() {
    const secretKey = process.env.STRIPE_SECRET_KEY;
    const webhookSecret = process.env.STRIPE_WEBHOOK_SECRET;
    if (secretKey && webhookSecret) {
      this.configured = true;
    }
  }

  async createCheckoutSession(
    _planId: BillingPlanTier,
    _workspaceId: string,
    _successUrl: string,
    _cancelUrl: string
  ): Promise<CheckoutSessionResult> {
    if (!this.configured) {
      throw new Error('StripeBillingProvider not configured: STRIPE_SECRET_KEY and STRIPE_WEBHOOK_SECRET required');
    }
    throw new Error('Stripe integration not implemented - implement with @stripe/stripe-js when configured');
  }

  async createPortalSession(_workspaceId: string): Promise<PortalSessionResult> {
    if (!this.configured) {
      throw new Error('StripeBillingProvider not configured: STRIPE_SECRET_KEY and STRIPE_WEBHOOK_SECRET required');
    }
    throw new Error('Stripe integration not implemented - implement with @stripe/stripe-js when configured');
  }

  async handleWebhook(_payload: string, _signature: string): Promise<WebhookEvent> {
    if (!this.configured) {
      throw new Error('StripeBillingProvider not configured');
    }
    throw new Error('Stripe integration not implemented');
  }

  validateWebhook(_signature: string): boolean {
    return this.configured;
  }
}

let providerInstance: BillingProvider | null = null;

export function getBillingProvider(): BillingProvider {
  if (!providerInstance) {
    const useMock = process.env.BILLING_PROVIDER !== 'stripe';
    providerInstance = useMock ? new MockBillingProvider() : new StripeBillingProvider();
  }
  return providerInstance;
}

export function setBillingProvider(provider: BillingProvider): void {
  providerInstance = provider;
}

export function getMockBillingProvider(): MockBillingProvider | null {
  const provider = getBillingProvider();
  return provider instanceof MockBillingProvider ? provider : null;
}