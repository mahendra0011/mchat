# Security Observability & Privacy-Safe Telemetry

Spec 42 implementation reference. Observability must let responders detect and
investigate abuse without becoming a second copy of user content.

## 1. Principles

- **Content-free by default.** No message bodies, attachments, previews, notes,
  search queries, contact details or secrets in logs, metrics, traces, alerts or
  dashboards.
- **Allowlisted structured fields.** Free-text logging is not permitted in
  security-sensitive paths. Unknown fields are dropped.
- **Pseudonymous identifiers.** Use internal ids or hashes for correlation; do
  not export emails/phones. Security-only telemetry is access-controlled and
  audited.
- **Fail closed on redaction.** If a field cannot be classified, drop it.
- **Collect what drives action.** Every alert maps to a runbook and an owner.

Enforcement: `apps/api/src/logger.ts` (key denylist + token/password patterns),
`apps/api/src/telemetry.ts` (`sanitizeTelemetryEvent`), and
`apps/api/src/privacy-leak.test.ts` (synthetic-secret leak regression test).

## 2. Signal inventory

| Signal | Fields | Use |
|---|---|---|
| HTTP requests | route template, method, status, latency, region, hashed subject | Reliability, abuse spikes |
| Auth events | outcome/reason code, method, device class, hashed account | Brute force, takeover |
| Authorization denials | policy action, resource type, workspace hash | Tenant isolation probing |
| Rate limits | limiter name, scope, decision | Abuse/scraping |
| WebSocket | connections, auth failures, subscription denials, delivery lag | Realtime health/privacy |
| Jobs | queue depth, oldest age, retries, dead-letter count | Delivery guarantees |
| Uploads | size bucket, MIME class, scan result | Malware/abuse |
| Signed URLs | issued/denied/expired counts | Exfiltration attempts |
| Deletion/export | job outcome, record counts, duration (no ids) | Privacy correctness |
| Backups/restore | success, duration, reconciliation counts | DR readiness |
| Scanner/lint gates | pass/fail, counts | Supply-chain health |

Never collect: plaintext, ciphertext envelopes, media bytes, search terms,
passwords/OTP, tokens, cookies, authorization headers, signed URLs, full IPs
(use truncated/hashed), full contact data, support ticket contents.

## 3. Log record contract

```json
{
  "ts": "2026-01-01T00:00:00.000Z",
  "level": "warn",
  "event": "auth.login_failed",
  "requestId": "req_...",
  "route": "POST /v1/auth/login",
  "status": 401,
  "reason": "invalid_credentials",
  "actorHash": "sha256:...",
  "workspaceHash": "sha256:...",
  "durationMs": 12
}
```

Allowed keys are defined centrally; `password`, `token`, `authorization`,
`cookie`, `secret`, `key`, `body`, `message`, `text`, `query` and similar keys
are always redacted. Error messages are mapped to stable codes; stack traces are
kept internal and scrubbed of request data.

## 4. Retention and access

- Application logs: 30 days hot, 90 days cold (or shorter where policy requires).
- Metrics: 13 months for capacity/trend comparison.
- Security audit events: compliance window (default 1 year) with legal-hold
  override; separate from application logs and least-privilege access.
- Debug/trace sampling: low rate, no payload capture; enabling verbose mode
  requires an incident/change record and expires automatically.
- Telemetry export to vendors requires the egress review in
  `docs/security/data-privacy.md`.

## 5. Alerts (minimum)

| Alert | Condition (starting point) | Severity |
|---|---|---|
| Auth failure spike | >5× baseline for 10 min, or one account >20 failures/5 min | SEV-2/3 |
| Cross-tenant denial spike | >10 policy denials/min across distinct workspaces | SEV-2 |
| Queue age/dead letters | oldest job >5 min or DLQ increase for 15 min | SEV-2/3 |
| API error budget burn | 2% budget in 1 hour or 10% in 6 hours | SEV-2 |
| Realtime delivery lag | p95 >2s or reconnect storm | SEV-2 |
| Upload scan failures | >5 quarantined/scan errors per 15 min | SEV-3 |
| Backup/restore failure | any failed scheduled backup | SEV-2 |
| Certificate/secret expiry | <14 days | SEV-3 |
| Scanner gate bypass | HIGH/CRITICAL with suppression | SEV-3 |

Alert payloads contain counts, codes and hashed identifiers only. On-call
follows `docs/operations/incident-playbook.md`; thresholds are tuned after each
drill and reviewed with SLOs.

## 6. Dashboards

1. **Security:** auth outcomes, lockouts, policy denials, rate limits, scanner
   findings, suppressed findings, secret-scan hits.
2. **Reliability:** availability burn, latency percentiles, WebSocket health,
   queue depth/age, DB pool saturation.
3. **Privacy correctness:** deletion/export outcomes, restore reconciliations,
   leak-test status, telemetry redaction failures.

Access is role-based; dashboards must not expose raw identifiers or payloads.
