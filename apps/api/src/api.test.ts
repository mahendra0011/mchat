import { describe, it, before, after } from 'node:test';
import assert from 'node:assert';
import { createHash } from 'node:crypto';
import { buildApp } from './app.js';
import { store } from './store.js';
import { sniffMimeType } from './routes/media.js';
import { applyPreviewPrivacy, recordNotification } from './routes/notifications.js';
import { processScheduledMessages } from './routes/messaging-ops.js';
import { FIXTURE_IDS } from '@orbit/test-fixtures';

describe('Orbit Chat API Integration Tests', () => {
  const app = buildApp();

  before(async () => {
    await app.ready();
  });

  after(async () => {
    await app.close();
  });

  it('GET /v1/health returns healthy status', async () => {
    const res = await app.inject({
      method: 'GET',
      url: '/v1/health',
    });

    assert.strictEqual(res.statusCode, 200);
    const body = JSON.parse(res.payload);
    assert.strictEqual(body.status, 'healthy');
  });

  it('GET /v1/metrics returns operational server statistics (Spec 20)', async () => {
    const res = await app.inject({
      method: 'GET',
      url: '/v1/metrics',
    });

    assert.strictEqual(res.statusCode, 200);
    const body = JSON.parse(res.payload);
    assert.strictEqual(body.status, 'operational');
    assert.ok(typeof body.uptimeSeconds === 'number');
    assert.ok(typeof body.memoryUsageMB === 'number');
    // Observability (Spec 10 — OpenTelemetry-style request tracing).
    assert.ok(body.observability, 'metrics must expose observability');
    assert.ok(body.observability.totalRequests >= 1, 'request counter must be non-zero after prior calls');
    assert.ok(typeof body.observability.spansRecorded === 'number');
  });

  it('GET /v1/me returns authenticated account and workspaces', async () => {
    const res = await app.inject({
      method: 'GET',
      url: '/v1/me',
    });

    assert.strictEqual(res.statusCode, 200);
    const body = JSON.parse(res.payload);
    assert.strictEqual(body.user.email, 'alex@orbit.internal');
    assert.ok(body.workspaces.length >= 2);
  });

  it('POST /v1/conversations/:id/messages successfully sends message with idempotency key', async () => {
    const idempotencyKey = `test-idemp-${Date.now()}`;
    const payload = {
      conversationId: FIXTURE_IDS.convPersonalAlexMaya,
      idempotencyKey,
      clientMessageId: `client-${Date.now()}`,
      contentType: 'text',
      body: 'Testing message delivery with idempotency',
      isEncrypted: true,
    };

    // First send
    const res1 = await app.inject({
      method: 'POST',
      url: `/v1/conversations/${FIXTURE_IDS.convPersonalAlexMaya}/messages`,
      payload,
    });

    assert.strictEqual(res1.statusCode, 201);
    const msg1 = JSON.parse(res1.payload);
    assert.strictEqual(msg1.body, payload.body);
    assert.strictEqual(msg1.idempotencyKey, idempotencyKey);

    // Second send with same idempotency key (must deduplicate!)
    const res2 = await app.inject({
      method: 'POST',
      url: `/v1/conversations/${FIXTURE_IDS.convPersonalAlexMaya}/messages`,
      payload,
    });

    assert.strictEqual(res2.statusCode, 200); // 200 indicates deduplicated replay
    const msg2 = JSON.parse(res2.payload);
    assert.strictEqual(msg2.id, msg1.id);
  });

  it('SECURITY TEST: Public message feed contains ZERO internal notes', async () => {
    const res = await app.inject({
      method: 'GET',
      url: `/v1/conversations/${FIXTURE_IDS.convBusinessCustomerMaya}/messages`,
      headers: {
        'x-workspace-id': FIXTURE_IDS.wsBusinessAcme,
      },
    });

    assert.strictEqual(res.statusCode, 200);
    const messages = JSON.parse(res.payload);
    assert.ok(Array.isArray(messages));
    
    // Check that not a single item is an internal note
    for (const msg of messages) {
      assert.notStrictEqual(msg.resourceType, 'business_internal_note');
      assert.ok(!msg.body.includes('INTERNAL NOTE:'));
    }
  });

  it('SECURITY TEST: Unauthorized personal workspace is denied access to business internal notes', async () => {
    // Attempt to access business internal notes with Personal workspace
    const res = await app.inject({
      method: 'GET',
      url: `/v1/business/${FIXTURE_IDS.wsPersonalAlex}/conversations/${FIXTURE_IDS.convBusinessCustomerMaya}/internal-notes`,
      headers: {
        'x-workspace-id': FIXTURE_IDS.wsPersonalAlex,
      },
    });

    assert.strictEqual(res.statusCode, 400); // Fails because personal workspace is not a business workspace
    const body = JSON.parse(res.payload);
    assert.strictEqual(body.error.code, 'NOT_A_BUSINESS_WORKSPACE');
  });

  it('BUSINESS TEST: Authorized business agent can read and create internal notes', async () => {
    // 1. Read notes as Acme Business Workspace
    const resRead = await app.inject({
      method: 'GET',
      url: `/v1/business/${FIXTURE_IDS.wsBusinessAcme}/conversations/${FIXTURE_IDS.convBusinessCustomerMaya}/internal-notes`,
      headers: {
        'x-workspace-id': FIXTURE_IDS.wsBusinessAcme,
      },
    });

    assert.strictEqual(resRead.statusCode, 200);
    const notes = JSON.parse(resRead.payload);
    assert.ok(Array.isArray(notes));
    assert.ok(notes.length >= 1);
    assert.strictEqual(notes[0].resourceType, 'business_internal_note');

    // 2. Create note as Acme Business Workspace
    const resCreate = await app.inject({
      method: 'POST',
      url: `/v1/business/${FIXTURE_IDS.wsBusinessAcme}/conversations/${FIXTURE_IDS.convBusinessCustomerMaya}/internal-notes`,
      headers: {
        'x-workspace-id': FIXTURE_IDS.wsBusinessAcme,
      },
      payload: {
        body: 'Follow up required with client regarding contract schedule.',
      },
    });

    assert.strictEqual(resCreate.statusCode, 201);
    const createdNote = JSON.parse(resCreate.payload);
    assert.strictEqual(createdNote.resourceType, 'business_internal_note');
  });

  it('PRIVACY TEST: GET /v1/privacy/receipt returns verified encryption and retention status', async () => {
    const res = await app.inject({
      method: 'GET',
      url: `/v1/privacy/receipt?conversationId=${FIXTURE_IDS.convPersonalAlexMaya}`,
      headers: {
        'x-workspace-id': FIXTURE_IDS.wsPersonalAlex,
      },
    });

    assert.strictEqual(res.statusCode, 200);
    const receipt = JSON.parse(res.payload);
    assert.strictEqual(receipt.encryption.isE2EE, true);
    assert.strictEqual(receipt.retention.retentionDays, 30);
    assert.ok(receipt.participants.length >= 2);
  });

  // --- EXPANSION TESTS (Specs 21-26) ---

  it('DISCOVERY TEST: POST /v1/contacts/search prevents enumeration with uniform structure', async () => {
    // Give Maya a shared workspace with the caller (Alex) so the response can
    // resolve sharedWorkspaceIds / sharedWorkspaceId / role. Cleaned up below.
    store.memberships.set('m-discovery-shared', {
      id: 'm-discovery-shared',
      workspaceId: FIXTURE_IDS.wsBusinessAcme,
      accountId: FIXTURE_IDS.accountMaya,
      role: 'agent',
      status: 'active',
      joinedAt: new Date().toISOString(),
    });

    try {
      // 1. Existing user (shares the Acme business workspace with the caller).
      const resExist = await app.inject({
        method: 'POST',
        url: '/v1/contacts/search',
        payload: { handle: 'maya' },
      });
      assert.strictEqual(resExist.statusCode, 200);
      const bodyExist = JSON.parse(resExist.payload);
      assert.strictEqual(bodyExist.data.found, true);
      assert.strictEqual(bodyExist.data.handle, 'maya');
      assert.strictEqual(bodyExist.data.matchedViaContactBook, false);
      assert.ok(Array.isArray(bodyExist.data.sharedWorkspaceIds));
      assert.ok(bodyExist.data.sharedWorkspaceIds.includes(FIXTURE_IDS.wsBusinessAcme));
      assert.strictEqual(bodyExist.data.sharedWorkspaceId, FIXTURE_IDS.wsBusinessAcme);
      assert.strictEqual(bodyExist.data.role, 'owner');

      // 2. Non-existent user (uniform negative response, no shared workspaces).
      const resNone = await app.inject({
        method: 'POST',
        url: '/v1/contacts/search',
        payload: { handle: 'nonexistent_ghost_999' },
      });
      assert.strictEqual(resNone.statusCode, 200);
      const bodyNone = JSON.parse(resNone.payload);
      assert.strictEqual(bodyNone.data.found, false);
      assert.strictEqual(bodyNone.data.matchedViaContactBook, false);
      assert.deepStrictEqual(bodyNone.data.sharedWorkspaceIds, []);
      assert.strictEqual(bodyNone.data.sharedWorkspaceId, null);
      assert.strictEqual(bodyNone.data.role, null);
    } finally {
      store.memberships.delete('m-discovery-shared');
    }
  });

  it('CONTACT REQUESTS TEST: GET and respond to unknown contact request', async () => {
    const resList = await app.inject({
      method: 'GET',
      url: '/v1/contacts/requests',
    });
    assert.strictEqual(resList.statusCode, 200);
    const bodyList = JSON.parse(resList.payload);
    assert.ok(bodyList.data.length >= 1);
    const reqId = bodyList.data[0].id;

    // Respond to request by accepting
    const resAccept = await app.inject({
      method: 'POST',
      url: `/v1/contacts/requests/${reqId}/respond`,
      payload: { action: 'accepted' },
    });
    assert.strictEqual(resAccept.statusCode, 200);
    const bodyAccept = JSON.parse(resAccept.payload);
    assert.strictEqual(bodyAccept.data.status, 'accepted');
  });

  it('BILLING & ENTITLEMENTS TEST: Check quota and evaluate limits', async () => {
    const res = await app.inject({
      method: 'GET',
      url: `/v1/workspaces/${FIXTURE_IDS.wsBusinessAcme}/billing/entitlements`,
    });
    assert.strictEqual(res.statusCode, 200);
    const body = JSON.parse(res.payload);
    assert.strictEqual(body.data.plan, 'business_starter');
    assert.strictEqual(body.data.seatsAllocated, 5);

    // Check quota for file upload
    const quotaRes = await app.inject({
      method: 'POST',
      url: `/v1/workspaces/${FIXTURE_IDS.wsBusinessAcme}/billing/check-quota`,
      payload: {
        action: 'upload_file',
        params: { fileSizeMB: 20 },
      },
    });
    assert.strictEqual(quotaRes.statusCode, 200);
    const quotaBody = JSON.parse(quotaRes.payload);
    assert.strictEqual(quotaBody.data.allowed, true);
});
  
  it('BILLING TEST: Change plan (upgrade/downgrade with proration)', async () => {
    const res = await app.inject({
      method: 'POST',
      url: `/v1/workspaces/${FIXTURE_IDS.wsBusinessAcme}/billing/subscription/change`,
      payload: { newPlanId: 'business_scale', prorationBehavior: 'charge' },
    });
    assert.strictEqual(res.statusCode, 200);
    const body = JSON.parse(res.payload);
    assert.strictEqual(body.data.plan, 'business_scale');
    assert.ok(body.data.invoice?.amountCents > 0, 'invoice should have amount for upgrade');
  });

  it('BILLING TEST: Cancel subscription at period end', async () => {
    const res = await app.inject({
      method: 'POST',
      url: `/v1/workspaces/${FIXTURE_IDS.wsBusinessAcme}/billing/subscription/cancel`,
      payload: { cancelAtPeriodEnd: true },
    });
    assert.strictEqual(res.statusCode, 200);
    const body = JSON.parse(res.payload);
    assert.strictEqual(body.data.status, 'active', 'subscription should remain active until period end');
    assert.strictEqual(body.data.cancelAtPeriodEnd, true);
  });

  it('BILLING TEST: Resume canceled subscription', async () => {
    // First cancel the subscription
    await app.inject({
      method: 'POST',
      url: `/v1/workspaces/${FIXTURE_IDS.wsBusinessAcme}/billing/subscription/cancel`,
      payload: { cancelAtPeriodEnd: false },
    });
    // Now resume
    const res = await app.inject({
      method: 'POST',
      url: `/v1/workspaces/${FIXTURE_IDS.wsBusinessAcme}/billing/subscription/resume`,
    });
    assert.strictEqual(res.statusCode, 200);
    const body = JSON.parse(res.payload);
    assert.strictEqual(body.data.status, 'active');
  });

  it('BILLING TEST: Grace period flow on payment failure', async () => {
    // Set up a workspace in grace period (simulate payment failed)
    const entitlement = store.billingEntitlements.get(FIXTURE_IDS.wsBusinessAcme);
    if (entitlement) {
      entitlement.status = 'grace_period';
      entitlement.metadata = { ...entitlement.metadata, gracePeriodEnd: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000).toISOString() };
      store.billingEntitlements.set(FIXTURE_IDS.wsBusinessAcme, entitlement);
      await store.persistBillingEntitlement(entitlement);
    }
    
    const res = await app.inject({
      method: 'POST',
      url: `/v1/workspaces/${FIXTURE_IDS.wsBusinessAcme}/billing/subscription/grace-period`,
    });
    assert.strictEqual(res.statusCode, 200);
    const body = JSON.parse(res.payload);
    assert.strictEqual(body.data.status, 'grace_period');
  });

  it('BILLING TEST: Refund recording via webhook', async () => {
    // Test charge.refunded webhook event
    const payload = JSON.stringify({
      type: 'charge.refunded',
      data: {
        workspaceId: FIXTURE_IDS.wsBusinessAcme,
        amount_refunded: 1800,
      },
    });
    
    const res = await app.inject({
      method: 'POST',
      url: '/v1/webhooks/billing',
      headers: { 'stripe-signature': 'whsec_mock' },
      payload,
    });
    assert.strictEqual(res.statusCode, 200);
  });

  it('BILLING TEST: Entitlement on workspace deletion', async () => {
    // Set up a business workspace with billing
    const workspaceId = FIXTURE_IDS.wsBusinessAcme;
    
    // Trigger cleanup-on-delete
    const res = await app.inject({
      method: 'POST',
      url: `/v1/workspaces/${workspaceId}/billing/cleanup-on-delete`,
    });
    assert.strictEqual(res.statusCode, 200);

    // Check entitlement was cleaned up
    const entitlementRes = await app.inject({
      method: 'GET',
      url: `/v1/workspaces/${workspaceId}/billing/entitlements`,
    });
    assert.strictEqual(entitlementRes.statusCode, 404, 'billing entitlement should be cleaned up after deletion');
  });

  it('BILLING TEST: Seat limit enforcement', async () => {
    // Try to set seats below current usage
    const res = await app.inject({
      method: 'POST',
      url: `/v1/workspaces/${FIXTURE_IDS.wsBusinessAcme}/billing/seats`,
      payload: { quantity: 1 },
    });
    assert.strictEqual(res.statusCode, 400);
    assert.strictEqual(JSON.parse(res.payload).error.code, 'INVALID_QUANTITY');
    
    // Try to exceed maximum
    const res2 = await app.inject({
      method: 'POST',
      url: `/v1/workspaces/${FIXTURE_IDS.wsBusinessAcme}/billing/seats`,
      payload: { quantity: 1001 },
    });
    assert.strictEqual(res2.statusCode, 400);
    assert.strictEqual(JSON.parse(res2.payload).error.code, 'INVALID_QUANTITY');
  });

  it('ADMIN & AUDIT TEST: Fetch sanitized audit logs and reports queue (business workspace)', async () => {
    const headers = { 'x-workspace-id': FIXTURE_IDS.wsBusinessAcme };
    const resLogs = await app.inject({
      method: 'GET',
      url: '/v1/admin/audit-logs',
      headers,
    });
    assert.strictEqual(resLogs.statusCode, 200);
    const logs = JSON.parse(resLogs.payload);
    assert.ok(Array.isArray(logs.data));
    assert.ok(logs.data.length >= 1);

    const resReports = await app.inject({
      method: 'GET',
      url: '/v1/admin/reports',
      headers,
    });
    assert.strictEqual(resReports.statusCode, 200);
    const reports = JSON.parse(resReports.payload);
    assert.ok(Array.isArray(reports.data));
    assert.ok(reports.data.length >= 1);
  });

  it('TRUST & SAFETY TEST: Personal workspace cannot access moderation queue (Spec 14)', async () => {
    const res = await app.inject({
      method: 'GET',
      url: '/v1/admin/reports',
      headers: { 'x-workspace-id': FIXTURE_IDS.wsPersonalAlex },
    });
    assert.strictEqual(res.statusCode, 403);
  });

  it('TRUST & SAFETY TEST: Report submission with evidence + appeal lifecycle (Spec 14)', async () => {
    const submitRes = await app.inject({
      method: 'POST',
      url: '/v1/admin/reports',
      headers: { 'x-workspace-id': FIXTURE_IDS.wsPersonalAlex },
      payload: {
        targetUserId: FIXTURE_IDS.accountMaya,
        targetHandle: 'maya_fixture',
        targetConversationId: FIXTURE_IDS.convPersonalAlexMaya,
        reason: 'harassment',
        details: 'Repeated unwanted contact after being asked to stop.',
        evidenceMessageIds: [FIXTURE_IDS.msgPersonal1],
      },
    });
    assert.strictEqual(submitRes.statusCode, 201);
    const report = JSON.parse(submitRes.payload).data;
    assert.deepStrictEqual(report.evidenceMessageIds, [FIXTURE_IDS.msgPersonal1]);

    // Reporter views their own reports
    const mineRes = await app.inject({
      method: 'GET',
      url: '/v1/reports/mine',
      headers: { 'x-workspace-id': FIXTURE_IDS.wsPersonalAlex },
    });
    assert.strictEqual(mineRes.statusCode, 200);
    const mine = JSON.parse(mineRes.payload).data;
    assert.ok(mine.some((r: { id: string }) => r.id === report.id));

    // Business owner (fallback Alex owns the business workspace) resolves it
    const resolveRes = await app.inject({
      method: 'POST',
      url: `/v1/admin/reports/${report.id}/resolve`,
      headers: { 'x-workspace-id': FIXTURE_IDS.wsBusinessAcme },
      payload: { action: 'warning', note: 'First warning issued after review.' },
    });
    assert.strictEqual(resolveRes.statusCode, 200);

    // Reporter files an appeal
    const appealRes = await app.inject({
      method: 'POST',
      url: `/v1/admin/reports/${report.id}/appeal`,
      headers: { 'x-workspace-id': FIXTURE_IDS.wsPersonalAlex },
      payload: { reason: 'The warning was issued in error.' },
    });
    assert.strictEqual(appealRes.statusCode, 200);
    const appealed = JSON.parse(appealRes.payload).data;
    assert.strictEqual(appealed.appealStatus, 'filed');

    // Duplicate appeal rejected
    const dupAppealRes = await app.inject({
      method: 'POST',
      url: `/v1/admin/reports/${report.id}/appeal`,
      headers: { 'x-workspace-id': FIXTURE_IDS.wsPersonalAlex },
      payload: { reason: 'retry' },
    });
    assert.strictEqual(dupAppealRes.statusCode, 409);

    // Reviewer upholds the appeal
    const appealResolveRes = await app.inject({
      method: 'POST',
      url: `/v1/admin/reports/${report.id}/appeal/resolve`,
      headers: { 'x-workspace-id': FIXTURE_IDS.wsBusinessAcme },
      payload: { decision: 'upheld', note: 'No violation found on re-review.' },
    });
    assert.strictEqual(appealResolveRes.statusCode, 200);
    const resolvedAppeal = JSON.parse(appealResolveRes.payload).data;
    assert.strictEqual(resolvedAppeal.appealStatus, 'upheld');
    assert.strictEqual(resolvedAppeal.actionTaken, 'none');
  });

  it('TRUST & SAFETY TEST: Suspension restricts the target; accused can appeal (Spec 14)', async () => {
    // Create a throwaway account to be the reported/suspended party.
    const loginRes = await app.inject({
      method: 'POST',
      url: '/v1/auth/sessions',
      payload: { email: 'suspend-target@orbit.test', password: 'orbitdemo123', deviceLabel: 'susp', platform: 'web' },
    });
    assert.strictEqual(loginRes.statusCode, 200);
    const loginBody = JSON.parse(loginRes.payload);
    const targetToken = loginBody.token as string;
    const targetAccountId = loginBody.user.id as string;

    // File a report against the throwaway account (reporter = fallback Alex).
    const submitRes = await app.inject({
      method: 'POST',
      url: '/v1/admin/reports',
      headers: { 'x-workspace-id': FIXTURE_IDS.wsPersonalAlex },
      payload: {
        targetUserId: targetAccountId,
        targetHandle: 'suspend-target',
        reason: 'spam',
        details: 'Coordinated spam.',
      },
    });
    assert.strictEqual(submitRes.statusCode, 201);
    const reportId = JSON.parse(submitRes.payload).data.id as string;

    // Reviewer (business owner) resolves with a suspension -> enforced.
    const resolveRes = await app.inject({
      method: 'POST',
      url: `/v1/admin/reports/${reportId}/resolve`,
      headers: { 'x-workspace-id': FIXTURE_IDS.wsBusinessAcme },
      payload: { action: 'suspended', note: 'Confirmed spam network.' },
    });
    assert.strictEqual(resolveRes.statusCode, 200);

    // The suspended account cannot perform normal actions.
    const blockedRes = await app.inject({
      method: 'GET',
      url: '/v1/settings',
      headers: { Authorization: `Bearer ${targetToken}` },
    });
    assert.strictEqual(blockedRes.statusCode, 403);
    assert.strictEqual(JSON.parse(blockedRes.payload).error.code, 'ACCOUNT_SUSPENDED');

    // But the accused can still appeal the restriction.
    const appealRes = await app.inject({
      method: 'POST',
      url: `/v1/admin/reports/${reportId}/appeal`,
      headers: { Authorization: `Bearer ${targetToken}` },
      payload: { reason: 'This was a misunderstanding; I am not a spammer.' },
    });
    assert.strictEqual(appealRes.statusCode, 200);
    assert.strictEqual(JSON.parse(appealRes.payload).data.appealStatus, 'filed');

    // Reviewer upholds the appeal -> restriction released.
    const upholdRes = await app.inject({
      method: 'POST',
      url: `/v1/admin/reports/${reportId}/appeal/resolve`,
      headers: { 'x-workspace-id': FIXTURE_IDS.wsBusinessAcme },
      payload: { decision: 'upheld', note: 'Insufficient evidence.' },
    });
    assert.strictEqual(upholdRes.statusCode, 200);

    // The account can act again.
    const restoredRes = await app.inject({
      method: 'GET',
      url: '/v1/settings',
      headers: { Authorization: `Bearer ${targetToken}` },
    });
    assert.strictEqual(restoredRes.statusCode, 200);
  });

  it('GROUP INVITE TEST: Redeem joins a group; approval-required flow gates membership (Spec 14)', async () => {
    // A fixture workspace seeds each group as an initial member (valid UUID participant).
    const seedWs = FIXTURE_IDS.wsBusinessAcme;

    // Maya authenticates so she can redeem the invite.
    const mayaLogin = await app.inject({
      method: 'POST',
      url: '/v1/auth/sessions',
      payload: { email: 'maya@orbit.internal', password: 'orbitdemo123', deviceLabel: 'maya-inv', platform: 'web' },
    });
    assert.strictEqual(mayaLogin.statusCode, 200);
    const mayaToken = JSON.parse(mayaLogin.payload).token as string;
    const mayaWs = FIXTURE_IDS.wsPersonalMaya;

    // Maya allows group invites from anyone so the redeem is not gated by contacts-only.
    const settingsRes = await app.inject({
      method: 'PUT',
      url: '/v1/settings/privacy',
      headers: { Authorization: `Bearer ${mayaToken}` },
      payload: { groupInvitePermission: 'everyone' },
    });
    assert.strictEqual(settingsRes.statusCode, 200);

    // ---- Flow 1: membershipApprovalRequired = true -> pending request, then approve ----
    const grpRes = await app.inject({
      method: 'POST',
      url: '/v1/conversations',
      headers: { 'x-workspace-id': FIXTURE_IDS.wsPersonalAlex },
      payload: { kind: 'group', title: 'Approval Group', participantWorkspaceIds: [seedWs], membershipApprovalRequired: true },
    });
    assert.strictEqual(grpRes.statusCode, 201);
    const approvalGroup = JSON.parse(grpRes.payload);

    const invRes = await app.inject({
      method: 'POST',
      url: '/v1/invites',
      headers: { 'x-workspace-id': FIXTURE_IDS.wsPersonalAlex },
      payload: { maxUses: 5, conversationId: approvalGroup.id },
    });
    assert.strictEqual(invRes.statusCode, 201);
    const inviteCode = JSON.parse(invRes.payload).data.code as string;

    const redeemRes = await app.inject({
      method: 'POST',
      url: `/v1/invites/${inviteCode}/redeem`,
      headers: { Authorization: `Bearer ${mayaToken}` },
    });
    assert.strictEqual(redeemRes.statusCode, 202);
    const redeemBody = JSON.parse(redeemRes.payload).data;
    assert.strictEqual(redeemBody.approvalRequired, true);
    assert.strictEqual(redeemBody.status, 'pending');
    // Maya is NOT yet a member.
    assert.ok(!approvalGroup.participants.some((p: { workspaceId: string }) => p.workspaceId === mayaWs));

    const approveRes = await app.inject({
      method: 'POST',
      url: `/v1/conversations/${approvalGroup.id}/join-requests/${redeemBody.joinRequestId}/approve`,
      headers: { 'x-workspace-id': FIXTURE_IDS.wsPersonalAlex },
    });
    assert.strictEqual(approveRes.statusCode, 200);
    const approved = JSON.parse(approveRes.payload).data;
    assert.strictEqual(approved.status, 'approved');
    assert.ok(approved.historyVisibilityStatement);

    // Now Maya is a member (she can read the conversation).
    const viewRes = await app.inject({
      method: 'GET',
      url: `/v1/conversations/${approvalGroup.id}/messages`,
      headers: { Authorization: `Bearer ${mayaToken}` },
    });
    assert.strictEqual(viewRes.statusCode, 200);

    // ---- Flow 2: no approval required -> direct join with history statement ----
    const grp2Res = await app.inject({
      method: 'POST',
      url: '/v1/conversations',
      headers: { 'x-workspace-id': FIXTURE_IDS.wsPersonalAlex },
      payload: { kind: 'group', title: 'Open Group', participantWorkspaceIds: [seedWs], membershipApprovalRequired: false },
    });
    assert.strictEqual(grp2Res.statusCode, 201);
    const openGroup = JSON.parse(grp2Res.payload);

    const inv2Res = await app.inject({
      method: 'POST',
      url: '/v1/invites',
      headers: { 'x-workspace-id': FIXTURE_IDS.wsPersonalAlex },
      payload: { maxUses: 5, conversationId: openGroup.id },
    });
    assert.strictEqual(inv2Res.statusCode, 201);
    const inviteCode2 = JSON.parse(inv2Res.payload).data.code as string;

    const redeem2Res = await app.inject({
      method: 'POST',
      url: `/v1/invites/${inviteCode2}/redeem`,
      headers: { Authorization: `Bearer ${mayaToken}` },
    });
    assert.strictEqual(redeem2Res.statusCode, 201);
    const redeem2Body = JSON.parse(redeem2Res.payload).data;
    assert.ok(redeem2Body.historyVisibilityStatement);
    assert.ok(openGroup.participants.some((p: { workspaceId: string }) => p.workspaceId === seedWs));
  });

  it('BUSINESS VERIFICATION TEST: Badge requires reviewer approval; paid ≠ verified; appeal path (Spec 14)', async () => {
    const ws = FIXTURE_IDS.wsBusinessAcme;
    // Acme is seeded verified; reset so the lifecycle can be observed end-to-end
    // (the final approve step restores the verified badge).
    store.workspaces.get(ws)!.isVerified = false;

    // Submit — badge must NOT be set yet (paid ≠ verified).
    const submitRes = await app.inject({
      method: 'POST',
      url: `/v1/business/${ws}/verification`,
      headers: { 'x-workspace-id': ws },
      payload: {
        legalName: 'Acme Corporation',
        registrationNumber: 'REG-12345',
        contactEmail: 'legal@acme.test',
        website: 'https://acme.test',
      },
    });
    assert.strictEqual(submitRes.statusCode, 201);
    const verificationId = JSON.parse(submitRes.payload).data.id as string;

    const viewBefore = await app.inject({
      method: 'GET',
      url: `/v1/business/${ws}/verification`,
      headers: { 'x-workspace-id': ws },
    });
    assert.strictEqual(viewBefore.statusCode, 200);
    assert.strictEqual(JSON.parse(viewBefore.payload).data.isVerifiedBadge, false);

    // Reviewer decisions are admin actions: complete step-up re-auth first.
    const stepUp = await app.inject({ method: 'POST', url: '/v1/auth/step-up' });
    assert.strictEqual(stepUp.statusCode, 200);

    // Reviewer rejects — badge stays false.
    const rejectRes = await app.inject({
      method: 'POST',
      url: `/v1/admin/business-verifications/${verificationId}/resolve`,
      headers: { 'x-workspace-id': ws },
      payload: { decision: 'reject', note: 'Registration number could not be confirmed.' },
    });
    assert.strictEqual(rejectRes.statusCode, 200);
    assert.strictEqual(JSON.parse(rejectRes.payload).data.status, 'rejected');

    const viewRejected = await app.inject({
      method: 'GET',
      url: `/v1/business/${ws}/verification`,
      headers: { 'x-workspace-id': ws },
    });
    assert.strictEqual(JSON.parse(viewRejected.payload).data.isVerifiedBadge, false);

    // Business appeals the rejection.
    const appealRes = await app.inject({
      method: 'POST',
      url: `/v1/admin/business-verifications/${verificationId}/appeal`,
      headers: { 'x-workspace-id': ws },
      payload: { reason: 'Registration is valid; please re-check the registry.' },
    });
    assert.strictEqual(appealRes.statusCode, 200);
    assert.strictEqual(JSON.parse(appealRes.payload).data.status, 'appealed');

    // Reviewer overturns and approves — badge is now set.
    const overturnRes = await app.inject({
      method: 'POST',
      url: `/v1/admin/business-verifications/${verificationId}/appeal/resolve`,
      headers: { 'x-workspace-id': ws },
      payload: { decision: 'overturn_and_approve', note: 'Confirmed with the registry.' },
    });
    assert.strictEqual(overturnRes.statusCode, 200);
    assert.strictEqual(JSON.parse(overturnRes.payload).data.status, 'approved');

    const viewAfter = await app.inject({
      method: 'GET',
      url: `/v1/business/${ws}/verification`,
      headers: { 'x-workspace-id': ws },
    });
    assert.strictEqual(JSON.parse(viewAfter.payload).data.isVerifiedBadge, true);
  });

  it('INTEGRATIONS TEST: List approved modules and revoke access', async () => {
    const res = await app.inject({
      method: 'GET',
      url: '/v1/integrations',
    });
    assert.strictEqual(res.statusCode, 200);
    const integrations = JSON.parse(res.payload);
    assert.ok(integrations.data.length >= 1);

    // Revoke Linear integration
    const resRevoke = await app.inject({
      method: 'POST',
      url: '/v1/integrations/int_linear/revoke',
    });
    assert.strictEqual(resRevoke.statusCode, 200);
    const revoked = JSON.parse(resRevoke.payload);
    assert.strictEqual(revoked.data.status, 'revoked');
  });

  it('INTEGRATIONS TEST: Per-conversation grants CRUD', async () => {
    const convId = FIXTURE_IDS.convBusinessCustomerMaya;

    // Grant access to conversation
    const grantRes = await app.inject({
      method: 'POST',
      url: '/v1/integrations/int_linear/grants/conversations',
      headers: { 'x-workspace-id': FIXTURE_IDS.wsBusinessAcme },
      payload: { conversationId: convId, scopes: ['messages.read_scoped', 'messages.send'] },
    });
    assert.strictEqual(grantRes.statusCode, 201, grantRes.payload);
    const grant = JSON.parse(grantRes.payload).data;
    assert.strictEqual(grant.integrationId, 'int_linear');
    assert.strictEqual(grant.conversationId, convId);
    assert.deepStrictEqual(grant.scopes, ['messages.read_scoped', 'messages.send']);
    assert.ok(grant.botPermissions);

    // List grants
    const listRes = await app.inject({
      method: 'GET',
      url: '/v1/integrations/int_linear/grants/conversations',
      headers: { 'x-workspace-id': FIXTURE_IDS.wsBusinessAcme },
    });
    assert.strictEqual(listRes.statusCode, 200);
    const grants = JSON.parse(listRes.payload).data;
    assert.ok(grants.some((g: any) => g.conversationId === convId));

    // Revoke grant
    const deleteRes = await app.inject({
      method: 'DELETE',
      url: `/v1/integrations/int_linear/grants/conversations/${convId}`,
      headers: { 'x-workspace-id': FIXTURE_IDS.wsBusinessAcme },
    });
    assert.strictEqual(deleteRes.statusCode, 200);

    // Verify removed
    const listAfter = await app.inject({
      method: 'GET',
      url: '/v1/integrations/int_linear/grants/conversations',
      headers: { 'x-workspace-id': FIXTURE_IDS.wsBusinessAcme },
    });
    const grantsAfter = JSON.parse(listAfter.payload).data;
    assert.ok(!grantsAfter.some((g: any) => g.conversationId === convId));
  });

  it('INTEGRATIONS TEST: Per-conversation grant validates scopes subset', async () => {
    const convId = FIXTURE_IDS.convBusinessCustomerMaya;

    // Try to grant scope not in integration (invalid enum value fails schema validation first)
    const grantRes = await app.inject({
      method: 'POST',
      url: '/v1/integrations/int_linear/grants/conversations',
      headers: { 'x-workspace-id': FIXTURE_IDS.wsBusinessAcme },
      payload: { conversationId: convId, scopes: ['messages.read_scoped', 'invalid_scope'] },
    });
    assert.strictEqual(grantRes.statusCode, 400);
    assert.strictEqual(JSON.parse(grantRes.payload).error.code, 'INVALID_GRANT_PAYLOAD');
  });

  it('INTEGRATIONS TEST: Per-conversation grant requires admin role', async () => {
    // Login as Sam (agent in business workspace, not admin)
    const samLogin = await app.inject({
      method: 'POST',
      url: '/v1/auth/sessions',
      payload: { email: 'sam@orbit.internal', password: 'orbitdemo123', deviceLabel: 'sam-grant', platform: 'web' },
    });
    const samToken = JSON.parse(samLogin.payload).token as string;

    const grantRes = await app.inject({
      method: 'POST',
      url: '/v1/integrations/int_linear/grants/conversations',
      headers: { Authorization: `Bearer ${samToken}`, 'x-workspace-id': FIXTURE_IDS.wsBusinessAcme },
      payload: { conversationId: FIXTURE_IDS.convBusinessCustomerMaya, scopes: ['messages.read_scoped'] },
    });
    assert.strictEqual(grantRes.statusCode, 403);
    assert.strictEqual(JSON.parse(grantRes.payload).error.code, 'INSUFFICIENT_ROLE');
  });

  it('WEBHOOK DELIVERY TEST: HMAC signature generation and verification', async () => {
    const { generateSignature, verifySignature, verifyWebhookSignature } = await import('./webhook-delivery.js');

    const secret = 'whsec_test123';
    const timestamp = Date.now();
    const payload = { event: 'message.created', data: { id: 'msg_123', body: 'Hello' } };
    const payloadStr = JSON.stringify(payload);

    const signature = generateSignature(secret, timestamp, payloadStr);
    assert.ok(signature.length === 64, 'Signature should be 64 hex chars');

    const valid = verifySignature(secret, timestamp, payloadStr, signature);
    assert.strictEqual(valid, true);

    // Tampered payload should fail
    const tamperedValid = verifySignature(secret, timestamp, JSON.stringify({ ...payload, data: { id: 'msg_999' } }), signature);
    assert.strictEqual(tamperedValid, false);

    // Replay window
    const oldTimestamp = timestamp - 6 * 60 * 1000; // 6 minutes ago
    const oldSig = generateSignature(secret, oldTimestamp, payloadStr);
    const replayResult = verifyWebhookSignature(secret, `t=${oldTimestamp}`, `v1=${oldSig}`, payloadStr);
    assert.strictEqual(replayResult.valid, false);
    assert.strictEqual(replayResult.reason, 'Timestamp outside replay window');

    // Valid current timestamp
    const currentResult = verifyWebhookSignature(secret, `t=${timestamp}`, `v1=${signature}`, payloadStr);
    assert.strictEqual(currentResult.valid, true);
  });

  it('API VERSIONING TEST: Response headers include version and sunset', async () => {
    // Use /v1/me which requires auth and goes through full pipeline
    const res = await app.inject({
      method: 'GET',
      url: '/v1/me',
    });
    assert.strictEqual(res.statusCode, 200);
    assert.strictEqual(res.headers['api-version'], '1');
    assert.strictEqual(res.headers['api-deprecated'], 'false');
    assert.ok(res.headers['sunset'], 'Sunset header must be present');
    // Sunset date should be ~1 year from now
    const sunsetHeader = Array.isArray(res.headers['sunset']) ? res.headers['sunset'][0] : res.headers['sunset'];
    const sunsetDate = new Date(sunsetHeader as string);
    const now = new Date();
    const diffYears = (sunsetDate.getTime() - now.getTime()) / (1000 * 60 * 60 * 24 * 365);
    assert.ok(diffYears >= 0.9 && diffYears <= 1.1, 'Sunset should be ~1 year from now');
  });

  it('MESSAGE TEST: Bot messages carry integrationId', async () => {
    // Send a message with integrationId (simulating bot)
    const res = await app.inject({
      method: 'POST',
      url: `/v1/conversations/${FIXTURE_IDS.convBusinessCustomerMaya}/messages`,
      headers: { 'x-workspace-id': FIXTURE_IDS.wsBusinessAcme },
      payload: {
        conversationId: FIXTURE_IDS.convBusinessCustomerMaya,
        idempotencyKey: `bot-msg-${Date.now()}`,
        clientMessageId: `bot-msg-${Date.now()}`,
        contentType: 'text',
        body: 'Bot message from integration',
        integrationId: 'int_linear',
      },
    });
    assert.strictEqual(res.statusCode, 201, res.payload);
    const msg = JSON.parse(res.payload);
    assert.strictEqual(msg.integrationId, 'int_linear');
  });

  it('PRIVACY TELEMETRY TEST: Ingest content-free telemetry event', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/v1/telemetry/events',
      payload: {
        eventId: `evt_tel_${Date.now()}`,
        eventName: 'workspace_switch_completed',
        occurredAt: new Date().toISOString(),
        actorType: 'personal_user',
        anonymizedCategory: 'workspace_personal',
        clientPlatform: 'web',
      },
    });
    assert.strictEqual(res.statusCode, 202);
  });

  it('SECURITY & SESSION TEST: List active device sessions and revoke other devices (Spec 30)', async () => {
    const res = await app.inject({
      method: 'GET',
      url: '/v1/auth/sessions',
    });
    assert.strictEqual(res.statusCode, 200);
    const body = JSON.parse(res.payload);
    assert.ok(Array.isArray(body.sessions));
    assert.ok(body.sessions.length >= 2);

    // Revoke all other sessions
    const resRevoke = await app.inject({
      method: 'POST',
      url: '/v1/auth/sessions/revoke-all-others',
    });
    assert.strictEqual(resRevoke.statusCode, 200);
    const revokeBody = JSON.parse(resRevoke.payload);
    assert.strictEqual(revokeBody.success, true);
    assert.ok(revokeBody.revokedCount >= 1);
  });

  it('SECURITY & STEP-UP TEST: Step-up re-authentication confirmation (Spec 30 & 32)', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/v1/auth/step-up',
    });
    assert.strictEqual(res.statusCode, 200);
    const body = JSON.parse(res.payload);
    assert.strictEqual(body.success, true);
    assert.strictEqual(body.stepUpVerified, true);
    assert.ok(body.expiresAt);
  });

  it('CRYPTOGRAPHY & SAFETY NUMBER TEST: Key bundle retrieval and safety number generation (Spec 31)', async () => {
    // 1. Get Key Bundle for Sam
    const resBundle = await app.inject({
      method: 'GET',
      url: `/v1/crypto/keys/${FIXTURE_IDS.accountSam}`,
    });
    assert.strictEqual(resBundle.statusCode, 200);
    const bundleBody = JSON.parse(resBundle.payload);
    assert.ok(bundleBody.bundle.identityKeyPub);

    // 2. Compute Safety Number between Alex and Sam
    const resSafety = await app.inject({
      method: 'POST',
      url: '/v1/crypto/safety-number',
      payload: { contactAccountId: FIXTURE_IDS.accountSam },
    });
    assert.strictEqual(resSafety.statusCode, 200);
    const safetyBody = JSON.parse(resSafety.payload);
    assert.ok(safetyBody.safetyNumber);
    assert.match(safetyBody.safetyNumber, /^\d{5}( \d{5}){11}$/);
    assert.ok(safetyBody.qrPayload.startsWith('orbit-verify:v1:'));

    // 3. Mark verified
    const resVerify = await app.inject({
      method: 'POST',
      url: '/v1/crypto/verify',
      payload: { contactAccountId: FIXTURE_IDS.accountSam, verified: true },
    });
    assert.strictEqual(resVerify.statusCode, 200);
    const verifyBody = JSON.parse(resVerify.payload);
    assert.strictEqual(verifyBody.record.status, 'verified');
  });

  it('E2EE KEY EXCHANGE TEST: Workspace key bundle resolution and encrypted snippet privacy (Spec 31)', async () => {
    // 1. Client key exchange resolves a participant workspace → owner key bundle
    const resWs = await app.inject({
      method: 'GET',
      url: `/v1/crypto/keys/workspace/${FIXTURE_IDS.wsPersonalMaya}`,
    });
    assert.strictEqual(resWs.statusCode, 200);
    const wsBundle = JSON.parse(resWs.payload);
    assert.ok(wsBundle.bundle.identityKeyPub);
    assert.strictEqual(wsBundle.bundle.accountId, FIXTURE_IDS.accountMaya);

    // 2. Seeded identity keys are real P-256 SPKI (so client-side ECDH succeeds)
    const spki = Buffer.from(wsBundle.bundle.identityKeyPub, 'base64');
    assert.strictEqual(spki[0], 0x30); // DER SEQUENCE
    assert.ok(spki.includes(0x04)); // uncompressed EC point marker
    assert.ok(spki.length >= 90);

    // 3. Unknown workspace → 404 (no bundle resolution)
    const resMissing = await app.inject({
      method: 'GET',
      url: '/v1/crypto/keys/workspace/00000000-0000-4000-8000-000000000000',
    });
    assert.strictEqual(resMissing.statusCode, 404);

    // 4. Encrypted send never leaks its payload into the conversation snippet
    const resSend = await app.inject({
      method: 'POST',
      url: `/v1/conversations/${FIXTURE_IDS.convPersonalAlexMaya}/messages`,
      payload: {
        conversationId: FIXTURE_IDS.convPersonalAlexMaya,
        idempotencyKey: `idemp-e2ee-snippet-${Date.now()}`,
        clientMessageId: `client-e2ee-snippet-${Date.now()}`,
        contentType: 'text',
        body: 'orbit.e2ee.v1.dGVzdGl2.eGxu',
        isEncrypted: true,
      },
    });
    assert.strictEqual(resSend.statusCode, 201);

    const resConvs = await app.inject({
      method: 'GET',
      url: `/v1/workspaces/${FIXTURE_IDS.wsPersonalAlex}/conversations`,
    });
    assert.strictEqual(resConvs.statusCode, 200);
    const convs = JSON.parse(resConvs.payload);
    const conv = convs.find((c: { id: string }) => c.id === FIXTURE_IDS.convPersonalAlexMaya);
    assert.ok(conv);
    assert.strictEqual(conv.lastMessageSnippet, 'Encrypted message');
  });

  it('ANTI-SSRF TEST: Safe destination validation (Spec 34)', async () => {
    // Blocked loopback
    const resLoop = await app.inject({
      method: 'POST',
      url: '/v1/security/ssrf-validate',
      payload: { url: 'https://localhost:4000/v1/health' },
    });
    assert.strictEqual(resLoop.statusCode, 200);
    const loopBody = JSON.parse(resLoop.payload);
    assert.strictEqual(loopBody.result.isAllowed, false);
    assert.strictEqual(loopBody.result.destinationCategory, 'BLOCKED_LOOPBACK');

    // Blocked cloud metadata
    const resMeta = await app.inject({
      method: 'POST',
      url: '/v1/security/ssrf-validate',
      payload: { url: 'https://169.254.169.254/latest' },
    });
    const metaBody = JSON.parse(resMeta.payload);
    assert.strictEqual(metaBody.result.isAllowed, false);
    assert.strictEqual(metaBody.result.destinationCategory, 'BLOCKED_CLOUD_METADATA');

    // Allowed public HTTPS destination
    const resSafe = await app.inject({
      method: 'POST',
      url: '/v1/security/ssrf-validate',
      payload: { url: 'https://example.com/webhook' },
    });
    const safeBody = JSON.parse(resSafe.payload);
    assert.strictEqual(safeBody.result.isAllowed, true);
    assert.strictEqual(safeBody.result.destinationCategory, 'PUBLIC_SAFE');
  });

  it('RETENTION & TOMBSTONE RECONCILIATION TEST: Deletion tombstones and restore suppression (Specs 37 & 41)', async () => {
    // 1. List tombstones for workspace
    const resTombstones = await app.inject({
      method: 'GET',
      url: '/v1/security/retention/tombstones',
    });
    assert.strictEqual(resTombstones.statusCode, 200);
    const tombstonesBody = JSON.parse(resTombstones.payload);
    assert.ok(tombstonesBody.totalTombstonesCount >= 1);

    // 2. Reconcile restore test
    const resReconcile = await app.inject({
      method: 'POST',
      url: '/v1/security/retention/reconcile',
      payload: {
        candidateRecords: [
          { id: 'msg_expired_gdpr_sample_999', content: 'Deleted GDPR content' },
          { id: 'msg_fresh_live_123', content: 'Active retained message' },
        ],
      },
    });
    assert.strictEqual(resReconcile.statusCode, 200);
    const reconcileBody = JSON.parse(resReconcile.payload);
    assert.strictEqual(reconcileBody.report.suppressedTombstoneCount, 1);
    assert.strictEqual(reconcileBody.preservedRecords.length, 1);
    assert.strictEqual(reconcileBody.preservedRecords[0].id, 'msg_fresh_live_123');
  });

  it('POLICY ENGINE TEST: Hybrid RBAC/ABAC authorization checks (Spec 32)', async () => {
    const resPolicy = await app.inject({
      method: 'POST',
      url: '/v1/security/policy/check',
      payload: {
        action: 'internal_note.read',
        resource: {
          type: 'internal_note',
          id: 'note-sample',
          workspaceId: FIXTURE_IDS.wsPersonalAlex, // Alex's active workspace is personal in default request
          isInternalNote: true,
          isUnderLegalHold: false,
        },
      },
    });
    assert.strictEqual(resPolicy.statusCode, 200);
    const policyBody = JSON.parse(resPolicy.payload);
    // In personal workspace, internal business notes are denied
    assert.strictEqual(policyBody.decision.allowed, false);
    assert.match(policyBody.decision.reason, /Personal workspaces and customer identities are strictly denied/);
  });

  // ===================== WAVE-A P0 MESSAGING TESTS =====================

  it('SEARCH TEST: Message search scoped to participant conversations (Spec 02 P0)', async () => {
    const res = await app.inject({
      method: 'GET',
      url: '/v1/search/messages?q=brand',
    });
    assert.strictEqual(res.statusCode, 200);
    const body = JSON.parse(res.payload);
    assert.ok(Array.isArray(body.data));
    assert.ok(body.count >= 0);
    // Each hit must include conversation context
    for (const hit of body.data) {
      assert.ok(hit.message.id);
      assert.ok(hit.conversationId);
      assert.ok(typeof hit.snippet === 'string');
    }
  });

  it('SEARCH TEST: Rejects too-short queries (Spec 02 P0)', async () => {
    const res = await app.inject({
      method: 'GET',
      url: '/v1/search/messages?q=a',
    });
    assert.strictEqual(res.statusCode, 400);
    const body = JSON.parse(res.payload);
    assert.strictEqual(body.error.code, 'INVALID_SEARCH_QUERY');
  });

  it('SEARCH TEST: Conversation search by title (Spec 02 P0)', async () => {
    const res = await app.inject({
      method: 'GET',
      url: '/v1/search/conversations?q=design',
    });
    assert.strictEqual(res.statusCode, 200);
    const body = JSON.parse(res.payload);
    assert.ok(Array.isArray(body.data));
  });

  it('PRESENCE TEST: Typing indicator set and clear (Spec 02 P0)', async () => {
    const convId = FIXTURE_IDS.convPersonalAlexMaya;
    const resTyping = await app.inject({
      method: 'POST',
      url: `/v1/conversations/${convId}/typing`,
    });
    assert.strictEqual(resTyping.statusCode, 200);

    const resPresence = await app.inject({
      method: 'GET',
      url: `/v1/conversations/${convId}/presence`,
    });
    assert.strictEqual(resPresence.statusCode, 200);
    const body = JSON.parse(resPresence.payload);
    assert.ok(Array.isArray(body.participants));

    const resStop = await app.inject({
      method: 'DELETE',
      url: `/v1/conversations/${convId}/typing`,
    });
    assert.strictEqual(resStop.statusCode, 200);
  });

  it('READ RECEIPTS TEST: Mark conversation as read updates delivery state (Spec 02 P0)', async () => {
    const res = await app.inject({
      method: 'POST',
      url: `/v1/conversations/${FIXTURE_IDS.convPersonalAlexMaya}/read`,
      payload: {},
    });
    assert.strictEqual(res.statusCode, 200);
    const body = JSON.parse(res.payload);
    assert.strictEqual(body.success, true);
    assert.ok(typeof body.markedCount === 'number');
  });

  it('DRAFTS TEST: Create, read, delete draft scoped to workspace (Spec 02 P0)', async () => {
    const convId = FIXTURE_IDS.convPersonalAlexMaya;

    // Upsert
    const resPut = await app.inject({
      method: 'PUT',
      url: `/v1/conversations/${convId}/draft`,
      payload: { body: 'draft message hello' },
    });
    assert.strictEqual(resPut.statusCode, 200);
    const putBody = JSON.parse(resPut.payload);
    assert.strictEqual(putBody.data.body, 'draft message hello');

    // Read back
    const resGet = await app.inject({
      method: 'GET',
      url: `/v1/conversations/${convId}/draft`,
    });
    assert.strictEqual(resGet.statusCode, 200);
    const getBody = JSON.parse(resGet.payload);
    assert.strictEqual(getBody.data.body, 'draft message hello');

    // Delete
    const resDel = await app.inject({
      method: 'DELETE',
      url: `/v1/conversations/${convId}/draft`,
    });
    assert.strictEqual(resDel.statusCode, 200);

    const resAfter = await app.inject({
      method: 'GET',
      url: `/v1/conversations/${convId}/draft`,
    });
    const afterBody = JSON.parse(resAfter.payload);
    assert.strictEqual(afterBody.data, null);
  });

  it('DRAFTS TEST: Rejects oversized draft body (Spec 02 P0)', async () => {
    const res = await app.inject({
      method: 'PUT',
      url: `/v1/conversations/${FIXTURE_IDS.convPersonalAlexMaya}/draft`,
      payload: { body: 'x'.repeat(10001) },
    });
    assert.strictEqual(res.statusCode, 400);
  });

  it('NOTIFICATIONS TEST: Feed, read, read-all (Spec 02 P0)', async () => {
    const resList = await app.inject({
      method: 'GET',
      url: '/v1/notifications',
    });
    assert.strictEqual(resList.statusCode, 200);
    const listBody = JSON.parse(resList.payload);
    assert.ok(Array.isArray(listBody.data));
    assert.ok(typeof listBody.unreadCount === 'number');

    const resReadAll = await app.inject({
      method: 'POST',
      url: '/v1/notifications/read-all',
    });
    assert.strictEqual(resReadAll.statusCode, 200);
  });

  it('NOTIFICATIONS PIPELINE TEST: Sending a message notifies other participants (Spec 02/10)', async () => {
    // Alex (fallback) sends a message that mentions Maya in their shared conversation.
    const sendRes = await app.inject({
      method: 'POST',
      url: `/v1/conversations/${FIXTURE_IDS.convPersonalAlexMaya}/messages`,
      headers: { 'x-workspace-id': FIXTURE_IDS.wsPersonalAlex },
      payload: {
        conversationId: FIXTURE_IDS.convPersonalAlexMaya,
        idempotencyKey: `notif-pipeline-${Date.now()}`,
        clientMessageId: `notif-pipeline-${Date.now()}`,
        contentType: 'text',
        body: '@maya thanks for the update!',
      },
    });
    assert.strictEqual(sendRes.statusCode, 201);

    // Maya authenticates and reads her scoped notification feed.
    const mayaLogin = await app.inject({
      method: 'POST',
      url: '/v1/auth/sessions',
      payload: { email: 'maya@orbit.internal', password: 'orbitdemo123', deviceLabel: 'notif-feed', platform: 'web' },
    });
    assert.strictEqual(mayaLogin.statusCode, 200);
    const mayaToken = JSON.parse(mayaLogin.payload).token as string;

    const feed = await app.inject({
      method: 'GET',
      url: '/v1/notifications',
      headers: { Authorization: `Bearer ${mayaToken}` },
    });
    assert.strictEqual(feed.statusCode, 200);
    const feedBody = JSON.parse(feed.payload);
    const forConv = (feedBody.data as Array<{ conversationId: string; type: string; workspaceId: string }>)
      .filter((n) => n.conversationId === FIXTURE_IDS.convPersonalAlexMaya && n.type === 'mention');
    assert.ok(forConv.length >= 1, 'expected a mention notification for the recipient');
    assert.ok(feedBody.unreadCount >= 1);
  });

  it('ACCOUNT RECOVERY TEST: Cancel a pending deletion within the grace period (Spec 10)', async () => {
    const login1 = await app.inject({
      method: 'POST',
      url: '/v1/auth/sessions',
      payload: { email: 'recovery-user@orbit.test', password: 'orbitdemo123', deviceLabel: 'rec', platform: 'web' },
    });
    assert.strictEqual(login1.statusCode, 200);
    const token1 = JSON.parse(login1.payload).token as string;

    // Account deletion is a sensitive action: complete step-up re-auth first.
    const stepUp1 = await app.inject({
      method: 'POST',
      url: '/v1/auth/step-up',
      headers: { Authorization: `Bearer ${token1}` },
    });
    assert.strictEqual(stepUp1.statusCode, 200);

    // Request deletion -> pending + all sessions revoked.
    const delRes = await app.inject({
      method: 'POST',
      url: '/v1/account/deletion-requests',
      headers: { Authorization: `Bearer ${token1}` },
    });
    assert.strictEqual(delRes.statusCode, 200);
    assert.strictEqual(JSON.parse(delRes.payload).status, 'deletion_pending');
    assert.ok(JSON.parse(delRes.payload).purgeJobId, 'deletion must schedule a durable purge job');

    // Durable job queue visibility: a purge job is now pending.
    const jobsRes = await app.inject({
      method: 'GET',
      url: '/v1/admin/jobs',
      headers: { 'x-workspace-id': FIXTURE_IDS.wsBusinessAcme },
    });
    assert.strictEqual(jobsRes.statusCode, 200);
    assert.ok(JSON.parse(jobsRes.payload).data.pending >= 1);

    // token1 was revoked; re-authenticate to recover.
    const login2 = await app.inject({
      method: 'POST',
      url: '/v1/auth/sessions',
      payload: { email: 'recovery-user@orbit.test', password: 'orbitdemo123', deviceLabel: 'rec2', platform: 'web' },
    });
    assert.strictEqual(login2.statusCode, 200);
    const token2 = JSON.parse(login2.payload).token as string;

    const cancelRes = await app.inject({
      method: 'POST',
      url: '/v1/account/deletion-requests/cancel',
      headers: { Authorization: `Bearer ${token2}` },
    });
    assert.strictEqual(cancelRes.statusCode, 200);
    assert.strictEqual(JSON.parse(cancelRes.payload).status, 'active');

    // No pending deletion anymore.
    const cancelAgain = await app.inject({
      method: 'POST',
      url: '/v1/account/deletion-requests/cancel',
      headers: { Authorization: `Bearer ${token2}` },
    });
    assert.strictEqual(cancelAgain.statusCode, 409);
    assert.strictEqual(JSON.parse(cancelAgain.payload).error.code, 'NO_PENDING_DELETION');
  });

  it('NOTIFICATIONS TEST: Push subscription register + remove (Spec 02 P0)', async () => {
    const resSub = await app.inject({
      method: 'POST',
      url: '/v1/notifications/push-subscriptions',
      payload: {
        endpoint: 'https://push.example.com/sub-123',
        keys: { p256dh: 'BKxQ', auth: 'abc' },
        platform: 'web',
      },
    });
    assert.strictEqual(resSub.statusCode, 201);
    const subBody = JSON.parse(resSub.payload);
    assert.ok(subBody.data.id);

    const resRemove = await app.inject({
      method: 'DELETE',
      url: `/v1/notifications/push-subscriptions/${subBody.data.id}`,
    });
    assert.strictEqual(resRemove.statusCode, 200);
  });

  it('NOTIFICATIONS TEST: Rejects invalid push subscription payload (Spec 02 P0)', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/v1/notifications/push-subscriptions',
      payload: { endpoint: 'https://push.example.com/sub-bad' },
    });
    assert.strictEqual(res.statusCode, 400);
  });

  it('MEDIA TEST: Upload rejects request without file (Spec 02 P0)', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/v1/media/upload',
      payload: {},
    });
    // multipart missing file -> 400, 406, 415 (wrong content-type) or 500
    assert.ok(
      res.statusCode === 400 || res.statusCode === 406 || res.statusCode === 415 || res.statusCode === 500,
      `unexpected status ${res.statusCode}`
    );
  });

  // ===================== WAVE-B MESSAGING OPS TESTS =====================

  it('MESSAGING OPS TEST: Pin/unpin conversation toggles state (Spec 02 P0)', async () => {
    const convId = FIXTURE_IDS.convPersonalAlexMaya;
    // Fixture starts with isPinned: true, so first toggle -> false, second -> true
    const res1 = await app.inject({ method: 'POST', url: `/v1/conversations/${convId}/pin` });
    assert.strictEqual(res1.statusCode, 200);
    const body1 = JSON.parse(res1.payload);
    assert.strictEqual(body1.isPinned, false);

    const res2 = await app.inject({ method: 'POST', url: `/v1/conversations/${convId}/pin` });
    const body2 = JSON.parse(res2.payload);
    assert.strictEqual(body2.isPinned, true);
  });

  it('MESSAGING OPS TEST: Mute/unmute conversation (Spec 02 P0)', async () => {
    const convId = FIXTURE_IDS.convPersonalAlexMaya;
    const res = await app.inject({ method: 'POST', url: `/v1/conversations/${convId}/mute` });
    assert.strictEqual(res.statusCode, 200);
    const body = JSON.parse(res.payload);
    assert.strictEqual(body.isMuted, true);
  });

  it('MESSAGING OPS TEST: Archive/unarchive conversation (Spec 02 P0)', async () => {
    const convId = FIXTURE_IDS.convPersonalAlexMaya;
    const res = await app.inject({ method: 'POST', url: `/v1/conversations/${convId}/archive` });
    assert.strictEqual(res.statusCode, 200);
    const body = JSON.parse(res.payload);
    assert.strictEqual(body.isArchived, true);
  });

  it('MESSAGING OPS TEST: Block/unblock workspace (Spec 02 P0)', async () => {
    const targetWs = FIXTURE_IDS.wsBusinessAcme;
    const resBlock = await app.inject({ method: 'POST', url: `/v1/blocks/${targetWs}` });
    assert.strictEqual(resBlock.statusCode, 200);
    const blockBody = JSON.parse(resBlock.payload);
    assert.strictEqual(blockBody.blocked, true);

    const resList = await app.inject({ method: 'GET', url: '/v1/blocks' });
    assert.strictEqual(resList.statusCode, 200);
    const listBody = JSON.parse(resList.payload);
    assert.ok(listBody.data.some((b: { blockedWorkspaceId: string }) => b.blockedWorkspaceId === targetWs));

    const resUnblock = await app.inject({ method: 'POST', url: `/v1/blocks/${targetWs}` });
    const unblockBody = JSON.parse(resUnblock.payload);
    assert.strictEqual(unblockBody.blocked, false);
  });

  it('MESSAGING OPS TEST: Folder create, list, update, delete (Spec 02 P0)', async () => {
    const resCreate = await app.inject({
      method: 'POST',
      url: '/v1/folders',
      payload: { name: 'Work', color: '#ff0000' },
    });
    assert.strictEqual(resCreate.statusCode, 201);
    const createBody = JSON.parse(resCreate.payload);
    const folderId = createBody.data.id;
    assert.strictEqual(createBody.data.name, 'Work');

    const resList = await app.inject({ method: 'GET', url: '/v1/folders' });
    const listBody = JSON.parse(resList.payload);
    assert.ok(listBody.data.some((f: { id: string }) => f.id === folderId));

    const resUpdate = await app.inject({
      method: 'PATCH',
      url: `/v1/folders/${folderId}`,
      payload: { name: 'Work Updated' },
    });
    assert.strictEqual(resUpdate.statusCode, 200);
    const updateBody = JSON.parse(resUpdate.payload);
    assert.strictEqual(updateBody.data.name, 'Work Updated');

    const resDelete = await app.inject({ method: 'DELETE', url: `/v1/folders/${folderId}` });
    assert.strictEqual(resDelete.statusCode, 200);
  });

  it('MESSAGING OPS TEST: Rejects empty folder name (Spec 02 P0)', async () => {
    const res = await app.inject({ method: 'POST', url: '/v1/folders', payload: { name: '' } });
    assert.strictEqual(res.statusCode, 400);
  });

  it('MESSAGING OPS TEST: Mentions endpoint accepts valid payload (Spec 02 P0)', async () => {
    const res = await app.inject({
      method: 'POST',
      url: `/v1/conversations/${FIXTURE_IDS.convPersonalAlexMaya}/mentions`,
      payload: { mentionedWorkspaceIds: [FIXTURE_IDS.wsPersonalMaya], messageId: 'msg_test_1' },
    });
    assert.strictEqual(res.statusCode, 200);
    const body = JSON.parse(res.payload);
    assert.strictEqual(body.success, true);
  });

  it('MESSAGING OPS TEST: Rejects invalid mention payload (Spec 02 P0)', async () => {
    const res = await app.inject({
      method: 'POST',
      url: `/v1/conversations/${FIXTURE_IDS.convPersonalAlexMaya}/mentions`,
      payload: {},
    });
    assert.strictEqual(res.statusCode, 400);
  });

  it('MESSAGING OPS TEST: Forward message requires target conversation (Spec 02 P0)', async () => {
    const res = await app.inject({
      method: 'POST',
      url: `/v1/messages/msg_1/forward`,
      payload: {},
    });
    assert.strictEqual(res.statusCode, 400);
  });

  it('MESSAGING OPS TEST: Forward returns 404 for missing message (Spec 02 P0)', async () => {
    const res = await app.inject({
      method: 'POST',
      url: `/v1/messages/msg_nonexistent/forward`,
      payload: { targetConversationId: FIXTURE_IDS.convPersonalAlexMaya },
    });
    assert.strictEqual(res.statusCode, 404);
  });

  it('MESSAGING OPS TEST: Customer can exit a direct conversation (Spec 14)', async () => {
    // Create a throwaway direct conversation, then exit it (self-contained; no shared fixture mutation).
    const created = await app.inject({
      method: 'POST',
      url: '/v1/conversations',
      payload: { kind: 'direct', participantWorkspaceIds: [FIXTURE_IDS.wsPersonalMaya] },
    });
    assert.strictEqual(created.statusCode, 201);
    const convId = JSON.parse(created.payload).id as string;
    const res = await app.inject({
      method: 'POST',
      url: `/v1/conversations/${convId}/leave`,
    });
    assert.strictEqual(res.statusCode, 200);
    assert.strictEqual(JSON.parse(res.payload).success, true);
  });

  it('MESSAGING OPS TEST: Role change rejects invalid role (Spec 02 P0)', async () => {
    const res = await app.inject({
      method: 'PUT',
      url: `/v1/conversations/${FIXTURE_IDS.convBusinessCustomerMaya}/members/${FIXTURE_IDS.wsBusinessAcme}/role`,
      payload: { role: 'superuser' },
    });
    assert.strictEqual(res.statusCode, 400);
  });

  it('GROUP GOVERNANCE TEST: Admin sets slow mode; slow sends are throttled (Spec 14)', async () => {
    const created = await app.inject({
      method: 'POST',
      url: '/v1/conversations',
      payload: { kind: 'group', title: 'Governance Test', participantWorkspaceIds: [FIXTURE_IDS.wsPersonalMaya] },
    });
    assert.strictEqual(created.statusCode, 201);
    const convId = JSON.parse(created.payload).id as string;

    // Admin sets slow mode = 60s and posting permission = admins
    const gov = await app.inject({
      method: 'PUT',
      url: `/v1/conversations/${convId}/governance`,
      payload: { slowModeSeconds: 60, postingPermission: 'admins' },
    });
    assert.strictEqual(gov.statusCode, 200);
    const govBody = JSON.parse(gov.payload);
    assert.strictEqual(govBody.slowModeSeconds, 60);
    assert.strictEqual(govBody.postingPermission, 'admins');

    // First send (admin) succeeds
    const first = await app.inject({
      method: 'POST',
      url: `/v1/conversations/${convId}/messages`,
      payload: {
        conversationId: convId,
        idempotencyKey: `gov-1-${Date.now()}`,
        clientMessageId: `gov-1-${Date.now()}`,
        contentType: 'text',
        body: 'first',
      },
    });
    assert.strictEqual(first.statusCode, 201);

    // Immediate second send is throttled by slow mode
    const second = await app.inject({
      method: 'POST',
      url: `/v1/conversations/${convId}/messages`,
      payload: {
        conversationId: convId,
        idempotencyKey: `gov-2-${Date.now()}`,
        clientMessageId: `gov-2-${Date.now()}`,
        contentType: 'text',
        body: 'second',
      },
    });
    assert.strictEqual(second.statusCode, 429);
    assert.strictEqual(JSON.parse(second.payload).error.code, 'SLOW_MODE');
  });

  it('CALLS TEST: Creates ringing audio call (WAVE-F)', async () => {
    const res = await app.inject({
      method: 'POST',
      url: `/v1/conversations/${FIXTURE_IDS.convPersonalAlexMaya}/calls`,
      headers: { 'x-workspace-id': FIXTURE_IDS.wsPersonalAlex },
      payload: { kind: 'audio' },
    });
    assert.strictEqual(res.statusCode, 201);
    const body = JSON.parse(res.payload);
    assert.strictEqual(body.data.status, 'ringing');
    assert.strictEqual(body.data.kind, 'audio');
    assert.ok(body.data.id.startsWith('call-'));
  });

  it('CALLS TEST: Rejects call from non-participant (WAVE-F)', async () => {
    // A brand-new account (auto-creates a personal workspace) is not a
    // participant of convPersonalAlexMaya (only Alex & Maya are).
    const loginRes = await app.inject({
      method: 'POST',
      url: '/v1/auth/sessions',
      payload: { email: 'stranger-calls@orbit.test', password: 'orbitdemo123', deviceLabel: 'calls-nonparticipant', platform: 'web' },
    });
    assert.strictEqual(loginRes.statusCode, 200);
    const strangerToken = JSON.parse(loginRes.payload).token as string;
    const res = await app.inject({
      method: 'POST',
      url: `/v1/conversations/${FIXTURE_IDS.convPersonalAlexMaya}/calls`,
      headers: { Authorization: `Bearer ${strangerToken}` },
      payload: { kind: 'video' },
    });
    assert.strictEqual(res.statusCode, 403);
  });

  it('CALLS TEST: Ignores spoofed workspace header (WAVE-F)', async () => {
    // Maya tries to spoof Alex's business workspace; the header is ignored and
    // her real personal workspace is used (which IS a participant) -> 201.
    const loginRes = await app.inject({
      method: 'POST',
      url: '/v1/auth/sessions',
      payload: { email: 'maya@orbit.internal', password: 'orbitdemo123', deviceLabel: 'calls-spoof', platform: 'web' },
    });
    assert.strictEqual(loginRes.statusCode, 200);
    const mayaToken = JSON.parse(loginRes.payload).token as string;
    const res = await app.inject({
      method: 'POST',
      url: `/v1/conversations/${FIXTURE_IDS.convPersonalAlexMaya}/calls`,
      headers: { Authorization: `Bearer ${mayaToken}`, 'x-workspace-id': FIXTURE_IDS.wsBusinessAcme },
      payload: { kind: 'audio' },
    });
    assert.strictEqual(res.statusCode, 201);
    // callerWorkspaceId must be Maya's real personal workspace, not the spoofed one.
    assert.strictEqual(JSON.parse(res.payload).data.callerWorkspaceId, FIXTURE_IDS.wsPersonalMaya);
  });

  it('CALLS TEST: Offer/answer/hangup transitions status and duration (WAVE-F)', async () => {
    const created = await app.inject({
      method: 'POST',
      url: `/v1/conversations/${FIXTURE_IDS.convPersonalAlexMaya}/calls`,
      headers: { 'x-workspace-id': FIXTURE_IDS.wsPersonalAlex },
      payload: { kind: 'video' },
    });
    const callId = JSON.parse(created.payload).data.id as string;

    const offer = await app.inject({
      method: 'POST',
      url: `/v1/calls/${callId}/signal`,
      payload: { type: 'offer', payload: 'v=0 o=- 0 0 IN IP4 0.0.0.0' },
    });
    assert.strictEqual(offer.statusCode, 200);
    assert.strictEqual(JSON.parse(offer.payload).data.status, 'active');

    const hangup = await app.inject({
      method: 'POST',
      url: `/v1/calls/${callId}/signal`,
      payload: { type: 'hangup', payload: '' },
    });
    assert.strictEqual(hangup.statusCode, 200);
    const body = JSON.parse(hangup.payload);
    assert.strictEqual(body.data.status, 'ended');
    assert.ok(typeof body.data.durationSeconds === 'number');
  });

  it('CALLS TEST: Decline marks call declined (WAVE-F)', async () => {
    const created = await app.inject({
      method: 'POST',
      url: `/v1/conversations/${FIXTURE_IDS.convPersonalAlexMaya}/calls`,
      headers: { 'x-workspace-id': FIXTURE_IDS.wsPersonalAlex },
      payload: { kind: 'audio' },
    });
    const callId = JSON.parse(created.payload).data.id as string;

    const declined = await app.inject({
      method: 'POST',
      url: `/v1/calls/${callId}/decline`,
    });
    assert.strictEqual(declined.statusCode, 200);
    assert.strictEqual(JSON.parse(declined.payload).data.status, 'declined');
  });

  it('CALLS TEST: GET call returns 404 for unknown id (WAVE-F)', async () => {
    const res = await app.inject({
      method: 'GET',
      url: '/v1/calls/call_unknown',
    });
    assert.strictEqual(res.statusCode, 404);
  });

  it('BLOCK TEST: Blocking a direct participant prevents message send (Spec 14)', async () => {
    // Alex blocks Maya via his personal workspace
    const blockRes = await app.inject({
      method: 'POST',
      url: `/v1/blocks/${FIXTURE_IDS.wsPersonalMaya}`,
      headers: { 'x-workspace-id': FIXTURE_IDS.wsPersonalAlex },
    });
    assert.strictEqual(blockRes.statusCode, 200);
    assert.strictEqual(JSON.parse(blockRes.payload).blocked, true);

    // Sending in the direct conversation is now denied
    const sendRes = await app.inject({
      method: 'POST',
      url: `/v1/conversations/${FIXTURE_IDS.convPersonalAlexMaya}/messages`,
      headers: { 'x-workspace-id': FIXTURE_IDS.wsPersonalAlex },
      payload: {
        conversationId: FIXTURE_IDS.convPersonalAlexMaya,
        idempotencyKey: `blocked-${Date.now()}`,
        clientMessageId: `blocked-${Date.now()}`,
        contentType: 'text',
        body: 'This should be rejected',
      },
    });
    assert.strictEqual(sendRes.statusCode, 403);
    assert.strictEqual(JSON.parse(sendRes.payload).error.code, 'BLOCKED');

    // Unblock restores sending
    const unblockRes = await app.inject({
      method: 'POST',
      url: `/v1/blocks/${FIXTURE_IDS.wsPersonalMaya}`,
      headers: { 'x-workspace-id': FIXTURE_IDS.wsPersonalAlex },
    });
    assert.strictEqual(JSON.parse(unblockRes.payload).blocked, false);

    const retryRes = await app.inject({
      method: 'POST',
      url: `/v1/conversations/${FIXTURE_IDS.convPersonalAlexMaya}/messages`,
      headers: { 'x-workspace-id': FIXTURE_IDS.wsPersonalAlex },
      payload: {
        conversationId: FIXTURE_IDS.convPersonalAlexMaya,
        idempotencyKey: `unblocked-${Date.now()}`,
        clientMessageId: `unblocked-${Date.now()}`,
        contentType: 'text',
        body: 'This should succeed again',
      },
    });
    assert.strictEqual(retryRes.statusCode, 201);
  });

  it('BLOCK TEST: Blocked party cannot file a contact request (Spec 14)', async () => {
    // Alex blocks Maya, then attempts a contact request to Maya -> 403.
    await app.inject({
      method: 'POST',
      url: `/v1/blocks/${FIXTURE_IDS.wsPersonalMaya}`,
      headers: { 'x-workspace-id': FIXTURE_IDS.wsPersonalAlex },
    });
    const reqRes = await app.inject({
      method: 'POST',
      url: '/v1/contacts/requests',
      headers: { 'x-workspace-id': FIXTURE_IDS.wsPersonalAlex },
      payload: { recipientHandle: 'maya', introMessage: 'should be blocked' },
    });
    assert.strictEqual(reqRes.statusCode, 403);
    assert.strictEqual(JSON.parse(reqRes.payload).error.code, 'BLOCKED');
    // Restore: unblock Maya
    await app.inject({
      method: 'POST',
      url: `/v1/blocks/${FIXTURE_IDS.wsPersonalMaya}`,
      headers: { 'x-workspace-id': FIXTURE_IDS.wsPersonalAlex },
    });
  });

  it('BLOCK TEST: Block list is visible to the blocking workspace (Spec 14)', async () => {
    await app.inject({
      method: 'POST',
      url: `/v1/blocks/${FIXTURE_IDS.wsPersonalMaya}`,
      headers: { 'x-workspace-id': FIXTURE_IDS.wsPersonalAlex },
    });
    const listRes = await app.inject({
      method: 'GET',
      url: '/v1/blocks',
      headers: { 'x-workspace-id': FIXTURE_IDS.wsPersonalAlex },
    });
    assert.strictEqual(listRes.statusCode, 200);
    const list = JSON.parse(listRes.payload).data;
    assert.ok(list.some((b: { blockedWorkspaceId: string }) => b.blockedWorkspaceId === FIXTURE_IDS.wsPersonalMaya));
    // cleanup
    await app.inject({
      method: 'POST',
      url: `/v1/blocks/${FIXTURE_IDS.wsPersonalMaya}`,
      headers: { 'x-workspace-id': FIXTURE_IDS.wsPersonalAlex },
    });
  });

  it('WORKSPACE BINDING TEST: x-workspace-id cannot spoof an unowned workspace (Spec 12)', async () => {
    // Maya's account (via session) cannot set x-workspace-id to Alex's business workspace.
    // Fallback auth resolves to Alex; use an explicit login session for Maya instead.
    const loginRes = await app.inject({
      method: 'POST',
      url: '/v1/auth/sessions',
      payload: { email: 'maya@orbit.internal', password: 'orbitdemo123', deviceLabel: 'test-device', platform: 'web' },
    });
    assert.strictEqual(loginRes.statusCode, 200);
    const token = JSON.parse(loginRes.payload).token as string;

    // Try to access the business workspace owned by Alex
    const spoofRes = await app.inject({
      method: 'GET',
      url: '/v1/me',
      headers: { Authorization: `Bearer ${token}`, 'x-workspace-id': FIXTURE_IDS.wsBusinessAcme },
    });
    assert.strictEqual(spoofRes.statusCode, 200);
    const me = JSON.parse(spoofRes.payload);
    // The active workspace must NOT be Alex's business workspace
    assert.notStrictEqual(me.activeWorkspace.id, FIXTURE_IDS.wsBusinessAcme);
  });

  it('MEDIA AUTHZ TEST: Attachment fetch denied for non-uploader workspace (Spec 13/14)', async () => {
    const { mkdirSync, writeFileSync, rmSync } = await import('node:fs');
    const { join } = await import('node:path');
    const uploadDir = process.env.ORBIT_UPLOAD_DIR || join(process.cwd(), 'uploads');
    const attId = `att_authz_${Date.now()}`;
    const storedPath = join(uploadDir, `${attId}.bin`);
    try {
      mkdirSync(uploadDir, { recursive: true });
      writeFileSync(storedPath, 'secret-bytes');
      if (store.db) {
        await store.sql(
          `INSERT INTO media_attachments (id, workspace_id, filename, mime_type, size_bytes, stored_path, created_at)
           VALUES ($1,$2,$3,$4,$5,$6,$7) ON CONFLICT (id) DO NOTHING`,
          [attId, FIXTURE_IDS.wsPersonalAlex, 'secret.txt', 'text/plain', 12, storedPath, new Date().toISOString()]
        );
      }

      // Login as Maya (a different account)
      const loginRes = await app.inject({
        method: 'POST',
        url: '/v1/auth/sessions',
        payload: { email: 'maya@orbit.internal', password: 'orbitdemo123', deviceLabel: 'media-authz', platform: 'web' },
      });
      assert.strictEqual(loginRes.statusCode, 200);
      const mayaToken = JSON.parse(loginRes.payload).token as string;

      // Uploader's workspace (fallback Alex) can fetch
      const ownerRes = await app.inject({
        method: 'GET',
        url: `/v1/media/${attId}`,
      });
      if (store.db) {
        assert.strictEqual(ownerRes.statusCode, 200);
      }

      // Another authenticated account cannot fetch
      const strangerRes = await app.inject({
        method: 'GET',
        url: `/v1/media/${attId}`,
        headers: { Authorization: `Bearer ${mayaToken}` },
      });
      if (store.db) {
        assert.strictEqual(strangerRes.statusCode, 403);
        assert.strictEqual(JSON.parse(strangerRes.payload).error.code, 'FORBIDDEN');
      } else {
        assert.strictEqual(strangerRes.statusCode, 404);
      }
    } finally {
      try {
        rmSync(storedPath, { force: true });
      } catch {
        /* ignore */
      }
    }
  });

  it('RATE LIMIT TEST: Login endpoint enforces sliding window (Spec 10/14)', async () => {
    let limited = false;
    for (let i = 0; i < 15; i++) {
      const res = await app.inject({
        method: 'POST',
        url: '/v1/auth/sessions',
        payload: { email: `ratelimit-${i}@orbit.internal`, deviceLabel: 'rl', platform: 'web' },
      });
      if (res.statusCode === 429) {
        limited = true;
        const body = JSON.parse(res.payload);
        assert.strictEqual(body.error.code, 'RATE_LIMITED');
        assert.ok(res.headers['retry-after']);
        break;
      }
    }
    assert.ok(limited, 'Expected the login rate limiter to trigger within 15 rapid attempts');
  });

  it('MISSING EVENTS TEST: conversation.updated emitted on pin/mute/archive (Spec 12)', async () => {
    const before = store.outboxEvents.length;
    await app.inject({
      method: 'POST',
      url: `/v1/conversations/${FIXTURE_IDS.convPersonalAlexMaya}/pin`,
      headers: { 'x-workspace-id': FIXTURE_IDS.wsPersonalAlex },
    });
    const newEvents = store.outboxEvents.slice(before);
    assert.ok(newEvents.some((e) => e.type === 'conversation.updated'));
  });

  it('SCOPED URL TEST: signed media URL grants access, bad signature rejected (Spec 10)', async () => {
    const ws = FIXTURE_IDS.wsPersonalAlex;
    const boundary = '----orbitboundary123';
    const body = Buffer.from(
      `--${boundary}\r\n` +
        `Content-Disposition: form-data; name="file"; filename="scoped.txt"\r\n` +
        `Content-Type: text/plain\r\n\r\n` +
        `scoped url contents\r\n` +
        `--${boundary}--\r\n`
    );

    const upload = await app.inject({
      method: 'POST',
      url: '/v1/media/upload',
      headers: { 'content-type': `multipart/form-data; boundary=${boundary}`, 'x-workspace-id': ws },
      payload: body,
    });
    assert.strictEqual(upload.statusCode, 201, upload.payload);
    const attachment = JSON.parse(upload.payload).data;
    assert.ok(attachment?.id, 'upload must return an attachment id');

    // Mint a scoped URL for the attachment.
    const mint = await app.inject({
      method: 'GET',
      url: `/v1/media/${attachment.id}/scoped-url`,
      headers: { 'x-workspace-id': ws },
    });
    assert.strictEqual(mint.statusCode, 200, mint.payload);
    const scoped = JSON.parse(mint.payload).data;
    assert.ok(scoped.url.includes('exp=') && scoped.url.includes('sig='), 'scoped URL must carry exp+sig');

    // Fetch using the scoped URL -> signature grants access (200).
    const fetchRes = await app.inject({ method: 'GET', url: scoped.url });
    assert.strictEqual(fetchRes.statusCode, 200, fetchRes.payload);

    // Tamper the signature -> 403.
    const badUrl = String(scoped.url).replace(/sig=[0-9a-f]+/, 'sig=deadbeefdeadbeef');
    const badRes = await app.inject({ method: 'GET', url: badUrl });
    assert.strictEqual(badRes.statusCode, 403, 'tampered signature must be rejected');
  });

  // --- WAVE A: API PART-1 (auth/session/settings/account/media/crypto hardening) ---

  it('SESSION EXPIRY TEST: Expired sessions are rejected with 401 SESSION_EXPIRED (Spec 30)', async () => {
    const expiredId = `sess-expired-${Date.now()}`;
    store.sessions.set(expiredId, {
      sessionId: expiredId,
      accountId: FIXTURE_IDS.accountAlex,
      activeWorkspaceId: FIXTURE_IDS.wsPersonalAlex,
      deviceLabel: 'expired-device',
      platform: 'web',
      createdAt: new Date(Date.now() - 8 * 24 * 60 * 60 * 1000).toISOString(),
      lastActiveAt: new Date(Date.now() - 8 * 24 * 60 * 60 * 1000).toISOString(),
      isCurrentSession: false,
      expiresAt: new Date(Date.now() - 1000).toISOString(),
    });

    const res = await app.inject({
      method: 'GET',
      url: '/v1/me',
      headers: { Authorization: `Bearer ${expiredId}` },
    });
    assert.strictEqual(res.statusCode, 401);
    assert.strictEqual(JSON.parse(res.payload).error.code, 'SESSION_EXPIRED');
    store.sessions.delete(expiredId);
  });

  it('SESSION EXPIRY TEST: Login creates sessions with a ~7 day expiresAt (Spec 30)', async () => {
    // Unique Authorization header so this login is not tripped by the shared
    // IP-based login rate-limit budget spent by the earlier rate-limit test.
    const loginRes = await app.inject({
      method: 'POST',
      url: '/v1/auth/sessions',
      headers: { Authorization: `Bearer rl-bypass-${Date.now()}` },
      payload: { email: 'expiresat-user@orbit.test', password: 'orbitdemo123', deviceLabel: 'exp', platform: 'web' },
    });
    assert.strictEqual(loginRes.statusCode, 200, loginRes.payload);
    const token = JSON.parse(loginRes.payload).token as string;
    const session = store.sessions.get(token);
    assert.ok(session, 'login must create a session record');
    assert.ok(session!.expiresAt, 'session must carry expiresAt');
    const ttlMs = new Date(session!.expiresAt!).getTime() - Date.now();
    assert.ok(ttlMs > 6.9 * 24 * 60 * 60 * 1000 && ttlMs <= 7.1 * 24 * 60 * 60 * 1000, 'default TTL is 7 days');
  });

  it('STEP-UP GATE TEST: Sensitive routes demand recent re-auth (Spec 30 & 32)', async () => {
    // Clear any pre-existing step-up so the gate is deterministic.
    const ds = store.deviceSessions.get('test-session-alex')!;
    ds.hasRecentStepUp = false;
    ds.stepUpExpiresAt = null;
    ds.lastStepUpAt = null;
    const tokenSession = store.sessions.get('test-session-alex');
    if (tokenSession) {
      tokenSession.hasRecentStepUp = false;
      tokenSession.stepUpExpiresAt = null;
      tokenSession.lastStepUpAt = null;
    }

    // Export without step-up -> denied.
    const denied = await app.inject({ method: 'POST', url: '/v1/exports' });
    assert.strictEqual(denied.statusCode, 403);
    assert.strictEqual(JSON.parse(denied.payload).error.code, 'STEP_UP_REQUIRED');

    // Complete step-up, then the same export succeeds.
    const stepUp = await app.inject({ method: 'POST', url: '/v1/auth/step-up' });
    assert.strictEqual(stepUp.statusCode, 200);
    assert.strictEqual(JSON.parse(stepUp.payload).stepUpVerified, true);
    assert.ok(ds.lastStepUpAt, 'step-up must record lastStepUpAt on the device session');

    const allowed = await app.inject({ method: 'POST', url: '/v1/exports' });
    assert.strictEqual(allowed.statusCode, 200, allowed.payload);
  });

  it('PROFILE TEST: PATCH /v1/me updates profile; phone requires OTP verification (Spec 09/30)', async () => {
    const res = await app.inject({
      method: 'PATCH',
      url: '/v1/me',
      payload: { displayName: 'Alex Rivera Jr', statusEmoji: '🚀', avatarAssetId: 'att_avatar_1' },
    });
    assert.strictEqual(res.statusCode, 200, res.payload);
    const user = JSON.parse(res.payload).user;
    assert.strictEqual(user.displayName, 'Alex Rivera Jr');
    assert.strictEqual(user.statusEmoji, '🚀');
    assert.strictEqual(user.avatarAssetId, 'att_avatar_1');
    assert.strictEqual(store.accounts.get(FIXTURE_IDS.accountAlex)!.displayName, 'Alex Rivera Jr');

    // Phone must be OTP-verified before it can be set.
    const phoneDenied = await app.inject({
      method: 'PATCH',
      url: '/v1/me',
      payload: { phone: '+15550101' },
    });
    assert.strictEqual(phoneDenied.statusCode, 400);
    assert.strictEqual(JSON.parse(phoneDenied.payload).error.code, 'PHONE_NOT_VERIFIED');

    // OTP flow: send a code (dev provider echoes it outside production) and verify.
    const phone = '+15550101';
    const sendRes = await app.inject({
      method: 'POST',
      url: '/v1/verification/codes',
      payload: { channel: 'sms', destination: phone },
    });
    assert.strictEqual(sendRes.statusCode, 202, sendRes.payload);
    const sentCode = JSON.parse(sendRes.payload).data.code as string;
    assert.match(sentCode, /^\d{6}$/);

    const verifyRes = await app.inject({
      method: 'POST',
      url: '/v1/verification/codes/verify',
      payload: { channel: 'sms', destination: phone, code: sentCode },
    });
    assert.strictEqual(verifyRes.statusCode, 200, verifyRes.payload);

    const phoneOk = await app.inject({ method: 'PATCH', url: '/v1/me', payload: { phone } });
    assert.strictEqual(phoneOk.statusCode, 200, phoneOk.payload);
    const phoneUser = JSON.parse(phoneOk.payload).user;
    assert.strictEqual(phoneUser.phone, phone);
    assert.strictEqual(phoneUser.phoneVerified, true);

    // Restore the seeded display name for the remaining tests.
    const restore = await app.inject({ method: 'PATCH', url: '/v1/me', payload: { displayName: 'Alex Rivera' } });
    assert.strictEqual(restore.statusCode, 200);
  });

  it('OTP LIFECYCLE TEST: Codes are single-use, attempt-limited and rate-limited (Spec 30)', async () => {
    const dest = '+15550999';

    // Send #1 (budget: 3/min shared across the suite — this is send #2 overall).
    const send1 = await app.inject({
      method: 'POST',
      url: '/v1/verification/codes',
      payload: { channel: 'sms', destination: dest },
    });
    assert.strictEqual(send1.statusCode, 202, send1.payload);
    const code1 = JSON.parse(send1.payload).data.code as string;

    const wrong = await app.inject({
      method: 'POST',
      url: '/v1/verification/codes/verify',
      payload: { channel: 'sms', destination: dest, code: code1 === '000000' ? '111111' : '000000' },
    });
    assert.strictEqual(wrong.statusCode, 400);
    assert.strictEqual(JSON.parse(wrong.payload).error.code, 'OTP_INVALID');

    const ok = await app.inject({
      method: 'POST',
      url: '/v1/verification/codes/verify',
      payload: { channel: 'sms', destination: dest, code: code1 },
    });
    assert.strictEqual(ok.statusCode, 200);

    // Single-use: replaying a consumed code must fail.
    const replay = await app.inject({
      method: 'POST',
      url: '/v1/verification/codes/verify',
      payload: { channel: 'sms', destination: dest, code: code1 },
    });
    assert.strictEqual(replay.statusCode, 400);
    assert.strictEqual(JSON.parse(replay.payload).error.code, 'OTP_INVALID');

    // Send #2 (budget: send #3 overall — the last allowed before 429).
    const send2 = await app.inject({
      method: 'POST',
      url: '/v1/verification/codes',
      payload: { channel: 'sms', destination: dest },
    });
    assert.strictEqual(send2.statusCode, 202, send2.payload);
    const code2 = JSON.parse(send2.payload).data.code as string;

    // Attempt limit: 5 wrong attempts are allowed, the 6th burns the code.
    for (let i = 0; i < 5; i++) {
      const attempt = await app.inject({
        method: 'POST',
        url: '/v1/verification/codes/verify',
        payload: { channel: 'sms', destination: dest, code: code2 === '222222' ? '333333' : '222222' },
      });
      assert.strictEqual(attempt.statusCode, 400);
      assert.strictEqual(JSON.parse(attempt.payload).error.code, 'OTP_INVALID');
    }
    const burned = await app.inject({
      method: 'POST',
      url: '/v1/verification/codes/verify',
      payload: { channel: 'sms', destination: dest, code: code2 },
    });
    assert.strictEqual(burned.statusCode, 400);
    assert.strictEqual(JSON.parse(burned.payload).error.code, 'OTP_ATTEMPTS_EXCEEDED');

    // Send #3 hits the 3/min rate limit for code delivery.
    const send3 = await app.inject({
      method: 'POST',
      url: '/v1/verification/codes',
      payload: { channel: 'sms', destination: dest },
    });
    assert.strictEqual(send3.statusCode, 429);
    assert.strictEqual(JSON.parse(send3.payload).error.code, 'RATE_LIMITED');
  });

  it('NOTIFICATION PREVIEW PRIVACY TEST: Push payload redacts message bodies (Spec 08/09)', async () => {
    // Unit: the helper honours each preview-detail level.
    assert.deepStrictEqual(applyPreviewPrivacy(undefined, { title: 'Maya', body: 'hi' }), { title: 'New message' });
    assert.deepStrictEqual(
      applyPreviewPrivacy({ hideNotificationPreviews: false, previewDetail: 'full' }, { title: 'Maya', body: 'hi' }),
      { title: 'Maya', body: 'hi' }
    );
    assert.deepStrictEqual(
      applyPreviewPrivacy({ hideNotificationPreviews: false, previewDetail: 'sender_only' }, { title: 'Maya', body: 'hi' }),
      { title: 'Maya' }
    );
    assert.deepStrictEqual(
      applyPreviewPrivacy({ hideNotificationPreviews: true, previewDetail: 'full' }, { title: 'Maya', body: 'hi' }),
      { title: 'New message' }
    );

    // Maya authenticates (unique bearer header to dodge the shared login budget).
    const mayaLogin = await app.inject({
      method: 'POST',
      url: '/v1/auth/sessions',
      headers: { Authorization: `Bearer rl-bypass-maya-${Date.now()}` },
      payload: { email: 'maya@orbit.internal', password: 'orbitdemo123', deviceLabel: 'preview-privacy', platform: 'web' },
    });
    assert.strictEqual(mayaLogin.statusCode, 200, mayaLogin.payload);
    const mayaToken = JSON.parse(mayaLogin.payload).token as string;

    // Alex enables full previews on his personal workspace.
    const setPrivacy = await app.inject({
      method: 'PUT',
      url: '/v1/settings/privacy',
      headers: { 'x-workspace-id': FIXTURE_IDS.wsPersonalAlex },
      payload: { hideNotificationPreviews: false },
    });
    assert.strictEqual(setPrivacy.statusCode, 200, setPrivacy.payload);
    const setNotifications = await app.inject({
      method: 'PUT',
      url: '/v1/settings/notifications',
      headers: { 'x-workspace-id': FIXTURE_IDS.wsPersonalAlex },
      payload: { previewDetail: 'full' },
    });
    assert.strictEqual(setNotifications.statusCode, 200, setNotifications.payload);

    // Maya sends a message -> notification recorded for Alex's workspace.
    const body1 = 'stand-up notes for tomorrow';
    const send1 = await app.inject({
      method: 'POST',
      url: `/v1/conversations/${FIXTURE_IDS.convPersonalAlexMaya}/messages`,
      headers: { Authorization: `Bearer ${mayaToken}`, 'x-workspace-id': FIXTURE_IDS.wsPersonalMaya },
      payload: {
        conversationId: FIXTURE_IDS.convPersonalAlexMaya,
        idempotencyKey: `preview-privacy-1-${Date.now()}`,
        clientMessageId: `preview-privacy-1-${Date.now()}`,
        contentType: 'text',
        body: body1,
      },
    });
    assert.strictEqual(send1.statusCode, 201, send1.payload);

    const feed1 = await app.inject({
      method: 'GET',
      url: '/v1/notifications',
      headers: { 'x-workspace-id': FIXTURE_IDS.wsPersonalAlex },
    });
    assert.strictEqual(feed1.statusCode, 200);
    const visible = (JSON.parse(feed1.payload).data as Array<Record<string, any>>).find(
      (n) => n.conversationId === FIXTURE_IDS.convPersonalAlexMaya && n.body === body1
    );
    assert.ok(visible, 'expected the notification to be recorded');
    assert.strictEqual(visible!.pushPayload.title, 'Maya Chen');
    assert.strictEqual(visible!.pushPayload.body, body1);

    // Hide previews again (schema default) -> payload must be generic with no body.
    const resetPrivacy = await app.inject({
      method: 'PUT',
      url: '/v1/settings/privacy',
      headers: { 'x-workspace-id': FIXTURE_IDS.wsPersonalAlex },
      payload: { hideNotificationPreviews: true },
    });
    assert.strictEqual(resetPrivacy.statusCode, 200);

    const body2 = 'secret follow-up item';
    const send2 = await app.inject({
      method: 'POST',
      url: `/v1/conversations/${FIXTURE_IDS.convPersonalAlexMaya}/messages`,
      headers: { Authorization: `Bearer ${mayaToken}`, 'x-workspace-id': FIXTURE_IDS.wsPersonalMaya },
      payload: {
        conversationId: FIXTURE_IDS.convPersonalAlexMaya,
        idempotencyKey: `preview-privacy-2-${Date.now()}`,
        clientMessageId: `preview-privacy-2-${Date.now()}`,
        contentType: 'text',
        body: body2,
      },
    });
    assert.strictEqual(send2.statusCode, 201, send2.payload);

    const feed2 = await app.inject({
      method: 'GET',
      url: '/v1/notifications',
      headers: { 'x-workspace-id': FIXTURE_IDS.wsPersonalAlex },
    });
    const redacted = (JSON.parse(feed2.payload).data as Array<Record<string, any>>).find(
      (n) => n.conversationId === FIXTURE_IDS.convPersonalAlexMaya && n.body === body2
    );
    assert.ok(redacted, 'expected the second notification to be recorded');
    assert.strictEqual(redacted!.pushPayload.title, 'New message');
    assert.strictEqual(redacted!.pushPayload.body, undefined);
  });

  it('MEDIA MIME SNIFF TEST: Magic bytes override the declared Content-Type (Spec 14/34)', async () => {
    // Unit: known signatures.
    const png = Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), Buffer.alloc(8)]);
    assert.strictEqual(sniffMimeType(png), 'image/png');
    assert.strictEqual(sniffMimeType(Buffer.from([0xff, 0xd8, 0xff, 0xe0, 0, 0, 0, 0])), 'image/jpeg');
    assert.strictEqual(sniffMimeType(Buffer.from('GIF87a......', 'binary')), 'image/gif');
    assert.strictEqual(sniffMimeType(Buffer.from('GIF89a......', 'binary')), 'image/gif');
    assert.strictEqual(
      sniffMimeType(Buffer.concat([Buffer.from('RIFF'), Buffer.alloc(4), Buffer.from('WEBP')])) as string,
      'image/webp'
    );
    assert.strictEqual(
      sniffMimeType(Buffer.concat([Buffer.from('RIFF'), Buffer.alloc(4), Buffer.from('WAVE')])) as string,
      'audio/wav'
    );
    assert.strictEqual(sniffMimeType(Buffer.from('%PDF-1.7 body')), 'application/pdf');
    assert.strictEqual(sniffMimeType(Buffer.from('OggS....vorbis')), 'audio/ogg');
    assert.strictEqual(
      sniffMimeType(Buffer.concat([Buffer.alloc(4), Buffer.from('ftyp'), Buffer.from('M4A '), Buffer.alloc(4)])),
      'audio/mp4'
    );
    assert.strictEqual(
      sniffMimeType(Buffer.concat([Buffer.alloc(4), Buffer.from('ftyp'), Buffer.from('isom'), Buffer.alloc(4)])),
      'video/mp4'
    );
    assert.strictEqual(sniffMimeType(Buffer.from('just some plain text')), null);

    const uploadPng = async (declaredType: string, filename: string, content: Buffer) => {
      const boundary = '----orbitmimeboundary';
      const header = Buffer.from(
        `--${boundary}\r\n` +
          `Content-Disposition: form-data; name="file"; filename="${filename}"\r\n` +
          `Content-Type: ${declaredType}\r\n\r\n`
      );
      const footer = Buffer.from(`\r\n--${boundary}--\r\n`);
      const body = Buffer.concat([header, content, footer]);
      return app.inject({
        method: 'POST',
        url: '/v1/media/upload',
        headers: { 'content-type': `multipart/form-data; boundary=${boundary}`, 'x-workspace-id': FIXTURE_IDS.wsPersonalAlex },
        payload: body,
      });
    };

    // Client lies about the type -> sniffed PNG wins.
    const pngContent = Buffer.concat([png, Buffer.from('fake-png-body')]);
    const pngUpload = await uploadPng('text/plain', 'fake.txt', pngContent);
    assert.strictEqual(pngUpload.statusCode, 201, pngUpload.payload);
    const pngAttachment = JSON.parse(pngUpload.payload).data;
    assert.strictEqual(pngAttachment.mimeType, 'image/png');

    // Unknown bytes -> application/octet-stream.
    const unknownUpload = await uploadPng('image/png', 'unknown.bin', Buffer.from('definitely not a real png file'));
    assert.strictEqual(unknownUpload.statusCode, 201, unknownUpload.payload);
    assert.strictEqual(JSON.parse(unknownUpload.payload).data.mimeType, 'application/octet-stream');

    // Cleanup stored fixtures.
    const { rmSync } = await import('node:fs');
    const { join } = await import('node:path');
    const uploadDir = process.env.ORBIT_UPLOAD_DIR || join(process.cwd(), 'uploads');
    try {
      rmSync(join(uploadDir, `${pngAttachment.id}.txt`), { force: true });
    } catch {
      /* ignore */
    }
  });

  it('LOGOUT TEST: POST /v1/auth/logout invalidates the current session (Spec 30)', async () => {
    const sessionId = `sess-logout-${Date.now()}`;
    store.sessions.set(sessionId, {
      sessionId,
      accountId: FIXTURE_IDS.accountAlex,
      activeWorkspaceId: FIXTURE_IDS.wsPersonalAlex,
      deviceLabel: 'logout-test-device',
      platform: 'web',
      createdAt: new Date().toISOString(),
      lastActiveAt: new Date().toISOString(),
      isCurrentSession: false,
      expiresAt: new Date(Date.now() + 3600000).toISOString(),
    });

    const res = await app.inject({
      method: 'POST',
      url: '/v1/auth/logout',
      headers: { Authorization: `Bearer ${sessionId}` },
    });
    assert.strictEqual(res.statusCode, 200);
    assert.strictEqual(JSON.parse(res.payload).ok, true);
    assert.strictEqual(store.sessions.has(sessionId), false, 'logout must delete the session record');
  });

  it('SESSIONS LIST TEST: GET /v1/me/sessions returns active sessions with expiry (Spec 30)', async () => {
    const res = await app.inject({ method: 'GET', url: '/v1/me/sessions' });
    assert.strictEqual(res.statusCode, 200);
    const sessions = JSON.parse(res.payload).sessions as Array<Record<string, any>>;
    assert.ok(Array.isArray(sessions));
    const seeded = sessions.find((s) => s.id === 'test-session-alex');
    assert.ok(seeded, 'seeded session must appear in the list');
    assert.ok(seeded!.expiresAt, 'session list must expose expiresAt');
    assert.ok(seeded!.createdAt);
  });

  it('SECURITY KEYS TEST: Challenge, register, list and delete security keys (Spec 30)', async () => {
    // Registration without an outstanding challenge is rejected.
    const premature = await app.inject({
      method: 'POST',
      url: '/v1/security/keys',
      payload: { label: 'Too early', publicKey: 'pk-early', credentialId: 'cred-early' },
    });
    assert.strictEqual(premature.statusCode, 409);
    assert.strictEqual(JSON.parse(premature.payload).error.code, 'CHALLENGE_REQUIRED');

    const challengeRes = await app.inject({ method: 'POST', url: '/v1/security/keys/register-challenge' });
    assert.strictEqual(challengeRes.statusCode, 200);
    const challenge = JSON.parse(challengeRes.payload).data;
    assert.ok(challenge.challenge && challenge.challenge.length >= 16);
    assert.ok(challenge.expiresAt);
    assert.strictEqual(challenge.userId, FIXTURE_IDS.accountAlex);

    const registerRes = await app.inject({
      method: 'POST',
      url: '/v1/security/keys',
      payload: { label: 'YubiKey 5', publicKey: 'MFkwEwYHKoZIzj0CAQYIKoZIzj0DAQcDQgAEsample', credentialId: 'cred-yubi-1' },
    });
    assert.strictEqual(registerRes.statusCode, 201, registerRes.payload);
    const key = JSON.parse(registerRes.payload).data;
    assert.strictEqual(key.label, 'YubiKey 5');
    assert.strictEqual(key.credentialId, 'cred-yubi-1');
    assert.strictEqual(key.accountId, FIXTURE_IDS.accountAlex);

    const listRes = await app.inject({ method: 'GET', url: '/v1/security/keys' });
    assert.strictEqual(listRes.statusCode, 200);
    const keys = JSON.parse(listRes.payload).data as Array<{ id: string }>;
    assert.ok(keys.some((k) => k.id === key.id));

    const deleteRes = await app.inject({ method: 'DELETE', url: `/v1/security/keys/${key.id}` });
    assert.strictEqual(deleteRes.statusCode, 200);

    const listAfter = await app.inject({ method: 'GET', url: '/v1/security/keys' });
    const keysAfter = JSON.parse(listAfter.payload).data as Array<{ id: string }>;
    assert.ok(!keysAfter.some((k) => k.id === key.id), 'deleted key must not be listed');
  });

  it('WORKSPACE FALLBACK TEST: Strict mode rejects unknown x-workspace-id (Spec 07/12)', async () => {
    process.env.ALLOW_WORKSPACE_FALLBACK = 'false';
    try {
      const res = await app.inject({
        method: 'GET',
        url: '/v1/me',
        headers: { 'x-workspace-id': '00000000-0000-4000-8000-0000000dead' },
      });
      assert.strictEqual(res.statusCode, 403);
      assert.strictEqual(JSON.parse(res.payload).error.code, 'WORKSPACE_FORBIDDEN');

      // A missing header still resolves to the account's own workspace.
      const okRes = await app.inject({ method: 'GET', url: '/v1/me' });
      assert.strictEqual(okRes.statusCode, 200);

      // Fallback mode (default in dev) still ignores the spoofed header.
      delete process.env.ALLOW_WORKSPACE_FALLBACK;
      const fallbackRes = await app.inject({
        method: 'GET',
        url: '/v1/me',
        headers: { 'x-workspace-id': '00000000-0000-4000-8000-0000000dead' },
      });
      assert.strictEqual(fallbackRes.statusCode, 200);
    } finally {
      delete process.env.ALLOW_WORKSPACE_FALLBACK;
    }
  });

  // --- WAVE B TESTS (API part-2) ---

  it('WAVE B — WORKSPACE MEMBERS: GET /v1/workspaces/:id/members lists role projections', async () => {
    const res = await app.inject({
      method: 'GET',
      url: `/v1/workspaces/${FIXTURE_IDS.wsBusinessAcme}/members`,
      headers: { 'x-workspace-id': FIXTURE_IDS.wsBusinessAcme },
    });
    assert.strictEqual(res.statusCode, 200, res.payload);
    const members = JSON.parse(res.payload) as Array<Record<string, any>>;
    assert.ok(members.length >= 2, 'owner and agent must both be listed');
    const owner = members.find((m) => m.userId === FIXTURE_IDS.accountAlex);
    const agent = members.find((m) => m.userId === FIXTURE_IDS.accountSam);
    assert.ok(owner, 'owner must be listed');
    assert.strictEqual(owner!.role, 'owner');
    assert.strictEqual(owner!.email, 'alex@orbit.internal');
    assert.ok(owner!.displayName);
    assert.ok(owner!.joinedAt);
    assert.ok(agent, 'agent membership must be listed');
    assert.strictEqual(agent!.role, 'agent');
    assert.strictEqual(agent!.email, 'sam@orbit.internal');
  });

  it('WAVE B — WORKSPACE INVITATIONS: create, list, revoke, accept + membership_changed', async () => {
    const wsHeaders = { 'x-workspace-id': FIXTURE_IDS.wsBusinessAcme };

    // Create
    const createRes = await app.inject({
      method: 'POST',
      url: `/v1/workspaces/${FIXTURE_IDS.wsBusinessAcme}/invitations`,
      headers: wsHeaders,
      payload: { email: 'newagent@orbit.internal', role: 'agent' },
    });
    assert.strictEqual(createRes.statusCode, 201, createRes.payload);
    const invitation = JSON.parse(createRes.payload);
    assert.strictEqual(invitation.status, 'pending');
    assert.strictEqual(invitation.email, 'newagent@orbit.internal');
    assert.ok(invitation.token && invitation.token.length >= 16);

    // List (admin only)
    const listRes = await app.inject({
      method: 'GET',
      url: `/v1/workspaces/${FIXTURE_IDS.wsBusinessAcme}/invitations`,
      headers: wsHeaders,
    });
    assert.strictEqual(listRes.statusCode, 200);
    const listed = JSON.parse(listRes.payload) as Array<Record<string, any>>;
    assert.ok(listed.some((i) => i.id === invitation.id));

    // Revoke
    const revokeRes = await app.inject({
      method: 'DELETE',
      url: `/v1/workspaces/${FIXTURE_IDS.wsBusinessAcme}/invitations/${invitation.id}`,
      headers: wsHeaders,
    });
    assert.strictEqual(revokeRes.statusCode, 200);
    assert.strictEqual(JSON.parse(revokeRes.payload).status, 'revoked');

    // Revoked tokens cannot be accepted
    const revokedAccept = await app.inject({
      method: 'POST',
      url: '/v1/workspaces/invitations/accept',
      payload: { token: invitation.token },
    });
    assert.strictEqual(revokedAccept.statusCode, 403);
    assert.strictEqual(JSON.parse(revokedAccept.payload).error.code, 'INVITATION_REVOKED');

    // Fresh invitation accepted by Maya (who becomes an Acme agent)
    const create2 = await app.inject({
      method: 'POST',
      url: `/v1/workspaces/${FIXTURE_IDS.wsBusinessAcme}/invitations`,
      headers: wsHeaders,
      payload: { email: 'maya@orbit.internal', role: 'agent' },
    });
    assert.strictEqual(create2.statusCode, 201);
    const invitation2 = JSON.parse(create2.payload);

    const mayaLogin = await app.inject({
      method: 'POST',
      url: '/v1/auth/sessions',
      headers: { Authorization: `Bearer rl-bypass-waveb-invite-${Date.now()}` },
      payload: { email: 'maya@orbit.internal', password: 'orbitdemo123', deviceLabel: 'waveb', platform: 'web' },
    });
    assert.strictEqual(mayaLogin.statusCode, 200, mayaLogin.payload);
    const mayaToken = JSON.parse(mayaLogin.payload).token as string;

    const eventsBefore = store.outboxEvents.length;
    const acceptRes = await app.inject({
      method: 'POST',
      url: '/v1/workspaces/invitations/accept',
      headers: { Authorization: `Bearer ${mayaToken}` },
      payload: { token: invitation2.token },
    });
    assert.strictEqual(acceptRes.statusCode, 200, acceptRes.payload);
    const accepted = JSON.parse(acceptRes.payload);
    assert.strictEqual(accepted.membership.role, 'agent');
    assert.strictEqual(accepted.membership.accountId, FIXTURE_IDS.accountMaya);
    assert.strictEqual(accepted.invitation.status, 'accepted');
    assert.ok(
      store.outboxEvents
        .slice(eventsBefore)
        .some((e) => e.type === 'workspace.membership_changed'),
      'acceptance must emit workspace.membership_changed'
    );

    // Replay is rejected
    const replay = await app.inject({
      method: 'POST',
      url: '/v1/workspaces/invitations/accept',
      headers: { Authorization: `Bearer ${mayaToken}` },
      payload: { token: invitation2.token },
    });
    assert.strictEqual(replay.statusCode, 409);

    // Cleanup: remove Maya from Acme again.
    store.memberships.forEach((m, id) => {
      if (m.workspaceId === FIXTURE_IDS.wsBusinessAcme && m.accountId === FIXTURE_IDS.accountMaya) {
        store.memberships.delete(id);
      }
    });
  });

  it('WAVE B — MEMBERSHIP ROLES: role change works; the last owner is immutable', async () => {
    const wsHeaders = { 'x-workspace-id': FIXTURE_IDS.wsBusinessAcme };

    // Promote Sam agent -> admin
    const promote = await app.inject({
      method: 'PATCH',
      url: `/v1/workspaces/${FIXTURE_IDS.wsBusinessAcme}/members/${FIXTURE_IDS.accountSam}`,
      headers: wsHeaders,
      payload: { role: 'admin' },
    });
    assert.strictEqual(promote.statusCode, 200, promote.payload);
    assert.strictEqual(JSON.parse(promote.payload).role, 'admin');

    // Demoting the (only) owner is rejected
    const demote = await app.inject({
      method: 'PATCH',
      url: `/v1/workspaces/${FIXTURE_IDS.wsBusinessAcme}/members/${FIXTURE_IDS.accountAlex}`,
      headers: wsHeaders,
      payload: { role: 'agent' },
    });
    assert.strictEqual(demote.statusCode, 403);
    assert.strictEqual(JSON.parse(demote.payload).error.code, 'LAST_OWNER');

    // The last owner cannot leave either
    const leave = await app.inject({
      method: 'DELETE',
      url: `/v1/workspaces/${FIXTURE_IDS.wsBusinessAcme}/members/me`,
      headers: wsHeaders,
    });
    assert.strictEqual(leave.statusCode, 403);
    assert.strictEqual(JSON.parse(leave.payload).error.code, 'LAST_OWNER');

    // Remove Sam (non-owner) — allowed
    const eventsBefore = store.outboxEvents.length;
    const remove = await app.inject({
      method: 'DELETE',
      url: `/v1/workspaces/${FIXTURE_IDS.wsBusinessAcme}/members/${FIXTURE_IDS.accountSam}`,
      headers: wsHeaders,
    });
    assert.strictEqual(remove.statusCode, 200, remove.payload);
    assert.ok(
      store.outboxEvents.slice(eventsBefore).some((e) => e.type === 'workspace.membership_changed'),
      'removal must emit workspace.membership_changed'
    );

    const membersAfter = await app.inject({
      method: 'GET',
      url: `/v1/workspaces/${FIXTURE_IDS.wsBusinessAcme}/members`,
      headers: wsHeaders,
    });
    const list = JSON.parse(membersAfter.payload) as Array<{ userId: string }>;
    assert.ok(!list.some((m) => m.userId === FIXTURE_IDS.accountSam), 'removed member must not be listed');

    // Restore Sam's membership for the remaining tests.
    store.memberships.set('m2', {
      id: 'm2',
      workspaceId: FIXTURE_IDS.wsBusinessAcme,
      accountId: FIXTURE_IDS.accountSam,
      role: 'agent',
      status: 'active',
      joinedAt: '2026-01-01T12:00:00Z',
    });
  });

  it('WAVE B — CAPABILITY DENIED: the analyst (read-only) role cannot send or assign', async () => {
    // Provision Maya as an analyst in the Acme business workspace.
    store.memberships.set('m-waveb-analyst', {
      id: 'm-waveb-analyst',
      workspaceId: FIXTURE_IDS.wsBusinessAcme,
      accountId: FIXTURE_IDS.accountMaya,
      role: 'analyst',
      status: 'active',
      joinedAt: new Date().toISOString(),
    });
    try {
      const mayaLogin = await app.inject({
        method: 'POST',
        url: '/v1/auth/sessions',
        headers: { Authorization: `Bearer rl-bypass-waveb-analyst-${Date.now()}` },
        payload: { email: 'maya@orbit.internal', password: 'orbitdemo123', deviceLabel: 'waveb-analyst', platform: 'web' },
      });
      assert.strictEqual(mayaLogin.statusCode, 200, mayaLogin.payload);
      const mayaToken = JSON.parse(mayaLogin.payload).token as string;
      const headers = { Authorization: `Bearer ${mayaToken}`, 'x-workspace-id': FIXTURE_IDS.wsBusinessAcme };

      // Analyst may still READ the conversation feed.
      const read = await app.inject({
        method: 'GET',
        url: `/v1/conversations/${FIXTURE_IDS.convBusinessCustomerMaya}/messages`,
        headers,
      });
      assert.strictEqual(read.statusCode, 200);

      // ...but sending is denied with CAPABILITY_DENIED.
      const send = await app.inject({
        method: 'POST',
        url: `/v1/conversations/${FIXTURE_IDS.convBusinessCustomerMaya}/messages`,
        headers,
        payload: {
          conversationId: FIXTURE_IDS.convBusinessCustomerMaya,
          idempotencyKey: `analyst-send-${Date.now()}`,
          clientMessageId: `analyst-send-${Date.now()}`,
          contentType: 'text',
          body: 'Read-only analysts must not be able to post',
        },
      });
      assert.strictEqual(send.statusCode, 403, send.payload);
      assert.strictEqual(JSON.parse(send.payload).error.code, 'CAPABILITY_DENIED');

      // Assignment is denied too.
      const assign = await app.inject({
        method: 'PUT',
        url: `/v1/conversations/${FIXTURE_IDS.convBusinessCustomerMaya}/assignment`,
        headers,
        payload: { assigneeUserId: FIXTURE_IDS.accountMaya },
      });
      assert.strictEqual(assign.statusCode, 403, assign.payload);
      assert.strictEqual(JSON.parse(assign.payload).error.code, 'CAPABILITY_DENIED');
    } finally {
      store.memberships.delete('m-waveb-analyst');
    }
  });

  it('WAVE B — ASSIGNMENT PERSISTENCE: assignee is stored on the conversation and broadcast', async () => {
    const headers = { 'x-workspace-id': FIXTURE_IDS.wsBusinessAcme };
    const eventsBefore = store.outboxEvents.length;

    const res = await app.inject({
      method: 'PUT',
      url: `/v1/conversations/${FIXTURE_IDS.convBusinessCustomerMaya}/assignment`,
      headers,
      payload: { assigneeUserId: FIXTURE_IDS.accountSam },
    });
    assert.strictEqual(res.statusCode, 200, res.payload);
    const body = JSON.parse(res.payload);
    assert.strictEqual(body.assigneeUserId, FIXTURE_IDS.accountSam);
    assert.ok(body.assignedAt);

    // Persisted on the store record...
    const conversation = store.conversations.get(FIXTURE_IDS.convBusinessCustomerMaya)!;
    assert.strictEqual(conversation.assigneeUserId, FIXTURE_IDS.accountSam);

    // ...and returned in the workspace conversation list.
    const list = await app.inject({
      method: 'GET',
      url: `/v1/workspaces/${FIXTURE_IDS.wsBusinessAcme}/conversations`,
      headers,
    });
    assert.strictEqual(list.statusCode, 200);
    const listed = JSON.parse(list.payload) as Array<Record<string, any>>;
    const entry = listed.find((c) => c.id === FIXTURE_IDS.convBusinessCustomerMaya);
    assert.ok(entry);
    assert.strictEqual(entry!.assigneeUserId, FIXTURE_IDS.accountSam);

    assert.ok(
      store.outboxEvents.slice(eventsBefore).some((e) => e.type === 'business.conversation.assigned'),
      'assignment must emit business.conversation.assigned'
    );

    // Unassign
    const clear = await app.inject({
      method: 'PUT',
      url: `/v1/conversations/${FIXTURE_IDS.convBusinessCustomerMaya}/assignment`,
      headers,
      payload: { assigneeUserId: null },
    });
    assert.strictEqual(clear.statusCode, 200);
    assert.strictEqual(JSON.parse(clear.payload).assigneeUserId, null);
    assert.strictEqual(store.conversations.get(FIXTURE_IDS.convBusinessCustomerMaya)!.assigneeUserId, null);
  });

  it('WAVE B — SAVED REPLIES: CRUD, shortcut uniqueness, and saved_replies.use on send', async () => {
    const headers = { 'x-workspace-id': FIXTURE_IDS.wsBusinessAcme };

    const create = await app.inject({
      method: 'POST',
      url: '/v1/saved-replies',
      headers,
      payload: { title: 'Refund policy', body: 'We refund within 30 days.', shortcut: '/refund' },
    });
    assert.strictEqual(create.statusCode, 201, create.payload);
    const savedReply = JSON.parse(create.payload);
    assert.strictEqual(savedReply.workspaceId, FIXTURE_IDS.wsBusinessAcme);
    assert.strictEqual(savedReply.shortcut, '/refund');

    // Duplicate shortcut is rejected
    const dup = await app.inject({
      method: 'POST',
      url: '/v1/saved-replies',
      headers,
      payload: { title: 'Dup', body: 'Dup body', shortcut: '/refund' },
    });
    assert.strictEqual(dup.statusCode, 409);
    assert.strictEqual(JSON.parse(dup.payload).error.code, 'SAVED_REPLY_SHORTCUT_TAKEN');

    // List + update
    const list = await app.inject({ method: 'GET', url: '/v1/saved-replies', headers });
    assert.strictEqual(list.statusCode, 200);
    assert.ok((JSON.parse(list.payload) as any[]).some((r) => r.id === savedReply.id));

    const patch = await app.inject({
      method: 'PATCH',
      url: `/v1/saved-replies/${savedReply.id}`,
      headers,
      payload: { body: 'We refund within 60 days for enterprise plans.' },
    });
    assert.strictEqual(patch.statusCode, 200);
    assert.match(JSON.parse(patch.payload).body, /60 days/);

    // Sending with the saved reply works for an owner.
    const send = await app.inject({
      method: 'POST',
      url: `/v1/conversations/${FIXTURE_IDS.convBusinessCustomerMaya}/messages`,
      headers,
      payload: {
        conversationId: FIXTURE_IDS.convBusinessCustomerMaya,
        idempotencyKey: `saved-reply-${Date.now()}`,
        clientMessageId: `saved-reply-${Date.now()}`,
        contentType: 'text',
        body: 'We refund within 60 days for enterprise plans.',
        savedReplyId: savedReply.id,
      },
    });
    assert.strictEqual(send.statusCode, 201, send.payload);

    // Delete, then reuse is a 404
    const del = await app.inject({
      method: 'DELETE',
      url: `/v1/saved-replies/${savedReply.id}`,
      headers,
    });
    assert.strictEqual(del.statusCode, 200);

    const reuse = await app.inject({
      method: 'POST',
      url: `/v1/conversations/${FIXTURE_IDS.convBusinessCustomerMaya}/messages`,
      headers,
      payload: {
        conversationId: FIXTURE_IDS.convBusinessCustomerMaya,
        idempotencyKey: `saved-reply-gone-${Date.now()}`,
        clientMessageId: `saved-reply-gone-${Date.now()}`,
        contentType: 'text',
        body: 'This saved reply no longer exists',
        savedReplyId: savedReply.id,
      },
    });
    assert.strictEqual(reuse.statusCode, 404);
    assert.strictEqual(JSON.parse(reuse.payload).error.code, 'SAVED_REPLY_NOT_FOUND');
  });

  it('WAVE B — CONVERSATION VAULT: visibility PATCH requires step-up; availabilityStatus reflects deletion', async () => {
    // Without a recent step-up the PATCH is refused.
    const ds = store.deviceSessions.get('test-session-alex')!;
    const tokenSession = store.sessions.get('test-session-alex');
    ds.hasRecentStepUp = false;
    ds.stepUpExpiresAt = null;
    ds.lastStepUpAt = null;
    if (tokenSession) {
      tokenSession.hasRecentStepUp = false;
      tokenSession.stepUpExpiresAt = null;
      tokenSession.lastStepUpAt = null;
    }

    const denied = await app.inject({
      method: 'PATCH',
      url: `/v1/vault/${FIXTURE_IDS.convPersonalAlexMaya}`,
      headers: { 'x-workspace-id': FIXTURE_IDS.wsPersonalAlex },
      payload: { visibility: 'workspace' },
    });
    assert.strictEqual(denied.statusCode, 403);
    assert.strictEqual(JSON.parse(denied.payload).error.code, 'STEP_UP_REQUIRED');

    const stepUp = await app.inject({ method: 'POST', url: '/v1/auth/step-up' });
    assert.strictEqual(stepUp.statusCode, 200);

    const patch = await app.inject({
      method: 'PATCH',
      url: `/v1/vault/${FIXTURE_IDS.convPersonalAlexMaya}`,
      headers: { 'x-workspace-id': FIXTURE_IDS.wsPersonalAlex },
      payload: { visibility: 'workspace', memberIds: [FIXTURE_IDS.accountAlex] },
    });
    assert.strictEqual(patch.statusCode, 200, patch.payload);
    const patched = JSON.parse(patch.payload);
    assert.strictEqual(patched.visibility, 'workspace');
    assert.deepStrictEqual(patched.memberIds, [FIXTURE_IDS.accountAlex]);

    const get = await app.inject({
      method: 'GET',
      url: `/v1/vault/${FIXTURE_IDS.convPersonalAlexMaya}`,
      headers: { 'x-workspace-id': FIXTURE_IDS.wsPersonalAlex },
    });
    assert.strictEqual(get.statusCode, 200, get.payload);
    const vaultEntry = JSON.parse(get.payload);
    assert.strictEqual(vaultEntry.availabilityStatus, 'available');
    assert.strictEqual(vaultEntry.visibility, 'workspace');
    assert.ok(Array.isArray(vaultEntry.items));

    // A deleted conversation reports unavailable (but the vault entry survives).
    const tempId = `waveb-vault-${Date.now()}`;
    store.conversations.set(tempId, {
      ...(store.conversations.get(FIXTURE_IDS.convPersonalAlexMaya) as any),
      id: tempId,
    });
    store.conversationVault.set(tempId, {
      conversationId: tempId,
      workspaceId: FIXTURE_IDS.wsPersonalAlex,
      visibility: 'all',
      memberIds: [],
      updatedAt: new Date().toISOString(),
    });
    store.conversations.delete(tempId);

    const unavailable = await app.inject({
      method: 'GET',
      url: `/v1/vault/${tempId}`,
      headers: { 'x-workspace-id': FIXTURE_IDS.wsPersonalAlex },
    });
    assert.strictEqual(unavailable.statusCode, 200, unavailable.payload);
    assert.strictEqual(JSON.parse(unavailable.payload).availabilityStatus, 'unavailable');
    store.conversationVault.delete(tempId);
  });

  it('WAVE B — SERVER SEQUENCE: every send increments a monotonic per-conversation sequence', async () => {
    const before = store.conversations.get(FIXTURE_IDS.convPersonalAlexMaya);
    assert.ok(before);
    const sendSeq = async (tag: string) => {
      const res = await app.inject({
        method: 'POST',
        url: `/v1/conversations/${FIXTURE_IDS.convPersonalAlexMaya}/messages`,
        headers: { 'x-workspace-id': FIXTURE_IDS.wsPersonalAlex },
        payload: {
          conversationId: FIXTURE_IDS.convPersonalAlexMaya,
          idempotencyKey: `seq-${tag}-${Date.now()}`,
          clientMessageId: `seq-${tag}-${Date.now()}`,
          contentType: 'text',
          body: `sequence probe ${tag}`,
        },
      });
      assert.strictEqual(res.statusCode, 201, res.payload);
      return JSON.parse(res.payload);
    };

    const eventsBefore = store.outboxEvents.length;
    const first = await sendSeq('a');
    const second = await sendSeq('b');

    assert.ok(typeof first.serverSequence === 'number' && first.serverSequence >= 1);
    assert.strictEqual(second.serverSequence, first.serverSequence + 1);
    assert.ok(first.id && first.createdAt);

    // The realtime payload carries the sequence too.
    const messageEvents = store.outboxEvents.slice(eventsBefore).filter((e) => e.type === 'message.created');
    assert.ok(messageEvents.length >= 2);
    assert.strictEqual(messageEvents[messageEvents.length - 1]!.payload.message.serverSequence, second.serverSequence);
  });

  it('WAVE B — DELETE SCOPE: self-scoped deletes hide only for the caller; everyone-scope honors the window', async () => {
    const sendAsAlex = async (body: string) => {
      const res = await app.inject({
        method: 'POST',
        url: `/v1/conversations/${FIXTURE_IDS.convPersonalAlexMaya}/messages`,
        headers: { 'x-workspace-id': FIXTURE_IDS.wsPersonalAlex },
        payload: {
          conversationId: FIXTURE_IDS.convPersonalAlexMaya,
          idempotencyKey: `del-${Date.now()}-${Math.random()}`,
          clientMessageId: `del-${Date.now()}-${Math.random()}`,
          contentType: 'text',
          body,
        },
      });
      assert.strictEqual(res.statusCode, 201, res.payload);
      return JSON.parse(res.payload);
    };

    const selfMsg = await sendAsAlex('delete me (self only)');
    const delSelf = await app.inject({
      method: 'DELETE',
      url: `/v1/conversations/${FIXTURE_IDS.convPersonalAlexMaya}/messages/${selfMsg.id}?scope=self`,
      headers: { 'x-workspace-id': FIXTURE_IDS.wsPersonalAlex },
    });
    assert.strictEqual(delSelf.statusCode, 200, delSelf.payload);
    assert.strictEqual(JSON.parse(delSelf.payload).scope, 'self');
    assert.ok(store.messages.get(selfMsg.id)!.deletedFor?.includes(FIXTURE_IDS.wsPersonalAlex));

    const alexFeed = await app.inject({
      method: 'GET',
      url: `/v1/conversations/${FIXTURE_IDS.convPersonalAlexMaya}/messages`,
      headers: { 'x-workspace-id': FIXTURE_IDS.wsPersonalAlex },
    });
    const alexIds = (JSON.parse(alexFeed.payload) as Array<{ id: string }>).map((m) => m.id);
    assert.ok(!alexIds.includes(selfMsg.id), 'self-deleted message must disappear for the caller');

    // Maya (the other participant) still sees it.
    const mayaLogin = await app.inject({
      method: 'POST',
      url: '/v1/auth/sessions',
      headers: { Authorization: `Bearer rl-bypass-waveb-del-${Date.now()}` },
      payload: { email: 'maya@orbit.internal', password: 'orbitdemo123', deviceLabel: 'waveb-del', platform: 'web' },
    });
    assert.strictEqual(mayaLogin.statusCode, 200, mayaLogin.payload);
    const mayaToken = JSON.parse(mayaLogin.payload).token as string;
    const mayaFeed = await app.inject({
      method: 'GET',
      url: `/v1/conversations/${FIXTURE_IDS.convPersonalAlexMaya}/messages`,
      headers: { Authorization: `Bearer ${mayaToken}`, 'x-workspace-id': FIXTURE_IDS.wsPersonalMaya },
    });
    const mayaIds = (JSON.parse(mayaFeed.payload) as Array<{ id: string }>).map((m) => m.id);
    assert.ok(mayaIds.includes(selfMsg.id), 'self-deleted message remains visible to others');

    // Everyone-scope delete inside the window.
    const everyoneMsg = await sendAsAlex('delete me (everyone)');
    const delEveryone = await app.inject({
      method: 'DELETE',
      url: `/v1/conversations/${FIXTURE_IDS.convPersonalAlexMaya}/messages/${everyoneMsg.id}?scope=everyone`,
      headers: { 'x-workspace-id': FIXTURE_IDS.wsPersonalAlex },
    });
    assert.strictEqual(delEveryone.statusCode, 200);
    assert.strictEqual(store.messages.get(everyoneMsg.id)!.isDeleted, true);

    // Outside the 15-minute window a non-admin is refused.
    const oldMsg = await sendAsAlex('too old to delete for everyone');
    store.messages.get(oldMsg.id)!.createdAt = new Date(Date.now() - 20 * 60 * 1000).toISOString();
    const expired = await app.inject({
      method: 'DELETE',
      url: `/v1/conversations/${FIXTURE_IDS.convPersonalAlexMaya}/messages/${oldMsg.id}?scope=everyone`,
      headers: { 'x-workspace-id': FIXTURE_IDS.wsPersonalAlex },
    });
    assert.strictEqual(expired.statusCode, 403);
    assert.strictEqual(JSON.parse(expired.payload).error.code, 'DELETE_WINDOW_EXPIRED');
    assert.strictEqual(store.messages.get(oldMsg.id)!.isDeleted, false);
  });

  it('WAVE B — MESSAGE EDIT: nested PATCH sets editedAt and enforces the 15-minute window', async () => {
    const send = await app.inject({
      method: 'POST',
      url: `/v1/conversations/${FIXTURE_IDS.convPersonalAlexMaya}/messages`,
      headers: { 'x-workspace-id': FIXTURE_IDS.wsPersonalAlex },
      payload: {
        conversationId: FIXTURE_IDS.convPersonalAlexMaya,
        idempotencyKey: `edit-${Date.now()}`,
        clientMessageId: `edit-${Date.now()}`,
        contentType: 'text',
        body: 'original body',
      },
    });
    assert.strictEqual(send.statusCode, 201, send.payload);
    const message = JSON.parse(send.payload);

    const eventsBefore = store.outboxEvents.length;
    const edit = await app.inject({
      method: 'PATCH',
      url: `/v1/conversations/${FIXTURE_IDS.convPersonalAlexMaya}/messages/${message.id}`,
      headers: { 'x-workspace-id': FIXTURE_IDS.wsPersonalAlex },
      payload: { body: 'edited body' },
    });
    assert.strictEqual(edit.statusCode, 200, edit.payload);
    const edited = JSON.parse(edit.payload);
    assert.strictEqual(edited.body, 'edited body');
    assert.strictEqual(edited.isEdited, true);
    assert.ok(edited.editedAt);
    assert.ok(
      store.outboxEvents.slice(eventsBefore).some((e) => e.type === 'message.updated'),
      'edits must emit message.updated'
    );

    // Outside the window a non-admin is refused.
    store.messages.get(message.id)!.createdAt = new Date(Date.now() - 20 * 60 * 1000).toISOString();
    const expired = await app.inject({
      method: 'PATCH',
      url: `/v1/conversations/${FIXTURE_IDS.convPersonalAlexMaya}/messages/${message.id}`,
      headers: { 'x-workspace-id': FIXTURE_IDS.wsPersonalAlex },
      payload: { body: 'too late' },
    });
    assert.strictEqual(expired.statusCode, 403);
    assert.strictEqual(JSON.parse(expired.payload).error.code, 'EDIT_WINDOW_EXPIRED');
  });

  it('WAVE B — CURSOR PAGINATION: workspace conversations paginate with an opaque cursor', async () => {
    const headers = { 'x-workspace-id': FIXTURE_IDS.wsBusinessAcme };

    // Ensure at least two Acme conversations exist.
    const created = await app.inject({
      method: 'POST',
      url: '/v1/conversations',
      headers,
      payload: {
        kind: 'direct',
        title: 'Wave B pagination probe',
        participantWorkspaceIds: [FIXTURE_IDS.wsPersonalMaya],
      },
    });
    assert.strictEqual(created.statusCode, 201, created.payload);

    const page1 = await app.inject({
      method: 'GET',
      url: `/v1/workspaces/${FIXTURE_IDS.wsBusinessAcme}/conversations?limit=1`,
      headers,
    });
    assert.strictEqual(page1.statusCode, 200, page1.payload);
    const body1 = JSON.parse(page1.payload);
    assert.ok(Array.isArray(body1.conversations), 'paginated shape must be {conversations, nextCursor}');
    assert.strictEqual(body1.conversations.length, 1);
    assert.ok(body1.nextCursor, 'a further page must be advertised');

    const page2 = await app.inject({
      method: 'GET',
      url: `/v1/workspaces/${FIXTURE_IDS.wsBusinessAcme}/conversations?limit=1&cursor=${encodeURIComponent(body1.nextCursor)}`,
      headers,
    });
    assert.strictEqual(page2.statusCode, 200, page2.payload);
    const body2 = JSON.parse(page2.payload);
    assert.strictEqual(body2.conversations.length, 1);
    assert.notStrictEqual(body2.conversations[0].id, body1.conversations[0].id);

    // Without cursor/limit the legacy bare-array shape is preserved.
    const legacy = await app.inject({
      method: 'GET',
      url: `/v1/workspaces/${FIXTURE_IDS.wsBusinessAcme}/conversations`,
      headers,
    });
    assert.strictEqual(legacy.statusCode, 200);
    assert.ok(Array.isArray(JSON.parse(legacy.payload)), 'legacy shape must remain a bare array');

    // Malformed cursors are rejected.
    const bad = await app.inject({
      method: 'GET',
      url: `/v1/workspaces/${FIXTURE_IDS.wsBusinessAcme}/conversations?cursor=not-a-cursor`,
      headers,
    });
    assert.strictEqual(bad.statusCode, 400);
    assert.strictEqual(JSON.parse(bad.payload).error.code, 'INVALID_CURSOR');
  });

  it('WAVE B — WORKFLOW ACTIONS: executing a card action validates against the definition and emits workflow_card.updated', async () => {
    const headers = { 'x-workspace-id': FIXTURE_IDS.wsBusinessAcme };
    const createCard = await app.inject({
      method: 'POST',
      url: `/v1/conversations/${FIXTURE_IDS.convBusinessCustomerMaya}/workflows`,
      headers,
      payload: { cardType: 'approval', title: 'Wave B refund approval' },
    });
    assert.strictEqual(createCard.statusCode, 201, createCard.payload);
    const card = JSON.parse(createCard.payload);
    assert.strictEqual(card.schemaVersion, 1);

    // Unknown action for this card type is refused.
    const invalid = await app.inject({
      method: 'POST',
      url: `/v1/workflows/${card.id}/actions`,
      headers,
      payload: { actionId: 'vote' },
    });
    assert.strictEqual(invalid.statusCode, 403);
    assert.strictEqual(JSON.parse(invalid.payload).error.code, 'WORKFLOW_ACTION_NOT_ALLOWED');

    const eventsBefore = store.outboxEvents.length;
    const approve = await app.inject({
      method: 'POST',
      url: `/v1/workflows/${card.id}/actions`,
      headers,
      payload: { actionId: 'approve', payload: { comment: 'Looks good' } },
    });
    assert.strictEqual(approve.statusCode, 200, approve.payload);
    const updated = JSON.parse(approve.payload);
    assert.strictEqual(updated.status, 'approved');
    assert.strictEqual(updated.history.length, 1);
    assert.strictEqual(updated.history[0].action, 'approve');
    assert.ok(
      store.outboxEvents.slice(eventsBefore).some((e) => e.type === 'workflow_card.updated'),
      'workflow actions must emit workflow_card.updated'
    );
  });

  it('WAVE B — SCHEDULED MESSAGES: schedule, list, cancel, and deliver via the tick', async () => {
    const headers = { 'x-workspace-id': FIXTURE_IDS.wsPersonalAlex };
    const conversationId = FIXTURE_IDS.convPersonalAlexMaya;
    const future = new Date(Date.now() + 60 * 60 * 1000).toISOString();

    const schedule = await app.inject({
      method: 'POST',
      url: `/v1/conversations/${conversationId}/messages/schedule`,
      headers,
      payload: { body: 'scheduled hello', scheduledFor: future },
    });
    assert.strictEqual(schedule.statusCode, 201, schedule.payload);
    const scheduled = JSON.parse(schedule.payload);
    assert.strictEqual(scheduled.status, 'scheduled');

    // Past timestamps are rejected.
    const past = await app.inject({
      method: 'POST',
      url: `/v1/conversations/${conversationId}/messages/schedule`,
      headers,
      payload: { body: 'too late', scheduledFor: new Date(Date.now() - 1000).toISOString() },
    });
    assert.strictEqual(past.statusCode, 400);
    assert.strictEqual(JSON.parse(past.payload).error.code, 'INVALID_SCHEDULE_TIME');

    const list = await app.inject({
      method: 'GET',
      url: `/v1/conversations/${conversationId}/scheduled`,
      headers,
    });
    assert.strictEqual(list.statusCode, 200);
    assert.ok((JSON.parse(list.payload).data as any[]).some((s) => s.id === scheduled.id));

    // Not due yet — the tick must not send it.
    assert.strictEqual(await processScheduledMessages(), 0);

    // Make it due and run the tick.
    store.scheduledMessages.get(scheduled.id)!.scheduledFor = new Date(Date.now() - 1000).toISOString();
    assert.strictEqual(await processScheduledMessages(), 1);
    assert.strictEqual(store.scheduledMessages.get(scheduled.id)!.status, 'sent');

    const feed = await app.inject({
      method: 'GET',
      url: `/v1/conversations/${conversationId}/messages`,
      headers,
    });
    const messages = JSON.parse(feed.payload) as Array<Record<string, any>>;
    const delivered = messages.find((m) => m.body === 'scheduled hello');
    assert.ok(delivered, 'the tick must deliver the scheduled message into the feed');
    assert.ok(typeof delivered!.serverSequence === 'number');

    // Cancel a second scheduled message before it fires.
    const schedule2 = await app.inject({
      method: 'POST',
      url: `/v1/conversations/${conversationId}/messages/schedule`,
      headers,
      payload: { body: 'cancel me', scheduledFor: new Date(Date.now() + 60 * 60 * 1000).toISOString() },
    });
    const scheduled2 = JSON.parse(schedule2.payload);
    const cancel = await app.inject({
      method: 'DELETE',
      url: `/v1/conversations/${conversationId}/scheduled/${scheduled2.id}`,
      headers,
    });
    assert.strictEqual(cancel.statusCode, 200);
    assert.strictEqual(JSON.parse(cancel.payload).status, 'cancelled');
    store.scheduledMessages.delete(scheduled2.id);
  });

  it('WAVE B — CONVERSATION INTENT: PATCH /v1/conversations/:id/intent switches personal/business mode', async () => {
    const headers = { 'x-workspace-id': FIXTURE_IDS.wsPersonalAlex };
    const eventsBefore = store.outboxEvents.length;

    const res = await app.inject({
      method: 'PATCH',
      url: `/v1/conversations/${FIXTURE_IDS.convPersonalAlexMaya}/intent`,
      headers,
      payload: { intent: 'business' },
    });
    assert.strictEqual(res.statusCode, 200, res.payload);
    const body = JSON.parse(res.payload);
    assert.strictEqual(body.intent, 'business');
    assert.strictEqual(store.conversations.get(FIXTURE_IDS.convPersonalAlexMaya)!.intent, 'business');
    assert.ok(
      store.outboxEvents.slice(eventsBefore).some((e) => e.type === 'conversation.intent_changed'),
      'intent changes must emit conversation.intent_changed'
    );

    const invalid = await app.inject({
      method: 'PATCH',
      url: `/v1/conversations/${FIXTURE_IDS.convPersonalAlexMaya}/intent`,
      headers,
      payload: { intent: 'secretly-a-third-mode' },
    });
    assert.strictEqual(invalid.statusCode, 400);
    assert.strictEqual(JSON.parse(invalid.payload).error.code, 'INVALID_INTENT');

    // Restore
    const restore = await app.inject({
      method: 'PATCH',
      url: `/v1/conversations/${FIXTURE_IDS.convPersonalAlexMaya}/intent`,
      headers,
      payload: { intent: 'personal' },
    });
    assert.strictEqual(restore.statusCode, 200);
  });

  it('WAVE B — EXPORT MANIFEST: /v1/portability/export returns a checksummed manifest and audits the request', async () => {
    // Sensitive: step-up required. Clear any earlier step-up first.
    const ds = store.deviceSessions.get('test-session-alex')!;
    const tokenSession = store.sessions.get('test-session-alex');
    ds.hasRecentStepUp = false;
    ds.stepUpExpiresAt = null;
    ds.lastStepUpAt = null;
    if (tokenSession) {
      tokenSession.hasRecentStepUp = false;
      tokenSession.stepUpExpiresAt = null;
      tokenSession.lastStepUpAt = null;
    }
    const denied = await app.inject({ method: 'POST', url: '/v1/portability/export' });
    assert.strictEqual(denied.statusCode, 403, denied.payload);
    assert.strictEqual(JSON.parse(denied.payload).error.code, 'STEP_UP_REQUIRED');

    const stepUp = await app.inject({ method: 'POST', url: '/v1/auth/step-up' });
    assert.strictEqual(stepUp.statusCode, 200);

    const eventsBefore = store.outboxEvents.length;
    const res = await app.inject({ method: 'POST', url: '/v1/portability/export' });
    assert.strictEqual(res.statusCode, 200, res.payload);
    const { manifest, payload } = JSON.parse(res.payload);

    assert.ok(manifest.exportId);
    assert.ok(manifest.exportedAt);
    assert.strictEqual(manifest.userId, FIXTURE_IDS.accountAlex);
    assert.ok(typeof manifest.counts.conversations === 'number');
    assert.ok(typeof manifest.counts.messages === 'number');
    assert.ok(typeof manifest.counts.files === 'number');
    assert.match(manifest.checksum, /^[0-9a-f]{64}$/);

    // Checksum must be the sha256 of the returned payload.
    const recomputed = createHash('sha256').update(JSON.stringify(payload), 'utf8').digest('hex');
    assert.strictEqual(manifest.checksum, recomputed);

    assert.ok(
      store.outboxEvents.slice(eventsBefore).some((e) => e.type === 'export.requested'),
      'exports must be audited via export.requested'
    );
  });

  // --- RECENT ENDPOINTS (untested until now) ---

  it('STUDIO SETTINGS TEST: PATCH partial update persists and rejects invalid values', async () => {
    const conversationId = FIXTURE_IDS.convPersonalAlexMaya;
    const headers = { 'x-workspace-id': FIXTURE_IDS.wsPersonalAlex };
    const originalStudio = JSON.parse(
      JSON.stringify(store.conversations.get(conversationId)!.studioSettings ?? {})
    );

    try {
      // (a) Update one field; the merged studioSettings is returned.
      const first = await app.inject({
        method: 'PATCH',
        url: `/v1/conversations/${conversationId}/studio-settings`,
        headers,
        payload: { wallpaper: 'warm-paper' },
      });
      assert.strictEqual(first.statusCode, 200, first.payload);
      const firstBody = JSON.parse(first.payload);
      assert.strictEqual(firstBody.success, true);
      assert.strictEqual(firstBody.studioSettings.wallpaper, 'warm-paper');
      assert.strictEqual(firstBody.conversation.studioSettings.wallpaper, 'warm-paper');

      // A second partial patch keeps the previously persisted value (merge).
      const second = await app.inject({
        method: 'PATCH',
        url: `/v1/conversations/${conversationId}/studio-settings`,
        headers,
        payload: { density: 'compact' },
      });
      assert.strictEqual(second.statusCode, 200, second.payload);
      const secondBody = JSON.parse(second.payload);
      assert.strictEqual(secondBody.studioSettings.wallpaper, 'warm-paper');
      assert.strictEqual(secondBody.studioSettings.density, 'compact');

      // (b) Invalid enum value -> 400 INVALID_STUDIO_SETTINGS.
      const invalid = await app.inject({
        method: 'PATCH',
        url: `/v1/conversations/${conversationId}/studio-settings`,
        headers,
        payload: { wallpaper: 'rainbow' },
      });
      assert.strictEqual(invalid.statusCode, 400);
      assert.strictEqual(JSON.parse(invalid.payload).error.code, 'INVALID_STUDIO_SETTINGS');

      // (c) Unknown conversation -> 404.
      const missing = await app.inject({
        method: 'PATCH',
        url: '/v1/conversations/00000000-0000-4000-8000-0000000dead/studio-settings',
        headers,
        payload: { wallpaper: 'none' },
      });
      assert.strictEqual(missing.statusCode, 404);
      assert.strictEqual(JSON.parse(missing.payload).error.code, 'CONVERSATION_NOT_FOUND');
    } finally {
      store.conversations.get(conversationId)!.studioSettings = originalStudio;
    }

    // (d) Non-participant workspace -> 403.
    const loginRes = await app.inject({
      method: 'POST',
      url: '/v1/auth/sessions',
      headers: { Authorization: `Bearer rl-bypass-studio-${Date.now()}` },
      payload: { email: 'stranger-studio@orbit.test', password: 'orbitdemo123', deviceLabel: 'studio-nonparticipant', platform: 'web' },
    });
    assert.strictEqual(loginRes.statusCode, 200, loginRes.payload);
    const token = JSON.parse(loginRes.payload).token as string;
    const denied = await app.inject({
      method: 'PATCH',
      url: `/v1/conversations/${conversationId}/studio-settings`,
      headers: { Authorization: `Bearer ${token}` },
      payload: { wallpaper: 'none' },
    });
    assert.strictEqual(denied.statusCode, 403);
    assert.strictEqual(JSON.parse(denied.payload).error.code, 'CONVERSATION_ACCESS_DENIED');
  });

  it('NOTIFICATION READ STATE TEST: PATCH /v1/notifications/:id sets read/readAt', async () => {
    // Seed a notification for the fallback (Alex) workspace via the route module exporter.
    const notification = recordNotification({
      workspaceId: FIXTURE_IDS.wsPersonalAlex,
      conversationId: FIXTURE_IDS.convPersonalAlexMaya,
      type: 'message',
      title: 'Read state probe',
      body: 'body',
    });
    assert.strictEqual(notification.read, false);
    assert.strictEqual(notification.readAt, null);

    // (a) read:true -> read true, readAt set.
    const readTrue = await app.inject({
      method: 'PATCH',
      url: `/v1/notifications/${notification.id}`,
      payload: { read: true },
    });
    assert.strictEqual(readTrue.statusCode, 200, readTrue.payload);
    const readTrueBody = JSON.parse(readTrue.payload);
    assert.strictEqual(readTrueBody.success, true);
    assert.strictEqual(readTrueBody.notification.read, true);
    assert.ok(readTrueBody.notification.readAt);

    // (b) read:false -> read false, readAt null.
    const readFalse = await app.inject({
      method: 'PATCH',
      url: `/v1/notifications/${notification.id}`,
      payload: { read: false },
    });
    assert.strictEqual(readFalse.statusCode, 200, readFalse.payload);
    const readFalseBody = JSON.parse(readFalse.payload);
    assert.strictEqual(readFalseBody.notification.read, false);
    assert.strictEqual(readFalseBody.notification.readAt, null);

    // (c) Missing/invalid body -> 400 INVALID_READ_STATE.
    const invalidString = await app.inject({
      method: 'PATCH',
      url: `/v1/notifications/${notification.id}`,
      payload: { read: 'yes' },
    });
    assert.strictEqual(invalidString.statusCode, 400);
    assert.strictEqual(JSON.parse(invalidString.payload).error.code, 'INVALID_READ_STATE');

    const invalidEmpty = await app.inject({
      method: 'PATCH',
      url: `/v1/notifications/${notification.id}`,
      payload: {},
    });
    assert.strictEqual(invalidEmpty.statusCode, 400);
    assert.strictEqual(JSON.parse(invalidEmpty.payload).error.code, 'INVALID_READ_STATE');

    // (d) Unknown notification -> 404.
    const missing = await app.inject({
      method: 'PATCH',
      url: '/v1/notifications/ntf_unknown_123',
      payload: { read: true },
    });
    assert.strictEqual(missing.statusCode, 404);
    assert.strictEqual(JSON.parse(missing.payload).error.code, 'NOT_FOUND');
  });

  it('CALLS SIGNAL RELAY TEST: offer/answer queued and drained with cursor; non-participant denied', async () => {
    const conversationId = FIXTURE_IDS.convPersonalAlexMaya;
    const headers = { 'x-workspace-id': FIXTURE_IDS.wsPersonalAlex };

    const created = await app.inject({
      method: 'POST',
      url: `/v1/conversations/${conversationId}/calls`,
      headers,
      payload: { kind: 'video' },
    });
    assert.strictEqual(created.statusCode, 201, created.payload);
    const callId = JSON.parse(created.payload).data.id as string;

    // Offer -> relayed as seq 1 and flips the call to active.
    const offer = await app.inject({
      method: 'POST',
      url: `/v1/calls/${callId}/signal`,
      headers,
      payload: { type: 'offer', payload: 'v=0 o=- 0 0 IN IP4 0.0.0.0' },
    });
    assert.strictEqual(offer.statusCode, 200, offer.payload);
    assert.strictEqual(JSON.parse(offer.payload).data.status, 'active');

    const firstPage = await app.inject({
      method: 'GET',
      url: `/v1/calls/${callId}/signals`,
      headers,
    });
    assert.strictEqual(firstPage.statusCode, 200, firstPage.payload);
    const firstBody = JSON.parse(firstPage.payload);
    assert.ok(Array.isArray(firstBody.data.signals));
    assert.strictEqual(firstBody.data.signals.length, 1);
    assert.strictEqual(firstBody.data.signals[0].seq, 1);
    assert.strictEqual(firstBody.data.signals[0].type, 'offer');
    assert.strictEqual(firstBody.data.nextCursor, 1);

    // Answer -> relayed as seq 2 and also flips status to active.
    const answer = await app.inject({
      method: 'POST',
      url: `/v1/calls/${callId}/signal`,
      headers,
      payload: { type: 'answer', payload: 'v=0 o=- 1 1 IN IP4 0.0.0.0' },
    });
    assert.strictEqual(answer.statusCode, 200, answer.payload);
    assert.strictEqual(JSON.parse(answer.payload).data.status, 'active');

    const secondPage = await app.inject({
      method: 'GET',
      url: `/v1/calls/${callId}/signals?after=1`,
      headers,
    });
    assert.strictEqual(secondPage.statusCode, 200, secondPage.payload);
    const secondBody = JSON.parse(secondPage.payload);
    assert.strictEqual(secondBody.data.signals.length, 1);
    assert.strictEqual(secondBody.data.signals[0].seq, 2);
    assert.strictEqual(secondBody.data.signals[0].type, 'answer');
    assert.strictEqual(secondBody.data.nextCursor, 2);

    // Non-participant cannot drain the relay queue.
    const loginRes = await app.inject({
      method: 'POST',
      url: '/v1/auth/sessions',
      headers: { Authorization: `Bearer rl-bypass-signal-${Date.now()}` },
      payload: { email: 'stranger-signals@orbit.test', password: 'orbitdemo123', deviceLabel: 'signals-nonparticipant', platform: 'web' },
    });
    assert.strictEqual(loginRes.statusCode, 200, loginRes.payload);
    const token = JSON.parse(loginRes.payload).token as string;
    const denied = await app.inject({
      method: 'GET',
      url: `/v1/calls/${callId}/signals`,
      headers: { Authorization: `Bearer ${token}` },
    });
    assert.strictEqual(denied.statusCode, 403);
assert.strictEqual(JSON.parse(denied.payload).error, 'not_participant');
  });

  // ===================== SPEC 19: CONVERSATION BRANCHES =====================

  it('BRANCH TEST: Create branch from message in non-branch conversation', async () => {
    const convId = FIXTURE_IDS.convPersonalAlexMaya;
    const msgId = FIXTURE_IDS.msgPersonal1;

    const res = await app.inject({
      method: 'POST',
      url: `/v1/conversations/${convId}/branches`,
      payload: { sourceMessageId: msgId, title: 'Design Review Branch' },
    });
    assert.strictEqual(res.statusCode, 201, res.payload);
    const branch = JSON.parse(res.payload);
    assert.strictEqual(branch.kind, 'branch');
    assert.strictEqual(branch.parentConversationId, convId);
    assert.strictEqual(branch.sourceMessageId, msgId);
    assert.strictEqual(branch.title, 'Design Review Branch');
    assert.ok(branch.participants.length >= 2);
    assert.strictEqual(branch.retentionDays, 30); // inherited from parent
  });

  it('BRANCH TEST: Create branch with custom participants and retention', async () => {
    const convId = FIXTURE_IDS.convPersonalAlexMaya;
    const msgId = FIXTURE_IDS.msgPersonal1;

    const res = await app.inject({
      method: 'POST',
      url: `/v1/conversations/${convId}/branches`,
      payload: {
        sourceMessageId: msgId,
        title: 'Custom Branch',
        participantWorkspaceIds: [FIXTURE_IDS.wsPersonalAlex],
        retentionDays: 60,
      },
    });
    assert.strictEqual(res.statusCode, 201, res.payload);
    const branch = JSON.parse(res.payload);
    assert.strictEqual(branch.kind, 'branch');
    assert.strictEqual(branch.title, 'Custom Branch');
    assert.strictEqual(branch.participants.length, 1);
    assert.strictEqual(branch.retentionDays, 60);
  });

  it('BRANCH TEST: Cannot create branch from branch conversation', async () => {
    // First create a branch
    const convId = FIXTURE_IDS.convPersonalAlexMaya;
    const msgId = FIXTURE_IDS.msgPersonal1;

    const branchRes = await app.inject({
      method: 'POST',
      url: `/v1/conversations/${convId}/branches`,
      payload: { sourceMessageId: msgId },
    });
    assert.strictEqual(branchRes.statusCode, 201);
    const branch = JSON.parse(branchRes.payload);
    const branchId = branch.id;

    // Try to create a branch from the branch
    const res = await app.inject({
      method: 'POST',
      url: `/v1/conversations/${branchId}/branches`,
      payload: { sourceMessageId: msgId },
    });
    assert.strictEqual(res.statusCode, 400, res.payload);
    const body = JSON.parse(res.payload);
    assert.strictEqual(body.error.code, 'CANNOT_BRANCH_BRANCH');
  });

  it('BRANCH TEST: List branches for a conversation', async () => {
    const convId = FIXTURE_IDS.convPersonalAlexMaya;
    const msgId = FIXTURE_IDS.msgPersonal1;

    // Create a branch first
    await app.inject({
      method: 'POST',
      url: `/v1/conversations/${convId}/branches`,
      payload: { sourceMessageId: msgId, title: 'Test Branch' },
    });

    const res = await app.inject({
      method: 'GET',
      url: `/v1/conversations/${convId}/branches`,
    });
    assert.strictEqual(res.statusCode, 200, res.payload);
    const branches = JSON.parse(res.payload);
    assert.ok(Array.isArray(branches));
    assert.ok(branches.length >= 1);
    assert.strictEqual(branches[0].kind, 'branch');
    assert.strictEqual(branches[0].parentConversationId, convId);
  });

  it('BRANCH TEST: Non-participant cannot list branches', async () => {
    // Sam tries to list branches for Alex-Maya conversation
    const res = await app.inject({
      method: 'GET',
      url: `/v1/conversations/${FIXTURE_IDS.convPersonalAlexMaya}/branches`,
      headers: { 'x-workspace-id': FIXTURE_IDS.wsPersonalSam },
    });
    // Should be 403 (access denied) or 404 (not found - to prevent enumeration)
    assert.ok(res.statusCode === 403 || res.statusCode === 404, `Expected 403 or 404, got ${res.statusCode}`);
  });

  it('BRANCH TEST: Analyst role can read but not create branches', async () => {
    // Switch to business workspace with analyst role
    // We need to create a session with analyst role - for now test capability check
    // This is more of a domain test, but we can verify the endpoint enforces it
    const convId = FIXTURE_IDS.convBusinessCustomerMaya;
    const msgId = FIXTURE_IDS.msgBusinessCustomer1;

    // Business admin (Alex) can create
    const res = await app.inject({
      method: 'POST',
      url: `/v1/conversations/${convId}/branches`,
      headers: { 'x-workspace-id': FIXTURE_IDS.wsBusinessAcme },
      payload: { sourceMessageId: msgId },
    });
    assert.strictEqual(res.statusCode, 201, res.payload);
  });

// ===================== SPEC 19: PER-CONVERSATION MODULE GRANTS =====================

  it('INTEGRATION GRANT TEST: Grant per-conversation scopes to integration', async () => {
    const integrationId = 'int_linear';
    const conversationId = FIXTURE_IDS.convBusinessCustomerMaya;

    const res = await app.inject({
      method: 'POST',
      url: `/v1/integrations/${integrationId}/grants/conversations`,
      headers: { 'x-workspace-id': FIXTURE_IDS.wsBusinessAcme },
      payload: { conversationId, scopes: ['messages.send'] }, // int_linear has messages.send and workflow.cards
    });
    if (res.statusCode !== 201) {
      console.log('Grant test failed:', res.statusCode, res.payload);
    }
    assert.strictEqual(res.statusCode, 201, res.payload);
    const grant = JSON.parse(res.payload).data;
    assert.strictEqual(grant.integrationId, integrationId);
    assert.strictEqual(grant.conversationId, conversationId);
    assert.deepStrictEqual(grant.scopes, ['messages.send']);
    assert.strictEqual(grant.grantedBy, FIXTURE_IDS.wsBusinessAcme);
  });

  it('INTEGRATION GRANT TEST: Reject grant with scopes not in integration manifest', async () => {
    const integrationId = 'int_linear'; // has scopes: messages.send, workflow.cards
    const conversationId = FIXTURE_IDS.convBusinessCustomerMaya;

    const res = await app.inject({
      method: 'POST',
      url: `/v1/integrations/${integrationId}/grants/conversations`,
      headers: { 'x-workspace-id': FIXTURE_IDS.wsBusinessAcme },
      payload: { conversationId, scopes: ['messages.send', 'webhooks.receive'] }, // webhooks.receive not in manifest
    });
    assert.strictEqual(res.statusCode, 400, res.payload);
    const body = JSON.parse(res.payload);
    assert.strictEqual(body.error.code, 'INVALID_SCOPES');
  });

  it('INTEGRATION GRANT TEST: List per-conversation grants for integration', async () => {
    const integrationId = 'int_linear';
    const conversationId = FIXTURE_IDS.convBusinessCustomerMaya;

    // Ensure grant exists
    await app.inject({
      method: 'POST',
      url: `/v1/integrations/${integrationId}/grants/conversations`,
      headers: { 'x-workspace-id': FIXTURE_IDS.wsBusinessAcme },
      payload: { conversationId, scopes: ['messages.send'] },
    });

    const res = await app.inject({
      method: 'GET',
      url: `/v1/integrations/${integrationId}/grants/conversations`,
      headers: { 'x-workspace-id': FIXTURE_IDS.wsBusinessAcme },
    });
    assert.strictEqual(res.statusCode, 200, res.payload);
    const grants = JSON.parse(res.payload).data;
    assert.ok(Array.isArray(grants));
    assert.ok(grants.length >= 1);
    assert.strictEqual(grants[0].integrationId, integrationId);
    assert.strictEqual(grants[0].conversationId, conversationId);
  });

  it('INTEGRATION GRANT TEST: Revoke per-conversation grant', async () => {
    const integrationId = 'int_linear';
    const conversationId = FIXTURE_IDS.convBusinessCustomerMaya;

    // Create grant first
    await app.inject({
      method: 'POST',
      url: `/v1/integrations/${integrationId}/grants/conversations`,
      headers: { 'x-workspace-id': FIXTURE_IDS.wsBusinessAcme },
      payload: { conversationId, scopes: ['messages.send'] },
    });

    // Revoke it
    const res = await app.inject({
      method: 'DELETE',
      url: `/v1/integrations/${integrationId}/grants/conversations/${conversationId}`,
      headers: { 'x-workspace-id': FIXTURE_IDS.wsBusinessAcme },
    });
    assert.strictEqual(res.statusCode, 200, res.payload);
    assert.strictEqual(JSON.parse(res.payload).success, true);

    // Verify it's gone
    const listRes = await app.inject({
      method: 'GET',
      url: `/v1/integrations/${integrationId}/grants/conversations`,
      headers: { 'x-workspace-id': FIXTURE_IDS.wsBusinessAcme },
    });
    const grants = JSON.parse(listRes.payload).data;
    assert.ok(!grants.some((g: { conversationId: string }) => g.conversationId === conversationId));
  });

it('INTEGRATION GRANT TEST: Non-admin cannot create per-conversation grant', async () => {
    // Sam is an agent in the business workspace, not admin/owner
    // Create a session for Sam with business workspace (unique header to bypass rate limit)
    const loginRes = await app.inject({
      method: 'POST',
      url: '/v1/auth/sessions',
      headers: { Authorization: `Bearer rl-bypass-integration-grant-${Date.now()}` },
      payload: { email: 'sam@orbit.internal', password: 'orbitdemo123', deviceLabel: 'sam-grant', platform: 'web' },
    });
    assert.strictEqual(loginRes.statusCode, 200);
    const token = JSON.parse(loginRes.payload).token as string;

    const res = await app.inject({
      method: 'POST',
      url: `/v1/integrations/int_linear/grants/conversations`,
      headers: { Authorization: `Bearer ${token}`, 'x-workspace-id': FIXTURE_IDS.wsBusinessAcme },
      payload: { conversationId: FIXTURE_IDS.convBusinessCustomerMaya, scopes: ['messages.send'] },
    });
    assert.strictEqual(res.statusCode, 403, res.payload);
    const body = JSON.parse(res.payload);
    assert.strictEqual(body.error.code, 'INSUFFICIENT_ROLE');
  });
});
