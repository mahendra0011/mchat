import { describe, it } from 'node:test';
import assert from 'node:assert';
import { PolicyEngine } from './policy.js';
import { validateSafeUrl } from './ssrf.js';
import { SlidingWindowRateLimiter } from './ratelimit.js';
import { DeletionTombstoneLedger } from './retention.js';
import { PolicyPrincipal, PolicyResource } from '@orbit/schemas';

describe('Security & Governance Expansion Tests (Specs 29-46)', () => {
  const policyEngine = new PolicyEngine();

  const businessWorkspaceId = '11111111-1111-4111-8111-111111111111';
  const otherWorkspaceId = '22222222-2222-4222-8222-222222222222';
  const accountId = '33333333-3333-4333-8333-333333333333';

  it('strictly denies cross-tenant access to conversations', () => {
    const principal: PolicyPrincipal = {
      accountId,
      activeWorkspaceId: businessWorkspaceId,
      activeWorkspaceType: 'BUSINESS',
      role: 'ADMIN',
      hasRecentStepUp: true,
    };

    const foreignResource: PolicyResource = {
      type: 'conversation',
      id: 'conv-999',
      workspaceId: otherWorkspaceId,
      isInternalNote: false,
      isUnderLegalHold: false,
    };

    const decision = policyEngine.evaluate(principal, 'conversation.read', foreignResource);
    assert.strictEqual(decision.allowed, false);
    assert.match(decision.reason, /Cross-tenant boundary violation/);
  });

  it('denies personal workspace access to business internal notes', () => {
    const personalPrincipal: PolicyPrincipal = {
      accountId,
      activeWorkspaceId: businessWorkspaceId,
      activeWorkspaceType: 'PERSONAL',
      role: 'MEMBER',
      hasRecentStepUp: false,
    };

    const internalNote: PolicyResource = {
      type: 'internal_note',
      id: 'note-123',
      workspaceId: businessWorkspaceId,
      isInternalNote: true,
      isUnderLegalHold: false,
    };

    const decision = policyEngine.evaluate(personalPrincipal, 'internal_note.read', internalNote);
    assert.strictEqual(decision.allowed, false);
    assert.match(decision.reason, /Personal workspaces and customer identities are strictly denied/);
  });

  it('enforces legal hold protection against message deletion', () => {
    const adminPrincipal: PolicyPrincipal = {
      accountId,
      activeWorkspaceId: businessWorkspaceId,
      activeWorkspaceType: 'BUSINESS',
      role: 'ADMIN',
      hasRecentStepUp: true,
    };

    const legalHoldMessage: PolicyResource = {
      type: 'message',
      id: 'msg-audit-1',
      workspaceId: businessWorkspaceId,
      isInternalNote: false,
      isUnderLegalHold: true,
    };

    const decision = policyEngine.evaluate(adminPrincipal, 'message.delete', legalHoldMessage);
    assert.strictEqual(decision.allowed, false);
    assert.match(decision.reason, /active compliance legal hold/);
  });

  it('requires step-up re-authentication for high-risk export operations', () => {
    const principalWithoutStepUp: PolicyPrincipal = {
      accountId,
      activeWorkspaceId: businessWorkspaceId,
      activeWorkspaceType: 'BUSINESS',
      role: 'OWNER',
      hasRecentStepUp: false,
    };

    const exportResource: PolicyResource = {
      type: 'export',
      id: 'exp-1',
      workspaceId: businessWorkspaceId,
      isInternalNote: false,
      isUnderLegalHold: false,
    };

    const decisionWithout = policyEngine.evaluate(principalWithoutStepUp, 'export.create', exportResource);
    assert.strictEqual(decisionWithout.allowed, false);
    assert.strictEqual(decisionWithout.requiresStepUp, true);

    const principalWithStepUp: PolicyPrincipal = {
      ...principalWithoutStepUp,
      hasRecentStepUp: true,
    };

    const decisionWith = policyEngine.evaluate(principalWithStepUp, 'export.create', exportResource);
    assert.strictEqual(decisionWith.allowed, true);
  });

  it('validates safe URLs and blocks SSRF vectors', () => {
    // 1. Loopback
    const loopback = validateSafeUrl('https://localhost/api');
    assert.strictEqual(loopback.isAllowed, false);
    assert.strictEqual(loopback.destinationCategory, 'BLOCKED_LOOPBACK');

    // 2. Cloud metadata
    const metadata = validateSafeUrl('https://169.254.169.254/latest/meta-data');
    assert.strictEqual(metadata.isAllowed, false);
    assert.strictEqual(metadata.destinationCategory, 'BLOCKED_CLOUD_METADATA');

    // 3. RFC1918 private ranges
    const privateIp10 = validateSafeUrl('https://10.0.0.1/admin');
    assert.strictEqual(privateIp10.isAllowed, false);
    assert.strictEqual(privateIp10.destinationCategory, 'BLOCKED_PRIVATE_RANGE');

    const privateIp192 = validateSafeUrl('https://192.168.1.50/dashboard');
    assert.strictEqual(privateIp192.isAllowed, false);

    // 4. Insecure protocol
    const insecure = validateSafeUrl('http://public-website.com');
    assert.strictEqual(insecure.isAllowed, false);
    assert.strictEqual(insecure.destinationCategory, 'BLOCKED_NON_HTTPS');

    // 5. Valid public HTTPS URL
    const safe = validateSafeUrl('https://api.github.com/repos/orbit/chat');
    assert.strictEqual(safe.isAllowed, true);
    assert.strictEqual(safe.destinationCategory, 'PUBLIC_SAFE');
  });

  it('enforces sliding window rate limits accurately', () => {
    const limiter = new SlidingWindowRateLimiter();
    const key = 'test-ip-127.0.0.1';

    // Allow 3 requests in 1000ms
    const r1 = limiter.check(key, 3, 1000);
    const r2 = limiter.check(key, 3, 1000);
    const r3 = limiter.check(key, 3, 1000);

    assert.strictEqual(r1.allowed, true);
    assert.strictEqual(r2.allowed, true);
    assert.strictEqual(r3.allowed, true);
    assert.strictEqual(r3.remaining, 0);

    // 4th request must be denied
    const r4 = limiter.check(key, 3, 1000);
    assert.strictEqual(r4.allowed, false);
    assert.strictEqual(r4.remaining, 0);
  });

  it('records deletion tombstones and suppresses them on backup restore', () => {
    const ledger = new DeletionTombstoneLedger();

    const tombstone = ledger.recordTombstone(
      'message',
      'msg-to-delete-999',
      businessWorkspaceId,
      'gdpr_erasure'
    );

    assert.ok(tombstone.tombstoneHash);
    assert.strictEqual(tombstone.targetType, 'message');
    assert.strictEqual(ledger.isTombstoned('msg-to-delete-999'), true);
    assert.strictEqual(ledger.isTombstoned('msg-active-001'), false);

    // Reconcile backup candidate records
    const backupRecords = [
      { id: 'msg-to-delete-999', text: 'This was deleted under GDPR' },
      { id: 'msg-active-001', text: 'This message is still valid' },
    ];

    const { preservedRecords, report } = ledger.reconcileRestore(backupRecords);

    assert.strictEqual(preservedRecords.length, 1);
    assert.strictEqual(preservedRecords[0].id, 'msg-active-001');
    assert.strictEqual(report.suppressedTombstoneCount, 1);
    assert.strictEqual(report.preservedRecordsCount, 1);
  });
});
