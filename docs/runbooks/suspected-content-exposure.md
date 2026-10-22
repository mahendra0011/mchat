# Runbook: Suspected Content Exposure

## Severity
**SEV-1** (Critical) — User message content, media, or private notes potentially accessed by unauthorized parties.

---

## Detection
- Security researcher / bug bounty report
- Internal audit finds over-permissive query (missing workspace scoping)
- Logs show `SELECT * FROM message_envelopes WHERE ...` without workspace filter
- Media object accessed via guessed/sequential `objectKey`
- Encryption key material in logs/error payloads

---

## Incident Commander
- **Primary**: On-call Security Engineer
- **Secondary**: Privacy Officer / DPO + Engineering Manager

---

## Immediate Actions (T+0 to T+15min)
1. **Stop the bleed**:
   - Deploy query fix / access control patch immediately (hotfix branch → main → deploy).
   - If media: revoke presigned URLs (rotate `STORAGE_S3_PRESIGN_SECRET` or shorten TTL to 1 min).
   - If encryption keys exposed: initiate `encryption-key-migration.md` runbook.
2. **Scope the exposure**:
   - Identify affected workspaces, conversations, users.
   - Determine time window of vulnerability.
   - Classify data: `message content`, `media`, `private notes`, `crypto keys`, `PII`.
3. **Kill switches**:
   - Feature flag `media.download.enabled=false` if object keys enumerable.
   - Feature flag `e2ee.key_exchange.enabled=false` if key material leaked.
4. **Preserve evidence** (read-only):
   - Snapshot DB (pg_dump) for forensic analysis.
   - Export access logs (API, S3, CDN) for affected resources.
   - Do NOT modify production data until legal authorizes.

---

## Communication
- **Internal**: `#incident-content-exposure` (highly restricted; legal, security, eng lead only).
- **External**: Do NOT post on public status page until legal review.
- **Regulators**: DPO assesses GDPR Art. 33/34 notification requirement (72h / without undue delay).
- **Affected users**: Direct, personalized notification per legal guidance (not broadcast).

---

## Evidence Preservation
- **Chain of custody**: Hash all exported logs (SHA-256), store in write-once bucket.
- **Access logs**: API request logs with `requestId`, `workspaceId`, `userId` (hashed), IP (masked), timestamp.
- **Database**: `pg_dump --data-only --table=message_envelopes --table=media_attachments ...`
- **Encryption**: If E2EE keys exposed, export `key_bundles`, `key_verifications` tables.

---

## Legal / Privacy Escalation
- **Mandatory**: DPO + qualified counsel review within 1h.
- **GDPR**: Art. 33 (72h to DPA), Art. 34 (to data subjects if high risk).
- **CCPA/CPRA**: "Security breach" notification if PI exposed.
- **Sector-specific**: HIPAA (if health data), FINRA (if financial), COPPA (if children).
- **Law enforcement**: If criminal access suspected, coordinate via counsel.

---

## Post-Incident Template
| Field | Details |
|-------|---------|
| Incident ID | `INC-YYYYMMDD-XXX` |
| Start / End (UTC) |  |
| Root Cause |  |
| Data Categories Exposed |  |
| Affected Workspaces / Users (count) |  |
| Exposure Window |  |
| Detection Method |  |
| Time to Detect (TTD) |  |
| Time to Contain (TTC) |  |
| Regulatory Notifications (DPA, AG, users) |  |
| Legal Hold Applied (Y/N) |  |
| Action Items (with owners + due dates) |  |
| Runbook Updates Needed |  |