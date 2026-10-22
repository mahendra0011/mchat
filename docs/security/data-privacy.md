# Data Privacy, Retention & Leak Prevention

Spec 37 implementation reference. Code paths and tests named here are the
current source of truth; update this document in the same PR that changes
retention, export, deletion or egress behavior.

## 1. Data inventory and classification

| Data category | Examples | System of record | Purpose | Retention | Export / deletion |
|---|---|---|---|---|---|
| Account identity | account id, email, display name, avatar | `user_accounts`, `identity_workspaces` | Authentication, profile | Account lifetime + deletion grace | Exportable; account deletion |
| Memberships | workspace, role, status | `workspace_memberships` | Authorization | Membership lifetime | Exportable; removed on leave/delete |
| Messages | ciphertext envelopes, client ids, sequence | `message_envelopes` | Messaging | Conversation retention (`retention_days`) or default | Exportable by participants; delete-for-me/delete-for-everyone |
| Attachments | object key, MIME, size, scan state | media metadata + object storage | File sharing | Follows message/conversation retention | Exportable; blob purge with tombstones |
| Internal notes | business-only notes | `business_internal_notes` | Business workflow | Business workspace retention | **Never** in customer export |
| Receipts / presence | delivery state, typing, online | DB + Redis (ephemeral) | Delivery UX | Ephemeral / short | Not exported |
| Auth/session | session id, device, revocation | `auth_sessions`, `device_sessions` | Session security | Session lifetime + audit window | Not exported |
| Security/audit | audit events, reports, risk signals | `admin_audit_logs`, trust & safety tables | Abuse/incident response | Policy-defined, legal hold aware | Restricted; staff-only |
| Privacy requests | erasure/access requests, deadlines | `data_requests` | Legal compliance | Statutory period | Staff workflow |
| Legal docs/consent | policy versions, consent records | `legal_documents`, `user_legal_consents` | Consent evidence | Statutory period | Exportable consent record |
| Backups | DB snapshots + tombstone ledger | backup storage | Disaster recovery | Documented backup expiry | Tombstones re-applied on restore |
| Telemetry | counters, spans, latency | telemetry pipeline | Operations/security | Short, aggregate | Content-free only |

Classification: identity/contact data is **personal**; message bodies, attachments
and internal notes are **confidential content**; keys and tokens are **secrets**;
audit and abuse records are **restricted**. Owners are named in
`docs/operations/coverage-map.md` and `docs/security/risk-register.md`.

## 2. Never in routine logs or analytics

Allowlisted structured fields only. Never log: message/note plaintext,
attachments, passwords/OTP, session or access tokens, API keys, private/recovery
keys, signed URLs, full authorization/cookie headers, complete contact lists,
full email/phone values, message previews, payment secrets.

Enforcement:
- `apps/api/src/logger.ts` — key denylist plus Bearer/password/token/secret
  patterns; Fastify request logging disabled (`app.ts`).
- `apps/api/src/telemetry.ts` — `sanitizeTelemetryEvent` drops sensitive keys,
  long text and nested content.
- `apps/api/src/privacy-leak.test.ts` — seeds synthetic secrets and asserts they
  never reach logs, telemetry or push payloads.

## 3. Data egress review

Every external system needs a vendor/data-flow record: exact fields, purpose,
region, retention, sub-processors, training use, encryption, deletion ability,
contractual terms, opt-out. The dependency inventory lives in
`docs/security/dependency-register.csv`; vendor approvals and exceptions are
tracked in `docs/security/risk-register.md`. No production content goes to
analytics, AI, support, push, email, crash reporting or experimentation vendors
before review and minimization.

## 4. Retention schedule

| Dataset | Default | Configurable? | Where enforced |
|---|---|---|---|
| Messages / conversation | Conversation `retention_days` (fixtures use 30) | Yes, per conversation/workspace | `packages/domain/src/retention.ts`, retention jobs |
| Internal notes | Follows business workspace retention | Workspace policy | Store + retention sweep |
| Presence/typing | Seconds (TTL) | Yes | `presence-pubsub.ts` |
| Sessions | Session lifetime, revoked immediately | Yes | Auth/session routes |
| Audit/security events | Compliance window | Legal hold overrides | Admin/audit storage |
| Abuse reports | Case lifetime | Policy | Trust & safety tables |
| Exports | Short-lived signed URL | Yes | Signed URL TTL clamp (1s–1h) |
| Dead-letter jobs | Bounded operational window | Yes | `job-queue.ts` |
| Backups | Documented backup expiry | Recovery policy | `docs/operations/disaster-recovery.md` |
| Telemetry | Short, aggregated | Yes | Telemetry pipeline |

“Retain forever” is not a default. Expiry jobs must be idempotent and observable.

## 5. Delete and export correctness

- Distinguish delete-for-me, delete-for-everyone, expiry, account deletion and
  business-record retention. Explain what recipients may already have seen or
  exported.
- Deletion enumerates primary rows, objects, caches, search indexes, derived
  thumbnails, queued jobs and downstream processors.
- `DeletionTombstoneLedger` (`packages/domain/src/retention.ts`) records hashed
  target ids so retries are idempotent and restores cannot resurrect erased
  data. `reconcileRestore` purges tombstoned rows after a restore; covered by
  `packages/domain/src/security-expansion.test.ts`.
- Backups may keep data until documented backup expiry, but restore must reapply
  tombstones and account revocations before serving traffic.
- Export reauthorizes at generation **and** download, uses private storage,
  short expiry, re-authentication and an audit event; internal business notes
  are excluded unless the caller is authorized. Personal and business export
  scopes stay separate.

## 6. Client caches, notifications and previews

- Browser storage is scoped to identity/device and cleared on logout, revoke or
  delete. Ciphertext is never treated as decryptable without keys.
- Service workers must not cache authenticated API responses; API responses for
  authenticated clients use `Cache-Control: no-store` (see
  `docs/acceptance-matrix.md`).
- Push payloads default to generic. `applyPreviewPrivacy` returns
  `{ title: 'New message' }` when previews are hidden, and `sender_only` drops
  the body. Users opt into previews with provider-exposure disclosure.
- Link previews go through the hardened fetch service (SSRF validation, redirect
  re-validation, size limits, no auto-open); preview data is not retained beyond
  the preview cache need. E2EE previews are generated locally unless the user
  explicitly submits the link.

## 7. AI and model privacy

AI is off by default for training on private content. Any AI feature must state
what leaves the device, provider, retention, review access and whether E2EE
plaintext is available. Prompt construction uses least context and must never
include internal business notes or another tenant's data. Messages, documents,
web pages and tool output are untrusted instructions. Prefer redaction and
provider zero-retention terms, verified technically and contractually.

## 8. References

- OWASP Privacy Risks: https://owasp.org/www-project-top-10-privacy-risks/
- OWASP Logging Cheat Sheet: https://cheatsheetseries.owasp.org/cheatsheets/Logging_Cheat_Sheet.html
- NIST Privacy Framework: https://www.nist.gov/privacy-framework
