# Security Testing & Verification

Spec 39 implementation matrix. Each ASVS 5.0 chapter maps to automated evidence
in this repository. Manual penetration testing and external review supplement,
but do not replace, the automated gates.

## 1. Test layers

| Layer | Command / location | Purpose |
|---|---|---|
| Type safety | `pnpm typecheck` | Eliminate unsafe shapes in security paths |
| Unit/property | `pnpm test` (Vitest/node:test) | Authz, crypto, retention, validation invariants |
| API integration | `apps/api/src/api.test.ts`, `db.test.ts`, `backup.test.ts` | Tenant isolation, sessions, deletion, restore |
| Realtime | `apps/api/src/realtime.test.ts` | Socket auth, subscription scoping, presence |
| Privacy leak test | `apps/api/src/privacy-leak.test.ts` | Synthetic secrets never reach logs/telemetry/push |
| E2E | `apps/web/e2e/*.spec.ts` (Playwright) | Auth, tenant, privacy, a11y, load smoke |
| SAST / SCA / secrets / IaC | `.github/workflows/security.yml`, `sast.yml` | Code, dependency, secret, container/config findings |
| Accessibility | `apps/web/e2e/a11y.spec.ts`, Lighthouse | Accessible security prompts and recovery flows |

## 2. ASVS 5.0 mapping

| ASVS chapter | Controls exercised | Evidence |
|---|---|---|
| V1 Encoding & sanitization | XSS output encoding, Markdown sanitization, link preview URL validation, SSRF guards | `apps/api/src/link-preview.test.ts`, `apps/api/src/exif.test.ts`, web sanitizer tests |
| V2 Validation & business logic | Schema validation, pagination/limit bounds, idempotency, upload limits | `packages/schemas/src/*.test.ts`, `apps/api/src/api.test.ts` |
| V3 Web frontend | Session/logout UX, CSRF strategy, security headers, cache controls | `security-headers.test.ts`, acceptance matrix, nginx.conf |
| V4 API & web service | Authentication, authorization, tenant scoping, rate limits, error handling | `api.test.ts`, `realtime.test.ts`, `infra.test.ts` |
| V5 File handling | Type/size checks, EXIF stripping, private storage, signed URLs | `exif.test.ts`, `signed-url.test.ts`, `api.test.ts` |
| V6 Authentication | Password/OTP flows, session rotation, re-auth, lockout, MFA hooks | `api.test.ts`, `security-expansion.test.ts` |
| V7 Session management | Revocation, device sessions, idle/absolute expiry, cookie flags | `api.test.ts`, `security-expansion.test.ts` |
| V8 Authorization | Role/permission matrix, workspace isolation, admin boundaries, IDOR | `api.test.ts`, `security-expansion.test.ts`, domain permission tests |
| V9 Self-contained tokens | JWT validation, expiry, audience/issuer, key handling | `crypto-adapter` tests, `api.test.ts` |
| V10 OAuth/OIDC | Identity linking, state/nonce, redirect validation | `apps/api/src/security-expansion.test.ts` |
| V11 Cryptography | AEAD envelopes, key derivation/wrapping, randomness, signed URL HMAC | `packages/crypto-adapter/src/*.test.ts` |
| V12 Secure communication | TLS edge config, HSTS, WebSocket upgrade, no mixed content | `infra/docker/nginx.conf`, e2e smoke |
| V13 Configuration | Env validation, fail-closed prod config, secret handling, headers | `apps/api/src/config.test.ts`, `env.ts`, gitleaks |
| V14 Data protection | Retention, deletion tombstones, export authz, backups, log redaction | `security-expansion.test.ts`, `retention.test.ts`, `privacy-leak.test.ts` |
| V15 Secure coding | Strict TS, lint, dependency policy, SAST | `pnpm typecheck`, `pnpm lint`, `pnpm licenses:check`, CodeQL |
| V16 Security logging | Content-free audit events, redaction, monitoring/alerting | `logger.ts`, `telemetry.ts`, `docs/operations/observability.md` |
| V17 WebRTC | Signaling authz, SFU tokens, media privacy | `packages/webrtc-sfu/src/*.test.ts` |

## 3. Mandatory negative cases

These must stay covered (each has an assertion in the test suite unless marked):

- Cross-tenant read/write/delete/socket subscription → denied.
- Missing, expired, revoked and malformed session/JWT → denied.
- Privilege escalation (member→admin, business→personal export, staff override)
  → denied and audited.
- Replay/duplicate mutation, idempotency keys, restore duplication → safe.
- XSS payloads in messages, display names, link previews, notifications → inert.
- SSRF: localhost, metadata IPs, redirects, DNS rebinding-style hosts → blocked.
- Upload: oversized, wrong MIME, executable, decompression bomb, EXIF GPS → rejected/stripped.
- Rate-limit and lockout thresholds → enforced, no account enumeration.
- Deleted/expired content and revoked sessions cannot be resurrected (incl.
  backup restore) → enforced via tombstone ledger.
- Secret material in logs/telemetry/push payloads → absent.

## 4. Risk-based manual testing

Before public beta and after high-risk changes: external pentest of auth,
tenant isolation, file upload, realtime and admin surfaces; abuse-case review of
invites, exports, bots/webhooks and notification fan-out. Findings are tracked in
`docs/security/risk-register.md` with severity SLAs from
`docs/security/supply-chain.md`. Re-test remediated issues and retain evidence.

## 5. Evidence package per release

CI run URL, test summary counts, SBOM, scan results (SAST/SCA/secrets/IaC),
license report, dependency register export, risk-register delta, pentest
attestation (when applicable) and sign-off from engineering + security owners
(`docs/security/release-gates.md`).
