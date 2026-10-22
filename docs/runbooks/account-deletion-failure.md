# Runbook: Account Deletion Failure

## Severity
**SEV-2** (High) — GDPR Art. 17 "Right to Erasure" request stuck; user data not deleted within 30-day deadline.

---

## Detection
- `/v1/metrics` shows `queue.dead_letter` for job `account_deletion` increasing
- Admin console shows `deletion_requested_at` > 30 days ago with `status != 'completed'`
- User support ticket: "My account deletion is stuck"
- Alert: `gdpr_deletion_overdue` firing

---

## Incident Commander
- **Primary**: On-call Backend Engineer
- **Secondary**: Privacy Officer / DPO

---

## Immediate Actions (T+0 to T+15min)
1. **Inspect stuck job**: `SELECT * FROM job_queue WHERE job_name='account_deletion' AND status IN ('pending','running','dead_letter') ORDER BY created_at;`
2. **Common failure modes**:
   - **Foreign key constraint**: Child rows in `message_envelopes`, `conversations`, `device_sessions` not cascading. Fix: run `DELETE FROM ... WHERE account_id=$1` in dependency order.
   - **E2EE content**: Server cannot decrypt; deletion is metadata-only (tombstones). Verify `deletion_tombstones` recorded.
   - **Media files**: S3 `DeleteObjects` failed (throttling, permissions). Retry with exponential backoff.
   - **External references**: Search index, analytics warehouse, backups. Run purge scripts.
3. **Manual completion**: If job logic sound but transient error, `UPDATE job_queue SET status='pending', attempts=0 WHERE id=$1;`
4. **Compensating transaction**: If partial delete occurred, run idempotent cleanup script to finish.
5. **Verify**: `SELECT * FROM user_accounts WHERE id=$1;` should return 0 rows (or `status='deleted'` with tombstone).

---

## Communication
- **Internal**: `#incident-gdpr` (restricted; DPO + eng).
- **User**: Direct update on deletion status; if delayed >30 days, DPO must document reason for regulator.
- **Regulator**: If deadline missed, DPO prepares Art. 17(3) justification (legal claims, public interest, etc.).

---

## Evidence Preservation
- Deletion job logs (full, with `requestId`, timestamps, error messages).
- Tombstone ledger entries (`deletion_tombstones` table) — immutable proof of deletion intent.
- Backup exclusion logs (verify deleted account not in nightly backup after deletion).

---

## Legal / Privacy Escalation
- **GDPR Art. 17**: 30-day deadline (extendable 60 days with notice).
- **CCPA/CPRA**: 45-day deadline (extendable 45 days).
- **Documentation**: Record reason for delay, steps taken, residual data (if any legal hold).
- **Legal hold**: If litigation hold applies, deletion pauses; document in `deletion_tombstones.reason='legal_hold'`.

---

## Post-Incident Template
| Field | Details |
|-------|---------|
| Incident ID | `INC-YYYYMMDD-XXX` |
| Start / End (UTC) |  |
| Root Cause |  |
| Account ID (hashed) |  |
| Deletion Requested At |  |
| Deletion Completed At |  |
| Days Overdue |  |
| Residual Data (tables, backup) |  |
| Legal Hold Applied (Y/N) |  |
| Regulator Notified (Y/N, which) |  |
| Detection Method |  |
| Time to Detect (TTD) |  |
| Time to Resolve (TTR) |  |
| Action Items (with owners + due dates) |  |
| Runbook Updates Needed |  |