# Orbit Chat — Security Threat Model & Risk Register (Spec 29)

## 1. Threat Actors & Capabilities

| Threat Actor | Motivation | Capabilities & Vectors | Primary Target Assets |
|---|---|---|---|
| **Opportunistic Cybercriminals** | Financial extortion, account takeover, spam distribution | Credential stuffing, brute-force login, phishing, public SSRF scanning | User credentials, business workspace access, invoice data |
| **Malicious Insiders / Compromised Staff** | Industrial espionage, unauthorized data access | Direct database queries, abuse of support/admin tooling, log inspection | Message plaintext, business internal notes, customer contact lists |
| **Cross-Tenant Attackers** | BOLA / IDOR exploitation, tenant leakage | Tampering with workspace IDs in API requests, websocket injection | Private messages, workspace configuration, billing quotas |
| **Network Eavesdroppers (Man-in-the-Middle)** | Mass surveillance, traffic interception | TLS stripping, rogue Wi-Fi access points, compromised DNS | Unencrypted payloads, session cookies, media uploads |

---

## 2. Protected Asset Classification

| Asset Category | Classification | Description & Storage Location | Protection Controls |
|---|---|---|---|
| **E2EE Private Keys** | Top Secret | Stored solely in client OS Secure Enclave / WebCrypto Keystore | Never transmitted to or stored on server; password/biometric gate |
| **Message Payloads** | Confidential | Stored as AES-256-GCM ciphertext in database & object store | Keyed with ephemeral message keys; never logged or indexed in plaintext |
| **Business Internal Notes** | Confidential | Stored in dedicated `internalNotes` table with tenant isolation | Strictly blocked from customer feeds, personal identities, and public APIs |
| **Session & Auth Tokens** | Secret | Stored in secure HTTP-only cookies and in-memory session maps | Immediate remote revocation, automatic idle timeout, step-up requirement |
| **Audit Logs** | Restricted | Tamper-evident hash-chained logs in `adminAuditLogs` | PII and secrets redacted; immutable retention for compliance |

---

## 3. Formal Risk Register

| Risk ID | Threat Scenario | Likelihood | Impact | Severity | Implemented Mitigation | Residual Risk | Status |
|---|---|---|---|---|---|---|---|
| **SEC-001** | BOLA / IDOR across tenant workspaces | Medium | Critical | High | Server-side `PolicyEngine` enforces tenant matching (`principal.workspaceId === resource.workspaceId`) on every route. | Low | Mitigated |
| **SEC-002** | Leakage of Business Internal Notes into customer chat | High | Critical | High | Hard separation in data models, distinct API endpoints, and test assertion enforcing ZERO notes in public feeds. | Low | Mitigated |
| **SEC-003** | Server-Side Request Forgery (SSRF) via link previews or webhooks | High | High | High | `validateSafeUrl` strictly blocks IPv4/IPv6 loopbacks, RFC1918 private ranges, and cloud metadata (169.254.169.254). | Low | Mitigated |
| **SEC-004** | Stolen or orphaned mobile device session | High | High | High | Remote device session management with single-session revocation and "Log out all other devices" in `SessionsAndDevicesModal`. | Low | Mitigated |
| **SEC-005** | Credential stuffing and automated login brute force | High | Medium | Medium | In-memory `SlidingWindowRateLimiter` enforces per-IP and per-account attempt limits with exponential backoff. | Low | Mitigated |
| **SEC-006** | Deleted user data resurrecting after database disaster restore | Medium | High | High | Cryptographically hashed `DeletionTombstoneLedger` reapplies erasure tombstones to prevent resurrection (Spec 41). | Low | Mitigated |
| **SEC-007** | E2EE Man-in-the-Middle or rogue server key substitution | Low | Critical | High | Out-of-band 60-digit Safety Numbers and QR code verification (`E2EEVerificationModal`) with key-change alert gates. | Low | Mitigated |

---

## 4. Release Risk Policy & Acceptance Gates (Spec 45)

1. **Zero High / Critical Unmitigated Risks**: No release artifact may be deployed to production with open Critical or High severity findings.
2. **Mandatory Step-Up Verification**: Destructive and high-assurance actions (exporting workspace data, transferring ownership, session revocation) require recent step-up re-authentication.
3. **Automated Regression Suite**: Monorepo test suite must pass with 100% success rate across domain invariants, API security tests, and crypto adapters prior to merge.
