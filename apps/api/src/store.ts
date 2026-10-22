import {
  UserAccount,
  IdentityWorkspace,
  WorkspaceMembership,
  Conversation,
  MessageEnvelope,
  BusinessInternalNote,
  WorkflowCard,
  VaultCollection,
  VaultItem,
  RealtimeEvent,
  AuthSession,
  ContactRequest,
  InviteLink,
  BillingEntitlement,
  InvoiceRecord,
  AdminAuditLog,
  UserReport,
  IntegrationManifest,
  BusinessVerification,
  PrivacyTelemetryEvent,
  DeviceSession,
  KeyBundle,
  KeyVerificationRecord,
  DeletionTombstone,
  SecurityKey,
  WorkspaceInvitation,
  SavedReply,
  ConversationVaultSettings,
  LegalDocument,
  UserLegalConsent,
  DataRequest,
  SpamSignal,
  UrgentSafetyCase,
  AccessGrant,
  LegalHold,
  ExperimentDefinition,
  ExperimentAssignment,
  ResearchStudy,
  ResearchParticipant,
  ResearchPool,
} from '@orbit/schemas';
import { IdempotencyManager, DeletionTombstoneLedger, SlidingWindowRateLimiter } from '@orbit/domain';
import { isEncryptedEnvelope } from '@orbit/crypto-adapter';
import type { DbClient } from './db/client.js';

interface WebhookDeliveryRecord {
  id: string;
  integrationId: string;
  event: string;
  payload: Record<string, unknown>;
  signature: string;
  timestamp: number;
  status: 'pending' | 'delivered' | 'failed' | 'dead_letter';
  deliveryStatus: 'sent' | 'failed' | 'retrying';
  attempts: number;
  lastError?: string;
  deliveredAt?: string;
  idempotencyKey?: string;
  createdAt: string;
}
import {
  fixtureAccounts,
  fixtureWorkspaces,
  fixtureConversations,
  fixtureMessages,
  fixtureInternalNotes,
  fixtureWorkflowCards,
  fixtureVaultCollections,
  fixtureVaultItems,
  FIXTURE_IDS,
  generateSyntheticUser,
} from '@orbit/test-fixtures';

export interface BlockEntry {
  id: string;
  workspaceId: string;
  blockedWorkspaceId: string;
  createdAt: string;
}

/** Spec 14 — a request to join a group that requires admin approval before membership. */
export interface GroupJoinRequest {
  id: string;
  conversationId: string;
  requesterWorkspaceId: string;
  inviteId: string | null;
  status: 'pending' | 'approved' | 'declined';
  createdAt: string;
  decidedAt?: string;
  decidedByWorkspaceId?: string;
}

export interface BillingEventRecord {
  id: string;
  workspaceId: string;
  type: string;
  planId: string | null;
  amount: number;
  currency: string;
  status: string;
  metadata: Record<string, unknown>;
  createdAt: string;
}

/** Media attachment metadata (Spec 10 — object storage; in-memory + SQL). */
export interface StoredMediaAttachment {
  id: string;
  workspaceId: string;
  filename: string;
  mimeType: string;
  sizeBytes: number;
  storedPath: string;
  createdAt: string;
}

/** Wave B — a message scheduled for future delivery (Spec 02 scheduled messages). */
export interface ScheduledMessage {
  id: string;
  conversationId: string;
  workspaceId: string;
  senderName: string;
  senderAvatarUrl?: string;
  body: string;
  scheduledFor: string;
  status: 'scheduled' | 'sent' | 'cancelled';
  createdAt: string;
  sentAt?: string;
}

export class DataStore {
  public accounts = new Map<string, UserAccount>();
  public workspaces = new Map<string, IdentityWorkspace>();
  public memberships = new Map<string, WorkspaceMembership>();
  public conversations = new Map<string, Conversation>();
  public messages = new Map<string, MessageEnvelope>();
  // CRITICAL: Isolated storage for business internal notes - never mixed with public messages
  public internalNotes = new Map<string, BusinessInternalNote>();
  public workflowCards = new Map<string, WorkflowCard>();
  public vaultCollections = new Map<string, VaultCollection>();
  public vaultItems = new Map<string, VaultItem>();
  public outboxEvents: RealtimeEvent[] = [];
  public sessions = new Map<string, AuthSession>();
  public idempotency = new IdempotencyManager<MessageEnvelope>();

  // Expansion Collections (Specs 21-26)
  public contactRequests = new Map<string, ContactRequest>();
  public inviteLinks = new Map<string, InviteLink>();
  /** Spec 14 — pending group join requests awaiting admin approval. */
  public groupJoinRequests = new Map<string, GroupJoinRequest>();
  /** Spec 14 — business verification applications (badge requires reviewer approval). */
  public businessVerifications = new Map<string, BusinessVerification>();
  public billingEntitlements = new Map<string, BillingEntitlement>();
  public invoices = new Map<string, InvoiceRecord>();
  public billingEvents = new Map<string, BillingEventRecord>();
  public adminAuditLogs: AdminAuditLog[] = [];
  public userReports = new Map<string, UserReport>();
  public integrations = new Map<string, IntegrationManifest>();
  public telemetryEvents: PrivacyTelemetryEvent[] = [];

  // Trust & Safety Collections (Spec 23)
  public spamSignals = new Map<string, SpamSignal>();
  public urgentSafetyCases = new Map<string, UrgentSafetyCase>();
  public accessGrants = new Map<string, AccessGrant>();

  // Legal & Compliance Collections (Spec 23)
  public legalDocuments = new Map<string, LegalDocument>();
  public userLegalConsents = new Map<string, UserLegalConsent>();
  public dataRequests = new Map<string, DataRequest>();
  public legalHolds = new Map<string, LegalHold>();
  public supportTickets = new Map<string, any>();
  /** SLA tracking records keyed by sla id. */
  public workflowSlas = new Map<string, any>();

  // Security & Crypto Collections (Specs 29-46)
  public deviceSessions = new Map<string, DeviceSession>();
  public keyBundles = new Map<string, KeyBundle>();
  public keyVerifications = new Map<string, KeyVerificationRecord>();
  public tombstoneLedger = new DeletionTombstoneLedger();
  public rateLimiter = new SlidingWindowRateLimiter();
  /** Spec 14 — blocked workspaces, keyed `${blockerWorkspaceId}:${blockedWorkspaceId}`. */
  public blocks = new Map<string, BlockEntry>();
  /** Spec 09/14 — persisted per-workspace settings, keyed by workspaceId. */
  public workspaceSettings = new Map<string, Record<string, unknown>>();
  /** Spec 14 — accounts currently restricted by moderation (suspended / temporary hold). */
  public suspendedAccounts = new Set<string>();
  /** Spec 10 — uploaded media attachments (object storage metadata). */
  public mediaAttachments = new Map<string, StoredMediaAttachment>();
  /** Spec 30 — registered security keys / passkeys, keyed by accountId. */
  public securityKeys = new Map<string, SecurityKey[]>();
  /** Wave B — workspace invitations, keyed by invitation id. */
  public invitations = new Map<string, WorkspaceInvitation>();
  /** Wave B — workspace saved replies, keyed by saved reply id. */
  public savedReplies = new Map<string, SavedReply>();
  /** Wave B — conversation vault settings (saved conversations), keyed by conversationId. */
  public conversationVault = new Map<string, ConversationVaultSettings>();
  /** Wave B — scheduled messages awaiting their send tick, keyed by scheduled message id. */
  public scheduledMessages = new Map<string, ScheduledMessage>();
  /** Spec 19 — branch permissions, keyed `${conversationId}_${workspaceId}`. */
  public branchPermissions = new Map<string, { conversationId: string; workspaceId: string; canRead: boolean; canWrite: boolean }>();
  /** Spec 19 — conversation module grants, keyed `${integrationId}_${conversationId}`. */
  public conversationModuleGrants = new Map<string, { integrationId: string; conversationId: string; grantedBy: string; grantedAt: string; scopes: string[]; botPermissions: { canJoin: boolean; canReadHistory: boolean; canSend: boolean }; id: string }>();
  /** Spec 24 — webhook delivery tracking with HMAC signing + replay protection. */
  public webhookDeliveries = new Map<string, WebhookDeliveryRecord>();
  /** Spec 25 — event registry with governance. */
  public eventRegistry = new Map<string, { definition: unknown; eventCount: number; lastSeenAt: string | null }>();
  /** Spec 25 — experiments framework. */
  public experiments = new Map<string, ExperimentDefinition>();
  /** Spec 25 — experiment assignments (deterministic). */
  public experimentAssignments = new Map<string, ExperimentAssignment>();
  /** Spec 25 — user research studies. */
  public researchStudies = new Map<string, ResearchStudy>();
  /** Spec 25 — research study participants. */
  public researchParticipants = new Map<string, ResearchParticipant>();
  /** Spec 25 — research participant pools for diversity recruitment. */
  public researchPools = new Map<string, ResearchPool>();
  /** EventIds already fanned out live in this process (bounded). */
  private broadcastCounts = new Map<string, number>();

  /**
   * Optional durable backend (Spec 10: PostgreSQL for authoritative relational data).
   * When set, core message commits write through to SQL inside a transaction + outbox
   * pattern. When null (no DATABASE_URL), the API runs the in-memory demo store only.
   */
  public db: DbClient | null = null;

  private eventSequence = 1;

  /** Wave B — per-conversation monotonic server sequence for message ordering. */
  private conversationSequences = new Map<string, number>();

  constructor(seedFixtures = true) {
    if (seedFixtures) {
      this.seed();
    }
  }

  seed(): void {
    // Seed accounts using synthetic generators (Spec 25)
    for (let i = 0; i < 3; i++) {
      const synth = generateSyntheticUser();
      this.accounts.set(synth.id, { ...synth });
    }

    fixtureAccounts.forEach((acc) => this.accounts.set(acc.id, { ...acc }));

    fixtureWorkspaces.forEach((ws) => this.workspaces.set(ws.id, { ...ws }));
    fixtureConversations.forEach((conv) => this.conversations.set(conv.id, { ...conv }));
    fixtureMessages.forEach((msg) => this.messages.set(msg.id, { ...msg }));
    fixtureInternalNotes.forEach((note) => this.internalNotes.set(note.id, { ...note }));
    fixtureWorkflowCards.forEach((card) => this.workflowCards.set(card.id, { ...card }));
    fixtureVaultCollections.forEach((coll) => this.vaultCollections.set(coll.id, { ...coll }));
    fixtureVaultItems.forEach((item) => this.vaultItems.set(item.id, { ...item }));

    // Seed default memberships
    this.memberships.set('m1', {
      id: 'm1',
      workspaceId: FIXTURE_IDS.wsBusinessAcme,
      accountId: FIXTURE_IDS.accountAlex,
      role: 'owner',
      status: 'active',
      joinedAt: '2026-01-01T10:00:00Z',
    });
    this.memberships.set('m2', {
      id: 'm2',
      workspaceId: FIXTURE_IDS.wsBusinessAcme,
      accountId: FIXTURE_IDS.accountSam,
      role: 'agent',
      status: 'active',
      joinedAt: '2026-01-01T12:00:00Z',
    });

    // Seed active session for Alex
    this.sessions.set('test-session-alex', {
      sessionId: 'test-session-alex',
      accountId: FIXTURE_IDS.accountAlex,
      activeWorkspaceId: FIXTURE_IDS.wsPersonalAlex,
      deviceLabel: 'Chrome on macOS (Authorized)',
      platform: 'web',
      createdAt: '2026-01-01T10:00:00Z',
      lastActiveAt: new Date().toISOString(),
      isCurrentSession: true,
      expiresAt: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000).toISOString(),
      hasRecentStepUp: true,
      stepUpExpiresAt: new Date(Date.now() + 60 * 60 * 1000).toISOString(),
      lastStepUpAt: new Date().toISOString(),
    });

    // Seed Contact Requests (Spec 21)
    this.contactRequests.set('cr_1', {
      id: 'cr_1',
      requesterId: 'usr_new_stranger',
      requesterHandle: 'jordan_lee',
      requesterDisplayName: 'Jordan Lee',
      recipientId: FIXTURE_IDS.accountAlex,
      recipientHandle: 'alex',
      status: 'pending',
      introMessage: 'Hi Alex, found your profile via the open research group!',
      createdAt: '2026-10-18T09:00:00Z',
      updatedAt: '2026-10-18T09:00:00Z',
    });

    // Seed Invite Link (Spec 21)
    this.inviteLinks.set('inv_alex_main', {
      id: 'inv_alex_main',
      workspaceId: FIXTURE_IDS.wsPersonalAlex,
      creatorId: FIXTURE_IDS.accountAlex,
      code: 'orbit-alex-2026',
      url: 'https://chat.orbit.local/invite/orbit-alex-2026',
      maxUses: 10,
      usedCount: 2,
      expiresAt: '2026-12-31T23:59:59Z',
      revoked: false,
      createdAt: '2026-01-01T00:00:00Z',
    });

    // Seed Billing Entitlements (Spec 22)
    this.billingEntitlements.set(FIXTURE_IDS.wsPersonalAlex, {
      workspaceId: FIXTURE_IDS.wsPersonalAlex,
      plan: 'personal_free',
      status: 'active',
      billingOwnerUserId: FIXTURE_IDS.accountAlex,
      seatsAllocated: 1,
      seatsUsed: 1,
      storageQuotaBytes: 1024 * 1024 * 1024, // 1 GB
      storageUsedBytes: 120 * 1024 * 1024,
      maxFileSizeMB: 25,
      customThemesAllowed: false,
      workflowCardsAllowed: false,
      auditExportAllowed: false,
      activeIntegrationsCount: 1,
      maxIntegrationsAllowed: 2,
      renewalDate: '2027-01-01T00:00:00Z',
      metadata: {},
    });

    this.billingEntitlements.set(FIXTURE_IDS.wsBusinessAcme, {
      workspaceId: FIXTURE_IDS.wsBusinessAcme,
      plan: 'business_starter',
      status: 'active',
      billingOwnerUserId: FIXTURE_IDS.accountAlex,
      seatsAllocated: 5,
      seatsUsed: 2,
      storageQuotaBytes: 50 * 1024 * 1024 * 1024, // 50 GB
      storageUsedBytes: 3 * 1024 * 1024 * 1024,
      maxFileSizeMB: 100,
      customThemesAllowed: true,
      workflowCardsAllowed: true,
      auditExportAllowed: true,
      activeIntegrationsCount: 2,
      maxIntegrationsAllowed: 10,
      renewalDate: '2026-11-01T00:00:00Z',
      metadata: {},
    });

    // Seed Invoices (Spec 22)
    this.invoices.set('inv_acme_101', {
      id: 'inv_acme_101',
      workspaceId: FIXTURE_IDS.wsBusinessAcme,
      invoiceNumber: 'INV-2026-1001',
      amountCents: 4900,
      currency: 'USD',
      date: '2026-10-01T00:00:00Z',
      status: 'paid',
      description: 'Acme Support — Business Starter Plan (5 Seats)',
    });

    // Seed Admin Audit Logs (Spec 23)
    this.adminAuditLogs.push({
      id: 'aud_log_001',
      actorId: FIXTURE_IDS.accountAlex,
      actorRole: 'system_admin',
      action: 'security.workspace.verified',
      targetType: 'workspace',
      targetId: FIXTURE_IDS.wsBusinessAcme,
      justification: 'Initial tenant verification and compliance clearance',
      ipHash: 'e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855',
      timestamp: '2026-01-01T12:00:00Z',
    });

    // Seed User Reports queue (Spec 23)
    this.userReports.set('rep_101', {
      id: 'rep_101',
      reporterId: FIXTURE_IDS.accountAlex,
      reporterHandle: 'alex',
      targetUserId: 'usr_spammer_bot',
      targetHandle: 'crypto_giveaway_bot',
      reason: 'spam',
      details: 'Unsolicited bot invitation to automated coin scheme.',
      status: 'pending',
      actionTaken: 'none',
      queueType: 'user_report',
      createdAt: '2026-10-18T08:30:00Z',
      updatedAt: '2026-10-18T08:30:00Z',
    });

    // Seed Integrations / Bots (Spec 24)
    this.integrations.set('int_linear', {
      id: 'int_linear',
      workspaceId: FIXTURE_IDS.wsBusinessAcme,
      name: 'Linear Tracker Bot',
      description: 'Creates and resolves support tickets with interactive workflow cards.',
      icon: 'bot',
      category: 'workflow',
      scopes: ['messages.read_scoped', 'messages.send', 'workflow.cards'],
      botIdentity: {
        name: 'Linear Bot',
        handle: 'linear_bot',
        avatar: '🤖',
        badge: 'Verified Bot',
      },
      webhookUrl: 'https://api.linear.local/webhook/orbit',
      status: 'installed',
      installedAt: '2026-09-15T10:00:00Z',
      dataPolicyUrl: 'https://linear.app/privacy',
    });

    this.integrations.set('int_github', {
      id: 'int_github',
      name: 'GitHub Webhook Connector',
      description: 'Stream release announcements and PR summaries into designated rooms.',
      icon: 'git-branch',
      category: 'workflow',
      scopes: ['messages.send', 'webhooks.receive'],
      status: 'available',
      dataPolicyUrl: 'https://github.com/privacy',
    });

    // Seed Device Sessions (Spec 30)
    this.deviceSessions.set('test-session-alex', {
      id: 'test-session-alex',
      accountId: FIXTURE_IDS.accountAlex,
      activeWorkspaceId: FIXTURE_IDS.wsPersonalAlex,
      deviceLabel: 'Chrome 130 on macOS (Active)',
      platform: 'web',
      ipAddressMasked: '192.168.***.***',
      isCurrentSession: true,
      isPasskeyAuthenticated: true,
      hasRecentStepUp: true,
      stepUpExpiresAt: new Date(Date.now() + 3600000).toISOString(),
      lastStepUpAt: new Date().toISOString(),
      createdAt: '2026-10-18T08:00:00Z',
      lastActiveAt: new Date().toISOString(),
      status: 'active',
    });

    this.deviceSessions.set('sess_macbook_pro', {
      id: 'sess_macbook_pro',
      accountId: FIXTURE_IDS.accountAlex,
      activeWorkspaceId: FIXTURE_IDS.wsBusinessAcme,
      deviceLabel: 'Orbit Desktop on MacBook Pro',
      platform: 'desktop',
      ipAddressMasked: '192.168.***.***',
      isCurrentSession: false,
      isPasskeyAuthenticated: true,
      hasRecentStepUp: false,
      createdAt: '2026-10-15T14:30:00Z',
      lastActiveAt: '2026-10-18T10:15:00Z',
      status: 'active',
    });

    this.deviceSessions.set('sess_iphone_15', {
      id: 'sess_iphone_15',
      accountId: FIXTURE_IDS.accountAlex,
      activeWorkspaceId: FIXTURE_IDS.wsPersonalAlex,
      deviceLabel: 'Orbit iOS on iPhone 15 Pro',
      platform: 'ios',
      ipAddressMasked: '172.56.***.***',
      isCurrentSession: false,
      isPasskeyAuthenticated: true,
      hasRecentStepUp: false,
      createdAt: '2026-10-10T11:00:00Z',
      lastActiveAt: '2026-10-18T12:00:00Z',
      status: 'active',
    });

    // Seed Key Bundles (Spec 31)
    this.keyBundles.set(FIXTURE_IDS.accountAlex, {
      accountId: FIXTURE_IDS.accountAlex,
      deviceId: 'dev_alex_web_1',
      identityKeyPub:
        'MFkwEwYHKoZIzj0CAQYIKoZIzj0DAQcDQgAEOUCVEZVPn8qiqnK1e/x19jofY7+hCLGbeYHT5cQ8OHJUyW+YmBsxYv35OLwzzO2d264zs9JrivhHrbUPdQ0kFg==',
      signedPreKeyPub: 'MFkwEwYHKoZIzj0CAQYIKoZIzj0DAQcDQgAESignedPreKeyAlexSampleBytesStringBase64Data==',
      signedPreKeySig: 'MEQCIDxSampleSignatureOverAlexSignedPreKeyWithEd25519KeyForVerification==',
      oneTimePreKeys: [
        'MFkwEwYHKoZIzj0CAQYIKoZIzj0DAQcDQgAEOpk1SampleAlexPreKeyBytesDataStringBase64==',
        'MFkwEwYHKoZIzj0CAQYIKoZIzj0DAQcDQgAEOpk2SampleAlexPreKeyBytesDataStringBase64==',
      ],
      registrationId: 44219,
      createdAt: '2026-01-01T00:00:00Z',
    });

    this.keyBundles.set(FIXTURE_IDS.accountSam, {
      accountId: FIXTURE_IDS.accountSam,
      deviceId: 'dev_sam_web_1',
      identityKeyPub:
        'MFkwEwYHKoZIzj0CAQYIKoZIzj0DAQcDQgAEdbJhZoI7tkwoqxPBpxtkWxSEk/j29Ldzt+fQGrGDjxkIXToXaF+St/ORsNBv/YDj+1WlwrCytQkd3swDGIKLNQ==',
      signedPreKeyPub: 'MFkwEwYHKoZIzj0CAQYIKoZIzj0DAQcDQgAESignedPreKeySamSampleBytesStringBase64Data==',
      signedPreKeySig: 'MEQCIDxSampleSignatureOverSamSignedPreKeyWithEd25519KeyForVerification==',
      oneTimePreKeys: [
        'MFkwEwYHKoZIzj0CAQYIKoZIzj0DAQcDQgAEOpk1SampleSamPreKeyBytesDataStringBase64==',
      ],
      registrationId: 18902,
      createdAt: '2026-01-01T00:00:00Z',
    });

    this.keyBundles.set(FIXTURE_IDS.accountMaya, {
      accountId: FIXTURE_IDS.accountMaya,
      deviceId: 'dev_maya_mobile_1',
      identityKeyPub:
        'MFkwEwYHKoZIzj0CAQYIKoZIzj0DAQcDQgAEZEhNBWsv3DXYmq+Wlak1S+uOS7Zey/ZoXbaM+LZFxOoXK/S/Ebc5qKhZRZi5hosyZAsUtdh2rbudd19DYkPS6w==',
      signedPreKeyPub: 'MFkwEwYHKoZIzj0CAQYIKoZIzj0DAQcDQgAESignedPreKeyMayaSampleBytesStringBase64Data==',
      signedPreKeySig: 'MEQCIDxSampleSignatureOverMayaSignedPreKeyWithEd25519KeyForVerification==',
      oneTimePreKeys: [
        'MFkwEwYHKoZIzj0CAQYIKoZIzj0DAQcDQgAEOpk1SampleMayaPreKeyBytesDataStringBase64==',
      ],
      registrationId: 29381,
      createdAt: '2026-01-01T00:00:00Z',
    });

    // Seed Key Verification Record (Spec 31)
    this.keyVerifications.set(FIXTURE_IDS.accountMaya, {
      contactAccountId: FIXTURE_IDS.accountMaya,
      contactIdentityKeyPub: 'MFkwEwYHKoZIzj0CAQYIKoZIzj0DAQcDQgAEMayaIdentityPublicKeySample64BytesStringBase64==',
      safetyNumber: '39102 81726 39102 81726 48291 39102 81726 48291 39102 81726 48291 39102',
      status: 'verified',
      verifiedAt: '2026-10-18T09:00:00Z',
    });
    this.keyVerifications.set(FIXTURE_IDS.accountSam, {
      contactAccountId: FIXTURE_IDS.accountSam,
      contactIdentityKeyPub: 'MFkwEwYHKoZIzj0CAQYIKoZIzj0DAQcDQgAESamIdentityPublicKeySample64BytesStringBase64==',
      safetyNumber: '48201 92837 19482 01928 37461 92837 46192 83746 19283 74619 28374 61928',
      status: 'verified',
      verifiedAt: '2026-10-18T09:00:00Z',
    });

    // Seed sample tombstone in ledger (Spec 37)
    this.tombstoneLedger.recordTombstone(
      'message',
      'msg_expired_gdpr_sample_999',
      FIXTURE_IDS.wsPersonalAlex,
      'gdpr_erasure'
    );
  }

  /**
   * Spec 10 — Message request path, steps 3–4:
   * commit the canonical message + realtime outbox event atomically.
   * In-memory maps stay the working set for fixtures/tests; when `db` is set,
   * PostgreSQL is authoritative and the commit is transactional.
   */
  async commitOutboundMessage(
    message: MessageEnvelope,
    conversation: Conversation,
    event: { eventId: string; type: string; payload: Record<string, unknown> }
  ): Promise<void> {
    const persistInMemory = () => {
      this.messages.set(message.id, message);
      this.idempotency.set(message.idempotencyKey, message);
      conversation.lastMessageSnippet =
        message.isEncrypted && isEncryptedEnvelope(message.body)
          ? 'Encrypted message'
          : this.snippet(message.body);
      conversation.lastMessageAt = message.createdAt;
      conversation.updatedAt = message.createdAt;
    };

    if (!this.db) {
      persistInMemory();
      return;
    }

    await this.db.transaction(async (tx) => {
      await tx.query(
        `INSERT INTO message_envelopes (
           id, conversation_id, sender_workspace_id, sender_name, idempotency_key,
           client_message_id, content_type, body, attachments, delivery_state,
           reactions, reply_to_message_id, reply_to_snippet, reply_to_sender_name,
           branch_id, is_edited, is_deleted, is_encrypted, server_sequence, created_at
         ) VALUES (
           $1, $2, $3, $4, $5, $6, $7, $8, $9::jsonb, $10, $11::jsonb,
           $12, $13, $14, $15, $16, $17, $18, $19, $20
         )`,
        [
          message.id,
          message.conversationId,
          message.senderWorkspaceId,
          message.senderName ?? null,
          message.idempotencyKey,
          message.clientMessageId ?? null,
          message.contentType,
          message.body ?? null,
          JSON.stringify(message.attachments ?? []),
          message.deliveryState,
          JSON.stringify(message.reactions ?? []),
          message.replyToMessageId ?? null,
          message.replyToSnippet ?? null,
          message.replyToSenderName ?? null,
          message.branchId ?? null,
          message.isEdited,
          message.isDeleted,
          message.isEncrypted,
          message.serverSequence ?? null,
          message.createdAt,
        ]
      );

      await tx.query(
        `UPDATE conversations
            SET last_message_snippet = $2, last_message_at = $3, updated_at = $3
          WHERE id = $1`,
        [conversation.id, conversation.lastMessageSnippet ?? null, message.createdAt]
      );

      // Outbox row in the SAME transaction (Spec 10: never lose events between commit and fan-out).
      // If the event was already fanned out live in this process, mark it delivered at insert;
      // otherwise leave delivered_at NULL so the outbox worker retries after reconnect/restart.
      await tx.query(
        `INSERT INTO realtime_outbox (event_id, type, schema_version, workspace_id, conversation_id, payload, occurred_at, delivered_at)
         VALUES ($1, $2, 1, $3, $4, $5::jsonb, $6, $7)`,
        [
          event.eventId,
          event.type,
          message.senderWorkspaceId,
          message.conversationId,
          JSON.stringify(event.payload),
          message.createdAt,
          this.wasEventBroadcast(event.eventId) ? new Date().toISOString() : null,
        ]
      );
    });

    persistInMemory();
  }

  /** Canonical lookup used when an idempotency race hits the DB unique constraint. */
  async findByIdempotencyKey(senderWorkspaceId: string, idempotencyKey: string): Promise<MessageEnvelope | null> {
    if (this.db) {
      const result = await this.db.query(
        'SELECT * FROM message_envelopes WHERE sender_workspace_id = $1 AND idempotency_key = $2',
        [senderWorkspaceId, idempotencyKey]
      );
      if (result.rows.length > 0) return this.hydrateMessageRow(result.rows[0]);
    }
    return this.idempotency.get(idempotencyKey) ?? null;
  }

  /** Spec 10 — edits are server-canonical and mirrored to the durable store. */
  async editMessageDurable(message: MessageEnvelope, body: string): Promise<void> {
    message.body = body;
    message.isEdited = true;
    message.editedAt = new Date().toISOString();
    if (this.db) {
      await this.db.query(
        `UPDATE message_envelopes SET body = $2, is_edited = TRUE, edited_at = $3 WHERE id = $1`,
        [message.id, body, message.editedAt]
      );
    }
  }

  /** Spec 02/08 — delete-for-everyone is a soft tombstone, not a silent vanish. */
  async softDeleteMessageDurable(message: MessageEnvelope): Promise<void> {
    message.isDeleted = true;
    if (this.db) {
      await this.db.query('UPDATE message_envelopes SET is_deleted = TRUE WHERE id = $1', [message.id]);
    }
    // Record hashed tombstone for restore suppression (Spec 41)
    const tombstone = this.tombstoneLedger.recordTombstone(
      'message',
      message.id,
      message.senderWorkspaceId,
      'user_delete'
    );
    await this.persistTombstone(tombstone);
  }

  /** Escape hatch for route-level write-through SQL (no-op when running without a DB). */
  async sql(query: string, params: unknown[] = []): Promise<{ rows: Record<string, unknown>[] }> {
    if (!this.db) return { rows: [] };
    return this.db.query(query, params);
  }

  // ---- Durable write-through helpers (Spec 10: DB is authoritative when configured) ----

  async persistAccount(account: UserAccount): Promise<void> {
    await this.sql(
      `INSERT INTO user_accounts (id, email, display_name, avatar_url, status, created_at, deletion_requested_at)
       VALUES ($1, $2, $3, $4, $5, $6, $7)
       ON CONFLICT (id) DO UPDATE SET
         email = EXCLUDED.email, display_name = EXCLUDED.display_name,
         avatar_url = EXCLUDED.avatar_url, status = EXCLUDED.status`,
      [
        account.id,
        account.email ?? null,
        account.displayName,
        account.avatarUrl ?? null,
        account.status,
        account.createdAt,
        account.deletionRequestedAt ?? null,
      ]
    );
  }

  async persistWorkspace(workspace: IdentityWorkspace): Promise<void> {
    await this.sql(
      `INSERT INTO identity_workspaces (
         id, owner_account_id, type, display_name, handle, avatar_url, bio, color_cue,
         category, business_hours, website, is_verified, status, created_at
       ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14)
       ON CONFLICT (id) DO UPDATE SET
         display_name = EXCLUDED.display_name, handle = EXCLUDED.handle,
         avatar_url = EXCLUDED.avatar_url, bio = EXCLUDED.bio, color_cue = EXCLUDED.color_cue,
         category = EXCLUDED.category, business_hours = EXCLUDED.business_hours,
         website = EXCLUDED.website, is_verified = EXCLUDED.is_verified, status = EXCLUDED.status`,
      [
        workspace.id,
        workspace.ownerAccountId,
        workspace.type,
        workspace.displayName,
        workspace.handle,
        workspace.avatarUrl ?? null,
        workspace.bio ?? null,
        workspace.colorCue ?? null,
        workspace.category ?? null,
        workspace.businessHours ?? null,
        workspace.website ?? null,
        workspace.isVerified ?? false,
        workspace.status,
        workspace.createdAt,
      ]
    );
  }

  async persistMembership(membership: WorkspaceMembership): Promise<void> {
    await this.sql(
      `INSERT INTO workspace_memberships (id, workspace_id, account_id, role, status, joined_at)
       VALUES ($1,$2,$3,$4,$5,$6)
       ON CONFLICT (workspace_id, account_id) DO UPDATE SET role = EXCLUDED.role, status = EXCLUDED.status`,
      [
        membership.id,
        membership.workspaceId,
        membership.accountId,
        membership.role,
        membership.status,
        membership.joinedAt,
      ]
    );
  }

  async persistConversation(
    conversation: Conversation,
    participants: Conversation['participants']
  ): Promise<void> {
    if (!this.db) return;
    await this.db.transaction(async (tx) => {
      await tx.query(
        `INSERT INTO conversations (
           id, workspace_id, kind, title, parent_conversation_id, source_message_id,
           intent_mode, intent, studio_settings, retention_days, unread_count, is_pinned,
           is_muted, is_archived, is_e2ee, membership_approval_required,
           assignee_user_id, assigned_at,
           last_message_snippet, last_message_at, created_at, updated_at
         ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9::jsonb,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19,$20,$21,$22)
         ON CONFLICT (id) DO UPDATE SET
           title = EXCLUDED.title, updated_at = EXCLUDED.updated_at,
           assignee_user_id = EXCLUDED.assignee_user_id, assigned_at = EXCLUDED.assigned_at,
           intent = EXCLUDED.intent`,
        [
          conversation.id,
          conversation.workspaceId,
          conversation.kind,
          conversation.title ?? null,
          conversation.parentConversationId ?? null,
          conversation.sourceMessageId ?? null,
          conversation.intentMode ?? 'standard',
          conversation.intent ?? null,
          conversation.studioSettings ? JSON.stringify(conversation.studioSettings) : null,
          conversation.retentionDays ?? null,
          conversation.unreadCount ?? 0,
          conversation.isPinned,
          conversation.isMuted,
          conversation.isArchived,
          conversation.isE2EE,
          conversation.membershipApprovalRequired ?? false,
          conversation.assigneeUserId ?? null,
          conversation.assignedAt ?? null,
          conversation.lastMessageSnippet ?? null,
          conversation.lastMessageAt ?? null,
          conversation.createdAt,
          conversation.updatedAt,
        ]
      );
      for (const participant of participants) {
        await tx.query(
          `INSERT INTO conversation_participants (
             id, conversation_id, workspace_id, display_name, handle, avatar_url, role, joined_at
           ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8)
           ON CONFLICT (conversation_id, workspace_id) DO NOTHING`,
          [
            `cp-${conversation.id}-${participant.workspaceId}`,
            conversation.id,
            participant.workspaceId,
            participant.displayName,
            participant.handle,
            participant.avatarUrl ?? null,
            participant.role,
            participant.joinedAt,
          ]
        );
      }
    });
  }

  /** Spec 07/11 — internal notes persist only in their own table, never in message_envelopes. */
  async persistInternalNote(note: BusinessInternalNote): Promise<void> {
    await this.sql(
      `INSERT INTO business_internal_notes (
         id, conversation_id, workspace_id, author_workspace_id,
         author_name, author_avatar_url, body, resource_type, created_at
       ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9)
       ON CONFLICT (id) DO NOTHING`,
      [
        note.id,
        note.conversationId,
        note.workspaceId,
        note.authorWorkspaceId,
        note.authorName,
        note.authorAvatarUrl ?? null,
        note.body,
        note.resourceType ?? 'business_internal_note',
        note.createdAt,
      ]
    );
  }

  async persistVaultCollection(collection: VaultCollection): Promise<void> {
    await this.sql(
      `INSERT INTO vault_collections (id, workspace_id, name, description, icon, visibility, item_count, created_at)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8)
       ON CONFLICT (id) DO UPDATE SET name = EXCLUDED.name, visibility = EXCLUDED.visibility,
         item_count = EXCLUDED.item_count`,
      [
        collection.id,
        collection.workspaceId,
        collection.name,
        collection.description ?? null,
        collection.icon ?? 'folder',
        collection.visibility,
        collection.itemCount ?? 0,
        collection.createdAt,
      ]
    );
  }

  async persistVaultItem(item: VaultItem): Promise<void> {
    await this.sql(
      `INSERT INTO vault_items (
         id, collection_id, workspace_id, item_type, source_conversation_id,
         source_conversation_title, source_message_id, author_name, title, content,
         tags, user_note, reminder_at, saved_at
       ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11::jsonb,$12,$13,$14)
       ON CONFLICT (id) DO NOTHING`,
      [
        item.id,
        item.collectionId,
        item.workspaceId,
        item.itemType ?? 'message',
        item.sourceConversationId ?? null,
        item.sourceConversationTitle ?? null,
        item.sourceMessageId ?? null,
        item.authorName ?? null,
        item.title ?? null,
        item.content,
        JSON.stringify(item.tags ?? []),
        item.userNote ?? null,
        item.reminderAt ?? null,
        item.savedAt,
      ]
    );
  }

  async persistSession(session: AuthSession): Promise<void> {
    await this.sql(
      `INSERT INTO auth_sessions (
         session_id, account_id, active_workspace_id, device_label, platform,
         is_current_session, status, created_at, last_active_at
       ) VALUES ($1,$2,$3,$4,$5,$6,'active',$7,$8)
       ON CONFLICT (session_id) DO UPDATE SET
         last_active_at = EXCLUDED.last_active_at, is_current_session = EXCLUDED.is_current_session`,
      [
        session.sessionId,
        session.accountId,
        session.activeWorkspaceId,
        session.deviceLabel,
        session.platform,
        session.isCurrentSession ?? false,
        session.createdAt,
        session.lastActiveAt,
      ]
    );
  }

  async revokeSessionsDurable(sessionIds: string[]): Promise<void> {
    if (!this.db || sessionIds.length === 0) return;
    await this.db.query(
      `UPDATE auth_sessions SET status = 'revoked', revoked_at = now() WHERE session_id = ANY($1)`,
      [sessionIds]
    );
  }

  // ---- Wave 2 durable write-through helpers (Specs 21-31) ----

  async persistContactRequest(request: ContactRequest): Promise<void> {
    await this.sql(
      `INSERT INTO contact_requests (
         id, requester_id, requester_handle, requester_display_name,
         recipient_id, recipient_handle, status, intro_message, created_at, updated_at
       ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)
       ON CONFLICT (id) DO UPDATE SET status = EXCLUDED.status, updated_at = EXCLUDED.updated_at`,
      [
        request.id,
        request.requesterId,
        request.requesterHandle,
        request.requesterDisplayName,
        request.recipientId,
        request.recipientHandle,
        request.status,
        request.introMessage ?? null,
        request.createdAt,
        request.updatedAt,
      ]
    );
  }

  async persistInviteLink(invite: InviteLink): Promise<void> {
    await this.sql(
      `INSERT INTO invite_links (
         id, workspace_id, creator_id, code, url, max_uses, used_count, expires_at, revoked, created_at, conversation_id
       ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11)
       ON CONFLICT (id) DO UPDATE SET used_count = EXCLUDED.used_count, revoked = EXCLUDED.revoked, conversation_id = EXCLUDED.conversation_id`,
      [
        invite.id,
        invite.workspaceId,
        invite.creatorId,
        invite.code,
        invite.url,
        invite.maxUses,
        invite.usedCount ?? 0,
        invite.expiresAt,
        invite.revoked ?? false,
        invite.createdAt,
        invite.conversationId ?? null,
      ]
    );
  }

  async persistGroupJoinRequest(request: GroupJoinRequest): Promise<void> {
    if (!this.db) return;
    await this.sql(
      `INSERT INTO group_join_requests (
         id, conversation_id, requester_workspace_id, invite_id, status, created_at
       ) VALUES ($1,$2,$3,$4,$5,$6)
       ON CONFLICT (id) DO UPDATE SET status = EXCLUDED.status`,
      [
        request.id,
        request.conversationId,
        request.requesterWorkspaceId,
        request.inviteId,
        request.status,
        request.createdAt,
      ]
    );
  }

  async persistBusinessVerification(verification: BusinessVerification): Promise<void> {
    if (!this.db) return;
    await this.sql(
      `INSERT INTO business_verifications (
         id, workspace_id, legal_name, registration_number, website, contact_email,
         evidence_document_ids, status, submitted_at, reviewer_id, decided_at,
         decision_note, appeal_reason, created_at, updated_at
       ) VALUES ($1,$2,$3,$4,$5,$6,$7::jsonb,$8,$9,$10,$11,$12,$13,$14,$15)
       ON CONFLICT (id) DO UPDATE SET
         status = EXCLUDED.status, submitted_at = EXCLUDED.submitted_at,
         reviewer_id = EXCLUDED.reviewer_id, decided_at = EXCLUDED.decided_at,
         decision_note = EXCLUDED.decision_note, appeal_reason = EXCLUDED.appeal_reason,
         updated_at = EXCLUDED.updated_at`,
      [
        verification.id,
        verification.workspaceId,
        verification.legalName,
        verification.registrationNumber,
        verification.website ?? null,
        verification.contactEmail,
        JSON.stringify(verification.evidenceDocumentIds ?? []),
        verification.status,
        verification.submittedAt ?? null,
        verification.reviewerId ?? null,
        verification.decidedAt ?? null,
        verification.decisionNote ?? null,
        verification.appealReason ?? null,
        verification.createdAt,
        verification.updatedAt,
      ]
    );
  }

  async persistWorkspaceSettings(workspaceId: string, settings: Record<string, unknown>): Promise<void> {
    await this.sql(
      `INSERT INTO workspace_settings (workspace_id, settings, updated_at)
       VALUES ($1,$2::jsonb,$3)
       ON CONFLICT (workspace_id) DO UPDATE SET settings = EXCLUDED.settings, updated_at = EXCLUDED.updated_at`,
      [workspaceId, JSON.stringify(settings), new Date().toISOString()]
    );
  }

  async persistMediaAttachment(rec: StoredMediaAttachment): Promise<void> {
    this.mediaAttachments.set(rec.id, rec);
    await this.sql(
      `INSERT INTO media_attachments (id, workspace_id, filename, mime_type, size_bytes, stored_path, created_at)
       VALUES ($1,$2,$3,$4,$5,$6,$7)
       ON CONFLICT (id) DO NOTHING`,
      [rec.id, rec.workspaceId, rec.filename, rec.mimeType, rec.sizeBytes, rec.storedPath, rec.createdAt]
    );
  }

  /** Resolve attachment metadata from the in-memory index, falling back to SQL. */
  async getMediaAttachment(id: string): Promise<StoredMediaAttachment | null> {
    const local = this.mediaAttachments.get(id);
    if (local) return local;
    if (!this.db) return null;
    const rows = await this.sql(
      'SELECT id, workspace_id, filename, mime_type, size_bytes, stored_path, created_at FROM media_attachments WHERE id = $1',
      [id]
    );
    const row = rows.rows[0];
    if (!row) return null;
    const rec: StoredMediaAttachment = {
      id: String(row.id),
      workspaceId: row.workspace_id ? String(row.workspace_id) : '',
      filename: String(row.filename),
      mimeType: String(row.mime_type),
      sizeBytes: Number(row.size_bytes),
      storedPath: String(row.stored_path),
      createdAt: String(row.created_at),
    };
    this.mediaAttachments.set(rec.id, rec);
    return rec;
  }

  async persistBillingEntitlement(entitlement: BillingEntitlement): Promise<void> {
    await this.sql(
      `INSERT INTO billing_entitlements (
         workspace_id, plan, status, billing_owner_user_id, seats_allocated, seats_used,
         storage_quota_bytes, storage_used_bytes, max_file_size_mb, custom_themes_allowed,
         workflow_cards_allowed, audit_export_allowed, active_integrations_count,
         max_integrations_allowed, renewal_date
       ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15)
       ON CONFLICT (workspace_id) DO UPDATE SET
         plan = EXCLUDED.plan, status = EXCLUDED.status,
         seats_allocated = EXCLUDED.seats_allocated, seats_used = EXCLUDED.seats_used,
         storage_quota_bytes = EXCLUDED.storage_quota_bytes,
         storage_used_bytes = EXCLUDED.storage_used_bytes,
         max_file_size_mb = EXCLUDED.max_file_size_mb,
         custom_themes_allowed = EXCLUDED.custom_themes_allowed,
         workflow_cards_allowed = EXCLUDED.workflow_cards_allowed,
         audit_export_allowed = EXCLUDED.audit_export_allowed,
         active_integrations_count = EXCLUDED.active_integrations_count,
         max_integrations_allowed = EXCLUDED.max_integrations_allowed,
         renewal_date = EXCLUDED.renewal_date`,
      [
        entitlement.workspaceId,
        entitlement.plan,
        entitlement.status,
        entitlement.billingOwnerUserId,
        entitlement.seatsAllocated,
        entitlement.seatsUsed,
        entitlement.storageQuotaBytes,
        entitlement.storageUsedBytes,
        entitlement.maxFileSizeMB,
        entitlement.customThemesAllowed,
        entitlement.workflowCardsAllowed,
        entitlement.auditExportAllowed,
        entitlement.activeIntegrationsCount,
        entitlement.maxIntegrationsAllowed,
        entitlement.renewalDate,
      ]
    );
  }

  async persistInvoice(invoice: InvoiceRecord): Promise<void> {
    await this.sql(
      `INSERT INTO invoices (id, workspace_id, invoice_number, amount_cents, currency, date, status, description)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8)
       ON CONFLICT (id) DO NOTHING`,
      [
        invoice.id,
        invoice.workspaceId,
        invoice.invoiceNumber,
        invoice.amountCents,
        invoice.currency ?? 'USD',
        invoice.date,
        invoice.status,
        invoice.description,
      ]
    );
  }

  async persistBillingEvent(event: BillingEventRecord): Promise<void> {
    await this.sql(
      `INSERT INTO billing_events (id, workspace_id, type, plan_id, amount, currency, status, metadata, created_at)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9)
       ON CONFLICT (id) DO NOTHING`,
      [
        event.id,
        event.workspaceId,
        event.type,
        event.planId,
        event.amount,
        event.currency,
        event.status,
        JSON.stringify(event.metadata),
        event.createdAt,
      ]
    );
  }

  async persistAdminAuditLog(entry: AdminAuditLog): Promise<void> {
    await this.sql(
      `INSERT INTO admin_audit_logs (id, actor_id, actor_role, action, target_type, target_id, justification, ip_hash, timestamp)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9)
       ON CONFLICT (id) DO NOTHING`,
      [
        entry.id,
        entry.actorId,
        entry.actorRole,
        entry.action,
        entry.targetType,
        entry.targetId,
        entry.justification,
        entry.ipHash,
        entry.timestamp,
      ]
    );
  }

  async persistUserReport(report: UserReport): Promise<void> {
    await this.sql(
      `INSERT INTO user_reports (
         id, reporter_id, reporter_handle, target_user_id, target_handle,
         target_conversation_id, reason, details, status, assigned_reviewer_id,
         resolution_note, action_taken, created_at, updated_at,
         evidence_message_ids, appeal_status, appeal_reason, appealed_at
       ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15::jsonb,$16,$17,$18)
       ON CONFLICT (id) DO UPDATE SET
         status = EXCLUDED.status, assigned_reviewer_id = EXCLUDED.assigned_reviewer_id,
         resolution_note = EXCLUDED.resolution_note, action_taken = EXCLUDED.action_taken,
         updated_at = EXCLUDED.updated_at,
         evidence_message_ids = EXCLUDED.evidence_message_ids,
         appeal_status = EXCLUDED.appeal_status, appeal_reason = EXCLUDED.appeal_reason,
         appealed_at = EXCLUDED.appealed_at`,
      [
        report.id,
        report.reporterId,
        report.reporterHandle,
        report.targetUserId,
        report.targetHandle,
        report.targetConversationId ?? null,
        report.reason,
        report.details ?? null,
        report.status,
        report.assignedReviewerId ?? null,
        report.resolutionNote ?? null,
        report.actionTaken ?? 'none',
        report.createdAt,
        report.updatedAt,
        JSON.stringify(report.evidenceMessageIds ?? []),
        report.appealStatus ?? 'none',
        report.appealReason ?? null,
        report.appealedAt ?? null,
      ]
    );
  }

  async persistIntegration(manifest: IntegrationManifest): Promise<void> {
    await this.sql(
      `INSERT INTO integrations (
         id, workspace_id, name, description, icon, category, scopes, bot_identity,
         webhook_url, webhook_secret, status, installed_at, data_policy_url
       ) VALUES ($1,$2,$3,$4,$5,$6,$7::jsonb,$8::jsonb,$9,$10,$11,$12,$13)
       ON CONFLICT (id) DO UPDATE SET
         workspace_id = EXCLUDED.workspace_id, status = EXCLUDED.status,
         installed_at = EXCLUDED.installed_at, webhook_url = EXCLUDED.webhook_url,
         webhook_secret = EXCLUDED.webhook_secret`,
      [
        manifest.id,
        manifest.workspaceId ?? null,
        manifest.name,
        manifest.description,
        manifest.icon,
        manifest.category,
        JSON.stringify(manifest.scopes ?? []),
        manifest.botIdentity ? JSON.stringify(manifest.botIdentity) : null,
        manifest.webhookUrl ?? null,
        manifest.webhookSecret ?? null,
        manifest.status,
        manifest.installedAt ?? null,
        manifest.dataPolicyUrl,
      ]
    );
  }

  async persistConversationGrant(grant: {
    id: string;
    integrationId: string;
    conversationId: string;
    grantedBy: string;
    grantedAt: string;
    scopes: string[];
    botPermissions: { canJoin: boolean; canReadHistory: boolean; canSend: boolean };
  }): Promise<void> {
    await this.sql(
      `INSERT INTO conversation_module_grants (
         id, integration_id, conversation_id, granted_by, granted_at, scopes, bot_permissions
       ) VALUES ($1,$2,$3,$4,$5,$6::jsonb,$7::jsonb)
       ON CONFLICT (integration_id, conversation_id) DO UPDATE SET
         scopes = EXCLUDED.scopes, granted_at = EXCLUDED.granted_at, granted_by = EXCLUDED.granted_by,
         bot_permissions = EXCLUDED.bot_permissions`,
      [
        grant.id,
        grant.integrationId,
        grant.conversationId,
        grant.grantedBy,
        grant.grantedAt,
        JSON.stringify(grant.scopes),
        JSON.stringify(grant.botPermissions),
      ]
    );
  }

  async persistTelemetryEvent(event: PrivacyTelemetryEvent): Promise<void> {
    await this.sql(
      `INSERT INTO privacy_telemetry_events (event_id, event_name, occurred_at, actor_type, anonymized_category, client_platform)
       VALUES ($1,$2,$3,$4,$5,$6)
       ON CONFLICT (event_id) DO NOTHING`,
      [event.eventId, event.eventName, event.occurredAt, event.actorType, event.anonymizedCategory, event.clientPlatform]
    );
  }

  async persistDeviceSession(session: DeviceSession): Promise<void> {
    await this.sql(
      `INSERT INTO device_sessions (
         id, account_id, active_workspace_id, device_label, platform, ip_address_masked,
         is_current_session, is_passkey_authenticated, has_recent_step_up, step_up_expires_at,
         status, created_at, last_active_at
       ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13)
       ON CONFLICT (id) DO UPDATE SET
         has_recent_step_up = EXCLUDED.has_recent_step_up,
         step_up_expires_at = EXCLUDED.step_up_expires_at,
         status = EXCLUDED.status,
         last_active_at = EXCLUDED.last_active_at,
         is_current_session = EXCLUDED.is_current_session`,
      [
        session.id,
        session.accountId,
        session.activeWorkspaceId,
        session.deviceLabel,
        session.platform,
        session.ipAddressMasked ?? '***.***.***.***',
        session.isCurrentSession ?? false,
        session.isPasskeyAuthenticated ?? false,
        session.hasRecentStepUp ?? false,
        session.stepUpExpiresAt ?? null,
        session.status ?? 'active',
        session.createdAt,
        session.lastActiveAt,
      ]
    );
  }

  async persistKeyBundle(bundle: KeyBundle): Promise<void> {
    await this.sql(
      `INSERT INTO key_bundles (
         account_id, device_id, identity_key_pub, signed_pre_key_pub, signed_pre_key_sig,
         one_time_pre_keys, registration_id, created_at
       ) VALUES ($1,$2,$3,$4,$5,$6::jsonb,$7,$8)
       ON CONFLICT (account_id) DO UPDATE SET
         device_id = EXCLUDED.device_id, identity_key_pub = EXCLUDED.identity_key_pub,
         signed_pre_key_pub = EXCLUDED.signed_pre_key_pub, signed_pre_key_sig = EXCLUDED.signed_pre_key_sig,
         one_time_pre_keys = EXCLUDED.one_time_pre_keys, registration_id = EXCLUDED.registration_id`,
      [
        bundle.accountId,
        bundle.deviceId,
        bundle.identityKeyPub,
        bundle.signedPreKeyPub,
        bundle.signedPreKeySig,
        JSON.stringify(bundle.oneTimePreKeys ?? []),
        bundle.registrationId,
        bundle.createdAt,
      ]
    );
  }

  async persistKeyVerification(record: KeyVerificationRecord): Promise<void> {
    await this.sql(
      `INSERT INTO key_verifications (
         contact_account_id, contact_identity_key_pub, safety_number, status, verified_at, previous_identity_key_pub
       ) VALUES ($1,$2,$3,$4,$5,$6)
       ON CONFLICT (contact_account_id) DO UPDATE SET
         contact_identity_key_pub = EXCLUDED.contact_identity_key_pub,
         safety_number = EXCLUDED.safety_number, status = EXCLUDED.status,
         verified_at = EXCLUDED.verified_at, previous_identity_key_pub = EXCLUDED.previous_identity_key_pub`,
      [
        record.contactAccountId,
        record.contactIdentityKeyPub,
        record.safetyNumber,
        record.status,
        record.verifiedAt ?? null,
        record.previousIdentityKeyPub ?? null,
      ]
    );
  }

  // ---- Wave 3 durable write-through helpers (Specs 25-26, 37, 41) ----

  async persistWorkflowCard(card: WorkflowCard): Promise<void> {
    await this.sql(
      `INSERT INTO workflow_cards (
         id, conversation_id, creator_workspace_id, creator_name, card_type, title,
         description, status, assignee_workspace_id, assignee_name, due_date,
         options, history, created_at, updated_at
       ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12::jsonb,$13::jsonb,$14,$15)
       ON CONFLICT (id) DO UPDATE SET
         status = EXCLUDED.status, assignee_workspace_id = EXCLUDED.assignee_workspace_id,
         assignee_name = EXCLUDED.assignee_name, options = EXCLUDED.options,
         history = EXCLUDED.history, updated_at = EXCLUDED.updated_at`,
      [
        card.id,
        card.conversationId,
        card.creatorWorkspaceId,
        card.creatorName,
        card.cardType,
        card.title,
        card.description ?? null,
        card.status,
        card.assigneeWorkspaceId ?? null,
        card.assigneeName ?? null,
        card.dueDate ?? null,
        JSON.stringify(card.options ?? []),
        JSON.stringify(card.history ?? []),
        card.createdAt,
        card.updatedAt,
      ]
    );
  }

  async persistWorkspaceInvitation(invitation: WorkspaceInvitation): Promise<void> {
    await this.sql(
      `INSERT INTO workspace_invitations (
         id, workspace_id, email, role, token, status, invited_by_account_id, created_at, accepted_at, accepted_account_id
       ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)
       ON CONFLICT (id) DO UPDATE SET
         status = EXCLUDED.status, accepted_at = EXCLUDED.accepted_at,
         accepted_account_id = EXCLUDED.accepted_account_id`,
      [
        invitation.id,
        invitation.workspaceId,
        invitation.email,
        invitation.role,
        invitation.token,
        invitation.status,
        invitation.invitedByAccountId,
        invitation.createdAt,
        invitation.acceptedAt ?? null,
        invitation.acceptedAccountId ?? null,
      ]
    );
  }

  async persistSavedReply(reply: SavedReply): Promise<void> {
    await this.sql(
      `INSERT INTO saved_replies (id, workspace_id, shortcut, title, body, team_id, created_at, updated_at)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8)
       ON CONFLICT (id) DO UPDATE SET
         shortcut = EXCLUDED.shortcut, title = EXCLUDED.title, body = EXCLUDED.body,
         team_id = EXCLUDED.team_id, updated_at = EXCLUDED.updated_at`,
      [
        reply.id,
        reply.workspaceId,
        reply.shortcut ?? null,
        reply.title,
        reply.body,
        reply.teamId ?? null,
        reply.createdAt ?? reply.updatedAt ?? new Date().toISOString(),
        reply.updatedAt ?? new Date().toISOString(),
      ]
    );
  }

  async persistConversationVault(settings: ConversationVaultSettings): Promise<void> {
    await this.sql(
      `INSERT INTO conversation_vault_settings (conversation_id, workspace_id, visibility, member_ids, updated_at)
       VALUES ($1,$2,$3,$4::jsonb,$5)
       ON CONFLICT (conversation_id) DO UPDATE SET
         visibility = EXCLUDED.visibility, member_ids = EXCLUDED.member_ids,
         updated_at = EXCLUDED.updated_at`,
      [
        settings.conversationId,
        settings.workspaceId,
        settings.visibility,
        JSON.stringify(settings.memberIds ?? []),
        settings.updatedAt,
      ]
    );
  }

  async persistTombstone(tombstone: DeletionTombstone): Promise<void> {
    await this.sql(
      `INSERT INTO deletion_tombstones (tombstone_id, target_type, target_id_hash, workspace_id, deleted_at, reason, tombstone_hash)
       VALUES ($1,$2,$3,$4,$5,$6,$7)
       ON CONFLICT (target_id_hash) DO NOTHING`,
      [
        tombstone.tombstoneId,
        tombstone.targetType,
        tombstone.targetIdHash,
        tombstone.workspaceId,
        tombstone.deletedAt,
        tombstone.reason,
        tombstone.tombstoneHash,
      ]
    );
  }

  // Trust & Safety persistence (Spec 23)
  async persistSpamSignal(signal: SpamSignal): Promise<void> {
    await this.sql(
      `INSERT INTO spam_signals (id, workspace_id, conversation_id, signal_type, confidence, evidence, created_at)
       VALUES ($1,$2,$3,$4,$5,$6::jsonb,$7)
       ON CONFLICT (id) DO NOTHING`,
      [signal.id, signal.workspaceId, signal.conversationId ?? null, signal.signalType, signal.confidence, JSON.stringify(signal.evidence), signal.createdAt]
    );
  }

  async persistUrgentSafetyCase(case_: UrgentSafetyCase): Promise<void> {
    await this.sql(
      `INSERT INTO urgent_safety_cases (id, workspace_id, reporter_id, severity, description, assigned_reviewer, status, created_at, resolved_at)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9)
       ON CONFLICT (id) DO UPDATE SET
         assigned_reviewer = EXCLUDED.assigned_reviewer, status = EXCLUDED.status, resolved_at = EXCLUDED.resolved_at`,
      [case_.id, case_.workspaceId, case_.reporterId, case_.severity, case_.description, case_.assignedReviewer ?? null, case_.status, case_.createdAt, case_.resolvedAt ?? null]
    );
  }

  async persistAccessGrant(grant: AccessGrant): Promise<void> {
    await this.sql(
      `INSERT INTO access_grants (id, target_workspace_id, granted_by_user_id, approver_user_id, purpose, capability, duration_minutes, status, created_at, expires_at, revoked_at, revoked_by, case_id)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13)
       ON CONFLICT (id) DO UPDATE SET
         status = EXCLUDED.status, revoked_at = EXCLUDED.revoked_at, revoked_by = EXCLUDED.revoked_by`,
      [grant.id, grant.targetWorkspaceId, grant.grantedByUserId, grant.approverUserId, grant.purpose, grant.capability, grant.durationMinutes, grant.status, grant.createdAt, grant.expiresAt, grant.revokedAt ?? null, grant.revokedBy ?? null, grant.caseId ?? null]
    );
  }

  // Legal & Compliance persistence (Spec 23)
  async persistLegalDocument(doc: LegalDocument): Promise<void> {
    await this.sql(
      `INSERT INTO legal_documents (id, type, version, content_markdown, effective_at, jurisdictions, required_consent, created_at, created_by)
       VALUES ($1,$2,$3,$4,$5,$6::jsonb,$7,$8,$9)
       ON CONFLICT (id) DO NOTHING`,
      [doc.id, doc.type, doc.version, doc.contentMarkdown, doc.effectiveAt, JSON.stringify(doc.jurisdictions), doc.requiredConsent, doc.createdAt, doc.createdBy]
    );
  }

  async persistUserLegalConsent(consent: UserLegalConsent): Promise<void> {
    await this.sql(
      `INSERT INTO user_legal_consents (id, user_id, document_id, consented_at, version, ip_hash)
       VALUES ($1,$2,$3,$4,$5,$6)
       ON CONFLICT (id) DO NOTHING`,
      [consent.id, consent.userId, consent.documentId, consent.consentedAt, consent.version, consent.ipHash ?? null]
    );
  }

  async persistDataRequest(request: DataRequest): Promise<void> {
    await this.sql(
      `INSERT INTO data_requests (id, user_id, workspace_id, type, status, scope, verification_method, verified_at, deadline_at, completed_at, rejection_reason, notes, exceptions, user_notified_at, created_at, updated_at)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13::jsonb,$14,$15,$16)
       ON CONFLICT (id) DO UPDATE SET
         status = EXCLUDED.status, verified_at = EXCLUDED.verified_at, deadline_at = EXCLUDED.deadline_at,
         completed_at = EXCLUDED.completed_at, rejection_reason = EXCLUDED.rejection_reason,
         notes = EXCLUDED.notes, exceptions = EXCLUDED.exceptions, user_notified_at = EXCLUDED.user_notified_at,
         updated_at = EXCLUDED.updated_at`,
      [
        request.id, request.userId, request.workspaceId, request.type, request.status,
        request.scope ?? null, request.verificationMethod ?? null, request.verifiedAt ?? null,
        request.deadlineAt ?? null, request.completedAt ?? null, request.rejectionReason ?? null,
        request.notes ?? null, JSON.stringify(request.exceptions ?? []), request.userNotifiedAt ?? null,
        request.createdAt, request.updatedAt
      ]
    );
  }

  // Support ticket persistence (Spec 28)
  async persistSupportTicket(ticket: any): Promise<void> {
    await this.sql(
      `INSERT INTO support_tickets (id, title, description, priority, status, created_by, created_at)
       VALUES ($1,$2,$3,$4,$5,$6,$7)
       ON CONFLICT (id) DO UPDATE SET
         title = EXCLUDED.title, description = EXCLUDED.description, priority = EXCLUDED.priority,
         status = EXCLUDED.status`,
      [ticket.id, ticket.title, ticket.description, ticket.priority, ticket.status, ticket.createdBy, ticket.createdAt]
    );
  }

  async persistWorkflowSla(sla: any): Promise<void> {
    await this.sql(
      `INSERT INTO workflow_sla (id, conversation_id, sla_type, deadline, status, resolved_at, breach_count, created_at)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8)
       ON CONFLICT (id) DO UPDATE SET
         status = EXCLUDED.status, resolved_at = EXCLUDED.resolved_at, breach_count = EXCLUDED.breach_count`,
      [sla.id, sla.conversationId, sla.slaType, sla.deadline, sla.status, sla.resolvedAt ?? null, sla.breachCount ?? 0, sla.createdAt]
    );
  }

  async persistLegalHold(hold: LegalHold): Promise<void> {
    await this.sql(
      `INSERT INTO legal_holds (id, workspace_id, conversation_ids, authorized_by, reason, expires_at, status, created_at, released_at, released_by)
       VALUES ($1,$2,$3::jsonb,$4,$5,$6,$7,$8,$9,$10)
       ON CONFLICT (id) DO UPDATE SET
         status = EXCLUDED.status, released_at = EXCLUDED.released_at, released_by = EXCLUDED.released_by`,
      [hold.id, hold.workspaceId, JSON.stringify(hold.conversationIds), hold.authorizedBy, hold.reason, hold.expiresAt, hold.status, hold.createdAt, hold.releasedAt ?? null, hold.releasedBy ?? null]
    );
  }

  async persistEventRegistryEntry(entry: { definition: unknown; eventCount: number; lastSeenAt: string | null }): Promise<void> {
    const def = entry.definition as { name: string; updatedAt: string };
    await this.sql(
      `INSERT INTO event_registry (name, definition, event_count, last_seen_at, updated_at)
       VALUES ($1, $2::jsonb, $3, $4, $5)
       ON CONFLICT (name) DO UPDATE SET
         definition = EXCLUDED.definition,
         event_count = EXCLUDED.event_count,
         last_seen_at = EXCLUDED.last_seen_at,
         updated_at = EXCLUDED.updated_at`,
      [def.name, JSON.stringify(entry.definition), entry.eventCount, entry.lastSeenAt, def.updatedAt]
    );
  }

  async persistExperiment(experiment: ExperimentDefinition): Promise<void> {
    await this.sql(
      `INSERT INTO experiments (id, hypothesis, audience, audience_config, randomization_unit, primary_metric, guardrail_metrics, owner, rollback_threshold, status, start_date, end_date, created_at, updated_at)
       VALUES ($1,$2,$3,$4::jsonb,$5,$6,$7::jsonb,$8,$9::jsonb,$10,$11,$12,$13,$14)
       ON CONFLICT (id) DO UPDATE SET
         hypothesis = EXCLUDED.hypothesis, audience = EXCLUDED.audience, audience_config = EXCLUDED.audience_config,
         randomization_unit = EXCLUDED.randomization_unit, primary_metric = EXCLUDED.primary_metric,
         guardrail_metrics = EXCLUDED.guardrail_metrics, owner = EXCLUDED.owner, rollback_threshold = EXCLUDED.rollback_threshold,
         status = EXCLUDED.status, start_date = EXCLUDED.start_date, end_date = EXCLUDED.end_date, updated_at = EXCLUDED.updated_at`,
      [
        experiment.id,
        experiment.hypothesis,
        experiment.audience,
        JSON.stringify(experiment.audienceConfig),
        experiment.randomizationUnit,
        experiment.primaryMetric,
        JSON.stringify(experiment.guardrailMetrics),
        experiment.owner,
        JSON.stringify(experiment.rollbackThreshold),
        experiment.status,
        experiment.startDate ?? null,
        experiment.endDate ?? null,
        experiment.createdAt,
        experiment.updatedAt,
      ]
    );
  }

  async persistExperimentAssignment(assignment: ExperimentAssignment): Promise<void> {
    await this.sql(
      `INSERT INTO experiment_assignments (id, experiment_id, unit_id, unit_type, variant, assigned_at)
       VALUES ($1,$2,$3,$4,$5,$6)
       ON CONFLICT (experiment_id, unit_id) DO UPDATE SET
         variant = EXCLUDED.variant, assigned_at = EXCLUDED.assigned_at`,
      [assignment.id, assignment.experimentId, assignment.unitId, assignment.unitType, assignment.variant, assignment.assignedAt]
    );
  }

  async persistResearchStudy(study: ResearchStudy): Promise<void> {
    await this.sql(
      `INSERT INTO research_studies (id, title, description, tasks, target_audience, duration_minutes, compensation, status, recording_consent, recording_retention_days, created_by, created_at, updated_at)
       VALUES ($1,$2,$3,$4::jsonb,$5::jsonb,$6,$7,$8,$9,$10,$11,$12,$13)
       ON CONFLICT (id) DO UPDATE SET
         title = EXCLUDED.title, description = EXCLUDED.description, tasks = EXCLUDED.tasks,
         target_audience = EXCLUDED.target_audience, duration_minutes = EXCLUDED.duration_minutes,
         compensation = EXCLUDED.compensation, status = EXCLUDED.status, recording_consent = EXCLUDED.recording_consent,
         recording_retention_days = EXCLUDED.recording_retention_days, updated_at = EXCLUDED.updated_at`,
      [
        study.id,
        study.title,
        study.description,
        JSON.stringify(study.tasks),
        JSON.stringify(study.targetAudience),
        study.durationMinutes,
        study.compensation ?? null,
        study.status,
        study.recordingConsent,
        study.recordingRetentionDays,
        study.createdBy,
        study.createdAt,
        study.updatedAt,
      ]
    );
  }

  async persistResearchParticipant(participant: ResearchParticipant): Promise<void> {
    await this.sql(
      `INSERT INTO research_participants (id, study_id, user_id, consented_at, status, created_at)
       VALUES ($1,$2,$3,$4,$5,$6)
       ON CONFLICT (id) DO UPDATE SET
         status = EXCLUDED.status`,
      [participant.id, participant.studyId, participant.userId, participant.consentedAt, participant.status, participant.createdAt]
    );
  }

  async persistResearchPool(pool: ResearchPool): Promise<void> {
    await this.sql(
      `INSERT INTO research_pools (id, name, demographics, incentives, created_by, created_at, updated_at)
       VALUES ($1,$2,$3::jsonb,$4::jsonb,$5,$6,$7)
       ON CONFLICT (id) DO UPDATE SET
         demographics = EXCLUDED.demographics, incentives = EXCLUDED.incentives, updated_at = EXCLUDED.updated_at`,
      [pool.id, pool.name, JSON.stringify(pool.demographics), JSON.stringify(pool.incentives), pool.createdBy, pool.createdAt, pool.updatedAt]
    );
  }

  /**
   * Boot-time hydration (Spec 10: PostgreSQL is authoritative).
   * Loads durable rows into the in-memory working set so reads after a restart
   * reflect persisted state. Safe to call on an empty database (no-op).
   */
  async hydrate(): Promise<void> {
    if (!this.db) return;

    const iso = (value: unknown): string => new Date(String(value)).toISOString();

    const accounts = await this.db.query('SELECT * FROM user_accounts');
    for (const row of accounts.rows) {
      const account: UserAccount = {
        id: String(row.id),
        email: String(row.email ?? ''),
        displayName: String(row.display_name),
        avatarUrl: row.avatar_url ? String(row.avatar_url) : undefined,
        status: String(row.status) as UserAccount['status'],
        createdAt: iso(row.created_at),
        deletionRequestedAt: row.deletion_requested_at ? iso(row.deletion_requested_at) : undefined,
      };
      this.accounts.set(account.id, account);
    }

    const workspaces = await this.db.query('SELECT * FROM identity_workspaces');
    for (const row of workspaces.rows) {
      const workspace: IdentityWorkspace = {
        id: String(row.id),
        ownerAccountId: String(row.owner_account_id),
        type: String(row.type) as IdentityWorkspace['type'],
        displayName: String(row.display_name),
        handle: String(row.handle),
        avatarUrl: row.avatar_url ? String(row.avatar_url) : undefined,
        bio: row.bio ? String(row.bio) : undefined,
        colorCue: row.color_cue ? String(row.color_cue) : undefined,
        category: row.category ? String(row.category) : undefined,
        businessHours: row.business_hours ? String(row.business_hours) : undefined,
        website: row.website ? String(row.website) : undefined,
        isVerified: Boolean(row.is_verified),
        status: String(row.status) as IdentityWorkspace['status'],
        createdAt: iso(row.created_at),
      };
      this.workspaces.set(workspace.id, workspace);
    }

    const memberships = await this.db.query('SELECT * FROM workspace_memberships');
    for (const row of memberships.rows) {
      const membership: WorkspaceMembership = {
        id: String(row.id),
        workspaceId: String(row.workspace_id),
        accountId: String(row.account_id),
        role: String(row.role) as WorkspaceMembership['role'],
        status: String(row.status) as WorkspaceMembership['status'],
        joinedAt: iso(row.joined_at),
      };
      this.memberships.set(membership.id, membership);
    }

    const sessions = await this.db.query('SELECT * FROM auth_sessions WHERE status = $1', ['active']);
    for (const row of sessions.rows) {
      const session: AuthSession = {
        sessionId: String(row.session_id),
        accountId: String(row.account_id),
        activeWorkspaceId: String(row.active_workspace_id ?? ''),
        deviceLabel: String(row.device_label ?? 'Unknown device'),
        platform: String(row.platform ?? 'web') as AuthSession['platform'],
        createdAt: iso(row.created_at),
        lastActiveAt: iso(row.last_active_at),
        isCurrentSession: Boolean(row.is_current_session),
      };
      this.sessions.set(session.sessionId, session);
    }

    const conversations = await this.db.query('SELECT * FROM conversations ORDER BY created_at');
    const participants = await this.db.query('SELECT * FROM conversation_participants');
    const participantsByConversation = new Map<string, Conversation['participants']>();
    for (const row of participants.rows) {
      const conversationId = String(row.conversation_id);
      const list = participantsByConversation.get(conversationId) ?? [];
      list.push({
        workspaceId: String(row.workspace_id),
        displayName: String(row.display_name),
        handle: String(row.handle),
        avatarUrl: row.avatar_url ? String(row.avatar_url) : undefined,
        role: String(row.role) as 'member' | 'admin',
        joinedAt: iso(row.joined_at),
        isOnline: false,
      });
      participantsByConversation.set(conversationId, list);
    }
    for (const row of conversations.rows) {
      const id = String(row.id);
      const conversation: Conversation = {
        id,
        workspaceId: String(row.workspace_id),
        kind: String(row.kind) as Conversation['kind'],
        title: row.title ? String(row.title) : undefined,
        participants: participantsByConversation.get(id) ?? [],
        parentConversationId: row.parent_conversation_id ? String(row.parent_conversation_id) : null,
        sourceMessageId: row.source_message_id ? String(row.source_message_id) : null,
        intentMode: String(row.intent_mode ?? 'standard') as Conversation['intentMode'],
        studioSettings: row.studio_settings
          ? (JSON.parse(String(row.studio_settings)) as Conversation['studioSettings'])
          : undefined,
        lastMessageSnippet: row.last_message_snippet ? String(row.last_message_snippet) : undefined,
        lastMessageAt: row.last_message_at ? iso(row.last_message_at) : undefined,
        unreadCount: Number(row.unread_count ?? 0),
        isPinned: Boolean(row.is_pinned),
        isMuted: Boolean(row.is_muted),
        isArchived: Boolean(row.is_archived),
        isE2EE: Boolean(row.is_e2ee),
        retentionDays: row.retention_days != null ? Number(row.retention_days) : null,
        assigneeUserId: row.assignee_user_id ? String(row.assignee_user_id) : null,
        assignedAt: row.assigned_at ? iso(row.assigned_at) : null,
        intent: row.intent ? (String(row.intent) as Conversation['intent']) : null,
        slowModeSeconds: row.slow_mode_seconds != null ? Number(row.slow_mode_seconds) : 0,
        postingPermission: (row.posting_permission as Conversation['postingPermission']) ?? 'everyone',
        membershipApprovalRequired: Boolean(row.membership_approval_required),
        createdAt: iso(row.created_at),
        updatedAt: iso(row.updated_at),
      };
      this.conversations.set(conversation.id, conversation);
    }

    const messages = await this.db.query('SELECT * FROM message_envelopes ORDER BY created_at');
    for (const row of messages.rows) {
      const message = this.hydrateMessageRow(row);
      this.messages.set(message.id, message);
      this.idempotency.set(message.idempotencyKey, message);
    }

    const internalNotes = await this.db.query('SELECT * FROM business_internal_notes');
    for (const row of internalNotes.rows) {
      const note: BusinessInternalNote = {
        id: String(row.id),
        conversationId: String(row.conversation_id),
        workspaceId: String(row.workspace_id),
        authorWorkspaceId: String(row.author_workspace_id),
        authorName: String(row.author_name),
        authorAvatarUrl: row.author_avatar_url ? String(row.author_avatar_url) : undefined,
        body: String(row.body),
        createdAt: iso(row.created_at),
        resourceType: 'business_internal_note',
      };
      this.internalNotes.set(note.id, note);
    }

    const vaultCollections = await this.db.query('SELECT * FROM vault_collections');
    for (const row of vaultCollections.rows) {
      const collection: VaultCollection = {
        id: String(row.id),
        workspaceId: String(row.workspace_id),
        name: String(row.name),
        description: row.description ? String(row.description) : undefined,
        icon: String(row.icon ?? 'folder'),
        visibility: String(row.visibility) as VaultCollection['visibility'],
        itemCount: Number(row.item_count ?? 0),
        createdAt: iso(row.created_at),
      };
      this.vaultCollections.set(collection.id, collection);
    }

    const vaultItems = await this.db.query('SELECT * FROM vault_items');
    for (const row of vaultItems.rows) {
      const item: VaultItem = {
        id: String(row.id),
        collectionId: String(row.collection_id),
        workspaceId: String(row.workspace_id),
        itemType: String(row.item_type ?? 'message') as VaultItem['itemType'],
        sourceConversationId: row.source_conversation_id
          ? String(row.source_conversation_id)
          : undefined,
        sourceConversationTitle: row.source_conversation_title
          ? String(row.source_conversation_title)
          : undefined,
        sourceMessageId: row.source_message_id ? String(row.source_message_id) : undefined,
        authorName: row.author_name ? String(row.author_name) : undefined,
        title: row.title ? String(row.title) : undefined,
        content: String(row.content),
        tags: (row.tags as string[]) ?? [],
        userNote: row.user_note ? String(row.user_note) : undefined,
        reminderAt: row.reminder_at ? iso(row.reminder_at) : undefined,
        savedAt: iso(row.saved_at),
      };
      this.vaultItems.set(item.id, item);
    }

    // ---- Wave 2 hydration (Specs 21-31) ----

    const contactRequests = await this.db.query('SELECT * FROM contact_requests');
    for (const row of contactRequests.rows) {
      const request: ContactRequest = {
        id: String(row.id),
        requesterId: String(row.requester_id),
        requesterHandle: String(row.requester_handle),
        requesterDisplayName: String(row.requester_display_name),
        recipientId: String(row.recipient_id),
        recipientHandle: String(row.recipient_handle),
        status: String(row.status) as ContactRequest['status'],
        introMessage: row.intro_message ? String(row.intro_message) : undefined,
        createdAt: iso(row.created_at),
        updatedAt: iso(row.updated_at),
      };
      this.contactRequests.set(request.id, request);
    }

    const inviteLinks = await this.db.query('SELECT * FROM invite_links');
    for (const row of inviteLinks.rows) {
      const invite: InviteLink = {
        id: String(row.id),
        workspaceId: String(row.workspace_id),
        creatorId: String(row.creator_id),
        code: String(row.code),
        url: String(row.url),
        maxUses: Number(row.max_uses),
        usedCount: Number(row.used_count ?? 0),
        expiresAt: iso(row.expires_at),
        revoked: Boolean(row.revoked),
        createdAt: iso(row.created_at),
        conversationId: row.conversation_id ? String(row.conversation_id) : undefined,
      };
      this.inviteLinks.set(invite.id, invite);
    }

    const joinRequests = await this.db.query('SELECT * FROM group_join_requests');
    for (const row of joinRequests.rows) {
      const request: GroupJoinRequest = {
        id: String(row.id),
        conversationId: String(row.conversation_id),
        requesterWorkspaceId: String(row.requester_workspace_id),
        inviteId: row.invite_id ? String(row.invite_id) : null,
        status: String(row.status) as GroupJoinRequest['status'],
        createdAt: iso(row.created_at),
      };
      this.groupJoinRequests.set(request.id, request);
    }

    const verifications = await this.db.query('SELECT * FROM business_verifications');
    for (const row of verifications.rows) {
      const verification: BusinessVerification = {
        id: String(row.id),
        workspaceId: String(row.workspace_id),
        legalName: String(row.legal_name),
        registrationNumber: String(row.registration_number),
        website: row.website ? String(row.website) : undefined,
        contactEmail: String(row.contact_email),
        evidenceDocumentIds: row.evidence_document_ids
          ? JSON.parse(String(row.evidence_document_ids))
          : [],
        status: String(row.status) as BusinessVerification['status'],
        submittedAt: row.submitted_at ? iso(row.submitted_at) : undefined,
        reviewerId: row.reviewer_id ? String(row.reviewer_id) : undefined,
        decidedAt: row.decided_at ? iso(row.decided_at) : undefined,
        decisionNote: row.decision_note ? String(row.decision_note) : undefined,
        appealReason: row.appeal_reason ? String(row.appeal_reason) : undefined,
        createdAt: iso(row.created_at),
        updatedAt: iso(row.updated_at),
      };
      this.businessVerifications.set(verification.id, verification);
    }

    const mediaRows = await this.db.query('SELECT * FROM media_attachments');
    for (const row of mediaRows.rows) {
      const rec: StoredMediaAttachment = {
        id: String(row.id),
        workspaceId: row.workspace_id ? String(row.workspace_id) : '',
        filename: String(row.filename),
        mimeType: String(row.mime_type),
        sizeBytes: Number(row.size_bytes),
        storedPath: String(row.stored_path),
        createdAt: iso(row.created_at),
      };
      this.mediaAttachments.set(rec.id, rec);
    }

    const billingEntitlements = await this.db.query('SELECT * FROM billing_entitlements');
    for (const row of billingEntitlements.rows) {
      const entitlement: BillingEntitlement = {
        workspaceId: String(row.workspace_id),
        plan: String(row.plan) as BillingEntitlement['plan'],
        status: String(row.status) as BillingEntitlement['status'],
        billingOwnerUserId: String(row.billing_owner_user_id),
        seatsAllocated: Number(row.seats_allocated),
        seatsUsed: Number(row.seats_used),
        storageQuotaBytes: Number(row.storage_quota_bytes),
        storageUsedBytes: Number(row.storage_used_bytes),
        maxFileSizeMB: Number(row.max_file_size_mb),
        customThemesAllowed: Boolean(row.custom_themes_allowed),
        workflowCardsAllowed: Boolean(row.workflow_cards_allowed),
        auditExportAllowed: Boolean(row.audit_export_allowed),
        activeIntegrationsCount: Number(row.active_integrations_count),
        maxIntegrationsAllowed: Number(row.max_integrations_allowed),
        renewalDate: iso(row.renewal_date),
        metadata: (row.metadata as Record<string, unknown>) ?? {},
      };
      this.billingEntitlements.set(entitlement.workspaceId, entitlement);
    }

    const invoices = await this.db.query('SELECT * FROM invoices');
    for (const row of invoices.rows) {
      const invoice: InvoiceRecord = {
        id: String(row.id),
        workspaceId: String(row.workspace_id),
        invoiceNumber: String(row.invoice_number),
        amountCents: Number(row.amount_cents),
        currency: String(row.currency ?? 'USD'),
        date: iso(row.date),
        status: String(row.status) as InvoiceRecord['status'],
        description: String(row.description),
      };
      this.invoices.set(invoice.id, invoice);
    }

    const billingEvents = await this.db.query('SELECT * FROM billing_events');
    for (const row of billingEvents.rows) {
      const event: BillingEventRecord = {
        id: String(row.id),
        workspaceId: String(row.workspace_id),
        type: String(row.type),
        planId: row.plan_id ? String(row.plan_id) : null,
        amount: Number(row.amount),
        currency: String(row.currency ?? 'USD'),
        status: String(row.status),
        metadata: row.metadata ? JSON.parse(String(row.metadata)) : {},
        createdAt: iso(row.created_at),
      };
      this.billingEvents.set(event.id, event);
    }

    const auditLogs = await this.db.query('SELECT * FROM admin_audit_logs ORDER BY timestamp');
    for (const row of auditLogs.rows) {
      this.adminAuditLogs.push({
        id: String(row.id),
        actorId: String(row.actor_id),
        actorRole: String(row.actor_role) as AdminAuditLog['actorRole'],
        action: String(row.action),
        targetType: String(row.target_type) as AdminAuditLog['targetType'],
        targetId: String(row.target_id),
        justification: String(row.justification),
        ipHash: String(row.ip_hash),
        timestamp: iso(row.timestamp),
      });
    }

    const userReports = await this.db.query('SELECT * FROM user_reports');
    for (const row of userReports.rows) {
      const report: UserReport = {
        id: String(row.id),
        reporterId: String(row.reporter_id),
        reporterHandle: String(row.reporter_handle),
        targetUserId: String(row.target_user_id),
        targetHandle: String(row.target_handle),
        targetConversationId: row.target_conversation_id ? String(row.target_conversation_id) : undefined,
        reason: String(row.reason) as UserReport['reason'],
        details: row.details ? String(row.details) : undefined,
        status: String(row.status) as UserReport['status'],
        assignedReviewerId: row.assigned_reviewer_id ? String(row.assigned_reviewer_id) : undefined,
        resolutionNote: row.resolution_note ? String(row.resolution_note) : undefined,
        actionTaken: String(row.action_taken ?? 'none') as UserReport['actionTaken'],
        evidenceMessageIds: (row.evidence_message_ids as string[]) ?? [],
        appealStatus: String(row.appeal_status ?? 'none') as UserReport['appealStatus'],
        appealReason: row.appeal_reason ? String(row.appeal_reason) : undefined,
        appealedAt: row.appealed_at ? iso(row.appealed_at) : undefined,
        createdAt: iso(row.created_at),
        updatedAt: iso(row.updated_at),
        queueType: String(row.queue_type ?? 'user_report') as UserReport['queueType'],
      };
      this.userReports.set(report.id, report);
    }

    const integrations = await this.db.query('SELECT * FROM integrations');
    for (const row of integrations.rows) {
      const manifest: IntegrationManifest = {
        id: String(row.id),
        workspaceId: row.workspace_id ? String(row.workspace_id) : undefined,
        name: String(row.name),
        description: String(row.description),
        icon: String(row.icon),
        category: String(row.category) as IntegrationManifest['category'],
        scopes: (row.scopes as IntegrationManifest['scopes']) ?? [],
        botIdentity: row.bot_identity ? JSON.parse(String(row.bot_identity)) : undefined,
        webhookUrl: row.webhook_url ? String(row.webhook_url) : undefined,
        webhookSecret: row.webhook_secret ? String(row.webhook_secret) : undefined,
        installedAt: row.installed_at ? iso(row.installed_at) : undefined,
        status: String(row.status) as IntegrationManifest['status'],
        dataPolicyUrl: String(row.data_policy_url),
      };
      this.integrations.set(manifest.id, manifest);
    }

    const telemetryEvents = await this.db.query('SELECT * FROM privacy_telemetry_events');
    for (const row of telemetryEvents.rows) {
      this.telemetryEvents.push({
        eventId: String(row.event_id),
        eventName: String(row.event_name) as PrivacyTelemetryEvent['eventName'],
        occurredAt: new Date(String(row.occurred_at)).toISOString(),
        actorType: String(row.actor_type) as PrivacyTelemetryEvent['actorType'],
        anonymizedCategory: String(row.anonymized_category),
        clientPlatform: String(row.client_platform) as PrivacyTelemetryEvent['clientPlatform'],
      });
    }

    // Trust & Safety hydration (Spec 23)
    const spamSignals = await this.db.query('SELECT * FROM spam_signals');
    for (const row of spamSignals.rows) {
      this.spamSignals.set(String(row.id), {
        id: String(row.id),
        workspaceId: String(row.workspace_id),
        conversationId: row.conversation_id ? String(row.conversation_id) : undefined,
        signalType: String(row.signal_type) as SpamSignal['signalType'],
        confidence: Number(row.confidence),
        evidence: (row.evidence as Record<string, unknown>) ?? {},
        createdAt: iso(row.created_at),
      });
    }

    const urgentSafetyCases = await this.db.query('SELECT * FROM urgent_safety_cases');
    for (const row of urgentSafetyCases.rows) {
      this.urgentSafetyCases.set(String(row.id), {
        id: String(row.id),
        workspaceId: String(row.workspace_id),
        reporterId: String(row.reporter_id),
        severity: String(row.severity) as UrgentSafetyCase['severity'],
        description: String(row.description),
        assignedReviewer: row.assigned_reviewer ? String(row.assigned_reviewer) : undefined,
        status: String(row.status) as UrgentSafetyCase['status'],
        createdAt: iso(row.created_at),
        resolvedAt: row.resolved_at ? iso(row.resolved_at) : undefined,
      });
    }

    const accessGrants = await this.db.query('SELECT * FROM access_grants');
    for (const row of accessGrants.rows) {
      this.accessGrants.set(String(row.id), {
        id: String(row.id),
        targetWorkspaceId: String(row.target_workspace_id),
        grantedByUserId: String(row.granted_by_user_id),
        approverUserId: String(row.approver_user_id),
        purpose: String(row.purpose),
        capability: String(row.capability) as AccessGrant['capability'],
        durationMinutes: Number(row.duration_minutes),
        status: String(row.status) as AccessGrant['status'],
        createdAt: iso(row.created_at),
        expiresAt: iso(row.expires_at),
        revokedAt: row.revoked_at ? iso(row.revoked_at) : undefined,
        revokedBy: row.revoked_by ? String(row.revoked_by) : undefined,
        caseId: row.case_id ? String(row.case_id) : undefined,
      });
    }

    // Legal & Compliance hydration (Spec 23)
    const legalDocuments = await this.db.query('SELECT * FROM legal_documents');
    for (const row of legalDocuments.rows) {
      this.legalDocuments.set(String(row.id), {
        id: String(row.id),
        type: String(row.type) as LegalDocument['type'],
        version: String(row.version),
        contentMarkdown: String(row.content_markdown),
        effectiveAt: iso(row.effective_at),
        jurisdictions: (row.jurisdictions as string[]) ?? [],
        requiredConsent: Boolean(row.required_consent),
        createdAt: iso(row.created_at),
        createdBy: String(row.created_by),
      });
    }

    const userLegalConsents = await this.db.query('SELECT * FROM user_legal_consents');
    for (const row of userLegalConsents.rows) {
      this.userLegalConsents.set(String(row.id), {
        id: String(row.id),
        userId: String(row.user_id),
        documentId: String(row.document_id),
        consentedAt: iso(row.consented_at),
        version: String(row.version),
        ipHash: row.ip_hash ? String(row.ip_hash) : undefined,
      });
    }

    const dataRequests = await this.db.query('SELECT * FROM data_requests');
    for (const row of dataRequests.rows) {
      this.dataRequests.set(String(row.id), {
        id: String(row.id),
        userId: String(row.user_id),
        workspaceId: String(row.workspace_id),
        type: String(row.type) as DataRequest['type'],
        status: String(row.status) as DataRequest['status'],
        scope: row.scope ? String(row.scope) : undefined,
        verificationMethod: row.verification_method ? (String(row.verification_method) as any) : undefined,
        verifiedAt: row.verified_at ? iso(row.verified_at) : undefined,
        deadlineAt: row.deadline_at ? iso(row.deadline_at) : undefined,
        completedAt: row.completed_at ? iso(row.completed_at) : undefined,
        rejectionReason: row.rejection_reason ? String(row.rejection_reason) : undefined,
        notes: row.notes ? String(row.notes) : undefined,
        exceptions: (row.exceptions as string[]) ?? [],
        userNotifiedAt: row.user_notified_at ? iso(row.user_notified_at) : undefined,
        createdAt: iso(row.created_at),
        updatedAt: iso(row.updated_at),
      });
    }

    const legalHolds = await this.db.query('SELECT * FROM legal_holds');
    for (const row of legalHolds.rows) {
      this.legalHolds.set(String(row.id), {
        id: String(row.id),
        workspaceId: String(row.workspace_id),
        conversationIds: (row.conversation_ids as string[]) ?? [],
        authorizedBy: String(row.authorized_by),
        reason: String(row.reason),
        expiresAt: iso(row.expires_at),
        status: String(row.status) as LegalHold['status'],
        createdAt: iso(row.created_at),
        releasedAt: row.released_at ? iso(row.released_at) : undefined,
        releasedBy: row.released_by ? String(row.released_by) : undefined,
      });
    }

    const deviceSessions = await this.db.query('SELECT * FROM device_sessions');
    for (const row of deviceSessions.rows) {
      const session: DeviceSession = {
        id: String(row.id),
        accountId: String(row.account_id),
        activeWorkspaceId: String(row.active_workspace_id),
        deviceLabel: String(row.device_label),
        platform: String(row.platform) as DeviceSession['platform'],
        ipAddressMasked: String(row.ip_address_masked),
        isCurrentSession: Boolean(row.is_current_session),
        isPasskeyAuthenticated: Boolean(row.is_passkey_authenticated),
        hasRecentStepUp: Boolean(row.has_recent_step_up),
        stepUpExpiresAt: row.step_up_expires_at ? iso(row.step_up_expires_at) : null,
        createdAt: iso(row.created_at),
        lastActiveAt: iso(row.last_active_at),
        status: String(row.status) as DeviceSession['status'],
      };
      this.deviceSessions.set(session.id, session);
    }

    const keyBundles = await this.db.query('SELECT * FROM key_bundles');
    for (const row of keyBundles.rows) {
      const bundle: KeyBundle = {
        accountId: String(row.account_id),
        deviceId: String(row.device_id),
        identityKeyPub: String(row.identity_key_pub),
        signedPreKeyPub: String(row.signed_pre_key_pub),
        signedPreKeySig: String(row.signed_pre_key_sig),
        oneTimePreKeys: (row.one_time_pre_keys as string[]) ?? [],
        registrationId: Number(row.registration_id),
        createdAt: iso(row.created_at),
      };
      this.keyBundles.set(bundle.accountId, bundle);
    }

    const keyVerifications = await this.db.query('SELECT * FROM key_verifications');
    for (const row of keyVerifications.rows) {
      const record: KeyVerificationRecord = {
        contactAccountId: String(row.contact_account_id),
        contactIdentityKeyPub: String(row.contact_identity_key_pub),
        safetyNumber: String(row.safety_number),
        status: String(row.status) as KeyVerificationRecord['status'],
        verifiedAt: row.verified_at ? iso(row.verified_at) : null,
        previousIdentityKeyPub: row.previous_identity_key_pub ? String(row.previous_identity_key_pub) : null,
      };
      this.keyVerifications.set(record.contactAccountId, record);
    }

    // ---- Wave 3 hydration (Specs 25-26, 37, 41) ----

    const workflowCards = await this.db.query('SELECT * FROM workflow_cards');
    for (const row of workflowCards.rows) {
      const card: WorkflowCard = {
        id: String(row.id),
        conversationId: String(row.conversation_id),
        creatorWorkspaceId: String(row.creator_workspace_id),
        creatorName: String(row.creator_name),
        cardType: String(row.card_type) as WorkflowCard['cardType'],
        title: String(row.title),
        description: row.description ? String(row.description) : undefined,
        status: String(row.status) as WorkflowCard['status'],
        assigneeWorkspaceId: row.assignee_workspace_id ? String(row.assignee_workspace_id) : null,
        assigneeName: row.assignee_name ? String(row.assignee_name) : undefined,
        dueDate: row.due_date ? iso(row.due_date) : null,
        options: (row.options as WorkflowCard['options']) ?? [],
        history: (row.history as WorkflowCard['history']) ?? [],
        createdAt: iso(row.created_at),
        updatedAt: iso(row.updated_at),
      };
      this.workflowCards.set(card.id, card);
    }

    // ---- Wave B hydration (invitations, saved replies, conversation vault) ----

    const invitationRows = await this.db.query('SELECT * FROM workspace_invitations');
    for (const row of invitationRows.rows) {
      const invitation: WorkspaceInvitation = {
        id: String(row.id),
        workspaceId: String(row.workspace_id),
        email: String(row.email),
        role: String(row.role) as WorkspaceInvitation['role'],
        token: String(row.token),
        status: String(row.status) as WorkspaceInvitation['status'],
        invitedByAccountId: String(row.invited_by_account_id),
        createdAt: iso(row.created_at),
        acceptedAt: row.accepted_at ? iso(row.accepted_at) : null,
        acceptedAccountId: row.accepted_account_id ? String(row.accepted_account_id) : null,
      };
      this.invitations.set(invitation.id, invitation);
    }

    const savedReplyRows = await this.db.query('SELECT * FROM saved_replies');
    for (const row of savedReplyRows.rows) {
      const reply: SavedReply = {
        id: String(row.id),
        workspaceId: String(row.workspace_id),
        shortcut: row.shortcut ? String(row.shortcut) : undefined,
        title: String(row.title),
        body: String(row.body),
        teamId: row.team_id ? String(row.team_id) : null,
        createdAt: iso(row.created_at),
        updatedAt: iso(row.updated_at),
      };
      this.savedReplies.set(reply.id, reply);
    }

    const vaultSettingsRows = await this.db.query('SELECT * FROM conversation_vault_settings');
    for (const row of vaultSettingsRows.rows) {
      const settings: ConversationVaultSettings = {
        conversationId: String(row.conversation_id),
        workspaceId: String(row.workspace_id),
        visibility: String(row.visibility) as ConversationVaultSettings['visibility'],
        memberIds: (row.member_ids as string[]) ?? [],
        updatedAt: iso(row.updated_at),
      };
      this.conversationVault.set(settings.conversationId, settings);
    }

    const tombstoneRows = await this.db.query('SELECT * FROM deletion_tombstones');
    const tombstones: DeletionTombstone[] = tombstoneRows.rows.map((row) => ({
      tombstoneId: String(row.tombstone_id),
      targetType: String(row.target_type) as DeletionTombstone['targetType'],
      targetIdHash: String(row.target_id_hash),
      workspaceId: String(row.workspace_id),
      deletedAt: iso(row.deleted_at),
      reason: String(row.reason) as DeletionTombstone['reason'],
      tombstoneHash: String(row.tombstone_hash),
    }));
    this.tombstoneLedger.hydrate(tombstones);

    // Spec 14 — blocks survive restart
    const blockRows = await this.db.query('SELECT * FROM blocked_workspaces');
    for (const row of blockRows.rows) {
      const entry: BlockEntry = {
        id: String(row.id),
        workspaceId: String(row.workspace_id),
        blockedWorkspaceId: String(row.blocked_workspace_id),
        createdAt: iso(row.created_at),
      };
      this.blocks.set(`${entry.workspaceId}:${entry.blockedWorkspaceId}`, entry);
    }

    // Spec 09/14 — persisted workspace settings survive restart
    const settingsRows = await this.db.query('SELECT * FROM workspace_settings');
    for (const row of settingsRows.rows) {
      this.workspaceSettings.set(String(row.workspace_id), (row.settings as Record<string, unknown>) ?? {});
    }

    // Spec 10 — undelivered outbox rows re-enter the replay window and the delivery worker
    const outboxRows = await this.db.query(
      `SELECT cursor, event_id, type, schema_version, workspace_id, conversation_id, payload, occurred_at
         FROM realtime_outbox WHERE delivered_at IS NULL ORDER BY cursor`
    );
    for (const row of outboxRows.rows) {
      const cursorNum = Number(row.cursor);
      if (cursorNum >= this.eventSequence) this.eventSequence = cursorNum + 1;
      this.outboxEvents.push({
        eventId: String(row.event_id),
        type: String(row.type),
        schemaVersion: Number(row.schema_version),
        workspaceId: String(row.workspace_id),
        conversationId: row.conversation_id ? String(row.conversation_id) : undefined,
        cursor: String(row.cursor),
        occurredAt: new Date(String(row.occurred_at)).toISOString(),
        payload: row.payload as Record<string, any>,
      });
    }
    if (this.outboxEvents.length > 1000) {
      this.outboxEvents.splice(0, this.outboxEvents.length - 1000);
    }
  }

  private snippet(body: string | undefined, max = 80): string {
    if (!body) return '';
    return body.length > max ? `${body.slice(0, max - 1)}…` : body;
  }

  private hydrateMessageRow(row: Record<string, unknown>): MessageEnvelope {
    return {
      id: String(row.id),
      conversationId: String(row.conversation_id),
      senderWorkspaceId: String(row.sender_workspace_id),
      senderName: row.sender_name != null ? String(row.sender_name) : '',
      idempotencyKey: String(row.idempotency_key),
      clientMessageId: row.client_message_id != null ? String(row.client_message_id) : '',
      contentType: String(row.content_type) as MessageEnvelope['contentType'],
      body: row.body != null ? String(row.body) : '',
      attachments: (row.attachments as MessageEnvelope['attachments']) ?? [],
      deliveryState: String(row.delivery_state) as MessageEnvelope['deliveryState'],
      reactions: (row.reactions as MessageEnvelope['reactions']) ?? [],
      replyToMessageId: row.reply_to_message_id ? String(row.reply_to_message_id) : undefined,
      replyToSnippet: row.reply_to_snippet ? String(row.reply_to_snippet) : undefined,
      replyToSenderName: row.reply_to_sender_name ? String(row.reply_to_sender_name) : undefined,
      branchId: row.branch_id ? String(row.branch_id) : undefined,
      isEdited: Boolean(row.is_edited),
      editedAt: row.edited_at ? String(row.edited_at) : undefined,
      isDeleted: Boolean(row.is_deleted),
      deletedFor: Array.isArray(row.deleted_for) ? (row.deleted_for as string[]) : undefined,
      isEncrypted: Boolean(row.is_encrypted),
      serverSequence: row.server_sequence != null ? Number(row.server_sequence) : undefined,
      createdAt: new Date(String(row.created_at)).toISOString(),
    };
  }

  isBlockedEitherWay(workspaceA: string, workspaceB: string): boolean {
    return this.blocks.has(`${workspaceA}:${workspaceB}`) || this.blocks.has(`${workspaceB}:${workspaceA}`);
  }

  /** Spec 14 — true when the two workspaces' owners share an accepted contact request. */
  hasAcceptedContact(workspaceA: string, workspaceB: string): boolean {
    const ownerA = this.workspaces.get(workspaceA)?.ownerAccountId;
    const ownerB = this.workspaces.get(workspaceB)?.ownerAccountId;
    if (!ownerA || !ownerB) return false;
    for (const cr of this.contactRequests.values()) {
      if (cr.status !== 'accepted') continue;
      const pair =
        (cr.requesterId === ownerA && cr.recipientId === ownerB) ||
        (cr.requesterId === ownerB && cr.recipientId === ownerA);
      if (pair) return true;
    }
    return false;
  }

  /** Spec 14 — true when the workspace has the privacy `restricted` flag enabled. */
  isWorkspaceRestricted(workspaceId: string): boolean {
    const settings = this.workspaceSettings.get(workspaceId);
    const privacy = settings?.privacy as { restricted?: boolean } | undefined;
    return Boolean(privacy?.restricted);
  }

  markEventBroadcast(eventId: string, recipients: number): void {
    this.broadcastCounts.set(eventId, recipients);
    if (this.broadcastCounts.size > 2000) {
      const oldest = this.broadcastCounts.keys().next().value;
      if (oldest !== undefined) this.broadcastCounts.delete(oldest);
    }
  }

  wasEventBroadcast(eventId: string): boolean {
    return (this.broadcastCounts.get(eventId) ?? 0) > 0;
  }

  /**
   * Spec 10 — outbox delivery worker: fan out persisted-but-undelivered events.
   * Marks rows delivered only when at least one recipient actually received them
   * (at-least-once delivery; clients dedupe by eventId).
   */
  async flushOutbox(deliver: (event: RealtimeEvent) => number): Promise<number> {
    if (!this.db) return 0;
    const rows = await this.db.query(
      `SELECT cursor, event_id, type, schema_version, workspace_id, conversation_id, payload, occurred_at
         FROM realtime_outbox WHERE delivered_at IS NULL ORDER BY cursor`
    );
    let delivered = 0;
    for (const row of rows.rows) {
      const event: RealtimeEvent = {
        eventId: String(row.event_id),
        type: String(row.type),
        schemaVersion: Number(row.schema_version),
        workspaceId: String(row.workspace_id),
        conversationId: row.conversation_id ? String(row.conversation_id) : undefined,
        cursor: String(row.cursor),
        occurredAt: new Date(String(row.occurred_at)).toISOString(),
        payload: row.payload as Record<string, any>,
      };
      const recipients = this.wasEventBroadcast(event.eventId) ? 1 : deliver(event);
      if (recipients > 0) {
        await this.db.query('UPDATE realtime_outbox SET delivered_at = now() WHERE event_id = $1 AND delivered_at IS NULL', [
          event.eventId,
        ]);
        delivered++;
      }
    }
    return delivered;
  }

  /**
   * Wave B — allocate the next monotonic server sequence for a conversation.
   * Every message committed to a conversation receives exactly one sequence,
   * giving clients a total order even when client clocks disagree.
   */
  nextServerSequence(conversationId: string): number {
    const next = (this.conversationSequences.get(conversationId) ?? 0) + 1;
    this.conversationSequences.set(conversationId, next);
    return next;
  }

  recordEvent(workspaceId: string, conversationId: string | undefined, type: string, payload: any): RealtimeEvent {
    const cursor = (this.eventSequence++).toString();
    const event: RealtimeEvent = {
      eventId: `evt-${cursor}-${Date.now()}`,
      type,
      schemaVersion: 1,
      workspaceId,
      conversationId,
      cursor,
      occurredAt: new Date().toISOString(),
      payload,
    };
    this.outboxEvents.push(event);
    if (this.outboxEvents.length > 1000) {
      this.outboxEvents.splice(0, this.outboxEvents.length - 1000);
    }
    return event;
  }
}

export const store = new DataStore(true);
