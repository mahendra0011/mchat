# Runbook: Push Notification Failure

## Severity
**SEV-2** (High) — Mobile/desktop push notifications not delivered; users miss realtime messages.

---

## Detection
- `/v1/metrics` shows `delivery.failed` spike for `push` channel
- Alert: `push_failure_rate` > 5% over 5 min
- Vendor dashboard (FCM/APNs) shows elevated error rates
- User reports: "not getting notifications"

---

## Incident Commander
- **Primary**: On-call Mobile/Backend Engineer
- **Secondary**: Platform Engineer

---

## Immediate Actions (T+0 to T+15min)
1. **Check vendor status**: FCM (Google), APNs (Apple), WebPush (Mozilla/Chrome) status pages.
2. **Inspect error codes**: Group failures by `invalid_token`, `unregistered`, `throttled`, `internal_server_error`.
3. **Token hygiene**: If `unregistered`/`invalid_token` high, run token cleanup job (remove stale device tokens from `device_sessions`).
4. **Throttling backoff**: If `throttled`, implement exponential backoff (max 60s) and reduce batch size.
5. **Payload validation**: Ensure payload size < 4KB (FCM) / 5KB (APNs); strip non-essential fields.
6. **Fallback**: Enable in-app badge/inbox as temporary notification surface via WebSocket `notification` event.
7. **Credentials**: Verify `FCM_SERVER_KEY`, `APNs_KEY_ID`, `APNs_TEAM_ID`, `APNs_PRIVATE_KEY` not rotated/expired.

---

## Communication
- **Internal**: `#incident-push` Slack.
- **Status Page**: Update "Push Notifications" component.

---

## Evidence Preservation
- Export failed push payloads (redacted) with error codes.
- Vendor API response logs (request IDs, timestamps).
- Device token rotation audit trail.

---

## Legal / Privacy Escalation
- Push payloads must not contain message content (Spec 10: privacy-safe telemetry). If they do, treat as data exposure incident.
- Token data is PII; ensure deletion on unregister.

---

## Post-Incident Template
| Field | Details |
|-------|---------|
| Incident ID | `INC-YYYYMMDD-XXX` |
| Start / End (UTC) |  |
| Root Cause |  |
| Failure Rate Peak |  |
| Affected Platforms (iOS/Android/Web) |  |
| Detection Method |  |
| Time to Detect (TTD) |  |
| Time to Mitigate (TTM) |  |
| Action Items (with owners + due dates) |  |
| Runbook Updates Needed |  |