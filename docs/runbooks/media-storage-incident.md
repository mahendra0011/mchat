# Runbook: Media Storage Incident

## Severity
**SEV-2** (High) — Uploads/downloads failing; user media inaccessible; potential data loss.

---

## Detection
- `/v1/metrics` shows `upload.failed` spike, `upload.in_progress` stuck
- Alert: `storage_error_rate` > 1% or `storage_latency_p95` > 10s
- S3/MinIO/GCS console shows 5xx errors or throttling
- Users report "upload failed" or "image not loading"

---

## Incident Commander
- **Primary**: On-call Platform Engineer
- **Secondary**: Backend Engineer

---

## Immediate Actions (T+0 to T+15min)
1. **Identify scope**: Local storage (`STORAGE_DRIVER=local`) vs. S3-compatible.
2. **Local disk full**: `df -h` on API nodes; clear temp files in `STORAGE_LOCAL_DIR`; add volume.
3. **S3 errors**:
   - `403`: Check IAM policy, bucket policy, KMS key access.
   - `404`: Bucket deleted or wrong region.
   - `503`/`SlowDown`: Request rate exceeded — enable exponential backoff, reduce concurrency.
   - `InternalError`: Vendor outage — check status page.
4. **Presigned URL expiry**: If downloads fail, verify `signed-url.ts` TTL (default 1h) and clock sync.
5. **Quarantine corrupted objects**: If `ETag` mismatch on download, mark object `quarantined` in `media_attachments` table.
6. **Failover**: If multi-region, redirect to healthy region via DNS/Route53.

---

## Communication
- **Internal**: `#incident-storage` Slack.
- **Status Page**: Update "Media/Files" component.

---

## Evidence Preservation
- S3 access logs (enable if not on) for failed requests.
- Presigned URL generation logs (requestId, objectKey, expiry).
- Application upload/download error logs with `requestId`.

---

## Legal / Privacy Escalation
- Media may contain user PII/sensitive content. If unauthorized access suspected (bucket policy misconfig), treat as `suspected-content-exposure.md`.
- GDPR: If media deleted unexpectedly, assess Art. 32 breach notification.

---

## Post-Incident Template
| Field | Details |
|-------|---------|
| Incident ID | `INC-YYYYMMDD-XXX` |
| Start / End (UTC) |  |
| Root Cause |  |
| Objects Affected (count, bytes) |  |
| Data Loss (Y/N, details) |  |
| Detection Method |  |
| Time to Detect (TTD) |  |
| Time to Mitigate (TTM) |  |
| Action Items (with owners + due dates) |  |
| Runbook Updates Needed |  |