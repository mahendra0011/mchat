/**
 * Orbit Chat Mobile — Push Notification Registration
 * Spec Reference: 12_SECURITY_PRIVACY_SPEC.md, 13_DELIVERY_RELIABILITY_SPEC.md
 *
 * Platform-agnostic push registration logic. React Native / Expo Push
 * token acquisition is injected so this layer stays unit-testable.
 */

import type { IdentityWorkspace } from '@orbit/schemas';

export interface PushTransport {
  requestPermission(): Promise<'granted' | 'denied' | 'unavailable'>;
  getDeviceToken(): Promise<string | null>;
}

export interface PushSubscriptionRecord {
  endpoint: string;
  workspaceId: string;
  deviceToken: string;
  platform: 'ios' | 'android' | 'web';
  isActive: boolean;
  registeredAt: string;
}

export class MobilePushManager {
  private transport: PushTransport;
  private subscriptions = new Map<string, PushSubscriptionRecord>();

  constructor(transport: PushTransport) {
    this.transport = transport;
  }

  async register(activeWorkspace: IdentityWorkspace, platform: 'ios' | 'android'): Promise<PushSubscriptionRecord | null> {
    const permission = await this.transport.requestPermission();
    if (permission !== 'granted') return null;

    const token = await this.transport.getDeviceToken();
    if (!token) return null;

    const record: PushSubscriptionRecord = {
      endpoint: `push://${platform}/${token}`,
      workspaceId: activeWorkspace.id,
      deviceToken: token,
      platform,
      isActive: true,
      registeredAt: new Date().toISOString(),
    };
    this.subscriptions.set(activeWorkspace.id, record);
    return record;
  }

  unregister(workspaceId: string): void {
    const sub = this.subscriptions.get(workspaceId);
    if (sub) {
      sub.isActive = false;
      this.subscriptions.delete(workspaceId);
    }
  }

  getActive(workspaceId: string): PushSubscriptionRecord | null {
    return this.subscriptions.get(workspaceId) ?? null;
  }

  getAll(): PushSubscriptionRecord[] {
    return [...this.subscriptions.values()];
  }
}
