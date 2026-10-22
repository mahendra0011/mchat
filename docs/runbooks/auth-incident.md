# Runbook: Authentication Incident

## Severity
**SEV-1** (Critical) — Login broken; sessions hijacked; tokens leaked; MFA bypass.

---

## Detection
- `/v1/health` OK but `/v1/auth/login` returns 5xx or 401 for valid creds
- Alert: `auth_failure_rate` > 10% or `session_hijack_detected`
- Abnormal spike in `token_refresh` failures
- Security team reports credential stuffing / phishing campaign
- `AUTH_JWT_SECRET` or `SESSION_COOKIE_SECRET` rotation detected without deploy

---

## Incident Commander
- **Primary**: On-call Security Engineer
- **Secondary**: Backend Engineer + Engineering Manager

---

## Immediate Actions (T+0 to T+15min)
1. **Rotate secrets immediately**:
   - `AUTH_JWT_SECRET` → new 64-char base64; deploy; all existing JWTs invalidated.
   - `SESSION_COOKIE_SECRET` → new 64-char base64; deploy; all sessions logged out.
   - Use `SECRET_STORE=aws` rotation if configured: `await secretStore.rotate('AUTH_JWT_SECRET')`.
2. **Revoke all sessions**: `DELETE FROM auth_sessions;` (or `UPDATE ... SET status='revoked'`).
3. **Enable strict rate limits**: `SlidingWindowRateLimiter` on `/auth/*` to 5 req/min/IP.
4. **Check for key compromise**: If JWT secret in logs/GitHub, assume all tokens forged.
5. **Audit recent logins**: `SELECT * FROM auth_sessions WHERE created_at > NOW() - INTERVAL '24h';` look for impossible travel, new devices.
6. **MFA enforcement**: Temporarily require step-up for all sensitive actions (password change, email change, device add).
7. **Kill switches**: Feature flag `auth.login.enabled=false` if attack ongoing.

---

## Communication
- **Internal**: `#incident-auth` Slack (restricted channel); legal/security leads only.
- **Status Page**: Update "Authentication" to `major_outage` if login down.
- **Users**: If sessions revoked, send "security logout" email with guidance.

---

## Evidence Preservation
- **Do not log tokens** (logger redacts `authorization`, `cookie`).
- Export authentication audit logs (success/failed login, token refresh, MFA challenges) with IP hashes.
- Preserve attacker IPs, user agents, timestamps.
- Screenshot vendor alerts (HaveIBeenPwned, GitHub secret scanning).

---

## Legal / Privacy Escalation
- **GDPR Art. 33**: Notify DPA within 72h if personal data (credentials, sessions) exposed.
- **CCPA/CPRA**: Notify CA AG if >500 CA residents affected.
- Engage qualified counsel for jurisdiction-specific duties.
- Preserve chain of custody for forensic analysis.

---

## Post-Incident Template
| Field | Details |
|-------|---------|
| Incident ID | `INC-YYYYMMDD-XXX` |
| Start / End (UTC) |  |
| Root Cause |  |
| Secrets Rotated (list) |  |
| Sessions Revoked (count) |  |
| Accounts Compromised (est.) |  |
| Detection Method |  |
| Time to Detect (TTD) |  |
| Time to Mitigate (TTM) |  |
| Regulatory Notifications Sent |  |
| Action Items (with owners + due dates) |  |
| Runbook Updates Needed |  |