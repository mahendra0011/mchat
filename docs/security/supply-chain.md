# Secure SDLC, CI/CD & Software Supply Chain

Spec 36 implementation guide. The controls below are mapped to files that exist in
this repository. Anything marked **deferred** has an owner and review date in the
decision register (`docs/operations/coverage-map.md`).

## 1. Change lifecycle

Every change follows:

`issue/threat notes → design/API/data review → implementation → peer review → automated checks → risk-based security testing → staging validation → controlled rollout → monitoring`

High-risk changes (crypto, authentication, permissions, export/delete, billing,
keys, admin access, data migrations) additionally require security-owner
approval before merge. The risk register and owner list live in
`docs/security/risk-register.md`.

## 2. Repository protection

- Branch protection on `main`: required review, required status checks, no
  direct pushes, no force pushes. Configure in GitHub repository settings;
  the required checks are the workflow names in `.github/workflows/`.
- Secrets never belong in the repo. `.env.example` contains placeholders only;
  real values come from the environment/secret manager (see
  `docs/security/infrastructure.md`).
- A committed secret must be revoked/rotated first, then removed. History
  rewriting alone is not remediation.
- Pull requests from forks never receive production secrets. Workflows that
  deploy run from `main` or via `workflow_dispatch` with environment approval
  (`.github/workflows/pre-beta-checklist.yml`).
- Code owners should review: `.github/workflows/**`, Dockerfiles,
  `infra/**`, dependency/lockfile changes, auth/crypto/billing paths.

## 3. CI security gates

| Gate | Control | Where |
|---|---|---|
| Lockfile consistency | `pnpm install --frozen-lockfile` | `ci.yml`, `security.yml`, `sbom.yml` |
| Type safety | `pnpm typecheck` (strict TS) | `ci.yml` |
| Formatting/lint | `pnpm lint` | `ci.yml` |
| Unit + integration tests | `pnpm test` (324 tests) | `ci.yml` |
| API/realtime contract tests | `apps/api/src/api.test.ts`, `realtime.test.ts` | `ci.yml` |
| SAST | CodeQL JavaScript/TypeScript | `security.yml`, `sast.yml` |
| Secret scanning | Gitleaks (full history, redacted output) | `security.yml`, `sast.yml` |
| Dependency review | `actions/dependency-review-action` (high+) | `security.yml` |
| SCA audit | `pnpm audit --audit-level=high` | `security.yml`, `sast.yml` |
| License policy | `pnpm licenses:check` | `security.yml` |
| SBOM | CycloneDX (`@cyclonedx/bom`, Syft fallback) | `sbom.yml`, `sast.yml` |
| Container/IaC scan | Trivy filesystem + config scan | `security.yml` |
| E2E auth/tenant/privacy flows | Playwright smoke + a11y + e2e | `ci.yml` |
| Release gate | Pre-beta checklist workflow | `pre-beta-checklist.yml` |

A green scanner is evidence that a check ran, not proof of security. Findings
must be triaged; suppressions require an owner, rationale, scope and expiry.
Suppressions are recorded in `docs/security/risk-register.md`.

## 4. Build and deployment integrity

- CI workflows use a minimal `permissions` block where possible; release jobs
  use GitHub environment protection.
- Deploy immutable versioned artifacts; do not deploy mutable tags. Container
  images are built from `infra/docker/Dockerfile.api` / `Dockerfile.web`.
- Runtime containers are non-root where the base image allows it, drop Linux
  capabilities, set `no-new-privileges`, and use read-only roots plus tmpfs
  (see `infra/docker/docker-compose.yml` and
  `docs/security/infrastructure.md`).
- SBOMs are retained for 90 days (`sbom.yml`). Keep the SBOM with the release
  evidence package.
- **Deferred:** artifact signing (Sigstore/cosign) and build provenance
  attestation. Owner: Platform Lead. Review date: 2027-01-01. Until then,
  deployments must use immutable digests and the pre-beta gate.
- Keep a rollback artifact and a database compatibility plan
  (`docs/runbooks/feature-rollback.md`).

## 5. Vulnerability management SLAs

| Severity / situation | Triage | Remediation or mitigation target |
|---|---|---|
| Actively exploited, credential or key exposure | Immediate incident triage | Isolate/rotate immediately; no sprint wait |
| Critical | Within 24 hours | Fix/mitigate within 72 hours or block release/disable surface |
| High | Within 2 business days | Fix within 7 days |
| Medium | Within 10 business days | Fix within 30 days |
| Low | Risk-based | Planned remediation |

Targets may be tightened based on exploitability and exposure. Unresolved items
need a documented owner and compensating control. Emergency patches follow the
incident playbook (`docs/operations/incident-playbook.md`).

## 6. License policy

Allowed by default: MIT, ISC, BSD-2-Clause, BSD-3-Clause, Apache-2.0, MPL-2.0,
0BSD, Unlicense, CC0-1.0, CC-BY-4.0, Python-2.0, BlueOak-1.0.0 and compound
licenses where at least one alternative is allowed.

Denied without an approved exception: GPL, AGPL, LGPL (for linked runtime code),
SSPL, EUPL, OSL, Commons Clause. Exceptions belong in
`docs/security/license-exceptions.json` with owner, rationale and expiry. Run
`pnpm licenses:check` before changing dependencies.

## 7. References

- OWASP Dependency-Check / Dependency-Check Maven: https://owasp.org/www-project-dependency-check/
- SLSA: https://slsa.dev/
- Sigstore: https://www.sigstore.dev/
- CycloneDX: https://cyclonedx.org/
