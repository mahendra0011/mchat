import { describe, it } from 'node:test';
import assert from 'node:assert';
import {
  RETENTION_SCHEDULE,
  getRetentionPolicy,
  categoriesWithPlaintext,
  validateRetentionSchedule,
} from './data-flow.js';

describe('Spec 08 — Retention schedule completeness', () => {
  it('covers all required data categories', () => {
    const required = [
      'message_body',
      'attachment_blob',
      'delivery_queue',
      'access_log',
      'abuse_report',
      'analytics_event',
      'backup',
      'account_deletion_record',
      'internal_note',
      'draft',
      'call_session_metadata',
      'presence_telemetry',
    ];
    for (const cat of required) {
      assert.ok(getRetentionPolicy(cat as never), `Missing retention policy for ${cat}`);
    }
  });

  it('validateRetentionSchedule returns no errors', () => {
    const errors = validateRetentionSchedule();
    assert.deepStrictEqual(errors, []);
  });

  it('all policies are encrypted at rest', () => {
    for (const p of RETENTION_SCHEDULE) {
      assert.ok(p.encryptedAtRest, `${p.category} must be encrypted at rest`);
    }
  });

  it('no analytics/access-log category stores plaintext content', () => {
    const plaintextCats = categoriesWithPlaintext();
    assert.ok(!plaintextCats.includes('analytics_event'));
    assert.ok(!plaintextCats.includes('access_log'));
    assert.ok(!plaintextCats.includes('delivery_queue'));
    assert.ok(!plaintextCats.includes('presence_telemetry'));
    assert.ok(!plaintextCats.includes('call_session_metadata'));
  });

  it('message_body, internal_note, draft, attachment marked as plaintext-capable', () => {
    const plaintextCats = categoriesWithPlaintext();
    assert.ok(plaintextCats.includes('message_body'));
    assert.ok(plaintextCats.includes('internal_note'));
    assert.ok(plaintextCats.includes('draft'));
    assert.ok(plaintextCats.includes('attachment_blob'));
  });

  it('account deletion removes user-content categories', () => {
    const contentCats = ['message_body', 'attachment_blob', 'internal_note', 'draft'];
    for (const cat of contentCats) {
      const policy = getRetentionPolicy(cat as never);
      assert.ok(policy?.deletedOnAccountDeletion, `${cat} must be deleted on account deletion`);
    }
  });

  it('access_log is NOT deleted on account deletion (safety retention)', () => {
    const policy = getRetentionPolicy('access_log');
    assert.strictEqual(policy?.deletedOnAccountDeletion, false);
  });
});
