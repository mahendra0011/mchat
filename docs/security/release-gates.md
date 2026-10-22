# Security Acceptance & Release Gates

Spec 45 implementation reference. A release is promoted only when every gate
below is evidenced. Passing CI is necessary but not sufficient: manual
attestations in the release workflow are required for controls that cannot be
proven from code alone.

## Gate 0 — Scope and risk

- Release scope, user impact, data touched, feature flags and rollback plan
  documented.
- High-risk changes (auth, permissions/tenancy, crypto/keys, deletion/export,
  billing, admin, migrations, new vendors) have security-owner review.
- Threat/abuse cases identified; new external data flows added to the egress
  register (`docs/security/data-privacy.md`, `dependency-register.csv`).
- Blocking: unknown data flow, unreviewed high-risk change, missing rollback.

## Gate 1 — Automated checks (every merge)

| Check | Command / workflow | Blocking |
|---|---|---|
| Frozen install | `pnpm install --frozen-lockfile` | Yes |
| Build | `pnpm build` | Yes |
| Typecheck | `pnpm typecheck` | Yes |
| Lint | `pnpm lint` (0 errors) | Yes |
| Tests | `pnpm test` (domain, crypto, API, privacy leak) | Yes |
| License policy | `pnpm licenses:check` | Yes |
| SAST | CodeQL (`security.yml`, `sast.yml`) | HIGH/CRITICAL |
| Secrets | Gitleaks full history | Any verified secret |
| Dependencies | dependency-review + `pnpm audit --audit-level=high` | HIGH/CRITICAL |
| Container/IaC | Trivy fs + config | HIGH/CRITICAL |
| SBOM | `sbom.yml` | Artifact missing |
| E2E smoke/a11y | Playwright `ci.yml` | Yes |

Suppressions require a risk-register entry with owner, scope, rationale and
expiry. Expired suppressions fail the gate.

## Gate 2 — Security verification

- ASVS mapping (`docs/security/security-testing.md`) has evidence for every
  in-scope chapter; negative cases pass.
- Privacy leak test passes; no content/secrets in logs, telemetry, push payloads
  or analytics (`apps/api/src/privacy-leak.test.ts`).
- Tenant isolation and authorization regression tests pass.
- Backup/restore and tombstone reconciliation verified for changes affecting
  persistence (`backup.test.ts`, `security-expansion.test.ts`).
- External pentest findings: no open Critical/High; Medium accepted with owner
  and date. Re-test evidence attached.
- Blocking: open Critical/High, failed privacy/tenancy test, untriaged scanner
  HIGH/CRITICAL.

## Gate 3 — Release readiness

Run the `Pre-Beta Checklist` workflow
(`.github/workflows/pre-beta-checklist.yml`) for `staging` or `production`.
It fails unless all of the following are true:

- [ ] Domain, DNS, TLS (>30 days), HSTS and CAA verified.
- [ ] Security headers/CSP verified on the deployed URL.
- [ ] Rate limits return 429 at threshold.
- [ ] Backup/restore test passes against the target database.
- [ ] Push credentials configured (or push explicitly disabled for the release).
- [ ] Privacy-safe logging/telemetry leak test passes.
- [ ] Alerts route to the on-call owner.
- [ ] Status page and vulnerability disclosure contact exist.
- [ ] DR, account-takeover, data-exposure and key-revocation drills passed.
- [ ] Staging config parity and feature-flag rollout percentages confirmed.
- [ ] Rollback verified (`docs/runbooks/feature-rollback.md`).
- [ ] Release checklist (`docs/runbooks/release-checklist.md`) signed.

Manual attestations are workflow inputs; false or missing inputs block
promotion. Do not bypass with an ad-hoc deploy.

## Gate 4 — Production monitoring

- Canary/small rollout first; watch error budget, auth denials, queue age,
  delivery lag and cost anomalies.
- Confirm no new HIGH/CRITICAL findings or leaked secrets after deploy.
- Rollback triggers and owner on standby for the observation window.
- Post-release checklist completed; incidents handled per
  `docs/operations/incident-playbook.md`.

## Exception process

A gate may be waived only with a written, time-boxed risk acceptance approved by
the security owner and engineering lead. It must include: control missing,
reason, compensating control, exposure window, owner, expiry and remediation
date. Exceptions are recorded in `docs/security/risk-register.md`; expired
exceptions block the next release.

## Evidence package

Attach to the release record: CI run URL, test counts, SBOM, license report,
scan outputs, suppression list, ASVS/pentest evidence, DR drill record, pre-beta
workflow run, rollback plan and sign-offs. Retain per the audit retention policy.
