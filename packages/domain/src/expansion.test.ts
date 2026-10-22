import { describe, it } from 'node:test';
import assert from 'node:assert';
import {
  evaluateEntitlement,
  validateHandleFormat,
  sanitizeSearchHandle,
  canTransitionContactRequest,
  sanitizeAuditData,
} from './index.js';
import type { BillingEntitlement } from '@orbit/schemas';

describe('Domain Expansion Tests (Specs 21-26)', () => {
  const sampleEntitlement: BillingEntitlement = {
    workspaceId: 'ws_business_1',
    plan: 'business_starter',
    status: 'active',
    billingOwnerUserId: 'user_alex',
    seatsAllocated: 5,
    seatsUsed: 3,
    storageQuotaBytes: 10 * 1024 * 1024 * 1024,
    storageUsedBytes: 2 * 1024 * 1024 * 1024,
    maxFileSizeMB: 50,
    customThemesAllowed: true,
    workflowCardsAllowed: true,
    auditExportAllowed: false,
    activeIntegrationsCount: 2,
    maxIntegrationsAllowed: 5,
    renewalDate: '2026-11-01T00:00:00Z',
    metadata: {},
  };

  it('evaluates seat entitlement correctly', () => {
    const res1 = evaluateEntitlement(sampleEntitlement, 'add_seat');
    assert.strictEqual(res1.allowed, true);

    const fullEntitlement = { ...sampleEntitlement, seatsUsed: 5 };
    const res2 = evaluateEntitlement(fullEntitlement, 'add_seat');
    assert.strictEqual(res2.allowed, false);
    assert.ok(res2.reason?.includes('Seat quota exceeded'));
  });

  it('evaluates file size upload entitlement correctly', () => {
    const okRes = evaluateEntitlement(sampleEntitlement, 'upload_file', { fileSizeMB: 25 });
    assert.strictEqual(okRes.allowed, true);

    const failRes = evaluateEntitlement(sampleEntitlement, 'upload_file', { fileSizeMB: 100 });
    assert.strictEqual(failRes.allowed, false);
    assert.ok(failRes.reason?.includes('exceeds plan maximum'));
  });

  it('denies audit export on starter tier', () => {
    const res = evaluateEntitlement(sampleEntitlement, 'audit_export');
    assert.strictEqual(res.allowed, false);
    assert.ok(res.reason?.includes('Business Scale tier'));
  });

  it('validates and sanitizes handle discovery format', () => {
    assert.strictEqual(sanitizeSearchHandle('@Alex_Rivera'), 'alex_rivera');
    assert.strictEqual(validateHandleFormat('alex').valid, true);
    assert.strictEqual(validateHandleFormat('a').valid, false);
    assert.strictEqual(validateHandleFormat('admin').valid, false); // reserved
  });

  it('enforces contact request state transitions', () => {
    assert.strictEqual(canTransitionContactRequest('pending', 'accepted'), true);
    assert.strictEqual(canTransitionContactRequest('pending', 'ignored'), true);
    assert.strictEqual(canTransitionContactRequest('pending', 'blocked'), true);
    assert.strictEqual(canTransitionContactRequest('accepted', 'pending'), false);
  });

  it('redacts sensitive audit fields completely', () => {
    const sensitive = {
      actorId: 'usr_1',
      password: 'superSecretPassword',
      token: 'jwt_token_here',
      safeField: 'audit_action_taken',
    };
    const sanitized = sanitizeAuditData(sensitive);
    assert.strictEqual(sanitized.safeField, 'audit_action_taken');
    assert.strictEqual(sanitized.password, '[REDACTED_CONFIDENTIAL]');
    assert.strictEqual(sanitized.token, '[REDACTED_CONFIDENTIAL]');
  });
});
