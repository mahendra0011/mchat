/**
 * Orbit Chat Mobile Foundation (iOS & Android Architecture)
 * Spec Reference: 00_START_HERE.md, 04_UX_UI_SPEC.md, 10_TECHNICAL_ARCHITECTURE.md
 *
 * Implements mobile-specific lifecycle, push notification registration,
 * native secure storage interfaces, and identity-aware chat routing.
 */

import { IdentityWorkspace, Conversation, MessageEnvelope } from '@orbit/schemas';
import { assertWorkspaceSenderScope, assertNoInternalNoteLeakage } from '@orbit/domain';

export { MobileNavigator } from './navigation/MobileNavigator.js';
export type { MobileRoute, NavState } from './navigation/MobileNavigator.js';
export { MobilePushManager } from './push/PushManager.js';
export type { PushTransport, PushSubscriptionRecord } from './push/PushManager.js';
export { MobileSecureStorage } from './storage/SecureStorage.js';
export type { SecureStorageDriver } from './storage/SecureStorage.js';
export { filterInboxConversations, computeDeliveryLabel, canSendInConversation } from './screens/viewModels.js';
export type { InboxScreenState, ConversationScreenState } from './screens/viewModels.js';

export interface MobileAppState {
  activeWorkspace: IdentityWorkspace;
  conversations: Conversation[];
  activeConversation: Conversation | null;
  messages: MessageEnvelope[];
  isBiometricLocked: boolean;
}

export class OrbitMobileEngine {
  private state: MobileAppState;

  constructor(initialWorkspace: IdentityWorkspace) {
    this.state = {
      activeWorkspace: initialWorkspace,
      conversations: [],
      activeConversation: null,
      messages: [],
      isBiometricLocked: true,
    };
  }

  unlockWithBiometrics(): boolean {
    this.state.isBiometricLocked = false;
    return true;
  }

  switchWorkspace(newWorkspace: IdentityWorkspace): void {
    // Atomic workspace transition rule on mobile
    this.state.activeWorkspace = newWorkspace;
    this.state.activeConversation = null;
    this.state.messages = [];
  }

  validateOutgoingMessage(workspaceId: string): void {
    assertWorkspaceSenderScope(this.state.activeWorkspace.id, workspaceId);
  }

  verifyTimelineSafety(timeline: MessageEnvelope[]): void {
    assertNoInternalNoteLeakage(timeline);
  }

  getState(): MobileAppState {
    return { ...this.state };
  }
}
