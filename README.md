# Orbit Chat Platform

Working codename: **Orbit Chat** (perform brand/trademark clearance before shipping).
A TypeScript monorepo for a privacy-first messaging platform with web and mobile
clients, a Fastify API, shared domain rules and a security/release-gate program.

The 00–46 specification pack has been implemented and removed from the repository;
ongoing documentation lives under [`docs/`](docs/) and the index is
[`INDEX.md`](INDEX.md). Operational concept decisions and deferrals are tracked in
[`docs/operations/coverage-map.md`](docs/operations/coverage-map.md).

## Repository layout

| Path | Contents |
|---|---|
| `apps/api` | Fastify HTTP/WebSocket API, persistence, security controls, tests |
| `apps/web` | React + Vite web client, Playwright E2E/a11y/load specs |
| `apps/mobile` | Expo / React Native client |
| `packages/domain` | Policy engine, retention, E2EE helpers, product rules |
| `packages/crypto-adapter` | WebCrypto AES-GCM, key wrapping, safety numbers |
| `packages/schemas` | Shared Zod validation schemas |
| `packages/api-client` | Typed API client |
| `packages/design-tokens`, `packages/localization`, `packages/ui-web` | Design system, i18n, UI primitives |
| `packages/webrtc-sfu` | Call signaling/SFU integration scaffolding |
| `infra/` | Dockerfiles, Compose, Kubernetes manifests, Terraform |
| `docs/` | Architecture, security, operations, runbooks and gates |
| `.github/workflows/` | CI, SAST/SCA, secrets, SBOM, staging and release gates |

## Quick start

Prerequisites: Node.js ≥ 20, pnpm ≥ 9, and optionally Docker.

```bash
pnpm install
pnpm build
pnpm typecheck
pnpm lint
pnpm test
```

Run the reference stack:

```bash
docker compose -f infra/docker/docker-compose.yml up --build
# web: http://localhost:3000  api: http://localhost:8080
```

Local development:

```bash
pnpm dev        # API + web dev servers
pnpm dev:api
pnpm dev:web
```

Database-backed API tests require `TEST_DATABASE_URL`; without it those suites
skip. E2E requires Playwright browsers (`pnpm --filter @orbit/web test:e2e:install`).

## Security and release baseline

- Dependency license gate: `pnpm licenses:check` (see `docs/security/supply-chain.md`).
- CI runs CodeQL, Gitleaks, dependency review, `pnpm audit`, Trivy (filesystem +
  IaC), SBOM generation and the full test suite.
- Release promotion requires the `Pre-Beta Checklist` workflow and the gates in
  `docs/security/release-gates.md`; manual attestations are blocking inputs.
- Runtime containers are non-root (nginx-unprivileged for web), read-only with
  dropped capabilities in Compose. Secrets are injected at runtime; the Compose
  values are local-development placeholders only.
- Privacy leak regression tests assert that synthetic secrets never reach logs,
  telemetry or push payloads (`apps/api/src/privacy-leak.test.ts`).

## Documentation

- Architecture: `docs/ARCHITECTURE_DECISIONS.md`, `docs/API_VERSIONING.md`, `docs/acceptance-matrix.md`
- Security: `docs/security/` (supply chain, data privacy, infrastructure, testing, release gates, risk register)
- Operations: `docs/operations/` (coverage map, incident playbook, DR, observability, SLO/cost, deployment options)
- Runbooks: `docs/runbooks/`

## Honest limitations

This repository is an implementation, not a security certification. End-to-end
encryption claims require independent protocol review; vendor email/push/billing
integrations and the LiveKit SFU are deferred or mocked until their gates pass;
production deployment, managed secrets and network policies must be configured
per `docs/security/infrastructure.md`. See the coverage map for every deferred
item, owner and review date.
