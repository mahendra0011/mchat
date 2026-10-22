# Runbook: Queue Lag / Backlog

## Severity
**SEV-2** (High) — Message delivery delayed; scheduled messages not firing; realtime events stuck in outbox.

---

## Detection
- `/v1/metrics` shows `queue.pending` > 10,000 or growing > 10%/min
- `/v1/metrics` shows `queue.dead_letter` increasing
- Alert: `queue_lag_high` or `dead_letter_growth` firing
- Users report "message not delivered" or "scheduled message not sent"

---

## Incident Commander
- **Primary**: On-call Backend Engineer
- **Secondary**: Platform Engineer

---

## Immediate Actions (T+0 to T+15min)
1. **Identify stuck job type**: Check `queue.pending` breakdown by job name (scheduled_messages, outbox_flush, push_notifications, email_digests, retention_cleanup).
2. **Pause non-critical consumers**: Scale down workers for low-priority queues (digests, analytics) to free capacity.
3. **Inspect dead-letter queue**: `SELECT * FROM job_queue WHERE status = 'dead_letter' ORDER BY created_at DESC LIMIT 20;` — look for repeated failures (transient vs. poison pill).
4. **Replay poison pills**: Fix root cause (schema mismatch, missing secret) then `UPDATE job_queue SET status='pending', attempts=0 WHERE status='dead_letter' AND job_name='...';`
5. **Scale consumers**: Horizontal pod autoscaler or manual `kubectl scale deployment queue-worker --replicas=N`.
6. **Circuit-breaker**: If external dependency (push provider, email SMTP) is down, pause that queue and alert vendor.

---

## Communication
- **Internal**: `#incident-queue` Slack; post backlog count every 5 min.
- **Status Page**: Update "Messaging" component to `degraded`.

---

## Evidence Preservation
- Export dead-letter rows with full payload (redacted) for replay analysis.
- Capture worker logs showing retry attempts and error messages.
- Save `/v1/metrics` snapshots every 2 min.

---

## Legal / Privacy Escalation
- If delayed messages contain PII and delay exceeds retention policy threshold, assess GDPR Art. 32 compliance.
- If dead-letter contains user content, ensure access-controlled storage.

---

## Post-Incident Template
| Field | Details |
|-------|---------|
| Incident ID | `INC-YYYYMMDD-XXX` |
| Start / End (UTC) |  |
| Root Cause |  |
| Peak Backlog Size |  |
| Messages Delayed |  |
| Detection Method |  |
| Time to Detect (TTD) |  |
| Time to Mitigate (TTM) |  |
| Action Items (with owners + due dates) |  |
| Runbook Updates Needed |  |