# Audit Results: Spec 28 & Spec 29

## Spec 28 — Specification Audit & Open Decisions

**Verdict: GAPS** — This is a meta-spec documenting open decisions and risk items. While many of the decisions' subjects are implemented in code, the spec itself as a governance document has gaps in tracking and the open items listed are only partially addressed.

### Specific Gaps (from Spec 28):

**Under-specified areas that have partial code implementation:**

1. **Onboarding, username/contact discovery, account recovery, activation**
   - ✅ OnboardingModal implemented in web app (`apps/web/src/components/OnboardingModal.tsx`)
   - ✅ Contact discovery modal and `/v1/contacts/search` route exist (`apps/api/src/routes/discovery.ts`, `apps/web/src/components/ContactDiscoveryModal.tsx`)
   - ✅ OTP verification route `/v1/verification/verify` exists (`apps/api/src/routes/verification.ts` - referenced in auth.ts)
   - ❌ Full account recovery flow (password reset, email verification cascade) not fully traced
   - ❌ Handle validation sanitization end-to-end not verified

2. **Billing, server-enforced entitlements, cancellation, business seat ownership**
   - ✅ Full billing routes exist (`apps/api/src/routes/billing.ts`)
   - ✅ Entitlement checks, plan changes, seat management, invoices, webhooks
   - ❌ Server-enforced entitlements at the capability level — some routes use `can()` but not all
   - ❌ Cancellation grace period enforcement visible but could be more robust
   - ❌ Business seat ownership transfer mechanics not explicitly verified beyond owner checks

3. **Internal admin/support tools, legal-policy readiness, data requests, jurisdiction review**
   - ✅ AdminConsoleModal exists (`apps/web/src/components/AdminConsoleModal.tsx`)
   - ✅ Data requests `/v1/privacy/requests` exist (`apps/api/src/routes/privacy.ts`)
   - ❌ Legal-policy readiness framework not visible
   - ❌ Jurisdiction review mechanisms not found
   - ❌ Data request processing pipeline (verification → completion → deletion) not fully traced

4. **Integration permissions, developer API governance, webhook safety**
   - ✅ Integration routes exist (`apps/api/src/routes/integrations.ts`)
   - ✅ Webhook delivery tracking `webhookDeliveries` map in store
   - ❌ Developer API governance (API key management, rate limits per developer) not clearly visible
   - ❌ Webhook safety validation (beyond signature checking) not found
   - ❌ Integration capability scoping not enforced in code

5. **Privacy-safe product analytics, experimentation guardrails, user research**
   - ✅ Telemetry events map `telemetryEvents` in store
   - ✅ PrivacyTelemetryEvent schema and persistence
   - ✅ Experiments framework in store (`experiments`, `experimentAssignments`)
   - ❌ Privacy-safe guardrails (consent opt-out, event anonymization) not clearly implemented
   - ❌ User research study pipeline not found beyond fixture seeding
   - ❌ Experiment retention and deletion not traced

6. **Export/import formats, migration, deduplication, backup distinctions**
   - ✅ Export data handler in `App.tsx` (`handleExportData`) — creates JSON export with privacy declaration
   - ✅ Backup tombstone ledger `DeletionTombstoneLedger` (`packages/domain/src/retention.ts`)
   - ✅ `reconcileRestore` for backup migration
   - ❌ Import formats/schema — `DataImportModal` exists but import API routes not fully traced
   - ❌ Deduplication logic during import not found
   - ❌ Backup/restore distinction between tombstones and full data not explicitly coded

7. **Web/app distribution, release acceptance, staged rollout, launch operations**
   - ❌ No distribution/deployment configuration found
   - ❌ Release acceptance criteria not implemented
   - ❌ Staged rollout / feature flag mechanism not found (feature-flags.ts exists but minimal)
   - ❌ Launch operations/rollback procedures not visible

**Decisions that must be made (from Spec 28) — tracked in code?**

1. ❓ Product name, domain, target markets, languages — not found in code
2. ✅ Sign-in identifiers/account recovery model partially: email required, phone optional with OTP verification, passkeys supported
3. ⚠️ Encryption model partially: E2EE for direct conversations, TLS 1.3 for transport, but multi-device, cloud history, search, backups E2EE status unclear
4. ❓ Web/native app strategy and MSupported browser/OS versions — not found
5. ⚠️ Initial backend/data infrastructure partially: PostgreSQL client exists, media storage regions not configured, observability providers partial, DR objectives not found
6. ⚠️ Business workspace ownership partially: owner/membership model implemented, customer visibility partial, team-agent identity policy partial, offboarding behavior partial
7. ✅ Monetization choice: billing ships with Stripe/mock provider, free/paid boundaries defined
8. ✅ Calls in launch scope: SFU package (`packages/webrtc-sfu`) present, call routes implemented
9. ❓ Import source support — third-party migration support not clearly traced
10. ❓ Support staffing, abuse-response coverage, legal review, breach escalation — not found

---

## Spec 29 — Security Threat Model & Risk Register

**Verdict: GAPS** — Significant implementation exists for many risks, but several critical gaps remain. Below is a risk-by-risk audit.

### SEC-001: Cross-user/cross-workspace read or write
- **Verdict: COMPLETE**
- **Evidence**: 
  - Policy engine `packages/domain/src/policy.ts` enforces multi-tenant boundary checks
  - `/v1/security/policy/check` route (`apps/api/src/routes/security.ts:74-108`)
  - Cross-tenant denial tested in `packages/domain/src/security-expansion.test.ts:16-36`
  - `assertNoInternalNoteLeakage` in conversation routes (`apps/api/src/routes/conversations.ts:262`)
  - Business notes denied to personal workspaces (`packages/domain/src/policy.ts:32-50`)

### SEC-002: Session theft or account takeover
- **Verdict: GAPS** — Partial implementation; critical follow-ups missing
- **Evidence**:
  - ✅ Security key registration routes `/v1/security/keys` (`apps/api/src/routes/security.ts:139-183`)
  - ✅ Session revocation `/v1/auth/sessions/:sessionId`, `/v1/auth/sessions/revoke-all-others` (`apps/api/src/routes/auth.ts:102-132`, `:135-174`)
  - ✅ Step-up re-authentication `/v1/auth/step-up` (`apps/api/src/routes/auth.ts:177-230`)
  - ❌ Full WebAuthn attestation/assertion verification — noted as "lightweight registration flow" with comment "Full WebAuthn attestation & assertion verification is a documented follow-up" (`apps/api/src/routes/security.ts:111-113`)
  - ❌ MFA factors beyond passkeys not found
  - ❌ Session anomaly detection/alerts not implemented
  - ❌ Passkey credential rotation/revocation flow not traced

### SEC-003: Server or database compromise exposes message content
- **Verdict: COMPLETE** (for explicitly covered conversations)
- **Evidence**:
  - ✅ Client-side E2EE conversation cipher `packages/crypto-adapter/src/conversation-cipher.ts` — AES-256-GCM per-conversation key
  - ✅ Double ratchet session layer `packages/crypto-adapter/src/double-ratchet.ts` — symmetric chain model with HKDF stepping
  - ✅ E2EE session manager `packages/crypto-adapter/src/e2ee-session.ts` — encrypt/decrypt API with local index callback
  - ✅ `isEncryptedEnvelope` check in message processing (`apps/api/src/routes/conversations.ts:441-443`)
  - ✅ Direct conversations marked `isE2EE: true` on creation
  - ❌ Independent crypto review not found in codebase
  - ❌ Multi-device key management — key bundles exist but rotation/sync flow not fully traced
  - ❌ Backup encryption — tombstone ledger has hashes but backup data encryption not traced
  - ❌ Search on encrypted content — `e2ee-search` package exists but integration with message queries not verified

### SEC-004: Plaintext leaks through telemetry or push
- **Verdict: GAPS** — Partial implementation
- **Evidence**:
  - ✅ SSRF validation `validateSafeUrl` (`packages/domain/src/ssrf.ts`) — blocks loopback, private ranges, cloud metadata, non-HTTPS
  - ✅ `/v1/security/ssrf-validate` route (`apps/api/src/routes/security.ts:16-31`)
  - ✅ Privacy telemetry events persisted in store with schema
  - ❌ Push notification payload inspection/redaction not found
  - ❌ Telemetry schema allowlist — events defined but allowlist validation not traced
  - ❌ Push by default configuration not clearly verified

### SEC-005: Malicious dependency/build artifact
- **Verdict: GAPS** — Infrastructure present but incomplete
- **Evidence**:
  - ✅ `package.json` and `pnpm-lock.yaml` exist for dependency pins
  - ❌ SCA (Software Composition Analysis) configuration not found
  - ❌ Secret scans in CI not traced
  - ❌ Artifact signing/deploy attestations not found
  - ❌ Pinned CI actions not verified

### SEC-006: SSRF from URL previews/webhooks
- **Verdict: COMPLETE**
- **Evidence**:
  - ✅ `validateSafeUrl` in `packages/domain/src/ssrf.ts` — comprehensive blocking: loopback (localhost, 127.0.0.1, ::1), private RFC1918 (10.x, 172.16-31, 192.168.x), link-local (169.254.x, fe80::), cloud metadata (169.254.169.254, metadata.google.internal), non-HTTP(S) protocols
  - ✅ `/v1/security/ssrf-validate` route exposed (`apps/api/src/routes/security.ts:16-31`)
  - ✅ Validated in security expansion tests: loopback, cloud metadata, RFC1918 private ranges, HTTP vs HTTPS (`packages/domain/src/security-expansion.test.ts:112-140`)
  - ✅ Onboarding passkey flow uses `validateSafeUrl` for attestation URLs

### SEC-007: Lost/stolen device exposes cached data
- **Verdict: GAPS** — Basic framework missing key controls
- **Evidence**:
  - ✅ Device sessions tracked with `isPasskeyAuthenticated`, `hasRecentStepUp`, IP masking
  - ✅ Session revocation routes exist
  - ❌ App lock / device PIN/not present code
  - ❌ Local data minimization — offline cache not traced for minimization policies
  - ❌ Remote revoke beyond sessions — no remote wipe found
  - ❌ Cache lifecycle tests not found

### SEC-008: Backup or export leakage
- **Verdict: GAPS** — Export mechanism exists but lacks key controls
- **Evidence**:
  - ✅ Data requests `/v1/privacy/requests` exist (`apps/api/src/routes/privacy.ts:103-138`)
  - ✅ Tombstone ledger for backup reconciliation (`packages/domain/src/retention.ts`)
  - ❌ Per-user/workspace access check on exports — data export handler in `App.tsx` has no access checks beyond basic token auth
  - ❌ Encryption of exports — export is plain JSON blob, no encryption
  - ❌ Short-lived links — not found
  - ❌ Export audit logging — not found
  - ❌ Expiry and deletion jobs for exports — not found

### SEC-009: Group membership/key change flaw
- **Verdict: GAPS** — Membership changes handled but key rotation missing
- **Evidence**:
  - ✅ Group membership changes via join requests (`apps/api/src/routes/discovery.ts:462-569`)
  - ✅ `membershipApprovalRequired` on conversations
  - ✅ Group invite/redemption with permission checks
  - ❌ Key rotation mechanism not found
  - ❌ Device/key-change UX not traced
  - ❌ Protocol-level membership change enforcement partial

### SEC-010: Abuse or denial of service
- **Verdict: GAPS** — Rate limiting present but advanced controls missing
- **Evidence**:
  - ✅ Rate limiting throughout API: login (10/60s), login step-up (5/60s), send-message (120/60s), create-conversation (30/60s), call-invite (20/60s), contact-request (30/60s), discovery-search (30/60s), invite (30/60s)
  - ✅ Signal queue max of 50 (`apps/api/src/routes/calls.ts:21`)
  - ❌ Circuit breakers not found
  - ❌ Adaptive limits beyond fixed thresholds not found
  - ❌ Spend alerts not found
  - ❌ Abuse runbooks not found
  - ❤ Queue caps for websocket/fan-out not traced

---

## Summary

| Spec | Verdict | Key Gaps |
|------|---------|----------|
| 28 | GAPS | Open decisions not tracked in code; 10/11 decision items not visible; under-specified areas only partially implemented |
| 29 | GAPS | 4/10 risks complete, 6/10 have significant gaps; E2EE (SEC-003) and SSRF (SEC-006) are strongest; session management (SEC-002), device security (SEC-007), exports (SEC-008) need work |