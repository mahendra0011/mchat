import React from 'react';
import { API_BASE_URL } from '../config';
import {
  Send,
  Paperclip,
  Smile,
  Shield,
  ShieldCheck,
  ShieldAlert,
  Phone,
  Sliders,
  Archive,
  PanelRightClose,
  PanelRightOpen,
  Pin,
  Share2,
  Check,
  CheckCheck,
  Clock,
  AlertCircle,
  Lock,
  Reply,
  Pencil,
  Trash2,
  Mic,
  Bell,
  BellOff,
  BellRing,
  ArrowDown,
  X,
  MessageSquarePlus,
  Globe,
  Bookmark,
  GitBranch,
} from 'lucide-react';
import {
  Conversation,
  MessageEnvelope,
  IdentityWorkspace,
  BusinessInternalNote,
  WorkflowCard,
  SendMessageRequest,
  MessageAttachment,
} from '@orbit/schemas';
import { computeVirtualWindow } from '@orbit/domain';
import { MediaMessage } from './MediaRenderers.js';
import { VoiceRecorder, VoiceNotePlayer } from './VoiceRecorder.js';
import { ReplyPreview } from './ReplyPreview.js';
import { CallPanel, type CallState, type CallParticipant } from './CallPanel.js';
import { LinkPreviewCard, extractFirstUrl } from './LinkPreviewCard.js';
import { SchedulingPopover } from './SchedulingPopover.js';
import { SavedRepliesPicker } from './SavedRepliesPicker.js';
import { WorkflowCardView } from './WorkflowCardView.js';
import { apiFetch } from '../lib/apiFetch.js';
import { formatRelativeTime, formatClockTime } from '../lib/time.js';
import { useI18n } from '../i18n-context.js';
import { getAccessToken } from '../lib/secure-storage.js';
import { hasE2EEForMode } from '@orbit/crypto-adapter';

// Message virtualization (Spec 10) — large histories render only the visible
// window; lists at or below the threshold render fully (flow layout, no overlap).
const VIRTUALIZE_THRESHOLD = 150;
const VIRTUAL_OVERSCAN = 10;
const ESTIMATED_ROW_HEIGHT = 84;

/** Wave B — server-enforced edit/delete window (mirrors MESSAGE_EDIT_WINDOW_MS). */
const MESSAGE_EDIT_WINDOW_MS = 15 * 60 * 1000;

/** Notification row returned by GET /v1/notifications. */
export interface NotificationItem {
  id: string;
  workspaceId: string;
  conversationId?: string | null;
  type: string;
  title: string;
  body: string;
  read: boolean;
  createdAt: string;
}

interface ReplyTarget {
  id: string;
  authorName: string;
  body: string;
}

interface UploadMeta {
  durationSeconds?: number;
  contentType?: 'image' | 'audio' | 'document';
}

interface ConversationCanvasProps {
  conversation: Conversation;
  messages: MessageEnvelope[];
  decryptedBodyById: Record<string, string>;
  e2eeKeyStatus?: 'establishing' | 'ready' | 'failed' | 'mismatch' | string;
  internalNotes: BusinessInternalNote[];
  workflowCards: WorkflowCard[];
  activeWorkspace: IdentityWorkspace;
  onSendMessage: (req: Partial<SendMessageRequest>) => Promise<void>;
  onCreateInternalNote: (body: string) => Promise<void>;
  onToggleReaction: (messageId: string, emoji: string) => void;
  onToggleRightPanel: () => void;
  isRightPanelOpen: boolean;
  onOpenPrivacyReceipt: () => void;
  onOpenStudio: () => void;
  onOpenVault: () => void;
  draft: string;
  onDraftChange: (text: string) => void;
  typingWorkspaceIds: string[];
  onForwardMessage: (messageId: string, targetConversationId: string) => Promise<void>;
  onPinMessage: (messageId: string) => Promise<void>;
  onEditMessage: (messageId: string, body: string) => Promise<boolean>;
  onDeleteMessage: (messageId: string, scope: 'self' | 'everyone') => Promise<boolean>;
  onToggleMuteConversation: () => Promise<boolean>;
  onOpenCompose: () => void;
  canBypassEditWindow: boolean;
  linkPreviewsEnabled: boolean;
  timestampFormat: '12h' | '24h';
  notifications: NotificationItem[];
  unreadNotificationCount: number;
  onRefreshNotifications: () => void;
  onMarkAllNotificationsRead: () => void;
  /** Wave B — toggle conversation intent (personal/business) with optimistic revert. */
  onToggleIntent?: (intent: 'personal' | 'business') => void;
  /** Wave B — replace a workflow card after a successful action. */
  onWorkflowCardUpdated: (card: WorkflowCard) => void;
  /** Wave B — message to scroll to (semantic search result). */
  highlightMessageId?: string | null;
  onHighlightHandled?: () => void;
}

interface BranchModalProps {
  isOpen: boolean;
  onClose: () => void;
  sourceMessage: MessageEnvelope;
  conversation: Conversation;
  activeWorkspace: IdentityWorkspace;
  onCreateBranch: (data: { title: string; participantWorkspaceIds: string[]; retentionDays?: number }) => Promise<void>;
}

const BranchModal: React.FC<BranchModalProps> = ({
  isOpen,
  onClose,
  sourceMessage,
  conversation,
  activeWorkspace,
  onCreateBranch,
}) => {
  const { t } = useI18n();
  const [title, setTitle] = React.useState('');
  const [selectedParticipants, setSelectedParticipants] = React.useState<string[]>(conversation.participants.map((p) => p.workspaceId));
  const [retentionDays, setRetentionDays] = React.useState<number | ''>('');
  const [isCreating, setIsCreating] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);

  const availableParticipants = conversation.participants;

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    setIsCreating(true);
    try {
      await onCreateBranch({
        title: title.trim() || `Branch from ${sourceMessage.senderName}'s message`,
        participantWorkspaceIds: selectedParticipants,
        retentionDays: retentionDays ? Number(retentionDays) : undefined,
      });
      onClose();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to create branch');
    } finally {
      setIsCreating(false);
    }
  };

  const toggleParticipant = (workspaceId: string) => {
    setSelectedParticipants((prev) =>
      prev.includes(workspaceId) ? prev.filter((id) => id !== workspaceId) : [...prev, workspaceId]
    );
  };

  if (!isOpen) return null;

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-labelledby="branch-modal-title"
      style={{
        position: 'fixed',
        inset: 0,
        backgroundColor: 'rgba(16, 18, 27, 0.65)',
        backdropFilter: 'blur(8px)',
        zIndex: 80,
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        padding: '16px',
      }}
    >
      <div
        style={{
          width: '100%',
          maxWidth: '480px',
          backgroundColor: 'var(--surface)',
          borderRadius: '20px',
          border: '1px solid var(--border-subtle)',
          boxShadow: '0 20px 40px rgba(0,0,0,0.25)',
          overflow: 'hidden',
          display: 'flex',
          flexDirection: 'column',
          maxHeight: '90vh',
        }}
      >
        <div
          style={{
            padding: '20px 24px 16px',
            borderBottom: '1px solid var(--border-subtle)',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'space-between',
          }}
        >
          <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
            <div
              style={{
                width: '36px',
                height: '36px',
                borderRadius: '10px',
                background: 'linear-gradient(135deg, #805AD5, #5955E8)',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                color: '#fff',
              }}
            >
              <GitBranch size={18} />
            </div>
            <div>
              <h2 id="branch-modal-title" style={{ fontSize: '18px', fontWeight: 700, margin: 0, color: 'var(--text-primary)' }}>
                Create Branch Conversation
              </h2>
              <span style={{ fontSize: '12px', color: 'var(--text-secondary)' }}>
                Start a new thread from a specific message
              </span>
            </div>
          </div>
          <button
            onClick={onClose}
            aria-label="Close modal"
            style={{
              background: 'transparent',
              border: 'none',
              cursor: 'pointer',
              color: 'var(--text-secondary)',
              padding: '6px',
            }}
          >
            <X size={20} />
          </button>
        </div>

        <form onSubmit={handleSubmit} style={{ padding: '24px', overflowY: 'auto', flex: 1 }}>
          <div style={{ marginBottom: '20px' }}>
            <label
              htmlFor="branch-title"
              style={{ display: 'block', fontSize: '12px', fontWeight: 600, color: 'var(--text-primary)', marginBottom: '6px' }}
            >
              Branch Title (optional)
            </label>
            <input
              id="branch-title"
              type="text"
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              placeholder="e.g., Design Review Follow-up"
              style={{
                width: '100%',
                padding: '10px 12px',
                borderRadius: '8px',
                border: '1px solid var(--border-subtle)',
                fontSize: '14px',
                backgroundColor: 'var(--surface)',
                color: 'var(--text-primary)',
                boxSizing: 'border-box',
              }}
            />
            <p style={{ fontSize: '11px', color: 'var(--text-muted)', marginTop: '4px' }}>
              Leave empty to auto-generate from source message
            </p>
          </div>

          <div style={{ marginBottom: '20px' }}>
            <label
              style={{ display: 'block', fontSize: '12px', fontWeight: 600, color: 'var(--text-primary)', marginBottom: '6px' }}
            >
              Participants
            </label>
            <div style={{ display: 'flex', flexDirection: 'column', gap: '8px', maxHeight: '200px', overflowY: 'auto' }}>
              {availableParticipants.map((p) => (
                <label
                  key={p.workspaceId}
                  style={{
                    display: 'flex',
                    alignItems: 'center',
                    gap: '10px',
                    padding: '8px 10px',
                    borderRadius: '8px',
                    border: selectedParticipants.includes(p.workspaceId)
                      ? '1px solid var(--accent-primary)'
                      : '1px solid var(--border-subtle)',
                    backgroundColor: selectedParticipants.includes(p.workspaceId)
                      ? 'var(--accent-soft)'
                      : 'var(--surface-muted)',
                    cursor: 'pointer',
                    transition: 'all 120ms ease',
                  }}
                >
                  <input
                    type="checkbox"
                    checked={selectedParticipants.includes(p.workspaceId)}
                    onChange={() => toggleParticipant(p.workspaceId)}
                    style={{ width: '16px', height: '16px', accentColor: 'var(--accent-primary)', flexShrink: 0 }}
                  />
                  <div
                    style={{
                      width: '28px',
                      height: '28px',
                      borderRadius: '9999px',
                      backgroundColor: 'var(--accent-primary)',
                      color: '#FFF',
                      display: 'flex',
                      alignItems: 'center',
                      justifyContent: 'center',
                      fontWeight: 700,
                      fontSize: '12px',
                      flexShrink: 0,
                    }}
                  >
                    {p.displayName.charAt(0)}
                  </div>
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div style={{ fontSize: '13px', fontWeight: 600, color: 'var(--text-primary)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                      {p.displayName}
                    </div>
                    <div style={{ fontSize: '11px', color: 'var(--text-secondary)' }}>@{p.handle}</div>
                  </div>
                  {p.workspaceId === activeWorkspace.id && (
                    <span style={{ fontSize: '10px', fontWeight: 700, backgroundColor: 'var(--accent-soft)', color: 'var(--accent-primary)', padding: '1px 6px', borderRadius: '4px' }}>
                      You
                    </span>
                  )}
                </label>
              ))}
            </div>
            <p style={{ fontSize: '11px', color: 'var(--text-muted)', marginTop: '4px' }}>
              {selectedParticipants.length} of {availableParticipants.length} selected
            </p>
          </div>

          <div style={{ marginBottom: '20px' }}>
            <label
              htmlFor="branch-retention"
              style={{ display: 'block', fontSize: '12px', fontWeight: 600, color: 'var(--text-primary)', marginBottom: '6px' }}
            >
              Retention Override (days, optional)
            </label>
            <input
              id="branch-retention"
              type="number"
              min="1"
              max="3650"
              value={retentionDays}
              onChange={(e) => {
                const val = e.target.value;
                setRetentionDays(val === '' ? ('' as const) : parseInt(val, 10));
              }}
              placeholder={conversation.retentionDays ? `Default: ${conversation.retentionDays} days` : 'No default retention'}
              style={{
                width: '100%',
                padding: '10px 12px',
                borderRadius: '8px',
                border: '1px solid var(--border-subtle)',
                fontSize: '14px',
                backgroundColor: 'var(--surface)',
                color: 'var(--text-primary)',
                boxSizing: 'border-box',
              }}
            />
            <p style={{ fontSize: '11px', color: 'var(--text-muted)', marginTop: '4px' }}>
              Override the default message retention period for this branch
            </p>
          </div>

          {error && (
            <div
              role="alert"
              style={{
                padding: '10px 12px',
                borderRadius: '8px',
                backgroundColor: 'rgba(229,62,62,0.12)',
                border: '1px solid var(--danger)',
                color: 'var(--danger)',
                fontSize: '12px',
                marginBottom: '16px',
              }}
            >
              {error}
            </div>
          )}

          <div style={{ display: 'flex', gap: '10px', justifyContent: 'flex-end' }}>
            <button
              type="button"
              onClick={onClose}
              disabled={isCreating}
              style={{
                padding: '10px 18px',
                borderRadius: '8px',
                border: '1px solid var(--border-subtle)',
                backgroundColor: 'transparent',
                color: 'var(--text-secondary)',
                fontSize: '13px',
                fontWeight: 600,
                cursor: isCreating ? 'not-allowed' : 'pointer',
                opacity: isCreating ? 0.6 : 1,
              }}
            >
              {t('common.cancel')}
            </button>
            <button
              type="submit"
              disabled={isCreating || selectedParticipants.length === 0}
              style={{
                padding: '10px 18px',
                borderRadius: '8px',
                border: 'none',
                backgroundColor: selectedParticipants.length === 0 ? 'var(--surface-muted)' : 'var(--accent-primary)',
                color: selectedParticipants.length === 0 ? 'var(--text-muted)' : '#FFF',
                fontSize: '13px',
                fontWeight: 600,
                cursor: isCreating || selectedParticipants.length === 0 ? 'not-allowed' : 'pointer',
                opacity: isCreating ? 0.8 : 1,
              }}
            >
              {isCreating ? t('common.creating') : 'Create Branch'}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
};

export const ConversationCanvas: React.FC<ConversationCanvasProps> = ({
  conversation,
  messages,
  decryptedBodyById,
  e2eeKeyStatus,
  internalNotes,
  workflowCards,
  activeWorkspace,
  onSendMessage,
  onCreateInternalNote,
  onToggleReaction,
  onToggleRightPanel,
  isRightPanelOpen,
  onOpenPrivacyReceipt,
  onOpenStudio,
  onOpenVault,
  draft,
  onDraftChange,
  typingWorkspaceIds,
  onForwardMessage,
  onPinMessage,
  onEditMessage,
  onDeleteMessage,
  onToggleMuteConversation,
  onOpenCompose,
  canBypassEditWindow,
  linkPreviewsEnabled,
  timestampFormat,
  notifications,
  unreadNotificationCount,
  onRefreshNotifications,
  onMarkAllNotificationsRead,
  onToggleIntent,
  onWorkflowCardUpdated,
  highlightMessageId,
  onHighlightHandled,
}) => {
  const { t } = useI18n();
  const isBusiness = activeWorkspace.type === 'business';
  const [composerMode, setComposerMode] = React.useState<'customer' | 'internal'>('customer');
  const [internalNoteDraft, setInternalNoteDraft] = React.useState('');
  const [showEmojiPickerFor, setShowEmojiPickerFor] = React.useState<string | null>(null);
  const [hoveredMessageId, setHoveredMessageId] = React.useState<string | null>(null);
  const [pinnedMessageId, setPinnedMessageId] = React.useState<string | null>(null);
  const [forwardModalMessageId, setForwardModalMessageId] = React.useState<string | null>(null);
  const [isSubmitting, setIsSubmitting] = React.useState(false);
  // Branch modal state
  const [branchModal, setBranchModal] = React.useState<{ isOpen: boolean; sourceMessage: MessageEnvelope | null }>({
    isOpen: false,
    sourceMessage: null,
  });
  const messageEndRef = React.useRef<HTMLDivElement>(null);
  const [isUploading, setIsUploading] = React.useState(false);
  const [uploadProgress, setUploadProgress] = React.useState<number | null>(null);
  const fileInputRef = React.useRef<HTMLInputElement>(null);
  const [reportingMessageId, setReportingMessageId] = React.useState<string | null>(null);
  const [reportReason, setReportReason] = React.useState<string>('spam');
  const [reportDetails, setReportDetails] = React.useState<string>('');
  const [isSubmittingReport, setIsSubmittingReport] = React.useState(false);
  const [reportSuccess, setReportSuccess] = React.useState<string | null>(null);

  // Wave B — scheduling, saved replies, translation, presence, workflow actions
  const [isSchedulingOpen, setIsSchedulingOpen] = React.useState(false);
  const [scheduledCount, setScheduledCount] = React.useState(0);
  const [isSavedRepliesOpen, setIsSavedRepliesOpen] = React.useState(false);
  const [translationNoteFor, setTranslationNoteFor] = React.useState<string | null>(null);
  const translationDismissedRef = React.useRef<Set<string>>(new Set());
  const [presenceOnline, setPresenceOnline] = React.useState<Record<string, boolean>>({});
  const [workflowError, setWorkflowError] = React.useState<string | null>(null);
  const [workflowBusyCardId, setWorkflowBusyCardId] = React.useState<string | null>(null);
  const messageRefs = React.useRef<Map<string, HTMLDivElement>>(new Map());

  // Wave B — message reply / edit / delete actions
  const [replyTo, setReplyTo] = React.useState<ReplyTarget | null>(null);
  const [editingMessageId, setEditingMessageId] = React.useState<string | null>(null);
  const [editingDraft, setEditingDraft] = React.useState('');
  const [isSavingEdit, setIsSavingEdit] = React.useState(false);
  const [editError, setEditError] = React.useState<string | null>(null);
  const [deleteTarget, setDeleteTarget] = React.useState<MessageEnvelope | null>(null);
  const [deleteError, setDeleteError] = React.useState<string | null>(null);

  // Voice note recording (replaces the text input row while active)
  const [isVoiceRecorderOpen, setIsVoiceRecorderOpen] = React.useState(false);

  // Upload lifecycle — progress, cancel (abort) and retry
  const uploadXhrRef = React.useRef<XMLHttpRequest | null>(null);
  const pendingUploadRef = React.useRef<{ file: File; meta?: UploadMeta } | null>(null);
  const [uploadFileName, setUploadFileName] = React.useState<string>('');
  const [uploadError, setUploadError] = React.useState<string | null>(null);

  // Header popovers — conversation mute lives in App state via onToggleMuteConversation
  const [isNotificationsOpen, setIsNotificationsOpen] = React.useState(false);

  // Call session (Spec 13 — signaling API + local getUserMedia, graceful degradation)
  const [callState, setCallState] = React.useState<CallState | null>(null);
  const [callError, setCallError] = React.useState<string | null>(null);
  const [isCallMuted, setIsCallMuted] = React.useState(false);
  const [isVideoOn, setIsVideoOn] = React.useState(true);
  const [isScreenSharing, setIsScreenSharing] = React.useState(false);
  const [mediaVersion, setMediaVersion] = React.useState(0);
  const localStreamRef = React.useRef<MediaStream | null>(null);
  const screenStreamRef = React.useRef<MediaStream | null>(null);
  const callIdRef = React.useRef<string | null>(null);
  const callWrapRef = React.useRef<HTMLDivElement>(null);

  // Scroll stickiness / jump-to-latest (Spec 10)
  const [isAtBottom, setIsAtBottom] = React.useState(true);
  const [showJumpToLatest, setShowJumpToLatest] = React.useState(false);

  // Conversation Studio (Spec 08) — per-chat appearance applied to rendering.
  const studio = conversation.studioSettings;
  const studioDensity = studio?.density ?? 'standard';
  const studioBubbleRadius = studio?.bubbleRadius ?? 'md';
  const showAvatars = studio?.showAvatars ?? true;
  const accentColor = studio?.themeAccent || (isBusiness ? '#805AD5' : 'var(--accent-primary)');
  const rowGap = studioDensity === 'compact' ? 6 : studioDensity === 'comfortable' ? 14 : 10;
  const bubblePadding =
    studioDensity === 'compact' ? '7px 11px' : studioDensity === 'comfortable' ? '13px 17px' : '10px 14px';
  const baseRadiusPx =
    studioBubbleRadius === 'sm' ? '8px' : studioBubbleRadius === 'lg' ? '20px' : studioBubbleRadius === 'full' ? '26px' : '16px';

  // Message virtualization (Spec 10): flow-layout windowing via top/bottom spacers.
  const timelineRef = React.useRef<HTMLDivElement>(null);
  const topSpacerRef = React.useRef<HTMLDivElement>(null);
  const [scrollMetrics, setScrollMetrics] = React.useState({
    scrollTop: 0,
    viewportHeight: 600,
    headerOffset: 0,
  });
  // Messages hidden from this workspace (delete-for-self) are never rendered.
  // Deleted-for-everyone messages (tombstones) ARE rendered as tombstones.
  const timelineMessages = React.useMemo(
    () =>
      messages.filter((m) => !(m.deletedFor ?? []).includes(activeWorkspace.id)),
    [messages, activeWorkspace.id]
  );

  const virtualizing = timelineMessages.length > VIRTUALIZE_THRESHOLD;
  const syncScrollMetrics = React.useCallback(() => {
    const container = timelineRef.current;
    if (!container) return;
    const spacerRect = topSpacerRef.current?.getBoundingClientRect();
    const containerRect = container.getBoundingClientRect();
    const headerOffset = spacerRect
      ? Math.max(0, spacerRect.top - containerRect.top + container.scrollTop)
      : 0;
    setScrollMetrics((prev) => {
      if (
        prev.scrollTop === container.scrollTop &&
        prev.viewportHeight === container.clientHeight &&
        prev.headerOffset === headerOffset
      ) {
        return prev;
      }
      return { scrollTop: container.scrollTop, viewportHeight: container.clientHeight, headerOffset };
    });
  }, []);
  const virtualWindow = React.useMemo(() => {
    if (!virtualizing) return null;
    return computeVirtualWindow({
      itemCount: timelineMessages.length,
      itemHeight: ESTIMATED_ROW_HEIGHT,
      viewportHeight: scrollMetrics.viewportHeight,
      scrollTop: Math.max(0, scrollMetrics.scrollTop - scrollMetrics.headerOffset),
      overscan: VIRTUAL_OVERSCAN,
    });
  }, [virtualizing, timelineMessages.length, scrollMetrics]);
  const visibleMessages = virtualWindow
    ? timelineMessages.slice(virtualWindow.startIndex, virtualWindow.endIndex)
    : timelineMessages;
  React.useLayoutEffect(() => {
    syncScrollMetrics();
  }, [syncScrollMetrics, timelineMessages, internalNotes, workflowCards]);

  const scrollToBottom = React.useCallback((behavior: ScrollBehavior) => {
    const container = timelineRef.current;
    if (!container) return;
    container.scrollTo({ top: container.scrollHeight, behavior });
    setIsAtBottom(true);
    setShowJumpToLatest(false);
  }, []);

  // Conversation switch: land at the newest message immediately.
  React.useEffect(() => {
    setIsAtBottom(true);
    setShowJumpToLatest(false);
    const frame = window.requestAnimationFrame(() => scrollToBottom('auto'));
    return () => window.cancelAnimationFrame(frame);
  }, [conversation.id, scrollToBottom]);

  // New messages: auto-stick when at the bottom, otherwise surface "Jump to latest".
  React.useEffect(() => {
    if (isAtBottom) {
      scrollToBottom('smooth');
    } else {
      setShowJumpToLatest(true);
    }
  }, [timelineMessages.length, internalNotes.length]);

  const handleTimelineScroll = React.useCallback(() => {
    syncScrollMetrics();
    const container = timelineRef.current;
    if (!container) return;
    const atBottom = container.scrollHeight - container.scrollTop - container.clientHeight < 56;
    setIsAtBottom(atBottom);
    if (atBottom) setShowJumpToLatest(false);
  }, [syncScrollMetrics]);

  const handleSend = async () => {
    if (composerMode === 'internal') {
      if (!internalNoteDraft.trim() || isSubmitting) return;
      setIsSubmitting(true);
      try {
        await onCreateInternalNote(internalNoteDraft.trim());
        setInternalNoteDraft('');
      } finally {
        setIsSubmitting(false);
      }
    } else {
      if (!draft.trim() || isSubmitting) return;
      setIsSubmitting(true);
      try {
        await onSendMessage({
          body: draft.trim(),
          contentType: 'text',
          replyToMessageId: replyTo?.id,
        });
        setReplyTo(null);
      } finally {
        setIsSubmitting(false);
      }
    }
  };

  const handleKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      void handleSend();
    }
  };

  // Media upload lifecycle (Spec 02 P0): XHR reports progress so the composer can
  // show a live bar with cancel (abort) and retry affordances.
  const sendAttachment = async (attachment: MessageAttachment, meta?: UploadMeta) => {
    const contentType: SendMessageRequest['contentType'] =
      meta?.contentType ??
      (attachment.mimeType.startsWith('image/')
        ? 'image'
        : attachment.mimeType.startsWith('audio/')
          ? 'audio'
          : 'document');
    const att: MessageAttachment =
      meta?.durationSeconds !== undefined
        ? { ...attachment, durationSeconds: meta.durationSeconds }
        : attachment;
    await onSendMessage({
      conversationId: conversation.id,
      idempotencyKey: `att-${Date.now()}`,
      clientMessageId: `att-${Date.now()}`,
      contentType,
      body: att.name,
      attachments: [att],
      replyToMessageId: replyTo?.id,
      isEncrypted: conversation.isE2EE,
    });
    setReplyTo(null);
  };

  const settleUpload = () => {
    uploadXhrRef.current = null;
    setIsUploading(false);
    setUploadProgress(null);
  };

  const startUpload = async (file: File, meta?: UploadMeta) => {
    if (isUploading) return;
    pendingUploadRef.current = { file, meta };
    setUploadFileName(file.name);
    setUploadError(null);
    setIsUploading(true);
    setUploadProgress(0);

    const xhr = new XMLHttpRequest();
    uploadXhrRef.current = xhr;
    xhr.open('POST', `${API_BASE_URL}/v1/media/upload`);
    const token = await getAccessToken();
    if (token) xhr.setRequestHeader('Authorization', `Bearer ${token}`);

    xhr.upload.onprogress = (event) => {
      if (event.lengthComputable) {
        setUploadProgress(Math.min(99, Math.round((event.loaded / event.total) * 100)));
      }
    };
    xhr.onload = () => {
      settleUpload();
      if (xhr.status >= 200 && xhr.status < 300) {
        try {
          const body = JSON.parse(xhr.responseText) as { data: MessageAttachment };
          pendingUploadRef.current = null;
          setUploadFileName('');
          void sendAttachment(body.data, meta);
        } catch {
          setUploadError(t('upload.failed'));
        }
        if (fileInputRef.current) fileInputRef.current.value = '';
      } else {
        setUploadError(
          xhr.status === 413 ? 'File is too large (25 MB max).' : t('upload.failed')
        );
      }
    };
    xhr.onerror = () => {
      settleUpload();
      setUploadError(t('upload.failed'));
    };
    xhr.onabort = () => {
      settleUpload();
      pendingUploadRef.current = null;
      setUploadFileName('');
    };

    const formData = new FormData();
    formData.append('file', file);
    xhr.send(formData);
  };

  const cancelUpload = () => {
    uploadXhrRef.current?.abort();
  };

  const retryUpload = () => {
    const pending = pendingUploadRef.current;
    if (pending && !isUploading) void startUpload(pending.file, pending.meta);
  };

  const dismissUploadError = () => {
    setUploadError(null);
    pendingUploadRef.current = null;
    setUploadFileName('');
  };

  const handleFileSelect = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    void startUpload(file);
    if (fileInputRef.current) fileInputRef.current.value = '';
  };

  const handleVoiceNoteDone = (blob: Blob, seconds: number) => {
    setIsVoiceRecorderOpen(false);
    const extension = blob.type.includes('ogg') ? 'ogg' : blob.type.includes('mp4') ? 'm4a' : 'webm';
    const file = new File([blob], `voice-note-${Date.now()}.${extension}`, {
      type: blob.type || 'audio/webm',
    });
    void startUpload(file, { durationSeconds: seconds, contentType: 'audio' });
  };

  // ---- Message actions: edit + delete (Wave B) ----
  const withinEditWindow = (createdAt: string): boolean => {
    const parsed = Date.parse(createdAt);
    if (Number.isNaN(parsed)) return false;
    return Date.now() - parsed <= MESSAGE_EDIT_WINDOW_MS;
  };

  const beginEdit = (msg: MessageEnvelope) => {
    const displayText = conversation.isE2EE && hasE2EEForMode(conversation.kind as any)
      ? decryptedBodyById[msg.id] ?? msg.body
      : msg.body;
    setEditingMessageId(msg.id);
    setEditingDraft(displayText);
    setEditError(null);
  };

  const cancelEdit = () => {
    setEditingMessageId(null);
    setEditingDraft('');
    setEditError(null);
  };

  const saveEdit = async (messageId: string) => {
    const trimmed = editingDraft.trim();
    if (!trimmed || isSavingEdit) return;
    setIsSavingEdit(true);
    setEditError(null);
    const ok = await onEditMessage(messageId, trimmed);
    setIsSavingEdit(false);
    if (ok) cancelEdit();
    else setEditError(t('errors.editFailed'));
  };

  const handleDeleteConfirm = async (scope: 'self' | 'everyone') => {
    if (!deleteTarget) return;
    setDeleteError(null);
    const ok = await onDeleteMessage(deleteTarget.id, scope);
    if (ok) {
      setDeleteTarget(null);
    } else {
      setDeleteError(t('errors.deleteFailed'));
    }
  };

  // ---- Call session (Spec 13) ----
  const callParticipants: CallParticipant[] = React.useMemo(() => {
    const list: CallParticipant[] = [
      { id: activeWorkspace.id, name: activeWorkspace.displayName, isMuted: isCallMuted, hasVideo: isVideoOn, isLocal: true },
    ];
    for (const p of conversation.participants) {
      if (p.workspaceId !== activeWorkspace.id) {
        list.push({ id: p.workspaceId, name: p.displayName, hasVideo: true });
      }
    }
    return list;
  }, [conversation.participants, activeWorkspace, isCallMuted, isVideoOn]);

  const startCall = async () => {
    if (callState) return;
    setCallError(null);
    setCallState('connecting');
    let stream: MediaStream | null = null;
    try {
      stream = await navigator.mediaDevices.getUserMedia({
        audio: true,
        video: isVideoOn,
      });
    } catch {
      try {
        stream = await navigator.mediaDevices.getUserMedia({ audio: true });
        setIsVideoOn(false);
      } catch {
        stream = null;
      }
    }
    localStreamRef.current = stream;
    setMediaVersion((v) => v + 1);

    try {
      const res = await fetch(`${API_BASE_URL}/v1/conversations/${conversation.id}/calls`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Accept: 'application/json',
          Authorization: `Bearer ${await getAccessToken()}`,
          'x-workspace-id': activeWorkspace.id,
        },
        body: JSON.stringify({ kind: isVideoOn ? 'video' : 'audio' }),
      });
      if (res.ok) {
        const body = (await res.json()) as { data?: { id?: string } };
        const callId = body.data?.id;
        if (callId) {
          callIdRef.current = callId;
          setCallState('active');
        } else {
          setCallState('active');
        }
      } else {
        setCallState(null);
        setCallError('Unable to start call right now.');
      }
    } catch {
      setCallState(null);
      setCallError('Unable to start call right now.');
    }
  };

  const toggleCallMute = () => {
    setIsCallMuted((prev) => {
      const next = !prev;
      localStreamRef.current?.getAudioTracks().forEach((track) => {
        track.enabled = !next;
      });
      return next;
    });
  };

  const toggleVideo = () => {
    setIsVideoOn((prev) => {
      const next = !prev;
      localStreamRef.current?.getVideoTracks().forEach((track) => {
        track.enabled = next;
      });
      return next;
    });
  };

  const toggleScreenShare = async () => {
    if (isScreenSharing) {
      screenStreamRef.current?.getTracks().forEach((track) => track.stop());
      screenStreamRef.current = null;
      setIsScreenSharing(false);
      setMediaVersion((v) => v + 1);
      return;
    }
    try {
      const display = (await (navigator.mediaDevices as unknown as {
        getDisplayMedia: (c: unknown) => Promise<MediaStream>;
      }).getDisplayMedia({ video: true })) as MediaStream;
      screenStreamRef.current = display;
      setIsScreenSharing(true);
      setMediaVersion((v) => v + 1);
    } catch {
      // permission denied or unsupported; no-op
    }
  };

  const leaveCall = async () => {
    const callId = callIdRef.current;
    if (callId) {
      try {
        await fetch(`${API_BASE_URL}/v1/calls/${callId}/signal`, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            Accept: 'application/json',
            Authorization: `Bearer ${await getAccessToken()}`,
            'x-workspace-id': activeWorkspace.id,
          },
          body: JSON.stringify({ callId, type: 'hangup', payload: {} }),
        });
      } catch {
        // best-effort
      }
    }
    localStreamRef.current?.getTracks().forEach((track) => track.stop());
    localStreamRef.current = null;
    screenStreamRef.current?.getTracks().forEach((track) => track.stop());
    screenStreamRef.current = null;
    callIdRef.current = null;
    setIsScreenSharing(false);
    setCallState('ended');
    setMediaVersion((v) => v + 1);
    window.setTimeout(() => setCallState(null), 900);
  };

  // Trust & Safety report (Spec 14): real API call with pre-submission disclosure + evidence
  const handleReportSubmit = async () => {
    if (!reportingMessageId) return;
    setIsSubmittingReport(true);
    try {
      const targetMsg = messages.find((m) => m.id === reportingMessageId);
      const targetHandle =
        conversation.participants.find((p) => p.workspaceId !== activeWorkspace.id)?.handle || 'unknown';
      const res = await fetch(`${API_BASE_URL}/v1/admin/reports`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${await getAccessToken()}`,
          'x-workspace-id': activeWorkspace.id,
        },
        body: JSON.stringify({
          targetUserId: targetMsg?.senderWorkspaceId || 'unknown',
          targetHandle,
          targetConversationId: conversation.id,
          reason: reportReason,
          details: reportDetails || undefined,
          evidenceMessageIds: [reportingMessageId],
        }),
      });
      if (res.ok) {
        setReportSuccess(reportingMessageId);
        setTimeout(() => {
          setReportingMessageId(null);
          setReportSuccess(null);
          setReportDetails('');
        }, 2500);
      }
    } catch {
      // swallow; user can retry
    } finally {
      setIsSubmittingReport(false);
    }
  };

  const getE2EEShield = () => {
    if (!conversation.isE2EE) {
      return {
        icon: Shield,
        color: 'var(--text-muted)',
        label: 'Standard In-Transit Encryption (TLS)',
      };
    }
    if (e2eeKeyStatus === 'ready' || e2eeKeyStatus === 'established') {
      return {
        icon: ShieldCheck,
        color: 'var(--positive)',
        label: 'End-to-End Encrypted (Verified Session)',
      };
    }
    if (e2eeKeyStatus === 'establishing') {
      return {
        icon: Shield,
        color: 'var(--caution)',
        label: 'Establishing Secure Keys...',
      };
    }
    return {
      icon: ShieldAlert,
      color: 'var(--danger)',
      label: 'E2EE Key Warning / Unverified',
    };
  };

  const shieldInfo = getE2EEShield();
  const ShieldIcon = shieldInfo.icon;

  const counterpart = conversation.participants.find((p) => p.workspaceId !== activeWorkspace.id);
  const displayTitle = conversation.title || counterpart?.displayName || 'Chat';
  const avatarUrl = counterpart?.avatarUrl;

  // Attach the local MediaStream to the CallPanel's <video> element (best-effort).
  React.useEffect(() => {
    if (!callWrapRef.current) return;
    const videoEl = callWrapRef.current.querySelector('video');
    if (!videoEl) return;
    const stream = isScreenSharing ? screenStreamRef.current : localStreamRef.current;
    videoEl.srcObject = stream;
  }, [callState, isScreenSharing, mediaVersion]);

  // Close the notifications popover on outside click / Escape.
  React.useEffect(() => {
    if (!isNotificationsOpen) return;
    const onPointerDown = (e: PointerEvent) => {
      const target = e.target as HTMLElement;
      if (target.closest('[data-canvas-popover="notifications"]')) return;
      setIsNotificationsOpen(false);
    };
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        setIsNotificationsOpen(false);
      }
    };
    document.addEventListener('pointerdown', onPointerDown);
    document.addEventListener('keydown', onKeyDown);
    return () => {
      document.removeEventListener('pointerdown', onPointerDown);
      document.removeEventListener('keydown', onKeyDown);
    };
  }, [isNotificationsOpen]);

  // ---- Wave B: scheduling count ----
  const loadScheduledCount = React.useCallback(async () => {
    try {
      const res = await apiFetch<{ data: Array<{ id: string }> }>(
        `/v1/conversations/${conversation.id}/scheduled`,
        { workspaceId: activeWorkspace.id }
      );
      setScheduledCount(Array.isArray(res?.data) ? res.data.length : 0);
    } catch {
      setScheduledCount(0);
    }
  }, [conversation.id, activeWorkspace.id]);

  React.useEffect(() => {
    void loadScheduledCount();
  }, [loadScheduledCount]);

  // ---- Wave B: presence for the other participant ----
  React.useEffect(() => {
    let cancelled = false;
    async function loadPresence() {
      try {
        const res = await apiFetch<{
          participants?: Array<{ workspaceId: string; isOnline?: boolean }>;
        }>(`/v1/conversations/${conversation.id}/presence`, { workspaceId: activeWorkspace.id });
        if (cancelled) return;
        const map: Record<string, boolean> = {};
        for (const p of res?.participants ?? []) map[p.workspaceId] = Boolean(p.isOnline);
        setPresenceOnline(map);
      } catch {
        if (!cancelled) setPresenceOnline({});
      }
    }
    void loadPresence();
    return () => {
      cancelled = true;
    };
  }, [conversation.id, activeWorkspace.id]);

  // ---- Wave B: scroll to a highlighted (searched) message ----
  React.useEffect(() => {
    if (!highlightMessageId) return;
    const frame = window.requestAnimationFrame(() => {
      const el = messageRefs.current.get(highlightMessageId);
      if (el) {
        el.scrollIntoView({ block: 'center', behavior: 'smooth' });
        el.style.transition = 'background-color 1200ms ease';
        el.style.backgroundColor = 'var(--accent-soft)';
        window.setTimeout(() => {
          el.style.backgroundColor = '';
        }, 1200);
      }
      onHighlightHandled?.();
    });
    return () => window.cancelAnimationFrame(frame);
  }, [highlightMessageId, onHighlightHandled]);

  const handleToggleIntent = () => {
    if (!onToggleIntent) return;
    const current = conversation.intent === 'business' ? 'business' : 'personal';
    onToggleIntent(current === 'business' ? 'personal' : 'business');
  };

  const onCreateBranch = async (data: { title: string; participantWorkspaceIds: string[]; retentionDays?: number }) => {
    const res = await apiFetch(
      `/v1/conversations/${conversation.id}/branches`,
      { method: 'POST', workspaceId: activeWorkspace.id, body: data }
    );
    if (!res) throw new Error('Failed to create branch');
    // The parent App component will handle navigation to the new branch
    // We could emit an event or call a callback here
    window.dispatchEvent(new CustomEvent('branch:created', { detail: res }));
  };

  const handleWorkflowAction = async (
    cardId: string,
    actionId: string,
    payload?: Record<string, unknown>
  ) => {
    setWorkflowError(null);
    setWorkflowBusyCardId(cardId);
    try {
      const updated = await apiFetch<WorkflowCard>(
        `/v1/workflows/${cardId}/actions`,
        { method: 'POST', workspaceId: activeWorkspace.id, body: { actionId, payload } }
      );
      onWorkflowCardUpdated(updated);
    } catch {
      setWorkflowError(t('workflow.actionFailed'));
    } finally {
      setWorkflowBusyCardId(null);
    }
  };

  const handleTranslate = (messageId: string) => {
    // No translation endpoint ships in this API build — surface a one-time note.
    if (translationDismissedRef.current.has(messageId)) return;
    setTranslationNoteFor(messageId);
  };

  const dismissTranslation = (messageId: string) => {
    translationDismissedRef.current.add(messageId);
    setTranslationNoteFor((prev) => (prev === messageId ? null : prev));
  };

  const handleInsertSavedReply = (body: string) => {
    const trimmed = draft.trim();
    const next = trimmed ? `${trimmed}\n${body}` : body;
    onDraftChange(next);
  };

  const counterpartOnline =
    counterpart?.isOnline === true || presenceOnline[counterpart?.workspaceId ?? ''] === true;
  const counterpartLastActive = (counterpart as { lastActiveAt?: string | null } | undefined)?.lastActiveAt;

  // Close scheduling / saved-replies popovers on outside click / Escape.
  React.useEffect(() => {
    if (!isSchedulingOpen && !isSavedRepliesOpen) return;
    const onPointerDown = (e: PointerEvent) => {
      const target = e.target as HTMLElement;
      if (target.closest('[data-canvas-popover="scheduling"]')) return;
      if (target.closest('[data-canvas-popover="schedule-trigger"]')) return;
      if (target.closest('[data-canvas-popover="saved-replies"]')) return;
      if (target.closest('[data-canvas-popover="saved-replies-trigger"]')) return;
      setIsSchedulingOpen(false);
      setIsSavedRepliesOpen(false);
    };
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        setIsSchedulingOpen(false);
        setIsSavedRepliesOpen(false);
      }
    };
    document.addEventListener('pointerdown', onPointerDown);
    document.addEventListener('keydown', onKeyDown);
    return () => {
      document.removeEventListener('pointerdown', onPointerDown);
      document.removeEventListener('keydown', onKeyDown);
    };
  }, [isSchedulingOpen, isSavedRepliesOpen]);

  const quickEmojis = ['👍', '❤️', '🔥', '👏', '🎉', '💡'];

  return (
    <main
      id="conversation-canvas"
      role="region"
      aria-label={`Conversation with ${displayTitle}`}
      style={{
        flex: 1,
        display: 'flex',
        flexDirection: 'column',
        backgroundColor: 'var(--canvas)',
        position: 'relative',
        overflow: 'hidden',
      }}
    >
      {/* 1. Conversation Header (Spec 04 & Spec 07) */}
      <header
        style={{
          height: '64px',
          padding: '0 20px',
          backgroundColor: 'var(--surface)',
          borderBottom: '1px solid var(--border-subtle)',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          flexShrink: 0,
          zIndex: 10,
        }}
      >
        <div style={{ display: 'flex', alignItems: 'center', gap: '14px', minWidth: 0 }}>
          {/* Avatar */}
          <div
            style={{
              width: '42px',
              height: '42px',
              borderRadius: conversation.kind === 'direct' ? '9999px' : '12px',
              backgroundColor: isBusiness ? '#805AD5' : 'var(--accent-primary)',
              color: '#FFF',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              fontWeight: 700,
              fontSize: '15px',
              flexShrink: 0,
            }}
          >
            {avatarUrl ? (
              <img
                src={avatarUrl}
                alt={displayTitle}
                style={{ width: '100%', height: '100%', borderRadius: 'inherit', objectFit: 'cover' }}
              />
            ) : (
              displayTitle.charAt(0)
            )}
          </div>

          <div style={{ minWidth: 0 }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
              <h1
                style={{
                  fontSize: '15px',
                  fontWeight: 600,
                  color: 'var(--text-primary)',
                  margin: 0,
                  overflow: 'hidden',
                  textOverflow: 'ellipsis',
                  whiteSpace: 'nowrap',
                }}
              >
                {displayTitle}
              </h1>

              {/* Wave B — intent mode toggle (personal / business) */}
              <button
                type="button"
                onClick={handleToggleIntent}
                aria-label={t(conversation.intent === 'business' ? 'intent.personal' : 'intent.business')}
                title={
                  conversation.intent === 'business'
                    ? t('intent.personal')
                    : t('intent.business')
                }
                style={{
                  fontSize: '11px',
                  fontWeight: 600,
                  textTransform: 'uppercase',
                  padding: '2px 6px',
                  borderRadius: '6px',
                  border: 'none',
                  cursor: onToggleIntent ? 'pointer' : 'default',
                  backgroundColor:
                    conversation.intent === 'business' ? 'var(--business-badge)' : 'var(--accent-soft)',
                  color: conversation.intent === 'business' ? 'var(--accent-text)' : 'var(--accent-primary)',
                  letterSpacing: '0.5px',
                  flexShrink: 0,
                }}
              >
                {conversation.intent === 'business' ? t('intent.business') : t('intent.personal')}
              </button>

              {conversation.intentMode && (
                <span
                  style={{
                    fontSize: '11px',
                    fontWeight: 600,
                    textTransform: 'uppercase',
                    padding: '2px 6px',
                    borderRadius: '6px',
                    backgroundColor: 'var(--surface-muted)',
                    color: 'var(--text-secondary)',
                    letterSpacing: '0.5px',
                  }}
                >
                  {conversation.intentMode} mode
                </span>
              )}

              {/* Branch badge */}
              {conversation.kind === 'branch' && (
                <span
                  style={{
                    fontSize: '11px',
                    fontWeight: 600,
                    textTransform: 'uppercase',
                    padding: '2px 6px',
                    borderRadius: '6px',
                    backgroundColor: 'var(--accent-soft)',
                    color: 'var(--accent-primary)',
                    letterSpacing: '0.5px',
                    display: 'inline-flex',
                    alignItems: 'center',
                    gap: '4px',
                  }}
                >
                  <GitBranch size={10} />
                  Branch
                </span>
              )}
            </div>

            {/* Wave B — presence indicator for the other participant */}
            <div
              style={{
                display: 'flex',
                alignItems: 'center',
                gap: '5px',
                marginTop: '2px',
                fontSize: '12px',
                color: counterpartOnline ? 'var(--positive)' : 'var(--text-muted)',
              }}
            >
              <span
                aria-hidden="true"
                style={{
                  width: '7px',
                  height: '7px',
                  borderRadius: '9999px',
                  backgroundColor: counterpartOnline ? 'var(--positive)' : 'var(--text-muted)',
                  flexShrink: 0,
                }}
              />
              <span>
                {counterpartOnline
                  ? t('presence.online')
                  : counterpartLastActive
                    ? t('presence.lastSeen', { time: formatRelativeTime(counterpartLastActive) })
                    : t('presence.offline')}
              </span>
            </div>

            {/* E2EE and Privacy Receipt Trigger */}
            <button
              onClick={onOpenPrivacyReceipt}
              title={`${shieldInfo.label} — Click to inspect Privacy Receipt`}
              aria-label="Inspect Privacy Receipt"
              style={{
                background: 'none',
                border: 'none',
                padding: 0,
                marginTop: '2px',
                display: 'inline-flex',
                alignItems: 'center',
                gap: '5px',
                cursor: 'pointer',
                fontSize: '12px',
                color: shieldInfo.color,
                fontWeight: 500,
              }}
            >
              <ShieldIcon size={13} />
              <span>{shieldInfo.label}</span>
            </button>
          </div>
        </div>

        {/* Action Controls */}
        <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
          {/* Wave B — scheduled messages indicator + trigger */}
          <div style={{ position: 'relative' }} data-canvas-popover="schedule-trigger">
            <button
              onClick={() => {
                if (!isSchedulingOpen) void loadScheduledCount();
                setIsSchedulingOpen((prev) => !prev);
              }}
              aria-label={t('schedule.title')}
              aria-expanded={isSchedulingOpen}
              title={t('schedule.title')}
              style={{
                width: '36px',
                height: '36px',
                borderRadius: '8px',
                border: 'none',
                backgroundColor: isSchedulingOpen ? 'var(--accent-soft)' : 'transparent',
                color: isSchedulingOpen ? 'var(--accent-primary)' : 'var(--text-secondary)',
                cursor: 'pointer',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                position: 'relative',
              }}
            >
              <Clock size={18} />
              {scheduledCount > 0 && (
                <span
                  aria-hidden="true"
                  style={{
                    position: 'absolute',
                    top: '2px',
                    right: '2px',
                    minWidth: '14px',
                    height: '14px',
                    padding: '0 3px',
                    borderRadius: '9999px',
                    backgroundColor: 'var(--accent-primary)',
                    color: 'var(--accent-text)',
                    fontSize: '9px',
                    fontWeight: 700,
                    display: 'inline-flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                    lineHeight: 1,
                  }}
                >
                  {scheduledCount}
                </span>
              )}
            </button>
          </div>

          <button
            onClick={() => {
              if (callState) {
                void leaveCall();
              } else {
                void startCall();
              }
            }}
            aria-label={callState ? 'End call' : 'Start call'}
            title={callState ? 'End Call' : 'Start Call'}
            style={{
              width: '36px',
              height: '36px',
              borderRadius: '8px',
              border: 'none',
              backgroundColor: callState ? 'var(--danger)' : 'transparent',
              color: callState ? '#FFF' : 'var(--text-secondary)',
              cursor: 'pointer',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              transition: 'background 120ms ease',
            }}
          >
            {callState ? <X size={18} /> : <Phone size={18} />}
          </button>

          {/* Conversation mute toggle */}
          <button
            onClick={() => void onToggleMuteConversation()}
            aria-label={conversation.isMuted ? 'Unmute conversation' : 'Mute conversation'}
            title={conversation.isMuted ? 'Unmute notifications' : 'Mute notifications'}
            style={{
              width: '36px',
              height: '36px',
              borderRadius: '8px',
              border: 'none',
              backgroundColor: conversation.isMuted ? 'var(--surface-muted)' : 'transparent',
              color: conversation.isMuted ? 'var(--caution)' : 'var(--text-secondary)',
              cursor: 'pointer',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
            }}
          >
            {conversation.isMuted ? <BellOff size={18} /> : <BellRing size={18} />}
          </button>

          {/* Notifications feed */}
          <div style={{ position: 'relative' }} data-canvas-popover="notifications">
            <button
              onClick={() => {
                setIsNotificationsOpen((prev) => {
                  if (!prev) onRefreshNotifications();
                  return !prev;
                });
              }}
              aria-label="Notifications"
              aria-expanded={isNotificationsOpen}
              title="Notifications"
              style={{
                width: '36px',
                height: '36px',
                borderRadius: '8px',
                border: 'none',
                backgroundColor: isNotificationsOpen ? 'var(--accent-soft)' : 'transparent',
                color: isNotificationsOpen ? 'var(--accent-primary)' : 'var(--text-secondary)',
                cursor: 'pointer',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                position: 'relative',
              }}
            >
              <Bell size={18} />
              {unreadNotificationCount > 0 && (
                <span
                  aria-hidden="true"
                  style={{
                    position: 'absolute',
                    top: '4px',
                    right: '4px',
                    minWidth: '14px',
                    height: '14px',
                    padding: '0 3px',
                    borderRadius: '9999px',
                    backgroundColor: 'var(--danger)',
                    color: '#FFF',
                    fontSize: '9px',
                    fontWeight: 700,
                    display: 'inline-flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                    lineHeight: 1,
                  }}
                >
                  {unreadNotificationCount > 9 ? '9+' : unreadNotificationCount}
                </span>
              )}
            </button>

            {isNotificationsOpen && (
              <div
                role="dialog"
                aria-label="Notifications"
                style={{
                  position: 'absolute',
                  top: '44px',
                  right: 0,
                  width: '320px',
                  maxHeight: '360px',
                  overflowY: 'auto',
                  backgroundColor: 'var(--surface)',
                  border: '1px solid var(--border-subtle)',
                  borderRadius: '12px',
                  boxShadow: '0 8px 30px rgba(0,0,0,0.18)',
                  padding: '8px',
                  zIndex: 40,
                }}
              >
                <div
                  style={{
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'space-between',
                    padding: '4px 8px 8px',
                    fontSize: '12px',
                    fontWeight: 700,
                    color: 'var(--text-secondary)',
                    textTransform: 'uppercase',
                    letterSpacing: '0.5px',
                  }}
                >
                  <span>{t('notifications.title')}</span>
                  <button
                    type="button"
                    onClick={() => onMarkAllNotificationsRead()}
                    disabled={unreadNotificationCount === 0}
                    style={{
                      border: 'none',
                      background: 'none',
                      cursor: unreadNotificationCount === 0 ? 'default' : 'pointer',
                      color: unreadNotificationCount === 0 ? 'var(--text-muted)' : 'var(--accent-primary)',
                      fontSize: '11px',
                      fontWeight: 600,
                    }}
                  >
                    {t('notifications.markAllRead')}
                  </button>
                </div>
                {notifications.length === 0 ? (
                  <p
                    style={{
                      margin: 0,
                      padding: '16px 8px',
                      textAlign: 'center',
                      fontSize: '13px',
                      color: 'var(--text-muted)',
                    }}
                  >
                    {t('notifications.empty')}
                  </p>
                ) : (
                  notifications.map((n) => (
                    <button
                      key={n.id}
                      type="button"
                      style={{
                        display: 'block',
                        width: '100%',
                        textAlign: 'left',
                        border: 'none',
                        borderRadius: '8px',
                        padding: '8px 10px',
                        cursor: 'pointer',
                        backgroundColor: n.read ? 'transparent' : 'var(--accent-soft)',
                        marginBottom: '2px',
                      }}
                    >
                      <div
                        style={{
                          fontSize: '13px',
                          fontWeight: n.read ? 500 : 700,
                          color: 'var(--text-primary)',
                          marginBottom: '2px',
                        }}
                      >
                        {n.title}
                      </div>
                      <div style={{ fontSize: '12px', color: 'var(--text-muted)', lineHeight: 1.4 }}>
                        {n.body}
                      </div>
                      <div style={{ fontSize: '10px', color: 'var(--text-muted)', marginTop: '4px' }}>
                        {new Date(n.createdAt).toLocaleString([], {
                          hour: '2-digit',
                          minute: '2-digit',
                          day: 'numeric',
                          month: 'short',
                        })}
                      </div>
                    </button>
                  ))
                )}
              </div>
            )}
          </div>

          {/* New conversation compose trigger */}
          <button
            onClick={onOpenCompose}
            aria-label="New conversation"
            title="New conversation"
            style={{
              width: '36px',
              height: '36px',
              borderRadius: '8px',
              border: 'none',
              backgroundColor: 'transparent',
              color: 'var(--text-secondary)',
              cursor: 'pointer',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
            }}
          >
            <MessageSquarePlus size={18} />
          </button>

          <button
            onClick={onOpenStudio}
            aria-label="Conversation Studio appearance"
            title="Conversation Studio (Visual customization)"
            style={{
              width: '36px',
              height: '36px',
              borderRadius: '8px',
              border: 'none',
              backgroundColor: 'transparent',
              color: 'var(--text-secondary)',
              cursor: 'pointer',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
            }}
          >
            <Sliders size={18} />
          </button>

          <button
            onClick={onOpenVault}
            aria-label="Context Vault saved items"
            title="Context Vault"
            style={{
              width: '36px',
              height: '36px',
              borderRadius: '8px',
              border: 'none',
              backgroundColor: 'transparent',
              color: 'var(--text-secondary)',
              cursor: 'pointer',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
            }}
          >
            <Archive size={18} />
          </button>

          <button
            onClick={onToggleRightPanel}
            aria-label={isRightPanelOpen ? 'Collapse side panel' : 'Expand side panel'}
            title={isRightPanelOpen ? 'Close Side Panel' : 'Open Side Panel'}
            style={{
              width: '36px',
              height: '36px',
              borderRadius: '8px',
              border: 'none',
              backgroundColor: isRightPanelOpen ? 'var(--accent-soft)' : 'transparent',
              color: isRightPanelOpen ? 'var(--accent-primary)' : 'var(--text-secondary)',
              cursor: 'pointer',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
            }}
          >
            {isRightPanelOpen ? <PanelRightClose size={18} /> : <PanelRightOpen size={18} />}
          </button>
        </div>
      </header>

      {/* Pinned Message Banner (Spec 02 P0) */}
      {pinnedMessageId && (
        <div
          role="note"
          aria-label="Pinned message"
          style={{
            backgroundColor: 'var(--surface-muted)',
            borderBottom: '1px solid var(--border-subtle)',
            padding: '8px 20px',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'space-between',
            fontSize: '13px',
            color: 'var(--text-primary)',
          }}
        >
          <div style={{ display: 'flex', alignItems: 'center', gap: '8px', minWidth: 0 }}>
            <Pin size={14} style={{ color: 'var(--accent-primary)', flexShrink: 0 }} />
            <span style={{ fontWeight: 600 }}>Pinned:</span>
            <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
              {decryptedBodyById[pinnedMessageId] ||
                messages.find((m) => m.id === pinnedMessageId)?.body ||
                'Pinned message'}
            </span>
          </div>
          <button
            onClick={() => setPinnedMessageId(null)}
            style={{
              border: 'none',
              background: 'none',
              cursor: 'pointer',
              color: 'var(--text-muted)',
              fontSize: '12px',
            }}
          >
            Unpin
          </button>
        </div>
      )}

      {/* 2. Message Timeline / Stream */}
      <div
        id="messages-scroll-area"
        role="log"
        aria-live="polite"
        aria-relevant="additions"
        tabIndex={0}
        aria-label="Message stream"
        ref={timelineRef}
        onScroll={handleTimelineScroll}
        style={{
          flex: 1,
          overflowY: 'auto',
          padding: '20px',
          display: 'flex',
          flexDirection: 'column',
          gap: `${rowGap}px`,
        }}
      >
        {messages.length === 0 && internalNotes.length === 0 ? (
          <div
            style={{
              margin: 'auto',
              textAlign: 'center',
              color: 'var(--text-muted)',
              fontSize: '14px',
              maxWidth: '320px',
            }}
          >
            <div
              style={{
                width: '48px',
                height: '48px',
                borderRadius: '16px',
                backgroundColor: 'var(--surface-muted)',
                margin: '0 auto 12px',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                color: 'var(--accent-primary)',
              }}
            >
              <Send size={22} />
            </div>
            <p style={{ fontWeight: 600, color: 'var(--text-primary)', marginBottom: '4px' }}>
              No messages yet
            </p>
            <p style={{ fontSize: '13px' }}>
              Send a message to start communicating securely with {displayTitle}.
            </p>
          </div>
        ) : (
          <>
            {/* Render Messages (virtualized above threshold — Spec 10) */}
            <div
              ref={topSpacerRef}
              style={{ height: virtualWindow ? virtualWindow.offsetTop : 0, flexShrink: 0 }}
              aria-hidden="true"
            />
            {visibleMessages.map((msg, index) => {
              const isMine = msg.senderWorkspaceId === activeWorkspace.id;
              const displayText = conversation.isE2EE && hasE2EEForMode(conversation.kind as any)
                ? decryptedBodyById[msg.id] ?? msg.body
                : msg.body;
              const isHovered = hoveredMessageId === msg.id;
              const isEditing = editingMessageId === msg.id;
              const prevMsg = index > 0 ? visibleMessages[index - 1] : null;
              const msgDay = msg.createdAt ? new Date(msg.createdAt).toDateString() : null;
              const prevDay = prevMsg?.createdAt ? new Date(prevMsg.createdAt).toDateString() : null;
              const showDateSeparator = msgDay !== null && msgDay !== prevDay;

              const isBotMessage = !!msg.integrationId;
              const bubbleBg = isMine
                ? accentColor
                : isBotMessage
                ? 'var(--accent-soft)'
                : 'var(--surface)';
              const bubbleBorder = isMine ? 'none' : isBotMessage ? '1px solid var(--accent-primary)' : '1px solid var(--border-subtle)';
              const bubbleColor = isMine ? '#FFFFFF' : 'var(--text-primary)';

              return (
                <React.Fragment key={msg.id || index}>
                  {showDateSeparator && (
                    <div
                      role="separator"
                      aria-label={`Date separator ${msgDay}`}
                      style={{
                        display: 'flex',
                        alignItems: 'center',
                        gap: '10px',
                        margin: '6px 0',
                        fontSize: '11px',
                        fontWeight: 600,
                        color: 'var(--text-muted)',
                        textTransform: 'uppercase',
                        letterSpacing: '0.5px',
                      }}
                    >
                      <span style={{ flex: 1, height: 1, backgroundColor: 'var(--border-subtle)' }} />
                      <span>
                        {new Date(msg.createdAt as string).toLocaleDateString([], {
                          weekday: 'short',
                          day: 'numeric',
                          month: 'short',
                          year: 'numeric',
                        })}
                      </span>
                      <span style={{ flex: 1, height: 1, backgroundColor: 'var(--border-subtle)' }} />
                    </div>
                  )}
                  <div
                    ref={(el) => {
                      if (el) messageRefs.current.set(msg.id, el);
                      else messageRefs.current.delete(msg.id);
                    }}
                    onMouseEnter={() => setHoveredMessageId(msg.id)}
                    onMouseLeave={() => {
                      setHoveredMessageId(null);
                      setShowEmojiPickerFor(null);
                    }}
                    style={{
                      display: 'flex',
                      flexDirection: 'column',
                      alignItems: isMine ? 'flex-end' : 'flex-start',
                      position: 'relative',
                    }}
                  >
                  {/* Tombstone for deleted-for-everyone messages */}
                  {msg.isDeleted && (
                    <div
                      style={{
                        display: 'flex',
                        alignItems: 'center',
                        gap: '8px',
                        padding: '8px 12px',
                        borderRadius: '12px',
                        backgroundColor: 'var(--surface-muted)',
                        color: 'var(--text-tertiary)',
                        fontSize: '13px',
                        fontStyle: 'italic',
                        maxWidth: '75%',
                        marginBottom: '4px',
                      }}
                    >
                      <Trash2 size={14} style={{ color: 'var(--text-muted)', flexShrink: 0 }} />
                      <span>{t('common.deletedMessage')}</span>
                      {(msg.editedAt || msg.createdAt) && (
                        <span style={{ fontSize: '11px', opacity: 0.7 }}>
                          {t('receipt.deletedAt', { time: formatRelativeTime(msg.editedAt || msg.createdAt) })}
                        </span>
                      )}
                    </div>
                  )}
                  {!msg.isDeleted && (
                    <>
                    {!isMine && (
                    <span
                      style={{
                        display: 'inline-flex',
                        alignItems: 'center',
                        gap: '6px',
                        fontSize: '12px',
                        fontWeight: 600,
                        color: 'var(--text-secondary)',
                        marginBottom: '3px',
                        marginLeft: '4px',
                      }}
                    >
                      {showAvatars && (
                        <span
                          aria-hidden="true"
                          style={{
                            width: '16px',
                            height: '16px',
                            borderRadius: conversation.kind === 'direct' ? '9999px' : '8px',
                            backgroundColor: 'var(--surface-muted)',
                            color: 'var(--text-secondary)',
                            display: 'inline-flex',
                            alignItems: 'center',
                            justifyContent: 'center',
                            fontSize: '9px',
                            fontWeight: 700,
                            flexShrink: 0,
                          }}
                        >
                          {(msg.senderName || '?').charAt(0)}
                        </span>
                      )}
                      {msg.senderName}
                      {msg.integrationId && (
                        <span
                          style={{
                            fontSize: '9px',
                            fontWeight: 700,
                            padding: '1px 5px',
                            borderRadius: '4px',
                            backgroundColor: 'var(--accent-soft)',
                            color: 'var(--accent-primary)',
                            textTransform: 'uppercase',
                            letterSpacing: '0.3px',
                          }}
                        >
                          BOT
                        </span>
                      )}
                    </span>
                  )}

                  {/* Message Bubble Container */}
  <div
    style={{
      display: 'flex',
      alignItems: 'flex-end',
      gap: '8px',
      flexDirection: isMine ? 'row-reverse' : 'row',
      maxWidth: '75%',
    }}
  >
    {/* Bubble */}
    <div
      style={{
        padding: bubblePadding,
        borderRadius: isMine
          ? `${baseRadiusPx} ${baseRadiusPx} 4px ${baseRadiusPx}`
          : `${baseRadiusPx} ${baseRadiusPx} ${baseRadiusPx} 4px`,
        backgroundColor: bubbleBg,
        color: bubbleColor,
        border: bubbleBorder,
        boxShadow: '0 1px 2px rgba(0,0,0,0.04)',
        wordBreak: 'break-word',
        position: 'relative',
        maxWidth: '480px',
      }}
    >
                      {/* Quoted reply preview */}
                      {msg.replyToMessageId && (
                        <div
                          style={{
                            borderLeft: `3px solid ${isMine ? 'rgba(255,255,255,0.7)' : 'var(--accent-primary)'}`,
                            borderRadius: '6px',
                            backgroundColor: isMine ? 'rgba(255,255,255,0.14)' : 'var(--surface-muted)',
                            padding: '4px 8px',
                            marginBottom: '6px',
                            fontSize: '12px',
                            minWidth: 0,
                          }}
                        >
                          <div
                            style={{
                              fontWeight: 600,
                              opacity: 0.9,
                              overflow: 'hidden',
                              textOverflow: 'ellipsis',
                              whiteSpace: 'nowrap',
                            }}
                          >
                            {msg.replyToSenderName || 'Unknown'}
                          </div>
                          <div
                            style={{
                              opacity: 0.75,
                              overflow: 'hidden',
                              textOverflow: 'ellipsis',
                              whiteSpace: 'nowrap',
                            }}
                          >
                            {msg.replyToSnippet ||
                              decryptedBodyById[msg.replyToMessageId] ||
                              messages.find((m) => m.id === msg.replyToMessageId)?.body ||
                              ''}
                          </div>
                        </div>
                      )}

                      {/* Attachments if any */}
                      {msg.attachments && msg.attachments.length > 0 && (
                        <div style={{ marginBottom: '8px', display: 'flex', flexDirection: 'column', gap: '6px' }}>
                          {msg.attachments.map((att, aIdx) => {
                            const absoluteUrl = att.url.startsWith('/') ? `${API_BASE_URL}${att.url}` : att.url;
                            if (att.mimeType.startsWith('audio/') && (att.name || '').startsWith('voice-note')) {
                              return (
                                <VoiceNotePlayer
                                  key={aIdx}
                                  src={absoluteUrl}
                                  durationSeconds={att.durationSeconds}
                                />
                              );
                            }
                            if (att.mimeType.startsWith('image/')) {
                              return (
                                <a
                                  key={aIdx}
                                  href={absoluteUrl}
                                  target="_blank"
                                  rel="noopener noreferrer"
                                  aria-label={`Open image ${att.name || ''} in a new tab`}
                                  style={{ display: 'block', maxWidth: '320px' }}
                                >
                                  <MediaMessage attachment={{ ...att, url: absoluteUrl }} />
                                </a>
                              );
                            }
                            return (
                              <MediaMessage
                                key={aIdx}
                                attachment={{ ...att, url: absoluteUrl }}
                              />
                            );
                          })}
                        </div>
                      )}

                      {/* Text or inline edit box */}
                      {isEditing ? (
                        <div style={{ minWidth: '240px' }}>
                          <textarea
                            aria-label="Edit message"
                            rows={2}
                            value={editingDraft}
                            onChange={(e) => setEditingDraft(e.target.value)}
                            onKeyDown={(e) => {
                              if (e.key === 'Enter' && !e.shiftKey) {
                                e.preventDefault();
                                void saveEdit(msg.id);
                              } else if (e.key === 'Escape') {
                                cancelEdit();
                              }
                            }}
                            autoFocus
                            style={{
                              width: '100%',
                              minHeight: '56px',
                              border: '1px solid var(--border-subtle)',
                              borderRadius: '8px',
                              background: 'var(--canvas)',
                              color: 'var(--text-primary)',
                              padding: '8px 10px',
                              fontSize: '14px',
                              lineHeight: '1.45',
                              fontFamily: 'inherit',
                              resize: 'vertical',
                              outline: 'none',
                            }}
                          />
                          {editError && (
                            <p role="alert" style={{ margin: '6px 0 0', fontSize: '12px', color: 'var(--danger)' }}>
                              {editError}
                            </p>
                          )}
                          <div style={{ display: 'flex', gap: '6px', marginTop: '6px', justifyContent: 'flex-end' }}>
                            <button
                              type="button"
                              onClick={cancelEdit}
                              style={{
                                padding: '4px 10px',
                                borderRadius: '6px',
                                border: '1px solid var(--border-subtle)',
                                background: 'transparent',
                                color: 'var(--text-secondary)',
                                cursor: 'pointer',
                                fontSize: '12px',
                              }}
                            >
                              {t('common.cancel')}
                            </button>
                            <button
                              type="button"
                              onClick={() => void saveEdit(msg.id)}
                              disabled={isSavingEdit || !editingDraft.trim()}
                              style={{
                                padding: '4px 10px',
                                borderRadius: '6px',
                                border: 'none',
                                backgroundColor: 'var(--accent-primary)',
                                color: '#FFF',
                                cursor: isSavingEdit ? 'wait' : 'pointer',
                                fontSize: '12px',
                                fontWeight: 600,
                                opacity: isSavingEdit || !editingDraft.trim() ? 0.6 : 1,
                              }}
                            >
                              {isSavingEdit ? t('common.saving') : t('common.save')}
                            </button>
                          </div>
                        </div>
                      ) : (
                        <>
                          {/* Text */}
                          <p style={{ margin: 0, fontSize: '14px', lineHeight: '1.45', whiteSpace: 'pre-wrap' }}>
                            {displayText}
                          </p>

                          {/* Link preview card */}
                          {linkPreviewsEnabled &&
                            msg.contentType === 'text' &&
                            (() => {
                              const url = extractFirstUrl(displayText);
                              return url ? <LinkPreviewCard url={url} enabled={linkPreviewsEnabled} /> : null;
                            })()}

                          {/* Meta: Timestamp, Edited, Status */}
                          <div
                            style={{
                              display: 'flex',
                              alignItems: 'center',
                              justifyContent: 'flex-end',
                              gap: '4px',
                              marginTop: '4px',
                              fontSize: '11px',
                              color: isMine ? 'rgba(255,255,255,0.75)' : 'var(--text-muted)',
                            }}
                          >
                            {msg.isEncrypted && !msg.integrationId && <Lock size={10} style={{ opacity: 0.8 }} />}
                            {msg.isEdited && <span>(edited)</span>}
                            <span>
                              {msg.createdAt
                                ? new Date(msg.createdAt).toLocaleTimeString([], {
                                    hour: '2-digit',
                                    minute: '2-digit',
                                    hour12: timestampFormat === '12h',
                                  })
                                : ''}
                            </span>

                            {isMine && (
                              <span style={{ display: 'inline-flex', alignItems: 'center', marginLeft: '2px' }}>
                                {msg.deliveryState === 'sending' && <Clock size={12} />}
                                {msg.deliveryState === 'sent' && <Check size={12} />}
                                {msg.deliveryState === 'delivered' && <CheckCheck size={12} />}
                                {msg.deliveryState === 'read' && (
                                  <CheckCheck size={12} style={{ color: isMine ? '#90CDF4' : 'var(--accent-primary)' }} />
                                )}
                                {msg.deliveryState === 'failed' && (
                                  <AlertCircle size={12} style={{ color: 'var(--danger)' }} />
                                )}
                              </span>
                            )}
                          </div>
                        </>
                      )}
                    </div>

                    {/* Hover Actions Menu (Desktop/Pointer) */}
                    {isHovered && (
                      <div
                        role="toolbar"
                        aria-label="Message actions"
                        style={{
                          display: 'flex',
                          alignItems: 'center',
                          gap: '2px',
                          backgroundColor: 'var(--surface)',
                          border: '1px solid var(--border-subtle)',
                          borderRadius: '8px',
                          padding: '2px',
                          boxShadow: '0 2px 8px rgba(0,0,0,0.08)',
                        }}
                      >
                        {/* Reaction Picker Button */}
                        <button
                          onClick={() => setShowEmojiPickerFor(showEmojiPickerFor === msg.id ? null : msg.id)}
                          aria-label="Add reaction"
                          title="React"
                          style={{
                            border: 'none',
                            background: 'none',
                            cursor: 'pointer',
                            padding: '4px 6px',
                            borderRadius: '6px',
                            color: 'var(--text-secondary)',
                            display: 'flex',
                            alignItems: 'center',
                          }}
                        >
                          <Smile size={14} />
                        </button>

                        {/* Wave B — E2EE privacy receipt affordance (hover) */}
                        {conversation.isE2EE && (
                          <span
                            title={t('receipt.e2eeTooltip', {
                              time: formatClockTime(msg.createdAt),
                              seq: msg.serverSequence ?? 0,
                            })}
                            aria-label={t('receipt.e2eeTooltip', {
                              time: formatClockTime(msg.createdAt),
                              seq: msg.serverSequence ?? 0,
                            })}
                            style={{
                              display: 'flex',
                              alignItems: 'center',
                              padding: '4px 4px',
                              color: 'var(--positive)',
                              cursor: 'help',
                            }}
                          >
                            <ShieldCheck size={14} />
                          </span>
                        )}

                        {/* Reply Button */}
                        <button
                          onClick={() =>
                            setReplyTo({
                              id: msg.id,
                              authorName: isMine ? activeWorkspace.displayName : msg.senderName || 'Unknown',
                              body: (decryptedBodyById[msg.id] ?? msg.body).slice(0, 120),
                            })
                          }
                          aria-label="Reply to message"
                          title="Reply"
                          style={{
                            border: 'none',
                            background: 'none',
                            cursor: 'pointer',
                            padding: '4px 6px',
                            borderRadius: '6px',
                            color: 'var(--text-secondary)',
                            display: 'flex',
                            alignItems: 'center',
                          }}
                        >
                          <Reply size={14} />
                        </button>

                        {/* Edit Button (own message, within window) */}
                        {isMine && withinEditWindow(msg.createdAt || '') && (
                          <button
                            onClick={() => beginEdit(msg)}
                            aria-label="Edit message"
                            title={canBypassEditWindow ? 'Edit' : 'Edit (within 15 minutes)'}
                            style={{
                              border: 'none',
                              background: 'none',
                              cursor: 'pointer',
                              padding: '4px 6px',
                              borderRadius: '6px',
                              color: 'var(--text-secondary)',
                              display: 'flex',
                              alignItems: 'center',
                            }}
                          >
                            <Pencil size={14} />
                          </button>
                        )}

                        {/* Delete Button (own message) */}
                        {isMine && (
                          <button
                            onClick={() => {
                              setDeleteTarget(msg);
                              setDeleteError(null);
                            }}
                            aria-label="Delete message"
                            title="Delete"
                            style={{
                              border: 'none',
                              background: 'none',
                              cursor: 'pointer',
                              padding: '4px 6px',
                              borderRadius: '6px',
                              color: 'var(--danger)',
                              display: 'flex',
                              alignItems: 'center',
                            }}
                          >
                            <Trash2 size={14} />
                          </button>
                        )}

                        {/* Forward Button */}
                        <button
                          onClick={() => {
                            setForwardModalMessageId(msg.id);
                          }}
                          aria-label="Forward message"
                          title="Forward"
                          style={{
                            border: 'none',
                            background: 'none',
                            cursor: 'pointer',
                            padding: '4px 6px',
                            borderRadius: '6px',
                            color: 'var(--text-secondary)',
                            display: 'flex',
                            alignItems: 'center',
                          }}
                        >
                          <Share2 size={14} />
                        </button>

                        {/* Branch Button (non-branch conversations only) */}
                        {conversation.kind !== 'branch' && (
                          <button
                            onClick={() => {
                              setBranchModal({ isOpen: true, sourceMessage: msg });
                            }}
                            aria-label="Create branch from this message"
                            title="Branch conversation"
                            style={{
                              border: 'none',
                              background: 'none',
                              cursor: 'pointer',
                              padding: '4px 6px',
                              borderRadius: '6px',
                              color: 'var(--text-secondary)',
                              display: 'flex',
                              alignItems: 'center',
                            }}
                          >
                            <GitBranch size={14} />
                          </button>
                        )}

                        {/* Pin Button */}
                        <button
                          onClick={async () => {
                            setPinnedMessageId(msg.id);
                            await onPinMessage(msg.id);
                          }}
                          aria-label="Pin message"
                          title="Pin"
                          style={{
                            border: 'none',
                            background: 'none',
                            cursor: 'pointer',
                            padding: '4px 6px',
                            borderRadius: '6px',
                            color: 'var(--text-secondary)',
                            display: 'flex',
                            alignItems: 'center',
                          }}
                        >
                          <Pin size={14} />
                        </button>

                        {/* Report Button (Trust & Safety - Spec 14) */}
                        <button
                          onClick={() => setReportingMessageId(msg.id)}
                          aria-label="Report message"
                          title="Report Message (Trust & Safety - Spec 14)"
                          style={{
                            border: 'none',
                            background: 'none',
                            cursor: 'pointer',
                            padding: '4px 6px',
                            borderRadius: '6px',
                            color: 'var(--danger)',
                            display: 'flex',
                            alignItems: 'center',
                          }}
                        >
                          <AlertCircle size={14} />
                        </button>

                        {/* Wave B — translation action (text messages only) */}
                        {msg.contentType === 'text' && (
                          <button
                            onClick={() => handleTranslate(msg.id)}
                            aria-label={t('translation.unavailable')}
                            title={t('translation.unavailable')}
                            style={{
                              border: 'none',
                              background: 'none',
                              cursor: 'pointer',
                              padding: '4px 6px',
                              borderRadius: '6px',
                              color: 'var(--text-secondary)',
                              display: 'flex',
                              alignItems: 'center',
                            }}
                          >
                            <Globe size={14} />
                          </button>
                        )}
                      </div>
                    )}
                  </div>

                  {/* Wave B — translation result / unavailable note */}
                  {translationNoteFor === msg.id && (
                    <div
                      role="note"
                      style={{
                        display: 'flex',
                        alignItems: 'center',
                        gap: '8px',
                        maxWidth: '480px',
                        marginTop: '4px',
                        padding: '6px 10px',
                        borderRadius: '8px',
                        backgroundColor: 'var(--surface-muted)',
                        border: '1px solid var(--border-subtle)',
                        alignSelf: isMine ? 'flex-end' : 'flex-start',
                      }}
                    >
                      <Globe size={13} style={{ color: 'var(--text-tertiary)', flexShrink: 0 }} />
                      <span
                        style={{
                          flex: 1,
                          fontSize: '12px',
                          fontStyle: 'italic',
                          color: 'var(--text-tertiary)',
                        }}
                      >
                        {t('translation.unavailableNote')}
                      </span>
                      <button
                        type="button"
                        onClick={() => dismissTranslation(msg.id)}
                        aria-label={t('translation.dismiss')}
                        style={{
                          border: 'none',
                          background: 'none',
                          cursor: 'pointer',
                          color: 'var(--text-muted)',
                          display: 'flex',
                          flexShrink: 0,
                        }}
                      >
                        <X size={13} />
                      </button>
                    </div>
                  )}

                  {/* Inline Emoji Selector Tray */}
                  {showEmojiPickerFor === msg.id && (
                    <div
                      style={{
                        display: 'flex',
                        alignItems: 'center',
                        gap: '4px',
                        backgroundColor: 'var(--surface)',
                        border: '1px solid var(--border-subtle)',
                        borderRadius: '20px',
                        padding: '4px 8px',
                        marginTop: '4px',
                        boxShadow: '0 4px 12px rgba(0,0,0,0.1)',
                        zIndex: 20,
                      }}
                    >
                      {quickEmojis.map((emoji) => (
                        <button
                          key={emoji}
                          onClick={() => {
                            onToggleReaction(msg.id, emoji);
                            setShowEmojiPickerFor(null);
                          }}
                          style={{
                            border: 'none',
                            background: 'none',
                            cursor: 'pointer',
                            fontSize: '16px',
                            padding: '2px 4px',
                            borderRadius: '6px',
                          }}
                        >
                          {emoji}
                        </button>
                      ))}
                    </div>
                  )}

                  {/* Reaction Badges */}
                  {msg.reactions && msg.reactions.length > 0 && (
                    <div
                      style={{
                        display: 'flex',
                        flexWrap: 'wrap',
                        gap: '4px',
                        marginTop: '4px',
                        marginLeft: isMine ? '0' : '4px',
                        marginRight: isMine ? '4px' : '0',
                      }}
                    >
                      {msg.reactions.map((r, rIdx) => {
                        const hasReacted = r.workspaceIds?.includes(activeWorkspace.id);
                        return (
                          <button
                            key={rIdx}
                            onClick={() => onToggleReaction(msg.id, r.emoji)}
                            style={{
                              display: 'inline-flex',
                              alignItems: 'center',
                              gap: '4px',
                              padding: '2px 6px',
                              borderRadius: '12px',
                              border: `1px solid ${hasReacted ? 'var(--accent-primary)' : 'var(--border-subtle)'}`,
                              backgroundColor: hasReacted ? 'var(--accent-soft)' : 'var(--surface)',
                              color: hasReacted ? 'var(--accent-primary)' : 'var(--text-primary)',
                              fontSize: '12px',
                              cursor: 'pointer',
                            }}
                          >
                            <span>{r.emoji}</span>
                            <span style={{ fontWeight: 600 }}>{r.count}</span>
                          </button>
                        );
                      })}
                    </div>
                  )}
                    </>
                  )}
                  </div>
                </React.Fragment>
              );
            })}
            <div
              style={{
                height: virtualWindow
                  ? Math.max(
                      0,
                      virtualWindow.totalHeight -
                        virtualWindow.offsetTop -
                        visibleMessages.length * ESTIMATED_ROW_HEIGHT,
                    )
                  : 0,
                flexShrink: 0,
              }}
              aria-hidden="true"
            />

            {/* Workflow Cards (Spec 03 G + Wave B actions) */}
            {workflowCards.map((card) => (
              <WorkflowCardView
                key={card.id}
                card={card}
                disabled={workflowBusyCardId === card.id}
                error={workflowError}
                onAction={(cardId, actionId, payload) => void handleWorkflowAction(cardId, actionId, payload)}
              />
            ))}

            {/* Business Internal Notes (Spec 07 Hard Separation & Privilege Separation) */}
            {isBusiness &&
              internalNotes.map((note) => (
                <div
                  key={note.id}
                  role="note"
                  aria-label="Internal team note (Confidential)"
                  style={{
                    margin: '10px 0',
                    padding: '12px 16px',
                    borderRadius: '12px',
                    backgroundColor: '#FEFCBF',
                    color: '#744210',
                    border: '1px solid #ECC94B',
                    boxShadow: '0 1px 3px rgba(0,0,0,0.05)',
                  }}
                >
                  <div
                    style={{
                      display: 'flex',
                      alignItems: 'center',
                      justifyContent: 'space-between',
                      marginBottom: '6px',
                      fontSize: '11px',
                      fontWeight: 700,
                      textTransform: 'uppercase',
                      letterSpacing: '0.6px',
                    }}
                  >
                    <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
                      <Lock size={12} />
                      <span>INTERNAL NOTE — TEAM ONLY (NOT VISIBLE TO CUSTOMER)</span>
                    </div>
                    <span>{new Date(note.createdAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}</span>
                  </div>
                  <p style={{ margin: 0, fontSize: '13px', lineHeight: '1.45', fontWeight: 500 }}>
                    {note.body}
                  </p>
                  <div style={{ marginTop: '6px', fontSize: '11px', opacity: 0.8 }}>
                    Author: {note.authorName}
                  </div>
                </div>
              ))}
          </>
        )}

        {/* Typing Indicator (Spec 02 P0) */}
        {typingWorkspaceIds.length > 0 && (
          <div
            role="status"
            aria-live="polite"
            style={{
              display: 'flex',
              alignItems: 'center',
              gap: '6px',
              fontSize: '12px',
              color: 'var(--text-muted)',
              fontStyle: 'italic',
            }}
          >
            <span>Someone is typing...</span>
            <span
              style={{
                display: 'inline-block',
                width: '6px',
                height: '6px',
                borderRadius: '9999px',
                backgroundColor: 'var(--accent-primary)',
                animation: 'typingDot 1.4s infinite ease-in-out',
              }}
            />
          </div>
        )}

        <div ref={messageEndRef} />
      </div>

      {/* Jump to latest (Spec 10) */}
      {showJumpToLatest && (
        <button
          type="button"
          onClick={() => scrollToBottom('smooth')}
          aria-label="Jump to latest message"
          title="Jump to latest"
          style={{
            position: 'absolute',
            bottom: '150px',
            right: '24px',
            width: '40px',
            height: '40px',
            borderRadius: '9999px',
            border: '1px solid var(--border-subtle)',
            backgroundColor: 'var(--surface)',
            color: 'var(--text-secondary)',
            cursor: 'pointer',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            boxShadow: '0 4px 14px rgba(0,0,0,0.12)',
            zIndex: 20,
          }}
        >
          <ArrowDown size={18} />
        </button>
      )}

      {/* 3. Composer Section (Spec 04 & Spec 07) */}
      <footer
        style={{
          padding: '12px 20px 16px',
          backgroundColor: 'var(--surface)',
          borderTop: '1px solid var(--border-subtle)',
          display: 'flex',
          flexDirection: 'column',
          gap: '8px',
          flexShrink: 0,
        }}
      >
        {/* Active Sending Identity Bar (Spec 00, 02, 04, 07 - HARD REQUIREMENT) */}
        <div
          id="active-identity-bar"
          style={{
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'space-between',
            padding: '6px 10px',
            borderRadius: '8px',
            backgroundColor: isBusiness ? 'rgba(128,90,213,0.08)' : 'var(--surface-muted)',
            border: `1px solid ${isBusiness ? '#D6BCFA' : 'var(--border-subtle)'}`,
            fontSize: '12px',
          }}
        >
          <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
            <span style={{ color: 'var(--text-secondary)' }}>Sending as:</span>
            <div
              style={{
                width: '18px',
                height: '18px',
                borderRadius: isBusiness ? '4px' : '9999px',
                backgroundColor: isBusiness ? '#805AD5' : 'var(--accent-primary)',
                color: '#FFF',
                display: 'inline-flex',
                alignItems: 'center',
                justifyContent: 'center',
                fontWeight: 700,
                fontSize: '10px',
              }}
            >
              {activeWorkspace.displayName.charAt(0)}
            </div>
            <strong style={{ color: 'var(--text-primary)' }}>{activeWorkspace.displayName}</strong>
            <span
              style={{
                padding: '1px 6px',
                borderRadius: '4px',
                backgroundColor: isBusiness ? '#805AD5' : 'var(--accent-soft)',
                color: isBusiness ? '#FFF' : 'var(--accent-primary)',
                fontSize: '10px',
                fontWeight: 600,
                textTransform: 'uppercase',
              }}
            >
              {activeWorkspace.type}
            </span>
          </div>

          {/* Business Dual Mode Switcher: Customer Send vs Internal Note (Spec 07) */}
          {isBusiness && (
            <div style={{ display: 'flex', gap: '4px' }}>
              <button
                type="button"
                onClick={() => setComposerMode('customer')}
                style={{
                  padding: '3px 8px',
                  borderRadius: '6px',
                  border: 'none',
                  fontSize: '11px',
                  fontWeight: 600,
                  cursor: 'pointer',
                  backgroundColor: composerMode === 'customer' ? '#805AD5' : 'transparent',
                  color: composerMode === 'customer' ? '#FFF' : 'var(--text-secondary)',
                  transition: 'all 120ms ease',
                }}
              >
                Customer Message
              </button>
              <button
                type="button"
                onClick={() => setComposerMode('internal')}
                style={{
                  padding: '3px 8px',
                  borderRadius: '6px',
                  border: 'none',
                  fontSize: '11px',
                  fontWeight: 600,
                  cursor: 'pointer',
                  backgroundColor: composerMode === 'internal' ? '#D69E2E' : 'transparent',
                  color: composerMode === 'internal' ? '#744210' : 'var(--text-secondary)',
                  transition: 'all 120ms ease',
                }}
              >
                🔒 Internal Note
              </button>
            </div>
          )}
        </div>

        {/* Reply preview above input */}
        {replyTo && composerMode !== 'internal' && (
          <div style={{ marginBottom: '4px' }}>
            <ReplyPreview
              authorName={replyTo.authorName}
              excerpt={replyTo.body}
              onClose={() => setReplyTo(null)}
            />
          </div>
        )}

        {/* Upload progress / cancel / retry bar */}
        {(isUploading || uploadError) && (
          <div
            role="status"
            aria-live="polite"
            style={{
              display: 'flex',
              alignItems: 'center',
              gap: '10px',
              padding: '8px 12px',
              borderRadius: '8px',
              border: `1px solid ${uploadError ? 'var(--danger)' : 'var(--border-subtle)'}`,
              backgroundColor: uploadError ? 'rgba(229,62,62,0.06)' : 'var(--surface-muted)',
              fontSize: '12px',
            }}
          >
            <span
              style={{
                flex: 1,
                minWidth: 0,
                overflow: 'hidden',
                textOverflow: 'ellipsis',
                whiteSpace: 'nowrap',
                fontWeight: 500,
                color: uploadError ? 'var(--danger)' : 'var(--text-secondary)',
              }}
            >
              {uploadError ? `${uploadFileName || t('common.file')}: ${uploadError}` : `${uploadFileName} — ${uploadProgress ?? 0}%`}
            </span>

            {isUploading && (
              <div
                aria-hidden="true"
                style={{
                  width: '120px',
                  height: '6px',
                  borderRadius: '9999px',
                  backgroundColor: 'var(--border-subtle)',
                  overflow: 'hidden',
                  flexShrink: 0,
                }}
              >
                <div
                  style={{
                    width: `${uploadProgress ?? 0}%`,
                    height: '100%',
                    backgroundColor: 'var(--accent-primary)',
                    transition: 'width 120ms linear',
                  }}
                />
              </div>
            )}

            {isUploading ? (
              <button
                type="button"
                onClick={cancelUpload}
                aria-label="Cancel upload"
                title="Cancel upload"
                style={{
                  border: 'none',
                  background: 'none',
                  cursor: 'pointer',
                  color: 'var(--text-secondary)',
                  display: 'flex',
                  alignItems: 'center',
                }}
              >
                <X size={14} />
              </button>
            ) : (
              uploadError && (
                <div style={{ display: 'flex', gap: '6px', flexShrink: 0 }}>
                  <button
                    type="button"
                    onClick={retryUpload}
                    aria-label="Retry upload"
                    title="Retry upload"
                    style={{
                      border: 'none',
                      borderRadius: '6px',
                      padding: '3px 10px',
                      cursor: 'pointer',
                      backgroundColor: 'var(--accent-primary)',
                      color: '#FFF',
                      fontSize: '11px',
                      fontWeight: 600,
                    }}
                  >
                    {t('common.retry')}
                  </button>
                  <button
                    type="button"
                    onClick={dismissUploadError}
                    aria-label="Dismiss upload error"
                    title="Dismiss"
                    style={{
                      border: 'none',
                      background: 'none',
                      cursor: 'pointer',
                      color: 'var(--text-muted)',
                      display: 'flex',
                      alignItems: 'center',
                    }}
                  >
                    <X size={14} />
                  </button>
                </div>
              )
            )}
          </div>
        )}

        {/* Voice recorder (replaces input while active) */}
        {isVoiceRecorderOpen ? (
          <VoiceRecorder
            onDone={handleVoiceNoteDone}
            onCancel={() => setIsVoiceRecorderOpen(false)}
          />
        ) : (
        <div
          style={{
            borderRadius: '12px',
            border: `1px solid ${
              composerMode === 'internal' ? '#ECC94B' : 'var(--border-subtle)'
            }`,
            backgroundColor: composerMode === 'internal' ? '#FFFFF0' : 'var(--canvas)',
            padding: '8px 12px',
            display: 'flex',
            flexDirection: 'column',
            gap: '6px',
          }}
        >
          <textarea
            id="message-composer-input"
            aria-label={
              composerMode === 'internal'
                ? 'Internal note input (confidential)'
                : `Send message to ${displayTitle}`
            }
            rows={2}
            value={composerMode === 'internal' ? internalNoteDraft : draft}
            onChange={(e) => {
              if (composerMode === 'internal') {
                setInternalNoteDraft(e.target.value);
              } else {
                onDraftChange(e.target.value);
              }
            }}
            onKeyDown={handleKeyDown}
            placeholder={
              composerMode === 'internal'
                ? 'Write internal note for team... (customer will never see this)'
                : `Message ${displayTitle}... (Press Enter to send)`
            }
            style={{
              width: '100%',
              border: 'none',
              background: 'transparent',
              outline: 'none',
              resize: 'none',
              fontFamily: 'inherit',
              fontSize: '14px',
              color: composerMode === 'internal' ? '#744210' : 'var(--text-primary)',
              lineHeight: '1.4',
            }}
          />

          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: '4px' }}>
              <input
                ref={fileInputRef}
                type="file"
                style={{ display: 'none' }}
                onChange={(e) => void handleFileSelect(e)}
                accept="image/*,video/*,audio/*,.pdf,.doc,.docx,.txt"
                aria-hidden="true"
                tabIndex={-1}
              />
              <button
                type="button"
                title={isUploading ? `Uploading... ${uploadProgress ?? 0}%` : 'Attach file'}
                aria-label="Attach file"
                onClick={() => fileInputRef.current?.click()}
                disabled={isUploading}
                style={{
                  border: 'none',
                  background: 'none',
                  padding: '6px',
                  borderRadius: '6px',
                  cursor: isUploading ? 'wait' : 'pointer',
                  color: isUploading ? 'var(--accent-primary)' : 'var(--text-secondary)',
                }}
              >
                <Paperclip size={16} />
              </button>

              {/* Voice note recorder trigger */}
              <button
                type="button"
                title={t('composer.voiceNote')}
                aria-label={t('composer.voiceNote')}
                onClick={() => setIsVoiceRecorderOpen(true)}
                disabled={isUploading}
                style={{
                  border: 'none',
                  background: 'none',
                  padding: '6px',
                  borderRadius: '6px',
                  cursor: isUploading ? 'not-allowed' : 'pointer',
                  color: 'var(--text-secondary)',
                }}
              >
                <Mic size={16} />
              </button>

              <button
                type="button"
                title="Add emoji"
                aria-label="Add emoji"
                style={{
                  border: 'none',
                  background: 'none',
                  padding: '6px',
                  borderRadius: '6px',
                  cursor: 'pointer',
                  color: 'var(--text-secondary)',
                }}
              >
                <Smile size={16} />
              </button>

              {/* Wave B — saved replies picker */}
              <div style={{ position: 'relative' }} data-canvas-popover="saved-replies-trigger">
                <button
                  type="button"
                  title={t('savedReplies.title')}
                  aria-label={t('savedReplies.title')}
                  onClick={() => setIsSavedRepliesOpen((prev) => !prev)}
                  style={{
                    border: 'none',
                    background: 'none',
                    padding: '6px',
                    borderRadius: '6px',
                    cursor: 'pointer',
                    color: isSavedRepliesOpen ? 'var(--accent-primary)' : 'var(--text-secondary)',
                  }}
                >
                  <Bookmark size={16} />
                </button>
              </div>

              {/* Wave B — schedule send */}
              <div style={{ position: 'relative' }} data-canvas-popover="schedule-trigger">
                <button
                  type="button"
                  title={t('schedule.title')}
                  aria-label={t('schedule.title')}
                  onClick={() => {
                    if (!isSchedulingOpen) void loadScheduledCount();
                    setIsSchedulingOpen((prev) => !prev);
                  }}
                  style={{
                    border: 'none',
                    background: 'none',
                    padding: '6px',
                    borderRadius: '6px',
                    cursor: 'pointer',
                    color: isSchedulingOpen ? 'var(--accent-primary)' : 'var(--text-secondary)',
                  }}
                >
                  <Clock size={16} />
                </button>
              </div>
            </div>

            <button
              id="send-message-button"
              type="button"
              onClick={() => void handleSend()}
              disabled={isSubmitting || (composerMode === 'internal' ? !internalNoteDraft.trim() : !draft.trim())}
              aria-label={composerMode === 'internal' ? 'Add internal note' : 'Send message'}
              style={{
                padding: '6px 14px',
                borderRadius: '8px',
                border: 'none',
                backgroundColor:
                  composerMode === 'internal'
                    ? '#D69E2E'
                    : isBusiness
                    ? '#805AD5'
                    : 'var(--accent-primary)',
                color: '#FFF',
                fontWeight: 600,
                fontSize: '13px',
                display: 'inline-flex',
                alignItems: 'center',
                gap: '6px',
                cursor:
                  isSubmitting || (composerMode === 'internal' ? !internalNoteDraft.trim() : !draft.trim())
                    ? 'not-allowed'
                    : 'pointer',
                opacity:
                  isSubmitting || (composerMode === 'internal' ? !internalNoteDraft.trim() : !draft.trim())
                    ? 0.5
                    : 1,
                transition: 'all 120ms ease',
              }}
            >
              <span>{composerMode === 'internal' ? 'Add Note' : t('common.send')}</span>
              <Send size={14} />
            </button>
          </div>
        </div>
        )}

        {/* Wave B — presence-aware composer hint */}
        {counterpart && !counterpartOnline && composerMode !== 'internal' && (
          <p
            role="status"
            style={{
              margin: 0,
              fontSize: '11px',
              fontStyle: 'italic',
              color: 'var(--text-muted)',
              textAlign: 'center',
            }}
          >
            {t('presence.offlineHint')}
          </p>
        )}
      </footer>

      {/* Wave B — scheduling + saved replies popovers */}
      {isSchedulingOpen && (
        <SchedulingPopover
          conversationId={conversation.id}
          workspaceId={activeWorkspace.id}
          composerText={draft}
          onScheduled={() => onDraftChange('')}
          onClose={() => setIsSchedulingOpen(false)}
        />
      )}
      {isSavedRepliesOpen && (
        <SavedRepliesPicker
          workspaceId={activeWorkspace.id}
          draftText={draft}
          onInsert={handleInsertSavedReply}
          onClose={() => setIsSavedRepliesOpen(false)}
        />
      )}

      {/* Forward Modal (Spec 02 P0) */}
      {forwardModalMessageId && (
        <div
          role="dialog"
          aria-modal="true"
          aria-label="Forward Message"
          style={{
            position: 'absolute',
            inset: 0,
            backgroundColor: 'rgba(0,0,0,0.5)',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            zIndex: 100,
          }}
        >
          <div
            style={{
              backgroundColor: 'var(--surface)',
              borderRadius: '16px',
              padding: '24px',
              width: '90%',
              maxWidth: '380px',
              boxShadow: '0 8px 30px rgba(0,0,0,0.2)',
            }}
          >
            <h3 style={{ margin: '0 0 12px', fontSize: '16px', fontWeight: 600 }}>
              Forward Message
            </h3>
            <p style={{ fontSize: '13px', color: 'var(--text-secondary)', marginBottom: '16px' }}>
              Forward message with explicit attribution to another active conversation.
            </p>
            <div style={{ display: 'flex', justifyContent: 'flex-end', gap: '8px' }}>
              <button
                type="button"
                onClick={() => setForwardModalMessageId(null)}
                style={{
                  padding: '8px 14px',
                  borderRadius: '8px',
                  border: '1px solid var(--border-subtle)',
                  background: 'transparent',
                  color: 'var(--text-primary)',
                  cursor: 'pointer',
                }}
              >
                Cancel
              </button>
              <button
                type="button"
                onClick={async () => {
                  await onForwardMessage(forwardModalMessageId, conversation.id);
                  setForwardModalMessageId(null);
                }}
                style={{
                  padding: '8px 14px',
                  borderRadius: '8px',
                  border: 'none',
                  backgroundColor: 'var(--accent-primary)',
                  color: '#FFF',
                  cursor: 'pointer',
                  fontWeight: 600,
                }}
              >
                Confirm Forward
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Branch Modal (Spec 19) */}
      {branchModal.isOpen && branchModal.sourceMessage && (
        <BranchModal
          isOpen={branchModal.isOpen}
          onClose={() => setBranchModal({ isOpen: false, sourceMessage: null })}
          sourceMessage={branchModal.sourceMessage}
          conversation={conversation}
          activeWorkspace={activeWorkspace}
          onCreateBranch={onCreateBranch}
        />
      )}

      {/* Trust & Safety Report Modal (Spec 14) */}
      {reportingMessageId && (
        <div
          style={{
            position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.5)',
            display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 1000,
          }}
          onClick={() => setReportingMessageId(null)}
        >
          <div
            onClick={(e) => e.stopPropagation()}
            style={{
              background: 'var(--surface)', borderRadius: '12px', padding: '24px',
              width: '420px', maxWidth: '92vw', border: '1px solid var(--border-subtle)',
            }}
          >
            {reportSuccess ? (
              <div style={{ textAlign: 'center', padding: '16px 0' }}>
                <Check size={28} color="var(--positive)" />
                <p style={{ margin: '12px 0 0', color: 'var(--text-primary)' }}>
                  Report submitted. Thank you for helping keep Orbit safe.
                </p>
              </div>
            ) : (
              <>
                <h3 style={{ margin: '0 0 8px', color: 'var(--text-primary)', fontSize: '16px' }}>Report Message</h3>
                <p style={{ margin: '0 0 16px', color: 'var(--text-secondary)', fontSize: '13px', lineHeight: '1.5' }}>
                  <strong>What gets shared:</strong> the selected message, its sender, your report reason,
                  and any notes you add. Your full chat history is never uploaded. A Trust &amp; Safety
                  reviewer will see this report.
                </p>
                <label style={{ display: 'block', fontSize: '12px', color: 'var(--text-secondary)', marginBottom: '4px' }}>
                  Reason
                </label>
                <select
                  value={reportReason}
                  onChange={(e) => setReportReason(e.target.value)}
                  style={{
                    width: '100%', padding: '8px', borderRadius: '8px', marginBottom: '12px',
                    background: 'var(--canvas)', color: 'var(--text-primary)', border: '1px solid var(--border-subtle)',
                  }}
                >
                  <option value="spam">Spam</option>
                  <option value="harassment">Harassment</option>
                  <option value="impersonation">Impersonation</option>
                  <option value="malware">Malware / suspicious link</option>
                  <option value="other">Other</option>
                </select>
                <label style={{ display: 'block', fontSize: '12px', color: 'var(--text-secondary)', marginBottom: '4px' }}>
                  Additional details (optional)
                </label>
                <textarea
                  value={reportDetails}
                  onChange={(e) => setReportDetails(e.target.value)}
                  rows={3}
                  maxLength={1000}
                  style={{
                    width: '100%', padding: '8px', borderRadius: '8px', marginBottom: '16px',
                    background: 'var(--canvas)', color: 'var(--text-primary)', border: '1px solid var(--border-subtle)',
                    resize: 'vertical', fontSize: '13px',
                  }}
                />
                <div style={{ display: 'flex', gap: '8px', justifyContent: 'flex-end' }}>
                  <button
                    onClick={() => setReportingMessageId(null)}
                    style={{
                      padding: '8px 14px', borderRadius: '8px', border: '1px solid var(--border-subtle)',
                      background: 'transparent', color: 'var(--text-secondary)', cursor: 'pointer', fontSize: '13px',
                    }}
                  >
                    Cancel
                  </button>
                  <button
                    onClick={() => void handleReportSubmit()}
                    disabled={isSubmittingReport}
                    style={{
                      padding: '8px 14px', borderRadius: '8px', border: 'none',
                      background: 'var(--danger)', color: '#FFF', cursor: 'pointer', fontSize: '13px',
                      opacity: isSubmittingReport ? 0.6 : 1,
                    }}
                  >
                    {isSubmittingReport ? 'Submitting…' : 'Submit Report'}
                  </button>
                </div>
              </>
            )}
          </div>
        </div>
      )}
      {/* Delete Message Dialog (Wave B) */}
      {deleteTarget && (
        <div
          role="dialog"
          aria-modal="true"
          aria-label="Delete message"
          onClick={() => setDeleteTarget(null)}
          style={{
            position: 'fixed',
            inset: 0,
            background: 'rgba(0,0,0,0.5)',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            zIndex: 1000,
          }}
        >
          <div
            onClick={(e) => e.stopPropagation()}
            style={{
              background: 'var(--surface)',
              borderRadius: '12px',
              padding: '24px',
              width: '400px',
              maxWidth: '92vw',
              border: '1px solid var(--border-subtle)',
            }}
          >
            <h3 style={{ margin: '0 0 8px', color: 'var(--text-primary)', fontSize: '16px' }}>
              {t('delete.title')}
            </h3>
            <p style={{ margin: '0 0 16px', color: 'var(--text-secondary)', fontSize: '13px', lineHeight: 1.5 }}>
              {withinEditWindow(deleteTarget.createdAt || '')
                ? canBypassEditWindow
                  ? t('delete.body.admin')
                  : t('delete.body.self')
                : t('delete.body.expired')}
            </p>
            {deleteError && (
              <p role="alert" style={{ margin: '0 0 12px', color: 'var(--danger)', fontSize: '12px' }}>
                {deleteError}
              </p>
            )}
            <div style={{ display: 'flex', gap: '8px', justifyContent: 'flex-end', flexWrap: 'wrap' }}>
              <button
                type="button"
                onClick={() => setDeleteTarget(null)}
                style={{
                  padding: '8px 14px',
                  borderRadius: '8px',
                  border: '1px solid var(--border-subtle)',
                  background: 'transparent',
                  color: 'var(--text-secondary)',
                  cursor: 'pointer',
                  fontSize: '13px',
                }}
              >
                {t('common.cancel')}
              </button>
              <button
                type="button"
                onClick={() => void handleDeleteConfirm('self')}
                style={{
                  padding: '8px 14px',
                  borderRadius: '8px',
                  border: '1px solid var(--border-subtle)',
                  background: 'transparent',
                  color: 'var(--text-primary)',
                  cursor: 'pointer',
                  fontSize: '13px',
                  fontWeight: 600,
                }}
              >
                {t('delete.forMe')}
              </button>
              {canBypassEditWindow && (
                <button
                  type="button"
                  onClick={() => void handleDeleteConfirm('everyone')}
                  style={{
                    padding: '8px 14px',
                    borderRadius: '8px',
                    border: 'none',
                    background: 'var(--danger)',
                    color: '#FFF',
                    cursor: 'pointer',
                    fontSize: '13px',
                    fontWeight: 600,
                  }}
                >
                  {t('delete.forEveryone')}
                </button>
              )}
            </div>
          </div>
        </div>
      )}

      {/* Call Panel Overlay (Spec 13) */}
      {callState && (
        <div
          ref={callWrapRef}
          style={{
            position: 'absolute',
            inset: 0,
            zIndex: 900,
            backgroundColor: 'var(--canvas)',
            padding: '24px',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
          }}
        >
          {callError ? (
            <div style={{ textAlign: 'center', color: 'var(--text-secondary)', fontSize: '14px' }}>
              <p role="alert" style={{ color: 'var(--danger)' }}>{callError}</p>
              <button
                type="button"
                onClick={() => {
                  setCallState(null);
                  setCallError(null);
                }}
                style={{
                  marginTop: '12px',
                  padding: '8px 16px',
                  borderRadius: '8px',
                  border: '1px solid var(--border-subtle)',
                  background: 'transparent',
                  color: 'var(--text-primary)',
                  cursor: 'pointer',
                }}
              >
                {t('common.close')}
              </button>
            </div>
          ) : (
            <div style={{ width: '100%', maxWidth: '960px', height: '100%' }}>
              <CallPanel
                participants={callParticipants}
                isMuted={isCallMuted}
                isVideoOn={isVideoOn}
                isScreenSharing={isScreenSharing}
                onToggleMute={toggleCallMute}
                onToggleVideo={toggleVideo}
                onToggleScreenShare={() => void toggleScreenShare()}
                onLeave={() => void leaveCall()}
                callState={callState}
              />
            </div>
          )}
        </div>
      )}
    </main>
  );
};
