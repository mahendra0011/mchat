import { describe, it } from 'node:test';
import assert from 'node:assert';
import {
  assertWorkspaceSenderScope,
  assertInternalNoteAccess,
  assertNoInternalNoteLeakage,
  DomainSecurityError,
} from './invariants.js';
import { canPerformAction } from './permissions.js';
import { IdempotencyManager } from './idempotency.js';
import { sanitizePlainText, extractSafeLinks } from './sanitization.js';
import { isMessageExpired } from './retention.js';

describe('Domain Security & Invariants', () => {
  it('throws DomainSecurityError on cross-workspace mismatch', () => {
    const ws1 = '11111111-1111-1111-1111-111111111111';
    const ws2 = '22222222-2222-2222-2222-222222222222';

    assert.doesNotThrow(() => assertWorkspaceSenderScope(ws1, ws1));
    assert.throws(
      () => assertWorkspaceSenderScope(ws1, ws2),
      (err: any) => err instanceof DomainSecurityError && err.code === 'CROSS_WORKSPACE_VIOLATION'
    );
  });

  it('enforces internal note access based on workspace type and role', () => {
    // Non-business workspace must fail
    assert.throws(
      () => assertInternalNoteAccess(false, 'agent'),
      (err: any) => err.code === 'INTERNAL_NOTE_NOT_ALLOWED'
    );

    // Analyst role lacks view_internal_notes permission
    assert.throws(
      () => assertInternalNoteAccess(true, 'analyst'),
      (err: any) => err.code === 'INSUFFICIENT_ROLE_PERMISSIONS'
    );

    // Agent, Admin, Owner are permitted
    assert.doesNotThrow(() => assertInternalNoteAccess(true, 'agent'));
    assert.doesNotThrow(() => assertInternalNoteAccess(true, 'admin'));
    assert.doesNotThrow(() => assertInternalNoteAccess(true, 'owner'));
  });

  it('prevents internal note leakage into customer message feeds', () => {
    const validCustomerFeed = [
      { id: '1', body: 'Hello', resourceType: 'message' },
      { id: '2', body: 'How can I help?', resourceType: 'message' },
    ];
    assert.doesNotThrow(() => assertNoInternalNoteLeakage(validCustomerFeed));

    const leakedFeed = [
      { id: '1', body: 'Hello', resourceType: 'message' },
      { id: '2', body: 'Customer seems angry', resourceType: 'business_internal_note' },
    ];
    assert.throws(
      () => assertNoInternalNoteLeakage(leakedFeed),
      (err: any) => err.code === 'INTERNAL_NOTE_LEAKAGE_DETECTED'
    );
  });

  it('correctly manages role permissions', () => {
    assert.strictEqual(canPerformAction('owner', 'delete_workspace'), true);
    assert.strictEqual(canPerformAction('admin', 'delete_workspace'), false);
    assert.strictEqual(canPerformAction('agent', 'create_internal_note'), true);
    assert.strictEqual(canPerformAction('analyst', 'create_internal_note'), false);
  });

  it('deduplicates operations via IdempotencyManager', () => {
    const mgr = new IdempotencyManager<string>();
    assert.strictEqual(mgr.has('key-1'), false);
    mgr.set('key-1', 'result-1');
    assert.strictEqual(mgr.has('key-1'), true);
    assert.strictEqual(mgr.get('key-1'), 'result-1');
  });

  it('sanitizes untrusted text and detects safe links', () => {
    const dirty = '<script>alert("xss")</script>';
    assert.strictEqual(sanitizePlainText(dirty), '&lt;script&gt;alert(&quot;xss&quot;)&lt;/script&gt;');

    const links = extractSafeLinks('Visit https://example.com and http://localhost:3000');
    assert.strictEqual(links.length, 2);
    assert.strictEqual(links[0].isSafe, true);
    assert.strictEqual(links[1].isSafe, false); // Localhost marked unsafe for preview
  });

  it('correctly calculates message expiration', () => {
    const recent = new Date().toISOString();
    assert.strictEqual(isMessageExpired(recent, 7), false);

    const oldDate = new Date(Date.now() - 10 * 24 * 60 * 60 * 1000).toISOString();
    assert.strictEqual(isMessageExpired(oldDate, 7), true);
  });
});
