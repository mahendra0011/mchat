# Documentation Index

The 00–46 product/engineering specification pack has been implemented and its
Markdown files removed. This index lists the living documentation. Use
[`docs/operations/coverage-map.md`](docs/operations/coverage-map.md) to see every
concept classified as selected, intentionally excluded or deferred (with owner
and review date).

## Start

| Document | Purpose |
|---|---|
| [README.md](README.md) | Repository overview, quick start, commands and limitations |
| [audit-results.md](audit-results.md) | Historical implementation audit results |

## Architecture and product contracts

| Document | Purpose |
|---|---|
| [docs/ARCHITECTURE_DECISIONS.md](docs/ARCHITECTURE_DECISIONS.md) | Architecture decision records |
| [docs/API_VERSIONING.md](docs/API_VERSIONING.md) | API versioning and compatibility policy |
| [docs/acceptance-matrix.md](docs/acceptance-matrix.md) | Acceptance criteria and security header/cache expectations |
| [docs/minimum-client-policy.md](docs/minimum-client-policy.md) | Supported client baseline |
| [docs/W11_TECHNOLOGY_CHOICE_GATES.md](docs/W11_TECHNOLOGY_CHOICE_GATES.md) | Technology selection gates |

## Security

| Document | Purpose |
|---|---|
| [docs/security/supply-chain.md](docs/security/supply-chain.md) | Secure SDLC, CI gates, vulnerability SLAs and license policy |
| [docs/security/data-privacy.md](docs/security/data-privacy.md) | Data map, retention, deletion/export correctness and leak prevention |
| [docs/security/infrastructure.md](docs/security/infrastructure.md) | Network zones, secrets, data stores and container hardening |
| [docs/security/security-testing.md](docs/security/security-testing.md) | ASVS mapping, test layers and mandatory negative cases |
| [docs/security/release-gates.md](docs/security/release-gates.md) | Gate 0–4, evidence package, exceptions and sign-off |
| [docs/security/risk-register.md](docs/security/risk-register.md) | Risks, owners, suppressions and exceptions |
| [docs/security/dependency-register.csv](docs/security/dependency-register.csv) | Dependency/vendor inventory |
| [docs/security/license-exceptions.json](docs/security/license-exceptions.json) | Reviewed license exceptions (empty by default) |

## Operations

| Document | Purpose |
|---|---|
| [docs/operations/coverage-map.md](docs/operations/coverage-map.md) | Full concept decision register and deferrals |
| [docs/operations/incident-playbook.md](docs/operations/incident-playbook.md) | Severity, containment, breach communications and drills |
| [docs/operations/disaster-recovery.md](docs/operations/disaster-recovery.md) | RPO/RTO, tombstones, restore reconciliation and backup security |
| [docs/operations/observability.md](docs/operations/observability.md) | Privacy-safe logs, metrics, alerts and dashboards |
| [docs/operations/slo-reliability-cost.md](docs/operations/slo-reliability-cost.md) | SLOs, load scenarios, resilience and cost guardrails |
| [docs/operations/deployment-options.md](docs/operations/deployment-options.md) | Low-cost/open-source deployment profiles and exit plan |

## Runbooks

- [Release checklist](docs/runbooks/release-checklist.md)
- [Feature rollback](docs/runbooks/feature-rollback.md)
- [Auth incident](docs/runbooks/auth-incident.md)
- [Database outage](docs/runbooks/db-outage.md)
- [Queue lag](docs/runbooks/queue-lag.md)
- [Media storage incident](docs/runbooks/media-storage-incident.md)
- [Push failure](docs/runbooks/push-failure.md)
- [Account deletion failure](docs/runbooks/account-deletion-failure.md)
- [Encryption key migration](docs/runbooks/encryption-key-migration.md)
- [Release incident](docs/runbooks/release-incident.md)
- [Suspected content exposure](docs/runbooks/suspected-content-exposure.md)

## Community

- [Acceptable use rules](docs/community/acceptable-use-rules.md)
