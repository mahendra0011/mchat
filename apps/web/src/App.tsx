import { API_BASE_URL, WS_BASE_URL } from './config';
import React from 'react';
import {
  UserAccount,
  IdentityWorkspace,
  Conversation,
  MessageEnvelope,
  BusinessInternalNote,
  WorkflowCard,
  VaultCollection,
  VaultItem,
  PrivacyReceipt,
  SendMessageRequest,
  CreateBusinessWorkspaceRequest,
  ConversationStudioSettings,
} from '@orbit/schemas';
import {
  OrbitHttpClient,
  OrbitRealtimeClient,
  OfflineQueue,
  QueuedMessage,
  OrbitApiError,
} from '@orbit/api-client';
import {
  addE2eeMessage,
  createE2eeIndex,
  extractSnippet,
  removeE2eeMessage,
  searchE2eeIndex,
  tokenize,
  type E2eeSearchIndex,
} from '@orbit/domain';
import {
  decryptMessageBodies,
  encryptMessageBody,
  getConversationCipher,
  UNDECRYPTABLE_PLACEHOLDER,
} from './lib/e2ee.js';
import {
  cacheDecryptedBodies,
  cacheMessages,
  readCachedDecryptedBodies,
  readCachedMessages,
} from './lib/offline-store.js';
import { apiFetch } from './lib/apiFetch.js';
import { getAccessToken, init } from './lib/secure-storage.js';
import {
  fixtureAccounts,
  fixtureWorkspaces,
  fixtureConversations,
  fixtureMessages,
  fixtureInternalNotes,
  fixtureWorkflowCards,
  fixtureVaultCollections,
  fixtureVaultItems,
  fixturePrivacyReceipt,
} from '@orbit/test-fixtures';

import { LeftRail } from './components/LeftRail.js';
import { ConversationList } from './components/ConversationList.js';
import { ConversationCanvas, type NotificationItem } from './components/ConversationCanvas.js';
import { NewConversationModal } from './components/NewConversationModal.js';
import { I18nProvider } from './i18n-context.js';
import { RightPanel } from './components/RightPanel.js';
import { CommandPalette } from './components/CommandPalette.js';
import { SettingsModal } from './components/SettingsModal.js';
import { OfflineBanner } from './components/OfflineBanner.js';
import { OnboardingModal } from './components/OnboardingModal.js';
import { ContactDiscoveryModal } from './components/ContactDiscoveryModal.js';
import { BillingModal } from './components/BillingModal.js';
import { AdminConsoleModal } from './components/AdminConsoleModal.js';
import { IntegrationsModal } from './components/IntegrationsModal.js';
import { DataImportModal } from './components/DataImportModal.js';
import { SessionsAndDevicesModal } from './components/SessionsAndDevicesModal.js';
import { E2EEVerificationModal } from './components/E2EEVerificationModal.js';
import { BusinessAnalyticsModal } from './components/BusinessAnalyticsModal.js';
import AppLock from './components/AppLock.js';
import type { SearchResultItem } from './components/SearchResultsPanel.js';

export const App: React.FC = () => (
  <I18nProvider>
    <OrbitApp />
  </I18nProvider>
);

const OrbitApp: React.FC = () => {
  // Client and queue instances
  const httpClient = React.useMemo(() => new OrbitHttpClient(API_BASE_URL), []);
  const realtimeClient = React.useMemo(() => new OrbitRealtimeClient(WS_BASE_URL), []);
  const offlineQueue = React.useMemo(() => new OfflineQueue(), []);

  // Root States
  const [user, setUser] = React.useState<UserAccount>(fixtureAccounts[0]);
  const [workspaces, setWorkspaces] = React.useState<IdentityWorkspace[]>(fixtureWorkspaces);
  const [activeWorkspace, setActiveWorkspace] = React.useState<IdentityWorkspace>(fixtureWorkspaces[0]);
  const activeWorkspaceRef = React.useRef(activeWorkspace);
  activeWorkspaceRef.current = activeWorkspace;

  const [conversations, setConversations] = React.useState<Conversation[]>(fixtureConversations);
  const [activeConversation, setActiveConversation] = React.useState<Conversation | null>(fixtureConversations[0]);
  const [messages, setMessages] = React.useState<MessageEnvelope[]>(fixtureMessages);
  // E2EE: decrypted plaintext per message id (wire bodies stay ciphertext in `messages`)
  const [decryptedBodies, setDecryptedBodies] = React.useState<Record<string, string>>({});
  const [e2eeKeyStatus, setE2eeKeyStatus] = React.useState<Record<string, 'establishing' | 'established'>>({});

  // Local E2EE search index — decrypted plaintext never leaves this device (Spec 10/26)
  const searchIndexRef = React.useRef<E2eeSearchIndex>(createE2eeIndex());

  // Initialize secure storage on first render
  React.useEffect(() => {
    init();
  }, []);
  const [messageMatches, setMessageMatches] = React.useState<
    Record<string, { count: number; snippet: string }>
  >({});

  // Establish the E2EE conversation key (key exchange) and decrypt loaded bodies
  const establishAndDecrypt = React.useCallback(
    async (conv: Conversation, msgs: MessageEnvelope[]) => {
      if (!conv.isE2EE) return;
      try {
        const cipher = await getConversationCipher(httpClient, conv, activeWorkspaceRef.current.id);
        const decrypted = await decryptMessageBodies(cipher, msgs);
        if (Object.keys(decrypted).length > 0) {
          setDecryptedBodies((prev) => ({ ...prev, ...decrypted }));
          void cacheDecryptedBodies(conv.id, decrypted);
        }
        setE2eeKeyStatus((prev) => ({ ...prev, [conv.id]: 'established' }));
      } catch {
        // Key exchange unavailable — legacy plaintext bodies still render as-is.
      }
    },
    [httpClient]
  );

  // Feed loaded messages (decrypted where possible) into the local search index
  React.useEffect(() => {
    const index = searchIndexRef.current;
    for (const msg of messages) {
      const text = decryptedBodies[msg.id] ?? msg.body;
      removeE2eeMessage(index, msg.id);
      if (text === UNDECRYPTABLE_PLACEHOLDER) continue;
      addE2eeMessage(index, {
        id: msg.id,
        conversationId: msg.conversationId,
        senderWorkspaceId: msg.senderWorkspaceId,
        sentAt: Date.parse(msg.createdAt) || 0,
        text,
      });
    }
  }, [messages, decryptedBodies]);

  const [internalNotes, setInternalNotes] = React.useState<BusinessInternalNote[]>(fixtureInternalNotes);
  const [workflowCards, setWorkflowCards] = React.useState<WorkflowCard[]>(fixtureWorkflowCards);

  const [vaultCollections] = React.useState<VaultCollection[]>(fixtureVaultCollections);
  const [vaultItems, setVaultItems] = React.useState<VaultItem[]>(fixtureVaultItems);
  const [privacyReceipt, setPrivacyReceipt] = React.useState<PrivacyReceipt | null>(fixturePrivacyReceipt);

  const [activeNav, setActiveNav] = React.useState<string>('inbox');
  const [searchQuery, setSearchQuery] = React.useState<string>('');
  const [isRightPanelOpen, setIsRightPanelOpen] = React.useState<boolean>(false);
  const [rightPanelTab, setRightPanelTab] = React.useState<'details' | 'timeline' | 'privacy' | 'vault' | 'studio' | 'workflows' | 'branches'>('details');

  const [isCommandPaletteOpen, setIsCommandPaletteOpen] = React.useState<boolean>(false);
  const [isSettingsOpen, setIsSettingsOpen] = React.useState<boolean>(false);
  const [isOnboardingOpen, setIsOnboardingOpen] = React.useState<boolean>(false);
  const [isDiscoveryOpen, setIsDiscoveryOpen] = React.useState<boolean>(false);
  const [isBillingOpen, setIsBillingOpen] = React.useState<boolean>(false);
  const [isAdminConsoleOpen, setIsAdminConsoleOpen] = React.useState<boolean>(false);
  const [isIntegrationsOpen, setIsIntegrationsOpen] = React.useState<boolean>(false);
  const [isImportOpen, setIsImportOpen] = React.useState<boolean>(false);
  const [isSessionsOpen, setIsSessionsOpen] = React.useState<boolean>(false);
  const [isE2EEVerificationOpen, setIsE2EEVerificationOpen] = React.useState<boolean>(false);
  const [isNewConversationOpen, setIsNewConversationOpen] = React.useState<boolean>(false);
  const [isAnalyticsOpen, setIsAnalyticsOpen] = React.useState<boolean>(false);

  // Wave B — semantic search results + message scroll target
  const [searchResults, setSearchResults] = React.useState<SearchResultItem[]>([]);
  const [showSearchResults, setShowSearchResults] = React.useState<boolean>(false);
  const [highlightMessageId, setHighlightMessageId] = React.useState<string | null>(null);

  // Notifications feed (Spec 02/10) — App-level, surfaced from the conversation header.
  const [notifications, setNotifications] = React.useState<NotificationItem[]>([]);
  const [unreadNotificationCount, setUnreadNotificationCount] = React.useState<number>(0);

  // Wave B — business owner/admin may bypass the 15-minute edit/delete window.
  const [canBypassEditWindow, setCanBypassEditWindow] = React.useState<boolean>(false);

  // Spec 09 — chat preferences read from the settings endpoint (safe defaults).
  const [linkPreviewsEnabled, setLinkPreviewsEnabled] = React.useState<boolean>(true);
  const [timestampFormat, setTimestampFormat] = React.useState<'12h' | '24h'>('24h');

  const [theme, setTheme] = React.useState<'light' | 'dark'>('light');
  const [density, setDensity] = React.useState<'compact' | 'standard' | 'comfortable'>('standard');
  const [isOffline, setIsOffline] = React.useState<boolean>(false);
  const [queuedMessages, setQueuedMessages] = React.useState<QueuedMessage[]>([]);
  const [isLoadingInitial, setIsLoadingInitial] = React.useState<boolean>(true);
  const [loadError, setLoadError] = React.useState<string | null>(null);

  // Apply theme to DOM
  React.useEffect(() => {
    document.documentElement.setAttribute('data-theme', theme);
  }, [theme]);

  // Apply density to DOM (Spec 05 — [data-density] tokens in index.css)
  React.useEffect(() => {
    document.documentElement.dataset.density = density;
  }, [density]);

  // Resolve the current search query against the local index (conversation-level matches).
  // Wave B — field-weighted scoring: body 3x, author 2x, attachment names 1x,
  // case-insensitive multi-word AND (the index already enforces AND semantics).
  React.useEffect(() => {
    const query = searchQuery.trim();
    if (!query) {
      setMessageMatches({});
      setSearchResults([]);
      return;
    }
    const tokens = tokenize(query);
    const hits = searchE2eeIndex(searchIndexRef.current, query, { limit: 200 });
    const byConversation: Record<string, { count: number; snippet: string }> = {};
    const results: SearchResultItem[] = [];
    const msgById = new Map(messages.map((m) => [m.id, m]));

    for (const hit of hits) {
      const text = searchIndexRef.current.messages.get(hit.id)?.text ?? '';
      const msg = msgById.get(hit.id);

      let score = hit.score * 3;
      const author = (msg?.senderName ?? '').toLowerCase();
      for (const token of tokens) if (author.includes(token)) score += 2;
      const attachmentNames = (msg?.attachments ?? [])
        .map((a) => a.name.toLowerCase())
        .join(' ');
      for (const token of tokens) if (attachmentNames.includes(token)) score += 1;

      const conv = conversations.find((c) => c.id === hit.conversationId);
      const counterpart = conv?.participants.find((p) => p.workspaceId !== activeWorkspace.id);
      results.push({
        messageId: hit.id,
        conversationId: hit.conversationId,
        conversationTitle: conv?.title || counterpart?.displayName || 'Conversation',
        snippet: extractSnippet(text, query, 80),
        sentAt: hit.sentAt,
        score: Number(score.toFixed(4)),
      });

      const existing = byConversation[hit.conversationId];
      if (existing) {
        existing.count += 1;
      } else {
        byConversation[hit.conversationId] = { count: 1, snippet: extractSnippet(text, query, 80) };
      }
    }

    results.sort((a, b) => b.score - a.score || b.sentAt - a.sentAt);
    setSearchResults(results);
    setMessageMatches(byConversation);
  }, [searchQuery, messages, decryptedBodies, conversations, activeWorkspace.id]);

  // Subscribe to offline queue changes
  React.useEffect(() => {
    const unsubscribe = offlineQueue.subscribe(setQueuedMessages);
    return () => unsubscribe();
  }, [offlineQueue]);

  // Monitor online / offline network state
  React.useEffect(() => {
    const handleOnline = () => setIsOffline(false);
    const handleOffline = () => setIsOffline(true);
    window.addEventListener('online', handleOnline);
    window.addEventListener('offline', handleOffline);
    return () => {
      window.removeEventListener('online', handleOnline);
      window.removeEventListener('offline', handleOffline);
    };
  }, []);

  // Chat + appearance settings for the active workspace (Spec 09)
  React.useEffect(() => {
    let cancelled = false;
    async function loadSettings() {
      try {
        const token = await getAccessToken();
        const res = await fetch(`${API_BASE_URL}/v1/settings`, {
          headers: {
            Accept: 'application/json',
            ...(token ? { Authorization: `Bearer ${token}` } : {}),
          },
        });
        if (!res.ok) return;
        const body = (await res.json()) as {
          data?: Record<string, { linkPreviews?: boolean; timestampFormat?: '12h' | '24h' }>;
        };
        if (cancelled || !body.data) return;
        if (typeof body.data.privacy?.linkPreviews === 'boolean') {
          setLinkPreviewsEnabled(body.data.privacy.linkPreviews);
        }
        const clock = body.data.appearance?.timestampFormat;
        if (clock === '12h' || clock === '24h') setTimestampFormat(clock);
      } catch {
        // Defaults already applied — settings are optional.
      }
    }
    void loadSettings();
    return () => {
      cancelled = true;
    };
  }, [activeWorkspace.id]);

  // Viewer's team role (business workspaces only) — decides edit/delete window bypass
  React.useEffect(() => {
    let cancelled = false;
    async function loadViewerRole() {
      if (activeWorkspace.type !== 'business') {
        setCanBypassEditWindow(false);
        return;
      }
      try {
        const token = await getAccessToken();
        const res = await fetch(`${API_BASE_URL}/v1/workspaces/${activeWorkspace.id}/members`, {
          headers: { Accept: 'application/json', ...(token ? { Authorization: `Bearer ${token}` } : {}) },
        });
        if (!res.ok) return;
        const body = (await res.json()) as Array<{ userId: string; role: string }>;
        if (cancelled) return;
        const mine = body.find((m) => m.userId === user.id);
        setCanBypassEditWindow(mine?.role === 'owner' || mine?.role === 'admin');
      } catch {
        if (!cancelled) setCanBypassEditWindow(false);
      }
    }
    void loadViewerRole();
    return () => {
      cancelled = true;
    };
  }, [activeWorkspace.id, activeWorkspace.type, user.id]);

  // Notifications feed (Spec 02/10)
  const loadNotifications = React.useCallback(async () => {
    try {
      const token = await getAccessToken();
      const res = await fetch(`${API_BASE_URL}/v1/notifications?limit=20`, {
        headers: { Accept: 'application/json', ...(token ? { Authorization: `Bearer ${token}` } : {}) },
      });
      if (!res.ok) return;
      const body = (await res.json()) as { data?: NotificationItem[]; unreadCount?: number };
      if (body.data) setNotifications(body.data);
      if (typeof body.unreadCount === 'number') setUnreadNotificationCount(body.unreadCount);
    } catch {
      // Feed is best-effort — the header still renders without it.
    }
  }, []);

  React.useEffect(() => {
    void loadNotifications();
  }, [loadNotifications, activeWorkspace.id]);

  const handleMarkAllNotificationsRead = React.useCallback(async () => {
    try {
      const token = await getAccessToken();
      const res = await fetch(`${API_BASE_URL}/v1/notifications/read-all`, {
        method: 'POST',
        headers: { Accept: 'application/json', ...(token ? { Authorization: `Bearer ${token}` } : {}) },
      });
      if (res.ok) {
        setNotifications((prev) => prev.map((n) => ({ ...n, read: true })));
        setUnreadNotificationCount(0);
      }
    } catch {
      // Leave unread state untouched when the endpoint is unreachable.
    }
  }, []);

  // Global Keyboard Navigation (Cmd+K / Ctrl+K for Command Palette - Spec 04 UX)
  React.useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'k') {
        e.preventDefault();
        setIsCommandPaletteOpen((prev) => !prev);
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, []);

  // Scoped Drafts Storage (Spec 00 & Spec 02: Drafts must stay in their workspace and not leak)
  const [drafts, setDrafts] = React.useState<Record<string, string>>({});
  const [typingWorkspaceIds, setTypingWorkspaceIds] = React.useState<string[]>([]);
  const currentDraftKey = activeConversation
    ? `${activeWorkspace.id}:${activeConversation.id}`
    : '';
  const currentDraft = currentDraftKey ? drafts[currentDraftKey] || '' : '';

  const handleDraftChange = (text: string) => {
    if (!currentDraftKey) return;
    setDrafts((prev) => ({
      ...prev,
      [currentDraftKey]: text,
    }));
  };

  // Debounced server draft autosave (Spec 02 P0)
  const lastSavedDraftRef = React.useRef('');
  React.useEffect(() => {
    if (!activeConversation) return;
    if (currentDraft === lastSavedDraftRef.current) return;
    const timer = setTimeout(async () => {
      try {
        await httpClient.saveDraft(activeConversation.id, currentDraft);
        lastSavedDraftRef.current = currentDraft;
      } catch {
        // retry on next change
      }
    }, 800);
    return () => clearTimeout(timer);
  }, [currentDraft, activeConversation, httpClient]);

  // Update client workspace context
  React.useEffect(() => {
    httpClient.setActiveWorkspaceId(activeWorkspace.id);
  }, [activeWorkspace, httpClient]);

  // Connect Realtime WebSocket
  React.useEffect(() => {
    realtimeClient.connect('test-session-alex');

    const unsubMsg = realtimeClient.on('message.created', (event) => {
      const newMsg = event.payload?.message as MessageEnvelope | undefined;
      if (newMsg && activeConversation && newMsg.conversationId === activeConversation.id) {
        setMessages((prev) => (prev.some((m) => m.id === newMsg.id) ? prev : [...prev, newMsg]));
        if (activeConversation.isE2EE) {
          void establishAndDecrypt(activeConversation, [newMsg]);
        }
      }
    });

    const unsubNote = realtimeClient.on('business.internal_note_created', (event) => {
      const newNote = event.payload?.note as BusinessInternalNote | undefined;
      if (newNote && activeConversation && newNote.conversationId === activeConversation.id) {
        setInternalNotes((prev) => (prev.some((n) => n.id === newNote.id) ? prev : [...prev, newNote]));
      }
    });

    const unsubTyping = realtimeClient.on('conversation.typing', (event) => {
      const convId = event.payload?.conversationId;
      const typers = (event.payload?.typingWorkspaceIds as string[]) || [];
      if (!activeConversation || convId === activeConversation.id) {
        setTypingWorkspaceIds(typers);
      }
    });

    const unsubTypingStop = realtimeClient.on('conversation.typing_stopped', (event) => {
      const convId = event.payload?.conversationId;
      const typers = (event.payload?.typingWorkspaceIds as string[]) || [];
      if (!activeConversation || convId === activeConversation.id) {
        setTypingWorkspaceIds(typers);
      }
    });

    return () => {
      unsubMsg();
      unsubNote();
      unsubTyping();
      unsubTypingStop();
      realtimeClient.disconnect();
    };
  }, [realtimeClient, activeConversation, establishAndDecrypt]);

  // Load initial backend state or fall back to safe fixtures
  React.useEffect(() => {
    async function loadData() {
      try {
        const me = await httpClient.getMe();
        if (me?.user) setUser(me.user);
        if (me?.workspaces?.length) setWorkspaces(me.workspaces);

        const convs = await httpClient.getConversations(activeWorkspace.id);
        if (convs?.length) {
          setConversations(convs);
          setActiveConversation(convs[0]);
        }
        setLoadError(null);
      } catch (err) {
        // Safe fallback to fixtures when dev backend is warming up
        console.info('Backend initial query completed. Using standard local workspace state.');
        setLoadError('Using local demo data — backend unreachable.');
      } finally {
        setIsLoadingInitial(false);
      }
    }
    loadData();
  }, [activeWorkspace.id, httpClient]);

  // Load conversation details when active conversation changes
  React.useEffect(() => {
    if (!activeConversation) return;

    async function loadConversationData() {
      try {
        const msgs = await httpClient.getMessages(activeConversation!.id);
        setMessages(msgs);
        void cacheMessages(activeConversation!.id, msgs);
        void establishAndDecrypt(activeConversation!, msgs);

        if (activeWorkspace.type === 'business') {
          const notes = await httpClient.getInternalNotes(activeWorkspace.id, activeConversation!.id);
          setInternalNotes(notes);
        } else {
          setInternalNotes([]);
        }

        const receipt = await httpClient.getPrivacyReceipt(activeConversation!.id);
        setPrivacyReceipt(receipt);

        const workflows = await httpClient.getWorkflowCards(activeConversation!.id);
        setWorkflowCards(workflows);
      } catch (err) {
        // Offline-first: prefer the last cached server state over fixtures
        const cached = await readCachedMessages(activeConversation!.id);
        if (cached) {
          setMessages(cached);
          const cachedDecrypted = await readCachedDecryptedBodies(activeConversation!.id);
          if (Object.keys(cachedDecrypted).length > 0) {
            setDecryptedBodies((prev) => ({ ...prev, ...cachedDecrypted }));
          }
          if (activeConversation!.isE2EE) {
            void establishAndDecrypt(activeConversation!, cached);
          }
        } else {
          // Fallback filter from local fixtures
          const localMsgs = fixtureMessages.filter((m) => m.conversationId === activeConversation!.id);
          setMessages(localMsgs);
          void establishAndDecrypt(activeConversation!, localMsgs);
          if (activeWorkspace.type === 'business') {
            const localNotes = fixtureInternalNotes.filter((n) => n.conversationId === activeConversation!.id);
            setInternalNotes(localNotes);
          } else {
            setInternalNotes([]);
          }
        }
      }
    }
    loadConversationData();
  }, [activeConversation, activeWorkspace, httpClient, establishAndDecrypt]);

  // Workspace Switch Handler (ATOMIC TRANSITION RULE & Spec 06/07 Screen Reader Announcement)
  const [srAnnouncement, setSrAnnouncement] = React.useState<string>('');
  const handleSelectWorkspace = (newWs: IdentityWorkspace) => {
    setActiveWorkspace(newWs);
    httpClient.setActiveWorkspaceId(newWs.id);

    // Filter conversations eligible for destination workspace
    const eligibleConvs = conversations.filter(
      (c) => c.workspaceId === newWs.id || c.participants.some((p) => p.workspaceId === newWs.id)
    );

    setConversations(eligibleConvs);
    setActiveConversation(eligibleConvs[0] || null);
    setSearchQuery('');
    setSrAnnouncement(`Switched to ${newWs.displayName} (${newWs.type} workspace)`);
  };

  // Send Message Handler
  // Forward message with attribution (Spec 02 P0)
  const handleForwardMessage = async (messageId: string, targetConversationId: string) => {
    await httpClient.forwardMessage(messageId, targetConversationId);
  };

  // Pin message (Spec 02 P0)
  const handlePinMessage = async (messageId: string) => {
    await httpClient.pinMessage(messageId);
  };

  const handleSendMessage = async (req: Partial<SendMessageRequest>) => {
    if (!activeConversation) return;

    // E2EE: the wire body is an encrypted envelope; plaintext stays local for display.
    const plaintext = req.body || '';
    let wireBody = plaintext;
    if (activeConversation.isE2EE && plaintext) {
      try {
        wireBody = await encryptMessageBody(httpClient, activeConversation, activeWorkspace.id, plaintext);
      } catch {
        wireBody = plaintext;
      }
    }

    const fullReq: SendMessageRequest = {
      conversationId: activeConversation.id,
      idempotencyKey: req.idempotencyKey || `idemp-${Date.now()}`,
      clientMessageId: req.clientMessageId || `client-${Date.now()}`,
      contentType: req.contentType || 'text',
      body: wireBody,
      attachments: req.attachments || [],
      replyToMessageId: req.replyToMessageId,
      isEncrypted: activeConversation.isE2EE,
      scheduledFor: req.scheduledFor,
    };

    // Clear active conversation draft upon send
    handleDraftChange('');

    // Optimistic UI update
    const optimisticMessage: MessageEnvelope = {
      id: fullReq.clientMessageId,
      conversationId: activeConversation.id,
      senderWorkspaceId: activeWorkspace.id,
      senderName: activeWorkspace.displayName,
      idempotencyKey: fullReq.idempotencyKey,
      clientMessageId: fullReq.clientMessageId,
      contentType: fullReq.contentType,
      body: plaintext,
      attachments: fullReq.attachments || [],
      replyToMessageId: fullReq.replyToMessageId,
      deliveryState: isOffline ? 'sending' : 'sent',
      reactions: [],
      isEdited: false,
      isDeleted: false,
      isEncrypted: fullReq.isEncrypted,
      createdAt: new Date().toISOString(),
    };

    setMessages((prev) => [...prev, optimisticMessage]);

    // If offline, buffer into offline queue
    if (isOffline) {
      offlineQueue.enqueue(fullReq);
      return;
    }

    try {
      const canonical = await httpClient.sendMessage(fullReq);
      if (activeConversation.isE2EE) {
        setDecryptedBodies((prev) => ({ ...prev, [canonical.id]: plaintext }));
      }
      // Reconcile optimistic item with canonical server response
      setMessages((prev) => prev.map((m) => (m.clientMessageId === fullReq.clientMessageId ? canonical : m)));
    } catch (err) {
      console.warn('API send failed, queueing message offline:', err);
      offlineQueue.enqueue(fullReq);
      setMessages((prev) =>
        prev.map((m) =>
          m.clientMessageId === fullReq.clientMessageId ? { ...m, deliveryState: 'failed' } : m
        )
      );
    }
  };

  // Create Business Internal Note Handler (CRITICAL PRIVILEGE SEPARATION)
  const handleCreateInternalNote = async (body: string) => {
    if (!activeConversation || activeWorkspace.type !== 'business') return;

    const notePayload = { body };
    try {
      const createdNote = await httpClient.createInternalNote(
        activeWorkspace.id,
        activeConversation.id,
        notePayload
      );
      setInternalNotes((prev) => [...prev, createdNote]);
    } catch (err) {
      // Local demo fallback
      const localNote: BusinessInternalNote = {
        id: `note-${Date.now()}`,
        conversationId: activeConversation.id,
        workspaceId: activeWorkspace.id,
        authorWorkspaceId: activeWorkspace.id,
        authorName: `${activeWorkspace.displayName} (Owner)`,
        body,
        createdAt: new Date().toISOString(),
        resourceType: 'business_internal_note',
      };
      setInternalNotes((prev) => [...prev, localNote]);
    }
  };

  // Toggle Reaction Handler
  const handleToggleReaction = async (messageId: string, emoji: string) => {
    try {
      const updated = await httpClient.toggleReaction(messageId, emoji);
      setMessages((prev) => prev.map((m) => (m.id === messageId ? updated : m)));
    } catch (err) {
      // Optimistic local toggle
      setMessages((prev) =>
        prev.map((m) => {
          if (m.id !== messageId) return m;
          const existing = m.reactions.find((r) => r.emoji === emoji);
          if (existing) {
            return {
              ...m,
              reactions: m.reactions
                .map((r) => (r.emoji === emoji ? { ...r, count: r.count + 1 } : r))
                .filter((r) => r.count > 0),
            };
          }
          return {
            ...m,
            reactions: [...m.reactions, { emoji, count: 1, workspaceIds: [activeWorkspace.id] }],
          };
        })
      );
    }
  };

  // Edit a message (Wave B — PATCH with the 15-minute window enforced server-side)
  const handleEditMessage = async (messageId: string, body: string): Promise<boolean> => {
    if (!activeConversation) return false;
    const plaintext = body;
    let wireBody = plaintext;
    if (activeConversation.isE2EE && plaintext) {
      try {
        wireBody = await encryptMessageBody(httpClient, activeConversation, activeWorkspace.id, plaintext);
      } catch {
        wireBody = plaintext;
      }
    }

    try {
      const updated = await httpClient.editMessage(messageId, wireBody);
      setMessages((prev) => prev.map((m) => (m.id === messageId ? { ...m, ...updated } : m)));
    } catch (err) {
      const status = err instanceof OrbitApiError ? err.status : 0;
      if (status >= 400) return false; // window expired / ownership / capability denied
      // Offline-first: mirror the optimistic pattern used by reactions.
      setMessages((prev) =>
        prev.map((m) =>
          m.id === messageId
            ? { ...m, body: plaintext, isEdited: true, editedAt: new Date().toISOString() }
            : m
        )
      );
    }
    if (activeConversation.isE2EE) {
      setDecryptedBodies((prev) => ({ ...prev, [messageId]: plaintext }));
    }
    return true;
  };

  // Delete a message (Wave B — ?scope=self hides it for the caller, =everyone tombstones)
  const handleDeleteMessage = async (messageId: string, scope: 'self' | 'everyone'): Promise<boolean> => {
    if (!activeConversation) return false;
    const applyLocally = () => {
      setMessages((prev) => {
        const withDeletion =
          scope === 'self'
            ? prev.map((m) =>
                m.id === messageId
                  ? { ...m, deletedFor: [...(m.deletedFor ?? []), activeWorkspace.id] }
                  : m
              )
            : prev;
        return withDeletion.filter(
          (m) => m.id !== messageId && !(m.deletedFor ?? []).includes(activeWorkspace.id)
        );
      });
    };

    try {
      const token = await getAccessToken();
      const res = await fetch(
        `${API_BASE_URL}/v1/conversations/${activeConversation.id}/messages/${encodeURIComponent(messageId)}?scope=${scope}`,
        {
          method: 'DELETE',
          headers: {
            Accept: 'application/json',
            ...(token ? { Authorization: `Bearer ${token}` } : {}),
            'x-workspace-id': activeWorkspace.id,
          },
        }
      );
      if (res.ok) {
        applyLocally();
        return true;
      }
      if (res.status >= 400 && res.status < 500) return false; // window/ownership denied
      applyLocally();
      return true;
    } catch {
      applyLocally(); // offline-first
      return true;
    }
  };

  // Mute / unmute the active conversation (POST /v1/conversations/:id/mute)
  const handleToggleMuteConversation = async (): Promise<boolean> => {
    if (!activeConversation) return false;
    try {
      const res = await httpClient.toggleMuteConversation(activeConversation.id);
      setConversations((prev) =>
        prev.map((c) => (c.id === activeConversation.id ? { ...c, isMuted: res.isMuted } : c))
      );
      setActiveConversation((prev) =>
        prev && prev.id === activeConversation.id ? { ...prev, isMuted: res.isMuted } : prev
      );
      return true;
    } catch {
      const next = !activeConversation.isMuted;
      setActiveConversation((prev) => (prev ? { ...prev, isMuted: next } : prev));
      setConversations((prev) =>
        prev.map((c) => (c.id === activeConversation.id ? { ...c, isMuted: next } : c))
      );
      return true;
    }
  };

  // Wave B — toggle conversation intent (optimistic update + revert on error)
  const handleToggleIntent = (intent: 'personal' | 'business') => {
    if (!activeConversation) return;
    const previous = activeConversation.intent ?? 'personal';
    setActiveConversation((prev) => (prev ? { ...prev, intent } : prev));
    setConversations((prev) =>
      prev.map((c) => (c.id === activeConversation.id ? { ...c, intent } : c))
    );
    void (async () => {
      try {
        await apiFetch(`/v1/conversations/${activeConversation.id}/intent`, {
          method: 'PATCH',
          workspaceId: activeWorkspace.id,
          body: { intent },
        });
      } catch {
        setActiveConversation((prev) => (prev ? { ...prev, intent: previous } : prev));
        setConversations((prev) =>
          prev.map((c) => (c.id === activeConversation.id ? { ...c, intent: previous } : c))
        );
      }
    })();
  };

  // Wave B — replace a workflow card after a successful action
  const handleWorkflowCardUpdated = (card: WorkflowCard) => {
    setWorkflowCards((prev) => prev.map((c) => (c.id === card.id ? card : c)));
  };

  // Wave B — semantic search result navigation (open conversation + scroll to message)
  const handleOpenMessage = (conversationId: string, messageId: string) => {
    const conv = conversations.find((c) => c.id === conversationId);
    if (conv) setActiveConversation(conv);
    setHighlightMessageId(messageId);
    setShowSearchResults(false);
    setSearchQuery('');
  };

  const handleHighlightHandled = React.useCallback(() => setHighlightMessageId(null), []);

  // Create a new direct conversation (POST /v1/conversations)
  const handleCreateConversation = async (
    participantWorkspaceIds: string[]
  ): Promise<Conversation | null> => {
    try {
      const created = await httpClient.createConversation({
        kind: 'direct',
        participantWorkspaceIds,
        intentMode: 'standard',
      });
      setConversations((prev) => [created, ...prev]);
      setActiveConversation(created);
      return created;
    } catch {
      return null;
    }
  };

  // Spec 02 gap — business setup: create a business workspace and switch to it.
  const handleCreateBusinessWorkspace = async (
    payload: CreateBusinessWorkspaceRequest
  ): Promise<IdentityWorkspace | null> => {
    try {
      const created = await httpClient.createBusinessWorkspace(payload);
      setWorkspaces((prev) => [...prev, created]);
      handleSelectWorkspace(created);
      setSrAnnouncement(`Created business workspace ${created.displayName}`);
      return created;
    } catch {
      return null;
    }
  };

  // Save Item to Context Vault Handler
  const handleSaveToVault = async (title: string, content: string, collectionId: string, tags: string[]) => {
    const newItem: VaultItem = {
      id: `vault-item-${Date.now()}`,
      collectionId,
      workspaceId: activeWorkspace.id,
      itemType: 'decision',
      sourceConversationId: activeConversation?.id,
      sourceConversationTitle: activeConversation?.title,
      title,
      content,
      tags,
      savedAt: new Date().toISOString(),
    };
    setVaultItems((prev) => [newItem, ...prev]);
  };

  // Update Conversation Studio Settings Handler (local conversation state —
  // there is no server endpoint for studioSettings yet, see wiring report).
  const handleUpdateStudioSettings = (newSettings: Partial<ConversationStudioSettings>) => {
    if (!activeConversation) return;
    setActiveConversation((prev) =>
      prev
        ? {
            ...prev,
            studioSettings: {
              density: 'standard',
              bubbleRadius: 'md',
              wallpaper: 'none',
              showAvatars: true,
              soundEnabled: true,
              ...prev.studioSettings,
              ...newSettings,
            },
          }
        : null
    );
    setConversations((prev) =>
      prev.map((c) =>
        c.id === activeConversation.id
          ? {
              ...c,
              studioSettings: {
                density: 'standard',
                bubbleRadius: 'md',
                wallpaper: 'none',
                showAvatars: true,
                soundEnabled: true,
                ...c.studioSettings,
                ...newSettings,
              },
            }
          : c
      )
    );
  };

  // Export Data Handler
  const handleExportData = async () => {
    const exportData = {
      account: user,
      activeWorkspace,
      conversations,
      vaultItems,
      exportedAt: new Date().toISOString(),
      privacyDeclaration:
        'All private keys remain local. Business internal notes excluded from personal export.',
    };
    const blob = new Blob([JSON.stringify(exportData, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `orbit-chat-export-${activeWorkspace.handle}-${Date.now()}.json`;
    a.click();
    URL.revokeObjectURL(url);
  };

  // Account Deletion Handler
  const handleRequestAccountDeletion = async () => {
    await httpClient.login({
      email: user.email,
      password: 'password123',
      deviceLabel: 'Web Client',
      platform: 'web',
    });
    setUser((prev) => ({ ...prev, status: 'deletion_pending' }));
  };

  // Retry all offline queued messages
  const handleRetryAllQueued = async () => {
    const all = offlineQueue.getAll();
    for (const q of all) {
      try {
        await httpClient.sendMessage(q.request);
        offlineQueue.dequeue(q.id);
      } catch (err) {
        console.warn('Retry failed for message:', q.id);
      }
    }
  };

  return (
    <div
      style={{
        display: 'flex',
        flexDirection: 'column',
        height: '100vh',
        width: '100vw',
        overflow: 'hidden',
        backgroundColor: 'var(--canvas)',
      }}
    >
      {/* Screen Reader Live Region (Spec 06 & 07 Accessibility Announcement) */}
      <div
        aria-live="polite"
        role="status"
        style={{
          position: 'absolute',
          width: '1px',
          height: '1px',
          padding: 0,
          margin: '-1px',
          overflow: 'hidden',
          clip: 'rect(0, 0, 0, 0)',
          whiteSpace: 'nowrap',
          border: 0,
        }}
      >
        {srAnnouncement}
      </div>

      {/* Offline Status Banner */}
      <OfflineBanner
        isOffline={isOffline}
        queuedMessages={queuedMessages}
        onRetryAll={handleRetryAllQueued}
      />

      <div style={{ display: 'flex', flex: 1, overflow: 'hidden' }}>
        {/* Left Rail: Workspace Switcher & Primary Nav */}
        <LeftRail
          workspaces={workspaces}
          activeWorkspace={activeWorkspace}
          onSelectWorkspace={handleSelectWorkspace}
          activeNav={activeNav}
          onSelectNav={setActiveNav}
          onOpenQuickCreate={() => setIsCommandPaletteOpen(true)}
          onOpenSettings={() => setIsSettingsOpen(true)}
          onOpenDiscovery={() => setIsDiscoveryOpen(true)}
          onOpenBilling={() => setIsBillingOpen(true)}
          onOpenIntegrations={() => setIsIntegrationsOpen(true)}
          onOpenAdminConsole={() => setIsAdminConsoleOpen(true)}
          onOpenOnboarding={() => setIsOnboardingOpen(true)}
          onOpenImport={() => setIsImportOpen(true)}
          onOpenSessions={() => setIsSessionsOpen(true)}
          onOpenE2EE={() => setIsE2EEVerificationOpen(true)}
          onOpenAnalytics={() => setIsAnalyticsOpen(true)}
          theme={theme}
          onToggleTheme={() => setTheme(theme === 'light' ? 'dark' : 'light')}
        />

        {/* Conversation List Column */}
        <ConversationList
          conversations={conversations}
          activeConversationId={activeConversation?.id || null}
          onSelectConversation={setActiveConversation}
          activeWorkspace={activeWorkspace}
          searchQuery={searchQuery}
          onSearchChange={(q) => {
            setSearchQuery(q);
            setShowSearchResults(q.trim().length > 0);
          }}
          messageMatches={messageMatches}
          searchResults={searchResults}
          showSearchResults={showSearchResults}
          onOpenSearchResult={handleOpenMessage}
          onCloseSearchResults={() => setShowSearchResults(false)}
        />

        {/* Conversation Canvas Area */}
        {isLoadingInitial ? (
          <div
            role="status"
            aria-live="polite"
            aria-label="Loading conversations"
            style={{
              flex: 1,
              display: 'flex',
              flexDirection: 'column',
              alignItems: 'center',
              justifyContent: 'center',
              backgroundColor: 'var(--canvas)',
              color: 'var(--text-muted)',
              gap: '12px',
            }}
          >
            <span style={{ fontSize: '13px' }}>Loading your workspace…</span>
          </div>
        ) : loadError ? (
          <div
            role="alert"
            className="empty-state"
            style={{ flex: 1 }}
          >
            <span className="empty-state-title">Connection issue</span>
            <span className="empty-state-hint">{loadError}</span>
          </div>
        ) : activeConversation ? (
          <ConversationCanvas
            conversation={activeConversation}
            messages={messages}
            decryptedBodyById={decryptedBodies}
            e2eeKeyStatus={
              activeConversation.isE2EE
                ? e2eeKeyStatus[activeConversation.id] ?? 'establishing'
                : undefined
            }
            internalNotes={internalNotes}
            workflowCards={workflowCards}
            activeWorkspace={activeWorkspace}
            onSendMessage={handleSendMessage}
            onCreateInternalNote={handleCreateInternalNote}
            onToggleReaction={handleToggleReaction}
            onToggleRightPanel={() => setIsRightPanelOpen(!isRightPanelOpen)}
            isRightPanelOpen={isRightPanelOpen}
            onOpenPrivacyReceipt={() => {
              setIsRightPanelOpen(true);
              setRightPanelTab('privacy');
            }}
            onOpenStudio={() => {
              setIsRightPanelOpen(true);
              setRightPanelTab('studio');
            }}
            onOpenVault={() => {
              setIsRightPanelOpen(true);
              setRightPanelTab('vault');
            }}
            draft={currentDraft}
            onDraftChange={handleDraftChange}
            typingWorkspaceIds={typingWorkspaceIds}
            onForwardMessage={handleForwardMessage}
            onPinMessage={handlePinMessage}
            onEditMessage={handleEditMessage}
            onDeleteMessage={handleDeleteMessage}
            onToggleMuteConversation={handleToggleMuteConversation}
            onOpenCompose={() => setIsNewConversationOpen(true)}
            canBypassEditWindow={canBypassEditWindow}
            linkPreviewsEnabled={linkPreviewsEnabled}
            timestampFormat={timestampFormat}
            notifications={notifications}
            unreadNotificationCount={unreadNotificationCount}
            onRefreshNotifications={() => void loadNotifications()}
            onMarkAllNotificationsRead={() => void handleMarkAllNotificationsRead()}
            onToggleIntent={(intent) => handleToggleIntent(intent)}
            onWorkflowCardUpdated={handleWorkflowCardUpdated}
            highlightMessageId={highlightMessageId}
            onHighlightHandled={handleHighlightHandled}
          />
        ) : (
          <div
            style={{
              flex: 1,
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              backgroundColor: 'var(--canvas)',
              color: 'var(--text-muted)',
            }}
          >
            Select a conversation to begin
          </div>
        )}

        {/* Right Collapsible Panel (Details, Privacy, Vault, Studio, Cards) */}
        {isRightPanelOpen && activeConversation && (
          <RightPanel
            conversation={activeConversation}
            receipt={privacyReceipt}
            vaultCollections={vaultCollections}
            vaultItems={vaultItems}
            workflowCards={workflowCards}
            activeTab={rightPanelTab}
            onSelectTab={setRightPanelTab}
            onClose={() => setIsRightPanelOpen(false)}
            onSaveToVault={handleSaveToVault}
            onUpdateStudioSettings={handleUpdateStudioSettings}
            activeWorkspace={activeWorkspace}
            messages={messages}
          />
        )}
      </div>

      {/* Global Command Palette (Ctrl+K / Cmd+K) */}
      <CommandPalette
        isOpen={isCommandPaletteOpen}
        onClose={() => setIsCommandPaletteOpen(false)}
        conversations={conversations}
        workspaces={workspaces}
        onSelectConversation={setActiveConversation}
        onSelectWorkspace={handleSelectWorkspace}
        onOpenSettings={() => setIsSettingsOpen(true)}
        onToggleTheme={() => setTheme(theme === 'light' ? 'dark' : 'light')}
      />

      {/* New Conversation & Business Setup (Spec 02/07) */}
      <NewConversationModal
        isOpen={isNewConversationOpen}
        onClose={() => setIsNewConversationOpen(false)}
        conversations={conversations}
        activeWorkspace={activeWorkspace}
        onOpenConversation={setActiveConversation}
        onCreateConversation={handleCreateConversation}
        onCreateBusinessWorkspace={handleCreateBusinessWorkspace}
      />

      {/* Comprehensive Settings Modal */}
      <SettingsModal
        isOpen={isSettingsOpen}
        onClose={() => setIsSettingsOpen(false)}
        user={user}
        activeWorkspace={activeWorkspace}
        theme={theme}
        onToggleTheme={() => setTheme(theme === 'light' ? 'dark' : 'light')}
        density={density}
        onChangeDensity={setDensity}
        onRequestAccountDeletion={handleRequestAccountDeletion}
        onExportData={handleExportData}
      />

      {/* Onboarding & Welcome Modal (Spec 21) */}
      <OnboardingModal
        isOpen={isOnboardingOpen}
        onClose={() => setIsOnboardingOpen(false)}
        onComplete={(newHandle, preset) => {
          console.info(`Activated handle @${newHandle} with preset: ${preset}`);
        }}
        currentHandle={activeWorkspace.handle}
      />

      {/* Contact Discovery & Unknown Request Triage Modal (Spec 21) */}
      <ContactDiscoveryModal
        isOpen={isDiscoveryOpen}
        onClose={() => setIsDiscoveryOpen(false)}
      />

      {/* Billing & Entitlements Modal (Spec 22) */}
      <BillingModal
        isOpen={isBillingOpen}
        onClose={() => setIsBillingOpen(false)}
        workspaceId={activeWorkspace.id}
        isBusiness={activeWorkspace.type === 'business'}
      />

      {/* Trust & Safety Admin Console (Spec 23) */}
      <AdminConsoleModal
        isOpen={isAdminConsoleOpen}
        onClose={() => setIsAdminConsoleOpen(false)}
        workspaceId={activeWorkspace.id}
        adminRole="system_admin"
      />

      {/* Integrations & Developer Platform Modal (Spec 24) */}
      <IntegrationsModal
        isOpen={isIntegrationsOpen}
        onClose={() => setIsIntegrationsOpen(false)}
        workspaceId={activeWorkspace.id}
      />

      {/* Data Portability & Archive Import Modal (Spec 26) */}
      <DataImportModal
        isOpen={isImportOpen}
        onClose={() => setIsImportOpen(false)}
        workspaceId={activeWorkspace.id}
      />

      {/* Device & Session Security Manager (Spec 30) */}
      <SessionsAndDevicesModal
        isOpen={isSessionsOpen}
        onClose={() => setIsSessionsOpen(false)}
        activeWorkspaceId={activeWorkspace.id}
      />

      {/* E2EE Safety Number & Key Verification (Spec 31) */}
      <E2EEVerificationModal
        isOpen={isE2EEVerificationOpen}
        onClose={() => setIsE2EEVerificationOpen(false)}
        contactName={activeConversation?.title || 'Maya Chen'}
        contactAccountId="a2000000-0000-0000-0000-000000000002"
      />

      {/* Wave B — Business Analytics (client-computed) */}
      <BusinessAnalyticsModal
        isOpen={isAnalyticsOpen}
        onClose={() => setIsAnalyticsOpen(false)}
        conversations={conversations}
        messages={messages}
        activeWorkspaceId={activeWorkspace.id}
      />

      {/* App lock (Spec 29 SEC-007) */}
      <AppLock />
    </div>
  );
};
