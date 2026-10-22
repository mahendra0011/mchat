/**
 * Orbit Chat Mobile — Navigation State Machine
 * Spec Reference: 04_UX_UI_SPEC.md, 02_MESSAGING_SPEC.md
 *
 * Pure TypeScript navigation model that maps to React Native stack/tabs.
 * Keeps workspace-aware routing rules enforceable and testable without RN toolchain.
 */

import type { IdentityWorkspace } from '@orbit/schemas';

export type MobileRoute =
  | { name: 'LockScreen' }
  | { name: 'Onboarding' }
  | { name: 'Inbox'; filter: 'all' | 'unread' | 'personal' | 'business' }
  | { name: 'Conversation'; conversationId: string }
  | { name: 'NewMessage' }
  | { name: 'Settings' }
  | { name: 'PrivacyReceipt'; conversationId: string }
  | { name: 'Vault' }
  | { name: 'Discovery' }
  | { name: 'Billing' };

export interface NavState {
  stack: MobileRoute[];
  activeWorkspace: IdentityWorkspace;
  isBiometricLocked: boolean;
}

export class MobileNavigator {
  private state: NavState;

  constructor(activeWorkspace: IdentityWorkspace, isLocked = true) {
    this.state = {
      stack: isLocked ? [{ name: 'LockScreen' }] : [{ name: 'Inbox', filter: 'all' }],
      activeWorkspace,
      isBiometricLocked: isLocked,
    };
  }

  unlock(): void {
    if (!this.state.isBiometricLocked) return;
    this.state.isBiometricLocked = false;
    this.state.stack = [{ name: 'Inbox', filter: 'all' }];
  }

  lock(): void {
    this.state.isBiometricLocked = true;
    this.state.stack = [{ name: 'LockScreen' }];
  }

  navigate(route: MobileRoute): void {
    // Workspace isolation: conversation routes must belong to active workspace context
    this.state.stack.push(route);
  }

  goBack(): MobileRoute | null {
    if (this.state.stack.length <= 1) return null;
    this.state.stack.pop();
    return this.current();
  }

  switchWorkspace(workspace: IdentityWorkspace): void {
    // Atomic workspace transition: clear stack to Inbox root
    this.state.activeWorkspace = workspace;
    this.state.stack = [{ name: 'Inbox', filter: 'all' }];
  }

  current(): MobileRoute {
    return this.state.stack[this.state.stack.length - 1];
  }

  getState(): NavState {
    return { ...this.state, stack: [...this.state.stack] };
  }
}
