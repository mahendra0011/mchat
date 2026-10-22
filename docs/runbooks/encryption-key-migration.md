# Runbook: Encryption Key Migration

## Severity
**SEV-2** (High) — Planned or emergency rotation of E2EE identity keys, signed pre-keys, or server-side encryption keys.

---

## Detection
- **Planned**: Scheduled rotation (90-day identity key, 28-day signed pre-key).
- **Emergency**: Key compromise suspected (device theft, malware, insider threat).
- **Algorithm migration**: Post-quantum hybrid (X25519+Kyber) rollout.

---

## Incident Commander
- **Primary**: On-call Crypto Engineer
- **Secondary**: Security Engineer + Backend Engineer

---

## Immediate Actions (T+0 to T+30min)
1. **Assess scope**: Single device? Single user? Workspace-wide? Platform-wide?
2. **Generate new key material**:
   - Identity key: `X25519` (or `X25519Kyber768` for PQ) — user must verify new safety numbers.
   - Signed pre-key: Server generates, signs with identity key.
   - One-time pre-keys: Batch of 50–100.
3. **Publish new bundle**: Upsert `key_bundles` for affected `accountId`; increment `registrationId`.
4. **Notify contacts**: Send `key_update` realtime event to all conversations where user participates.
5. **Client-side**: On next app open, client fetches new bundle, re-encrypts pending outbound messages.
6. **Server-side**: No decryption capability (E2EE); server only stores public bundles.
7. **Deprecate old keys**: Mark old `key_bundles` as `superseded`; retain for 30 days for in-flight message decryption.

---

## Emergency: Server-Side Encryption Key (at-rest)
1. Generate new DEK (Data Encryption Key), wrap with new KEK (Key Encryption Key) in KMS.
2. Re-encrypt affected columns/tables (background job, chunked, idempotent).
3. Update `encryption_key_version` in metadata.
4. Monitor `/v1/metrics` for `crypto.reencrypt.latency_p95`.

---

## Communication
- **Internal**: `#incident-crypto` (restricted).
- **Users**: In-app banner "Your encryption keys have been updated for security. Please verify safety numbers with contacts."
- **Status Page**: Only if user-visible degradation (rekey delays).

---

## Evidence Preservation
- Old key bundles (public only) retained for audit.
- Rotation audit log: `admin_audit_logs` entry with `action: 'crypto.key_rotated'`, `justification`, `actor_id`.
- KMS key rotation records (CloudTrail / audit logs).

---

## Legal / Privacy Escalation
- If emergency rotation due to compromise, treat as `suspected-content-exposure.md`.
- Key material is not PII but enables decryption of PII; handle with same rigor.

---

## Post-Incident Template
| Field | Details |
|-------|---------|
| Incident ID | `INC-YYYYMMDD-XXX` |
| Start / End (UTC) |  |
| Trigger (planned / emergency / algorithm upgrade) |  |
| Scope (device / user / workspace / platform) |  |
| Keys Rotated (identity / signed-pre / one-time / server DEK) |  |
| Safety Number Changes Required |  |
| User Notifications Sent |  |
| Detection Method |  |
| Time to Complete |  |
| Action Items (with owners + due dates) |  |
| Runbook Updates Needed |  |