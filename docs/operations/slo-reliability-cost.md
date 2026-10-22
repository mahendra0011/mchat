# Performance, Reliability & Cost

Spec 43 implementation reference. Targets are starting commitments for beta and
must be measured with the privacy-safe signals in
`docs/operations/observability.md`.

## 1. Service level objectives

| User journey | SLI | Beta target | Error budget |
|---|---|---|---|
| API availability | successful non-5xx responses / valid requests | 99.9% monthly | 43 min/month |
| Message send | accepted sends / attempts (excluding validation denials) | 99.95% | 21 min/month |
| Realtime delivery | events delivered to online clients within 2s | 99.5% | 3.6 h/month |
| API latency | p95 for non-media endpoints | <300 ms | alert on burn |
| Auth latency | p95 login/session validation | <500 ms | alert on burn |
| Upload/export jobs | completed within 5 min / 15 min | 99% | ticket + review |
| Recovery | RPO <5 min, RTO <30 min | per DR drill | SEV-2 if missed |
| Data correctness | no resurrection after restore | 100% | release blocker |

Exclusions: client network failures, provider outages, invalid requests, and
planned maintenance announced in advance. Measure server-side, not from a single
synthetic probe. Alert on multi-window error-budget burn.

## 2. Load and capacity scenarios

Run before beta and after changes to realtime, persistence or media:

| Scenario | Assumptions (beta baseline) | Pass criteria |
|---|---|---|
| Steady chat | 1,000 concurrent WebSockets, 100 msgs/s, 30% group fan-out | p95 send <300 ms, delivery <2 s, no queue backlog |
| Burst | 10× send rate for 2 min | rate limits protect core, recovery <5 min |
| Large uploads | 50 MB files, 20 concurrent | no memory growth, signed URL flow intact |
| History/export | 1M-message workspace export | completes within 15 min, memory bounded |
| Failure | DB primary failover / Redis loss | no data loss, reconnect + catchup correct |

Load harness lives with E2E (`apps/web/e2e/load.spec.ts`) with k6/Artillery as an
optional replacement for higher concurrency. Record results with release
evidence; do not optimize against synthetic numbers alone.

## 3. Resilience controls

- Rate limiting on auth, sends, uploads, invites, link previews and exports;
  stricter limits for unauthenticated and new accounts.
- Retries with bounded exponential backoff + jitter; idempotency keys for
  mutations; dead-letter queue for poison jobs with an operator replay path.
- Circuit breakers/timeouts for third-party calls (push, email, webhooks,
  previews) so a vendor outage cannot exhaust API workers.
- Database pool limits, statement timeouts, pagination caps and query budgets.
- WebSocket connection caps, backpressure, heartbeat and cursor-based catchup.
- Object storage signed URLs with clamped TTL; private buckets; CDN only for
  public/static assets.
- Graceful shutdown, health/readiness probes, and horizontal scaling for API and
  WebSocket tiers (sticky sessions or shared pub/sub).

## 4. Capacity triggers

| Signal | Trigger | Action |
|---|---|---|
| API p95 / CPU | >70% sustained for 15 min | Add instance; review hot routes |
| WebSocket connections | >70% of per-instance limit | Scale gateway; tune fan-out |
| Queue age | >2 min p95 | Scale workers; inspect slow handlers |
| DB connections/CPU | >70% | Pool tuning, indexes, read replica |
| Storage growth | >80% of plan | Lifecycle/retention review, expand |
| Error budget | 50% consumed | Freeze risky releases |
| Error budget | 100% consumed | Reliability-only work until restored |

## 5. Cost model and guardrails

Cost drivers: compute (API/WebSocket), managed Postgres, Redis, object storage +
egress, push/email providers, observability ingestion, CI minutes, and video
minutes (when calls ship).

Guardrails:

- Per-workspace quotas for storage, uploads, exports, invites and bot/webhook
  fan-out; hard caps for free tier, soft caps with warnings for paid.
- Retention defaults enforced; media lifecycle rules delete expired objects;
  avoid storing multiple transcodes/thumbnails indefinitely.
- Avoid high-cardinality metrics and verbose log ingestion; sample traces.
- Budget alerts at 50/80/100% per environment with an owner. Unit economics
  tracked as cost per active workspace and per 1,000 messages.
- Media/calling is the largest variable cost; gate group calls behind plans and
  cap participant minutes until usage data exists.
- Review reserved/committed-use discounts only after stable baseline.

## 6. Review cadence

Monthly: SLO attainment, error-budget policy, capacity triggers and cost per
unit. Quarterly: load test at 2× current peak, DR drill, vendor cost review.
Any missed SLO or drill requires an action item with owner and date; unresolved
items block release gates when they affect auth, delivery, deletion or recovery.
