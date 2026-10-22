/**
 * Orbit Chat Mobile — Screen View Models
 * Spec Reference: 04_UX_UI_SPEC.md (Mobile parity sections)
 *
 * Pure view-model state that React Native screens bind to.
 * Keeps rendering logic thin and business rules testable.
 */

import type { Conversation, MessageEnvelope, IdentityWorkspace } from '@orbit/schemas';

export interface InboxScreenState {
  conversations: Conversation[];
  filter: 'all' | 'unread' | 'personal' | 'business';
  searchQuery: string;
  isRefreshing: boolean;
  error: string | null;
}

export interface ConversationScreenState {
  conversation: Conversation | null;
  messages: MessageEnvelope[];
  draft: string;
  isSending: boolean;
  typingWorkspaceIds: string[];
  pendingUploads: { id: string; name: string; progress: number }[];
  error: string | null;
}

export function filterInboxConversations(
  conversations: Conversation[],
  filter: InboxScreenState['filter'],
  workspaceType: IdentityWorkspace['type']
): Conversation[] {
  switch (filter) {
    case 'unread':
      return conversations.filter((c) => (c.unreadCount ?? 0) > 0);
    case 'personal':
      return workspaceType === 'personal' ? conversations : [];
    case 'business':
      return workspaceType === 'business' ? conversations.filter((c) => c.kind === 'group' || c.kind === 'branch') : [];
    case 'all':
    default:
      return conversations;
  }
}

export function computeDeliveryLabel(lastMessage: MessageEnvelope | undefined, myWorkspaceId: string): string {
  if (!lastMessage) return '';
  if (lastMessage.senderWorkspaceId !== myWorkspaceId) return '';
  switch (lastMessage.deliveryState) {
    case 'sent':
      return 'Sent';
    case 'delivered':
      return 'Delivered';
    case 'read':
      return 'Read';
    case 'failed':
      return 'Failed';
    default:
      return '';
  }
}

export function canSendInConversation(conversation: Conversation | null, draft: string, isSending: boolean): boolean {
  if (!conversation || isSending) return false;
  if (conversation.isArchived) return false;
  return draft.trim().length > 0;
}
