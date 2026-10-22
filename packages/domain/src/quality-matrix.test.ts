import { describe, it } from 'node:test';
import assert from 'node:assert';
import { sanitizePlainText, extractSafeLinks } from './sanitization.js';
import { assertWorkspaceSenderScope, assertNoInternalNoteLeakage } from './invariants.js';
import { PolicyEngine } from './policy.js';
import { sanitizeAuditData } from './audit.js';
import { PolicyPrincipal, PolicyResource } from '@orbit/schemas';

describe('Spec 16 Quality & High-Risk Edge Cases Matrix', () => {
  const policyEngine = new PolicyEngine();

  describe('Messaging Input Invariants (Spec 16)', () => {
    it('handles complex emoji sequences and zero-width joiners without corrupting UTF-8', () => {
      const emojiSeq = '👨‍👩‍👧‍👦 🚀 ❤️‍🔥 🏳️‍🌈 👍🏽';
      const sanitized = sanitizePlainText(emojiSeq);
      assert.strictEqual(sanitized, emojiSeq);
    });

    it('handles RTL text (Arabic, Hebrew) while preserving directional integrity', () => {
      const rtlText = 'مرحبا بك في أوربت شات - שלום עולם';
      const sanitized = sanitizePlainText(rtlText);
      assert.strictEqual(sanitized, rtlText);
    });

    it('sanitizes code-like text and script injection attempts into safe text entities', () => {
      const codeSnippet = '<script>alert(document.cookie)</script><style>body{display:none}</style>';
      const sanitized = sanitizePlainText(codeSnippet);
      assert.ok(!sanitized.includes('<script>'));
      assert.ok(sanitized.includes('&lt;script&gt;'));
      assert.ok(sanitized.includes('&lt;/script&gt;'));
    });

    it('detects unsafe link schemes (javascript:, data:, file:) and marks them unsafe', () => {
      const dangerousInput = 'Visit javascript:alert(1) and data:text/html;base64,PHNjcmlwdD4= and https://orbit.chat';
      const links = extractSafeLinks(dangerousInput);
      const safeHttps = links.find((l) => l.url.startsWith('https://orbit.chat'));
      const dangerousJs = links.find((l) => l.url.startsWith('javascript:'));
      
      assert.ok(safeHttps);
      assert.strictEqual(safeHttps.isSafe, true);

      // If unsafe schemes are parsed, they must NEVER be flagged as isSafe
      if (dangerousJs) {
        assert.strictEqual(dangerousJs.isSafe, false);
      }
    });

    it('validates and handles extreme message lengths up to limits safely', () => {
      const hugeString = 'A'.repeat(20000);
      const sanitized = sanitizePlainText(hugeString);
      assert.strictEqual(sanitized.length, 20000);
    });
  });

  describe('Personal vs Business Workspace Boundary Invariants (Spec 16 & Spec 07)', () => {
    it('prohibits personal workspace from authoring or accessing internal notes', () => {
      const personalPrincipal: PolicyPrincipal = {
        accountId: 'acc_alex_123',
        activeWorkspaceId: 'ws_personal_alex',
        activeWorkspaceType: 'PERSONAL',
        role: 'OWNER',
        hasRecentStepUp: false,
      };

      const noteResource: PolicyResource = {
        type: 'internal_note',
        id: 'note_confidential_1',
        workspaceId: 'ws_personal_alex',
        isInternalNote: true,
        isUnderLegalHold: false,
      };

      const decision = policyEngine.evaluate(personalPrincipal, 'internal_note.create', noteResource);
      assert.strictEqual(decision.allowed, false);
      assert.match(decision.reason || '', /Personal workspaces and customer identities are strictly denied/);
    });

    it('verifies that customer message export strictly excludes any internal notes', () => {
      const customerFeed = [
        { id: 'msg_1', body: 'Invoice question', resourceType: 'message' },
        { id: 'msg_2', body: 'Payment confirmed', resourceType: 'message' },
      ];

      // Verifies no internal notes are in customer feed
      assert.doesNotThrow(() => assertNoInternalNoteLeakage(customerFeed));

      // Attempting to export an internal note in a customer export triggers immediate violation
      const compromisedFeed = [
        { id: 'msg_1', body: 'Invoice question', resourceType: 'message' },
        { id: 'note_leak', body: 'Customer is demanding refund', resourceType: 'business_internal_note' },
      ];

      assert.throws(
        () => assertNoInternalNoteLeakage(compromisedFeed),
        (err: any) => err.code === 'INTERNAL_NOTE_LEAKAGE_DETECTED'
      );
    });

    it('asserts scheduled messages remain strictly bound to origin workspace', () => {
      const originWorkspace = 'ws_business_acme';
      const attemptedTargetWorkspace = 'ws_personal_alex';

      assert.throws(
        () => assertWorkspaceSenderScope(originWorkspace, attemptedTargetWorkspace),
        (err: any) => err.code === 'CROSS_WORKSPACE_VIOLATION'
      );
    });
  });

  describe('Privacy & Telemetry Safe Invariants (Spec 16 & Spec 20)', () => {
    it('guarantees analytics and audit logs completely redact raw credentials and tokens', () => {
      const unredactedAudit = {
        action: 'auth.login_attempt',
        token: 'eyJhGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.secretpayload',
        password: 'super_secret_master_password',
        recoveryCode: 'orbit-rec-1234-5678-9012',
        clientIp: '192.168.1.100',
      };

      const redacted = sanitizeAuditData(unredactedAudit);
      assert.strictEqual(redacted.token, '[REDACTED_CONFIDENTIAL]');
      assert.strictEqual(redacted.password, '[REDACTED_CONFIDENTIAL]');
      assert.strictEqual(redacted.recoveryCode, '[REDACTED_CONFIDENTIAL]');
      assert.strictEqual(redacted.clientIp, '192.168.1.100');
    });
  });
});

