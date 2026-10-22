# Library & Backend Concept Coverage Map (Spec 46)

This document classifies every foundational architecture, identity, communication,
backend, quality and platform-operations concept used by Orbit Chat as
**selected**, **intentionally excluded**, or **deferred**. Deferred/excluded
items carry an owner and review date. Evidence points to the repository path or
test that proves the decision.

## 1. Core concept decisions

| Domain | Concept | Selected technology / control | Why | Version / license | Data touched | Owner | Security evidence | Status | Limitation | Review |
|---|---|---|---|---|---|---|---|---|---|---|
| Runtime | Monorepo workspace | pnpm workspaces | Fast, strict dependency isolation | pnpm 9 / MIT | Build only | Platform Lead | Frozen lockfile gate | **selected** | Requires Node >= 20 | 2027-01-01 |
| Runtime | Strict typing | TypeScript (`tsc`) | Contract safety across packages | 5.9.3 / Apache-2.0 | Code symbols | Architecture Lead | `pnpm typecheck` | **selected** | Test files compile via `tsconfig.tests.json` | 2027-01-01 |
| Runtime | HTTP framework | Fastify | Low overhead, schema-inferred handlers | 4.29 / MIT | Requests/responses | Backend Lead | API integration suite | **selected** | Node-only runtime | 2027-01-01 |
| Runtime | Input validation | Zod schemas (`@orbit/schemas`) | Shared runtime validation client+server | 3.25 / MIT | Validated inputs | Backend Lead | Schema unit tests | **selected** | Schemas must stay backward compatible | 2027-01-01 |
| Frontend | Web client | React + Vite | Reactive UI, instant HMR, static build | React 18.3 / Vite 5.4 / MIT | UI state | Frontend Lead | E2E + a11y | **selected** | Requires client JavaScript | 2027-01-01 |
| Frontend | Styling | Aurora Paper design tokens (CSS vars) | Zero runtime, WCAG 2.2 AA palette | 1.0.0 / MIT | Visual tokens | Design Lead | Token contrast tests | **selected** | Consistent token usage required | 2027-01-01 |
| Frontend | Mobile client | Expo / React Native | Share domain/schemas with web | Expo 51 / RN 0.74 / MIT | Device sessions, local cache | Mobile Lead | Mobile unit tests, secure-store | **selected** | Push delivery deferred (see below) | 2027-01-01 |
| Frontend | Localization | `@orbit/localization` | Locale bundles + fallbacks | 1.0.0 / MIT | UI strings | Frontend Lead | Localization tests | **selected** | RTL audit still manual | 2027-01-01 |
| Identity | Authentication | Opaque sessions + WebAuthn hooks | Phishing-resistant primary path | FIDO2 L3 / standard | Challenges, public keys | Security Lead | Auth/session API tests | **selected** | Hardware authenticator recommended | 2027-01-01 |
| Identity | Step-up re-auth | Time-bounded elevated session | Protect export/ownership changes | 1.0.0 / MIT | Elevated session state | Security Lead | Step-up tests | **selected** | 60-minute elevation window | 2027-01-01 |
| Cryptography | Symmetric encryption | WebCrypto AES-256-GCM | Audited native primitives | W3C standard | Message/attachment ciphertext | Security Lead | `crypto-adapter` suite | **selected** | Secure CSPRNG required | 2027-01-01 |
| Cryptography | Key verification | Safety numbers + QR | Detect server key substitution | Orbit Spec 31 | Public identity keys | Security Lead | Safety-number tests | **selected** | Requires out-of-band comparison | 2027-01-01 |
| Authorization | Multi-tenancy + RBAC/ABAC | Central `PolicyEngine` | Prevent BOLA/IDOR and tenant bleed | 1.0.0 / MIT | Context + resource ids | Backend Lead | Policy/tenant isolation tests | **selected** | Needs complete context input | 2027-01-01 |
| Realtime | WebSocket gateway | `@fastify/websocket` + cursors | Bi-directional delivery with catchup | 10.x / MIT | Event envelopes | Backend Lead | Realtime auth/scoping tests | **selected** | Socket is not source of truth | 2027-01-01 |
| Abuse | SSRF defense | `validateSafeUrl` | Blocks private/metadata egress | 1.0.0 / MIT | Target URLs | Security Lead | SSRF edge-case tests | **selected** | HTTPS required | 2027-01-01 |
| Abuse | Rate limiting | Sliding-window limiter | Brute-force/scraper defense | 1.0.0 / MIT | Hashed IP, account ids | Security Lead | Threshold tests | **selected** | In-memory per node; shared store needed to scale | 2027-01-01 |
| Privacy | Retention + deletion | `DeletionTombstoneLedger` | No resurrection after restore | 1.0.0 / MIT | Hashed target ids | Privacy Lead | Retention/reconcile tests | **selected** | Tombstones persist for reconciliation | 2027-01-01 |
| Observability | Telemetry/logging | Redacted structured logs | No content/secrets in pipeline | 1.0.0 / MIT | Pseudonymous metadata | DevOps Lead | `privacy-leak.test.ts` | **selected** | Content prohibited by policy | 2027-01-01 |
| Data | Relational storage | PostgreSQL 16 | ACID, constraints, durable backups | PostgreSQL license | Structured records | Database Lead | DB + backup tests | **selected** | RLS is defense-in-depth only | 2027-01-01 |
| Data | Cache/presence | Redis 7 (BSD image) | Ephemeral presence/pubsub | Redis 7 / BSD-3 | Ephemeral ids | Platform Lead | Presence/pubsub tests | **selected** | Never primary storage | 2027-01-01 |
| Communications | WebRTC SFU | SFU signaling/package scaffolding | Group call bandwidth control | LiveKit / Apache-2.0 | Media signaling | Media Lead | `webrtc-sfu` tests | **deferred with owner** | Managed/self-hosted SFU selected at calls GA; owner: Media Lead | 2027-03-01 |
| AI/ML | Model training on content | None | No training on customer content | N/A | None | Security Lead | AI privacy review | **intentionally excluded** | Local deterministic helpers only | 2027-01-01 |

## 2. Extended concept register

| Concept | Decision | Evidence / location | Status | Owner | Limitation / review |
|---|---|---|---|---|---|
| API client SDK | Typed shared client | `packages/api-client` | **selected** | Frontend Lead | No auto-generated OpenAPI client yet |
| Search | Server-side full-text + semantic index | `routes/search.ts`, `routes/semantic-search.ts`, domain index | **selected** | Backend Lead | In-memory per-workspace index; needs external index at scale |
| Link previews | Server-side fetch with SSRF/redirect checks | `link-preview.ts`, tests | **selected** | Backend Lead | Preview cache is process-local |
| Media uploads | MIME/size/EXIF validation + private signed URLs | `exif.ts`, `signed-url.ts`, `routes/media.ts` | **selected** | Security Lead | Transcoding absent |
| Malware scanning | Signature/heuristic scanner + quarantine state | `malware-scan.ts` | **selected** | Security Lead | Not a full AV engine; ClamAV integration deferred |
| Push notifications | In-app feed + privacy-filtered push payloads | `routes/notifications.ts` | **selected** | Mobile Lead | FCM/APNs delivery deferred; owner: Mobile Lead, 2027-03-01 |
| Email delivery | None | — | **intentionally excluded** | Backend Lead | Transactional email picked with beta provider; re-review 2027-01-01 |
| Billing | Provider-agnostic billing interface + mock | `billing-provider.ts`, `routes/billing.ts` | **selected** | Backend Lead | Live PSP deferred until paid beta; owner: Backend Lead, 2027-03-01 |
| Integrations/webhooks | Token revoke + signed webhook delivery | `routes/integrations.ts`, `webhook-delivery.ts` | **selected** | Backend Lead | No inbound webhook replay dashboard yet |
| Job queue | In-process retry queue + DLQ | `job-queue.ts` | **selected** | Backend Lead | Not durable across restarts; managed queue deferred, 2027-03-01 |
| Feature flags | Percentage rollout gate | `feature-flags.ts` | **selected** | Backend Lead | No remote flag service |
| Admin/trust & safety | Cases, holds, audit, abuse signals | `routes/admin.ts`, migration 0017 | **selected** | Security Lead | Staff tooling UI is minimal |
| Legal/compliance | Policy docs, consent, data requests | migration 0017, `routes/privacy.ts` | **selected** | Privacy Lead | Jurisdiction templates need counsel review |
| Portability/export | Authorized export + download re-auth | `portability.ts`, `routes/portability.ts` | **selected** | Privacy Lead | Large exports use shared worker |
| Account security | Session/device revocation, key rotation | `routes/security.ts`, `security-keys.ts` | **selected** | Security Lead | Hardware-key recovery is manual |
| Secrets at rest | Env/secret manager injection | `env.ts`, `secret-store.ts` | **selected** | Platform Lead | Managed vault integration deferred, 2027-01-01 |
| Object storage | Local driver + S3-compatible driver | `storage` config, signed URLs | **selected** | Platform Lead | Multipart upload for very large files deferred |
| Observability stack | Structured logs + metrics hooks | `logger.ts`, `telemetry.ts`, this doc | **selected** | DevOps Lead | Managed OTel/Prometheus pipeline deferred, 2027-03-01 |
| Email/calendar/AI vendors | No outbound vendor content flows | egress review in `data-privacy.md` | **intentionally excluded** | Security Lead | Any addition requires Gate 0 review |
| Managed search/vector DB | None | — | **deferred with owner** | Backend Lead | Revisit at 100k messages/workspace; 2027-06-01 |
| Malware sandbox/AV | ClamAV or cloud scanner | quarantine path exists | **deferred with owner** | Security Lead | Before public file sharing GA; 2027-03-01 |
| Durable queue/broker | Managed queue (SQS/Cloud Tasks) | `job-queue.ts` seam | **deferred with owner** | Platform Lead | When multi-instance workers ship; 2027-03-01 |
| Video conferencing | LiveKit managed/self-hosted | `routes/calls.ts`, `webrtc-sfu` | **deferred with owner** | Media Lead | Calls GA gate; 2027-03-01 |
| AI model integration | External LLM providers | `routes/ai.ts` uses local helpers only | **intentionally excluded** | Security Lead | Requires egress + privacy review to change |
| End-to-end encrypted backups | Client-side key escrow | Backup is server-side ciphertext only | **intentionally excluded** | Security Lead | Would change restore model |

## 3. Quality, security and operations concepts

| Concept | Decision | Evidence | Status | Owner | Review |
|---|---|---|---|---|---|
| Unit/integration testing | node:test + Vitest | `pnpm test` (324 tests) | **selected** | QA Lead | 2027-01-01 |
| E2E/accessibility | Playwright + axe | `apps/web/e2e/*` | **selected** | QA Lead | 2027-01-01 |
| SAST/SCA/secrets/IaC | CodeQL, Gitleaks, audit, Trivy | `.github/workflows/` | **selected** | Security Lead | 2027-01-01 |
| License compliance | Denylist gate + exceptions | `scripts/check-licenses.mjs` | **selected** | Platform Lead | 2027-01-01 |
| SBOM | CycloneDX artifact | `sbom.yml` | **selected** | Platform Lead | 2027-01-01 |
| Artifact signing/provenance | Not yet | `supply-chain.md` | **deferred with owner** | Platform Lead | Before public GA; 2027-01-01 |
| Container hardening | Non-root, read-only, cap-drop | `infra/docker/*`, `infrastructure.md` | **selected** | Platform Lead | 2027-01-01 |
| IaC | Terraform + Kubernetes manifests | `infra/terraform`, `infra/kubernetes` | **selected** | Platform Lead | NetworkPolicy deferred, 2027-01-01 |
| CI/CD gates | Workflows + pre-beta gate | `.github/workflows/`, `release-gates.md` | **selected** | Platform Lead | 2027-01-01 |
| Backup/DR | PITR + restore drills + tombstones | `disaster-recovery.md`, backup tests | **selected** | Database Lead | 2027-01-01 |
| Incident response | Severity, containment, comms, drills | `incident-playbook.md` | **selected** | Security Lead | 2027-01-01 |
| SLO/capacity/cost | SLOs, load scenarios, budgets | `slo-reliability-cost.md` | **selected** | Platform Lead | 2027-01-01 |
| Deployment options | Low-cost beta profile + exit plan | `deployment-options.md` | **selected** | Platform Lead | 2027-01-01 |
| Multi-region active-active | Not for beta | DR doc | **deferred with owner** | Platform Lead | After DR drills; 2027-06-01 |
