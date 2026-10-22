/**
 * Database layer tests (Specs 10, 11, 16).
 * Runs the real SQL migrations against PGlite (in-process PostgreSQL) so schema
 * validity, constraints and the transactional message commit are verified without
 * requiring an external database server.
 */
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { PGlite } from '@electric-sql/pglite';
import type { DbClient } from './db/client.js';
import { wrapPg } from './db/client.js';
import { runMigrations } from './db/migrate.js';
import { DataStore } from './store.js';
import type { Conversation, MessageEnvelope } from '@orbit/schemas';

let db: DbClient;
let raw: PGlite;

before(async () => {
  raw = new PGlite();
  db = wrapPg(raw);
  await runMigrations(db, () => {});
});

after(async () => {
  await raw.close();
});

async function seedCoreScope(): Promise<{ accountId: string; workspaceId: string; conversationId: string }> {
  const stamp = Date.now();
  const accountId = `usr_test_${stamp}`;
  const workspaceId = `ws_test_${stamp}`;
  const conversationId = `conv_test_${stamp}`;

  await db.query('INSERT INTO user_accounts (id, email, display_name) VALUES ($1, $2, $3)', [
    accountId,
    `${accountId}@example.com`,
    'Test User',
  ]);
  await db.query(
    `INSERT INTO identity_workspaces (id, owner_account_id, type, display_name, handle)
     VALUES ($1, $2, 'personal', 'Test User', $3)`,
    [workspaceId, accountId, `handle_${stamp}`]
  );
  await db.query(
    `INSERT INTO conversations (id, workspace_id, kind, title)
     VALUES ($1, $2, 'direct', 'DB Test Chat')`,
    [conversationId, workspaceId]
  );

  return { accountId, workspaceId, conversationId };
}

test('migrations apply cleanly and re-running is a no-op (Spec 10)', async () => {
  const applied = await db.query('SELECT id, name FROM schema_migrations ORDER BY id');
  assert.ok(applied.rows.length >= 1, 'schema_migrations should record applied migrations');
  assert.equal(applied.rows[0]!.id, '0001');

  const secondRun = await runMigrations(db, () => {});
  assert.deepEqual(secondRun, [], 'second run must not re-apply migrations');
});

test('core tables from Spec 11 data model exist', async () => {
  const tables = await db.query(`
    SELECT table_name FROM information_schema.tables
    WHERE table_schema = 'public'
    ORDER BY table_name
  `);
  const names = tables.rows.map((row) => String(row.table_name));
  for (const expected of [
    'user_accounts',
    'auth_sessions',
    'identity_workspaces',
    'workspace_memberships',
    'conversations',
    'conversation_participants',
    'message_envelopes',
    'business_internal_notes',
    'vault_collections',
    'vault_items',
    'workflow_cards',
    'realtime_outbox',
    'schema_migrations',
  ]) {
    assert.ok(names.includes(expected), `missing table: ${expected}`);
  }
});

test('idempotency key is unique per sender (Spec 11 invariant)', async () => {
  const { workspaceId, conversationId } = await seedCoreScope();
  const insertMessage = (id: string) =>
    db.query(
      `INSERT INTO message_envelopes (
         id, conversation_id, sender_workspace_id, idempotency_key, content_type, body
       ) VALUES ($1, $2, $3, $4, 'text', 'hello')`,
      [id, conversationId, workspaceId, 'idem-key-1']
    );

  await insertMessage(`msg_a_${Date.now()}`);
  await assert.rejects(
    () => insertMessage(`msg_b_${Date.now()}`),
    (error: unknown) => (error as { code?: string }).code === '23505',
    'duplicate (sender, idempotency_key) must violate the unique constraint'
  );
});

test('internal notes live in a separate table and never appear in the message feed (Spec 07/11)', async () => {
  const { workspaceId, conversationId } = await seedCoreScope();

  await db.query(
    `INSERT INTO message_envelopes (id, conversation_id, sender_workspace_id, idempotency_key, content_type, body)
     VALUES ($1, $2, $3, $4, 'text', 'customer visible message')`,
    [`msg_pub_${Date.now()}`, conversationId, workspaceId, `idem_pub_${Date.now()}`]
  );
  await db.query(
    `INSERT INTO business_internal_notes (id, conversation_id, workspace_id, author_workspace_id, author_name, body)
     VALUES ($1, $2, $3, $3, 'Acme Agent', 'INTERNAL: customer is on a paid plan')`,
    [`note_${Date.now()}`, conversationId, workspaceId]
  );

  const publicFeed = await db.query(
    'SELECT body FROM message_envelopes WHERE conversation_id = $1',
    [conversationId]
  );
  assert.equal(publicFeed.rows.length, 1);
  assert.equal(publicFeed.rows[0]!.body, 'customer visible message');

  const noteCount = await db.query('SELECT COUNT(*) AS c FROM business_internal_notes WHERE conversation_id = $1', [
    conversationId,
  ]);
  assert.equal(String(noteCount.rows[0]!.c), '1', 'note must exist only in its own table');

  const leaked = publicFeed.rows.find((row) => String(row.body).includes('INTERNAL'));
  assert.equal(leaked, undefined, 'internal note text must never appear in message_envelopes');
});

test('foreign keys reject orphaned child rows (Spec 11 invariant)', async () => {
  const { workspaceId } = await seedCoreScope();
  await assert.rejects(
    () =>
      db.query(
        `INSERT INTO message_envelopes (id, conversation_id, sender_workspace_id, idempotency_key, content_type)
         VALUES ($1, 'conv_does_not_exist', $2, $3, 'text')`,
        [`msg_orphan_${Date.now()}`, workspaceId, `idem_orphan_${Date.now()}`]
      ),
    (error: unknown) => (error as { code?: string }).code === '23503',
    'message row must reference an existing conversation'
  );
});

test('commitOutboundMessage persists message + outbox in one transaction (Spec 10)', async () => {
  const { workspaceId, conversationId } = await seedCoreScope();
  const store = new DataStore(false);
  store.db = db;

  const workspaceRow = await db.query('SELECT * FROM identity_workspaces WHERE id = $1', [workspaceId]);
  const conversationRow = await db.query('SELECT * FROM conversations WHERE id = $1', [conversationId]);

  const conversation: Conversation = {
    id: String(conversationRow.rows[0]!.id),
    workspaceId: String(conversationRow.rows[0]!.workspace_id),
    kind: 'direct',
    title: 'DB Test Chat',
    participants: [],
    intentMode: 'standard',
    unreadCount: 0,
    isPinned: false,
    isMuted: false,
    isArchived: false,
    isE2EE: false,
    membershipApprovalRequired: false,
    createdAt: new Date(String(conversationRow.rows[0]!.created_at)).toISOString(),
    updatedAt: new Date().toISOString(),
  };

  const message: MessageEnvelope = {
    id: `msg_commit_${Date.now()}`,
    conversationId,
    senderWorkspaceId: workspaceId,
    senderName: 'Test User',
    idempotencyKey: `idem_commit_${Date.now()}`,
    clientMessageId: `client_${Date.now()}`,
    contentType: 'text',
    body: 'durable commit test',
    attachments: [],
    deliveryState: 'delivered',
    reactions: [],
    isEdited: false,
    isDeleted: false,
    isEncrypted: false,
    createdAt: new Date().toISOString(),
  };

  await store.commitOutboundMessage(message, conversation, {
    eventId: `evt_${Date.now()}`,
    type: 'message.created',
    payload: { messageId: message.id },
  });

  // Working set updated
  assert.ok(store.messages.has(message.id), 'in-memory working set should hold the message');
  assert.ok(store.idempotency.has(message.idempotencyKey));

  // Durable rows committed
  const stored = await db.query('SELECT * FROM message_envelopes WHERE id = $1', [message.id]);
  assert.equal(stored.rows.length, 1);
  assert.equal(stored.rows[0]!.body, 'durable commit test');

  const outbox = await db.query('SELECT * FROM realtime_outbox WHERE conversation_id = $1', [conversationId]);
  assert.ok(outbox.rows.length >= 1, 'outbox event must be committed with the message');

  const conv = await db.query('SELECT last_message_at FROM conversations WHERE id = $1', [conversationId]);
  assert.ok(conv.rows[0]!.last_message_at, 'conversation activity must be updated in the same commit');

  // Workspace scoping sanity: sender workspace row exists independently (tenancy)
  assert.ok(workspaceRow.rows.length === 1);

  // Duplicate idempotent retry must be rejected by the DB unique constraint
  const duplicate: MessageEnvelope = { ...message, id: `msg_commit_dup_${Date.now()}` };
  await assert.rejects(
    () =>
      store.commitOutboundMessage(duplicate, conversation, {
        eventId: `evt_dup_${Date.now()}`,
        type: 'message.created',
        payload: {},
      }),
    (error: unknown) => (error as { code?: string }).code === '23505'
  );
});

test('hydrate() restores durable rows into a fresh working set (Spec 10 restart survival)', async () => {
  const stamp = `h_${Date.now()}`;
  const writer = new DataStore(false);
  writer.db = db;

  const account = {
    id: `usr_${stamp}`,
    email: `${stamp}@example.com`,
    displayName: 'Hydrate Tester',
    status: 'active' as const,
    createdAt: new Date().toISOString(),
  };
  const workspace = {
    id: `ws_${stamp}`,
    ownerAccountId: account.id,
    type: 'personal' as const,
    displayName: 'Hydrate Tester',
    handle: `h_${stamp}`,
    isVerified: false,
    status: 'active' as const,
    createdAt: new Date().toISOString(),
  };
  const membership = {
    id: `m_${stamp}`,
    workspaceId: workspace.id,
    accountId: account.id,
    role: 'owner' as const,
    status: 'active' as const,
    joinedAt: new Date().toISOString(),
  };
  const conversation: Conversation = {
    id: `conv_${stamp}`,
    workspaceId: workspace.id,
    kind: 'direct',
    title: 'Hydration Chat',
    participants: [
      {
        workspaceId: workspace.id,
        displayName: workspace.displayName,
        handle: workspace.handle,
        role: 'admin',
        joinedAt: new Date().toISOString(),
        isOnline: false,
      },
    ],
    intentMode: 'focus',
    unreadCount: 3,
    isPinned: true,
    isMuted: false,
    isArchived: false,
    isE2EE: true,
    membershipApprovalRequired: false,
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  };

  await writer.persistAccount(account);
  await writer.persistWorkspace(workspace);
  await writer.persistMembership(membership);
  await writer.persistConversation(conversation, conversation.participants);

  const message: MessageEnvelope = {
    id: `msg_${stamp}`,
    conversationId: conversation.id,
    senderWorkspaceId: workspace.id,
    senderName: workspace.displayName,
    idempotencyKey: `idem_${stamp}`,
    clientMessageId: `client_${stamp}`,
    contentType: 'text',
    body: 'survives restart',
    attachments: [],
    deliveryState: 'delivered',
    reactions: [],
    isEdited: false,
    isDeleted: false,
    isEncrypted: true,
    createdAt: new Date().toISOString(),
  };
  await writer.commitOutboundMessage(message, conversation, {
    eventId: `evt_${stamp}`,
    type: 'message.created',
    payload: { messageId: message.id },
  });

  await writer.persistInternalNote({
    id: `note_${stamp}`,
    conversationId: conversation.id,
    workspaceId: workspace.id,
    authorWorkspaceId: workspace.id,
    authorName: 'Acme Agent (agent)',
    body: 'INTERNAL: not for customers',
    createdAt: new Date().toISOString(),
    resourceType: 'business_internal_note',
  });

  // Simulate a process restart: fresh empty working set, same database
  const reader = new DataStore(false);
  reader.db = db;
  await reader.hydrate();

  assert.ok(reader.accounts.has(account.id), 'account restored');
  const restoredWorkspace = reader.workspaces.get(workspace.id);
  assert.ok(restoredWorkspace, 'workspace restored');
  assert.equal(restoredWorkspace.handle, workspace.handle);

  assert.ok(reader.memberships.has(membership.id), 'membership restored');

  const restoredConversation = reader.conversations.get(conversation.id);
  assert.ok(restoredConversation, 'conversation restored');
  assert.equal(restoredConversation.intentMode, 'focus');
  assert.equal(restoredConversation.isE2EE, true);
  assert.equal(restoredConversation.isPinned, true);
  assert.equal(restoredConversation.participants.length, 1, 'participants restored');
  assert.equal(restoredConversation.participants[0]!.handle, workspace.handle);

  const restoredMessage = reader.messages.get(message.id);
  assert.ok(restoredMessage, 'message restored');
  assert.equal(restoredMessage.body, 'survives restart');
  assert.ok(reader.idempotency.has(message.idempotencyKey), 'idempotency cache restored');

  const restoredNote = reader.internalNotes.get(`note_${stamp}`);
  assert.ok(restoredNote, 'internal note restored');
  assert.equal(restoredNote.resourceType, 'business_internal_note');
});

test('wave 2 entities hydrate: contacts, invites, billing, reports, integrations, crypto (Specs 21-31)', async () => {
  const stamp = `w2_${Date.now()}`;
  const writer = new DataStore(false);
  writer.db = db;

  // Need an account + workspace for FKs
  await db.query('INSERT INTO user_accounts (id, email, display_name) VALUES ($1, $2, $3)', [
    `usr_${stamp}`,
    `${stamp}@example.com`,
    'Wave2 Tester',
  ]);
  await db.query(
    `INSERT INTO identity_workspaces (id, owner_account_id, type, display_name, handle)
     VALUES ($1, $2, 'personal', 'Wave2 Tester', $3)`,
    [`ws_${stamp}`, `usr_${stamp}`, `w2_${stamp}`]
  );

  const contactRequest = {
    id: `cr_${stamp}`,
    requesterId: `usr_${stamp}`,
    requesterHandle: `w2_${stamp}`,
    requesterDisplayName: 'Wave2 Tester',
    recipientId: `usr_${stamp}`,
    recipientHandle: `w2_${stamp}`,
    status: 'accepted' as const,
    introMessage: 'hi from wave2',
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  };
  await writer.persistContactRequest(contactRequest);

  const invite = {
    id: `inv_${stamp}`,
    workspaceId: `ws_${stamp}`,
    creatorId: `usr_${stamp}`,
    code: `code_${stamp}`,
    url: `https://chat.orbit.local/invite/${stamp}`,
    maxUses: 3,
    usedCount: 1,
    expiresAt: new Date(Date.now() + 86400000).toISOString(),
    revoked: true,
    createdAt: new Date().toISOString(),
  };
  await writer.persistInviteLink(invite);

  const entitlement = {
    workspaceId: `ws_${stamp}`,
    plan: 'business_starter' as const,
    status: 'active' as const,
    billingOwnerUserId: `usr_${stamp}`,
    seatsAllocated: 5,
    seatsUsed: 2,
    storageQuotaBytes: 50 * 1024 * 1024 * 1024,
    storageUsedBytes: 1024,
    maxFileSizeMB: 100,
    customThemesAllowed: true,
    workflowCardsAllowed: true,
    auditExportAllowed: false,
    activeIntegrationsCount: 1,
    maxIntegrationsAllowed: 10,
    renewalDate: new Date(Date.now() + 30 * 86400000).toISOString(),
    metadata: {},
  };
  await writer.persistBillingEntitlement(entitlement);

  const report = {
    id: `rep_${stamp}`,
    reporterId: `usr_${stamp}`,
    reporterHandle: `w2_${stamp}`,
    targetUserId: `usr_target_${stamp}`,
    targetHandle: 'spammer',
    reason: 'spam' as const,
    queueType: 'user_report' as const,
    details: 'bot spam',
    status: 'resolved' as const,
    actionTaken: 'suspended' as const,
    assignedReviewerId: `usr_${stamp}`,
    resolutionNote: 'confirmed spam',
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  };
  await writer.persistUserReport(report);

  const auditEntry = {
    id: `aud_${stamp}`,
    actorId: `usr_${stamp}`,
    actorRole: 'trust_safety' as const,
    action: 'report.resolved.suspended',
    targetType: 'report' as const,
    targetId: report.id,
    justification: 'confirmed spam',
    ipHash: 'hash',
    timestamp: new Date().toISOString(),
  };
  await writer.persistAdminAuditLog(auditEntry);

  const integration = {
    id: `int_${stamp}`,
    workspaceId: `ws_${stamp}`,
    name: 'Wave2 Bot',
    description: 'test bot',
    icon: 'bot',
    category: 'workflow' as const,
    scopes: ['messages.send'] as const,
    webhookUrl: 'https://example.local/hook',
    status: 'installed' as const,
    installedAt: new Date().toISOString(),
    dataPolicyUrl: 'https://example.local/policy',
  };
  await writer.persistIntegration(integration as never);

  await writer.persistTelemetryEvent({
    eventId: `tel_${stamp}`,
    eventName: 'contact_request_sent',
    occurredAt: new Date().toISOString(),
    actorType: 'personal_user',
    anonymizedCategory: 'contact_request',
    clientPlatform: 'web',
  });

  const deviceSession = {
    id: `ds_${stamp}`,
    accountId: `usr_${stamp}`,
    activeWorkspaceId: `ws_${stamp}`,
    deviceLabel: 'Chrome on Windows',
    platform: 'web' as const,
    ipAddressMasked: '***.***.***.***',
    isCurrentSession: false,
    isPasskeyAuthenticated: true,
    hasRecentStepUp: true,
    stepUpExpiresAt: new Date(Date.now() + 3600000).toISOString(),
    status: 'revoked' as const,
    createdAt: new Date().toISOString(),
    lastActiveAt: new Date().toISOString(),
  };
  await writer.persistDeviceSession(deviceSession);

  const keyBundle = {
    accountId: `usr_${stamp}`,
    deviceId: `dev_${stamp}`,
    identityKeyPub: 'A'.repeat(64),
    signedPreKeyPub: 'B'.repeat(64),
    signedPreKeySig: 'C'.repeat(64),
    oneTimePreKeys: ['D'.repeat(64)],
    registrationId: 12345,
    createdAt: new Date().toISOString(),
  };
  await writer.persistKeyBundle(keyBundle);

  const verification = {
    contactAccountId: `usr_${stamp}`,
    contactIdentityKeyPub: 'A'.repeat(64),
    safetyNumber: '12345 67890',
    status: 'key_change_detected' as const,
    verifiedAt: null,
    previousIdentityKeyPub: 'Z'.repeat(64),
  };
  await writer.persistKeyVerification(verification);

  // Restart simulation
  const reader = new DataStore(false);
  reader.db = db;
  await reader.hydrate();

  assert.equal(reader.contactRequests.get(`cr_${stamp}`)?.status, 'accepted');
  const restoredInvite = reader.inviteLinks.get(`inv_${stamp}`);
  assert.ok(restoredInvite, 'invite restored');
  assert.equal(restoredInvite.revoked, true);
  assert.equal(restoredInvite.usedCount, 1);

  const restoredEntitlement = reader.billingEntitlements.get(`ws_${stamp}`);
  assert.ok(restoredEntitlement, 'entitlement restored');
  assert.equal(restoredEntitlement.plan, 'business_starter');
  assert.equal(restoredEntitlement.seatsAllocated, 5);

  const restoredReport = reader.userReports.get(`rep_${stamp}`);
  assert.ok(restoredReport, 'report restored');
  assert.equal(restoredReport.status, 'resolved');
  assert.equal(restoredReport.actionTaken, 'suspended');

  assert.ok(
    reader.adminAuditLogs.some((log) => log.id === `aud_${stamp}`),
    'audit log restored'
  );

  const restoredIntegration = reader.integrations.get(`int_${stamp}`);
  assert.ok(restoredIntegration, 'integration restored');
  assert.equal(restoredIntegration.status, 'installed');
  assert.deepEqual(restoredIntegration.scopes, ['messages.send']);

  assert.ok(
    reader.telemetryEvents.some((e) => e.eventId === `tel_${stamp}`),
    'telemetry restored'
  );

  const restoredDevice = reader.deviceSessions.get(`ds_${stamp}`);
  assert.ok(restoredDevice, 'device session restored');
  assert.equal(restoredDevice.status, 'revoked');
  assert.equal(restoredDevice.hasRecentStepUp, true);

  const restoredBundle = reader.keyBundles.get(`usr_${stamp}`);
  assert.ok(restoredBundle, 'key bundle restored');
  assert.equal(restoredBundle.registrationId, 12345);
  assert.deepEqual(restoredBundle.oneTimePreKeys, ['D'.repeat(64)]);

  const restoredVerification = reader.keyVerifications.get(`usr_${stamp}`);
  assert.ok(restoredVerification, 'key verification restored');
  assert.equal(restoredVerification.status, 'key_change_detected');
  assert.equal(restoredVerification.previousIdentityKeyPub, 'Z'.repeat(64));
});

test('wave 3: workflow cards hydrate and tombstone ledger survives restart (Specs 25-26, 41)', async () => {
  const stamp = `w3_${Date.now()}`;
  const writer = new DataStore(false);
  writer.db = db;

  // Seed required account/workspace/conversation via SQL
  await db.query('INSERT INTO user_accounts (id, email, display_name) VALUES ($1, $2, $3)', [
    `usr_${stamp}`,
    `${stamp}@example.com`,
    'Wave3 Tester',
  ]);
  await db.query(
    `INSERT INTO identity_workspaces (id, owner_account_id, type, display_name, handle)
     VALUES ($1, $2, 'personal', 'Wave3 Tester', $3)`,
    [`ws_${stamp}`, `usr_${stamp}`, `w3_${stamp}`]
  );
  await db.query(
    `INSERT INTO conversations (id, workspace_id, kind) VALUES ($1, $2, 'direct')`,
    [`conv_${stamp}`, `ws_${stamp}`]
  );

  const card: import('@orbit/schemas').WorkflowCard = {
    id: `wf_${stamp}`,
    conversationId: `conv_${stamp}`,
    creatorWorkspaceId: `ws_${stamp}`,
    creatorName: 'Wave3 Tester',
    cardType: 'approval',
    title: 'Approve launch',
    description: 'Sign off before release',
    status: 'pending',
    assigneeWorkspaceId: null,
    dueDate: null,
    options: [
      { id: 'opt1', label: 'Approve', votes: 1, checked: false },
      { id: 'opt2', label: 'Reject', votes: 0, checked: false },
    ],
    history: [
      {
        actionId: 'act1',
        actorWorkspaceId: `ws_${stamp}`,
        actorName: 'Wave3 Tester',
        action: 'created',
        timestamp: new Date().toISOString(),
      },
    ],
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  };
  await writer.persistWorkflowCard(card);

  // Record a tombstone in the writer ledger + persist
  const tombstone = writer.tombstoneLedger.recordTombstone(
    'message',
    `msg_${stamp}`,
    `ws_${stamp}`,
    'gdpr_erasure'
  );
  await writer.persistTombstone(tombstone);

  // Restart simulation
  const reader = new DataStore(false);
  reader.db = db;
  await reader.hydrate();

  const restoredCard = reader.workflowCards.get(`wf_${stamp}`);
  assert.ok(restoredCard, 'workflow card restored');
  assert.equal(restoredCard.cardType, 'approval');
  assert.equal(restoredCard.options?.length, 2);
  assert.equal(restoredCard.options?.[0].label, 'Approve');
  assert.equal(restoredCard.history?.length, 1);

  assert.ok(
    reader.tombstoneLedger.isTombstoned(`msg_${stamp}`),
    'tombstone survives restart and suppresses restore'
  );
  const allTombstones = reader.tombstoneLedger.getAllTombstones();
  assert.ok(
    allTombstones.some((t) => t.targetIdHash === tombstone.targetIdHash && t.reason === 'gdpr_erasure'),
    'tombstone row hydrated with original reason'
  );
});

test('flushOutbox delivers undelivered rows once and marks them delivered (Spec 10)', async () => {
  const stamp = `fo_${Date.now()}`;
  const writer = new DataStore(false);
  writer.db = db;

  const account = {
    id: `usr_${stamp}`,
    email: `${stamp}@example.com`,
    displayName: 'Outbox Tester',
    status: 'active' as const,
    createdAt: new Date().toISOString(),
  };
  const workspace = {
    id: `ws_${stamp}`,
    ownerAccountId: account.id,
    type: 'personal' as const,
    displayName: 'Outbox Tester',
    handle: `fo_${stamp}`,
    isVerified: false,
    status: 'active' as const,
    createdAt: new Date().toISOString(),
  };
  const conversation: Conversation = {
    id: `conv_${stamp}`,
    workspaceId: workspace.id,
    kind: 'direct',
    title: 'Outbox Chat',
    participants: [
      {
        workspaceId: workspace.id,
        displayName: workspace.displayName,
        handle: workspace.handle,
        role: 'admin',
        joinedAt: new Date().toISOString(),
        isOnline: false,
      },
    ],
    intentMode: 'focus',
    unreadCount: 0,
    isPinned: false,
    isMuted: false,
    isArchived: false,
    isE2EE: false,
    membershipApprovalRequired: false,
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  };

  await writer.persistAccount(account);
  await writer.persistWorkspace(workspace);
  await writer.persistConversation(conversation, conversation.participants);

  const message: MessageEnvelope = {
    id: `msg_${stamp}`,
    conversationId: conversation.id,
    senderWorkspaceId: workspace.id,
    senderName: workspace.displayName,
    idempotencyKey: `idem_${stamp}`,
    clientMessageId: `client_${stamp}`,
    contentType: 'text',
    body: 'undelivered until flushed',
    attachments: [],
    deliveryState: 'delivered',
    reactions: [],
    isEdited: false,
    isDeleted: false,
    isEncrypted: false,
    createdAt: new Date().toISOString(),
  };
  // No live fan-out here (no wasEventBroadcast), so delivered_at stays NULL.
  await writer.commitOutboundMessage(message, conversation, {
    eventId: `evt_${stamp}`,
    type: 'message.created',
    payload: { messageId: message.id },
  });

  const undeliveredBefore = await db.query(
    'SELECT event_id FROM realtime_outbox WHERE event_id = $1 AND delivered_at IS NULL',
    [`evt_${stamp}`]
  );
  assert.equal(undeliveredBefore.rows.length, 1, 'event must start undelivered');

  // First flush: deliver callback invoked, row marked delivered.
  const deliveredIds: string[] = [];
  const firstFlush = await writer.flushOutbox((event) => {
    deliveredIds.push(event.eventId);
    return 1;
  });
  assert.ok(firstFlush >= 1, 'flush must deliver at least the pending row');
  assert.ok(deliveredIds.includes(`evt_${stamp}`), 'deliver callback receives the pending event');

  const afterFirst = await db.query('SELECT delivered_at FROM realtime_outbox WHERE event_id = $1', [`evt_${stamp}`]);
  assert.ok(afterFirst.rows[0]!.delivered_at, 'row must be marked delivered after flush');

  // Second flush: already-delivered row is not re-delivered.
  const secondDelivered: string[] = [];
  await writer.flushOutbox((event) => {
    secondDelivered.push(event.eventId);
    return 1;
  });
  assert.ok(
    !secondDelivered.includes(`evt_${stamp}`),
    'delivered event must not be fanned out again on subsequent flush'
  );
});

test('blocks hydrate and isBlockedEitherWay survives restart (Spec 14)', async () => {
  const stamp = `blk_${Date.now()}`;
  const writer = new DataStore(false);
  writer.db = db;

  const mkWorkspace = (suffix: string) => {
    const account = {
      id: `usr_${suffix}`,
      email: `${suffix}@example.com`,
      displayName: `Blocker ${suffix}`,
      status: 'active' as const,
      createdAt: new Date().toISOString(),
    };
    const workspace = {
      id: `ws_${suffix}`,
      ownerAccountId: account.id,
      type: 'personal' as const,
      displayName: `Blocker ${suffix}`,
      handle: `h_${suffix}`,
      isVerified: false,
      status: 'active' as const,
      createdAt: new Date().toISOString(),
    };
    return { account, workspace };
  };

  const a = mkWorkspace(`${stamp}_a`);
  const b = mkWorkspace(`${stamp}_b`);
  await writer.persistAccount(a.account);
  await writer.persistWorkspace(a.workspace);
  await writer.persistAccount(b.account);
  await writer.persistWorkspace(b.workspace);

  await db.query(
    `INSERT INTO blocked_workspaces (id, workspace_id, blocked_workspace_id, created_at)
     VALUES ($1, $2, $3, $4) ON CONFLICT DO NOTHING`,
    [`blk_${stamp}`, a.workspace.id, b.workspace.id, new Date().toISOString()]
  );

  const reader = new DataStore(false);
  reader.db = db;
  await reader.hydrate();

  assert.ok(
    reader.isBlockedEitherWay(a.workspace.id, b.workspace.id),
    'block must be restored after restart (either direction)'
  );
  assert.ok(
    reader.isBlockedEitherWay(b.workspace.id, a.workspace.id),
    'block check must be symmetric across both directions'
  );
  assert.ok(!reader.isBlockedEitherWay(a.workspace.id, `${stamp}_unrelated`), 'unrelated workspaces are not blocked');
});
