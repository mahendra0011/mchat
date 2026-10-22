# Runbook: Database Outage

## Severity
**SEV-1** (Critical) — Primary data store unavailable; all write paths blocked; read paths degraded.

---

## Detection
- `/v1/health` returns non-healthy or times out
- `/v1/metrics` shows `database.activeQueries` spike, `database.latencyP95Ms` > 5000ms
- Alert: `db_connection_failed` or `db_query_latency_p95` firing
- Application logs show `FATAL: database migration failed` or connection pool exhaustion

---

## Incident Commander
- **Primary**: On-call Platform Engineer (rotation)
- **Secondary**: Database Administrator (if separate role)

---

## Immediate Actions (T+0 to T+15min)
1. **Confirm scope**: Check if read replicas (if any) are reachable; verify `pg_isready` on primary.
2. **Check connection pool**: Inspect `pg_stat_activity` for idle-in-transaction or runaway queries.
3. **Failover (if HA)**: Promote standby via managed service (RDS/CloudSQL) or Patroni failover.
4. **Circuit-breaker**: Ensure API `db` client has `max_retries=3`, `retry_delay=exp_backoff`; enable read-only mode via feature flag if writes are the only affected path.
5. **Scale up**: Increase `max_connections` temporarily; add read replicas if load is read-heavy.

---

## Communication
- **Internal**: `#incident-db` Slack channel; post status every 10 min.
- **Status Page**: Update "Database" component to `degraded` or `major_outage`.
- **Customer-facing**: If outage > 15 min, post banner in app and status page with ETA.

---

## Evidence Preservation
- Capture `pg_stat_activity` snapshot (`SELECT * FROM pg_stat_activity;`).
- Export last 1h of PostgreSQL logs (slow queries, deadlocks, FATALs).
- Save `/v1/metrics` JSON output every 5 min during incident.
- Retain application logs with `requestId` correlation.

---

## Legal / Privacy Escalation
- If outage caused by data corruption or unauthorized access, notify DPO within 1h (GDPR Art. 33).
- Preserve WAL segments for forensic analysis if breach suspected.
- Document any data loss window for potential regulator notification.

---

## Post-Incident Template
| Field | Details |
|-------|---------|
| Incident ID | `INC-YYYYMMDD-XXX` |
| Start / End (UTC) |  |
| Root Cause |  |
| Impact (users, data loss, RPO/RTO) |  |
| Detection Method |  |
| Time to Detect (TTD) |  |
| Time to Mitigate (TTM) |  |
| Action Items (with owners + due dates) |  |
| Runbook Updates Needed |  |