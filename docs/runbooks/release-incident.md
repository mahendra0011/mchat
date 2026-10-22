# Release Incident Playbook

## If Release Breaks Production

### Immediate Actions (0-5 minutes)

1. **Assess the scope** — Determine if the issue is:
   - Feature-flag related (toggle off the affected flag)
   - Database migration issue
   - Deployment configuration error
   - External service dependency failure

2. **Toggle feature flags off** — Use the global kill switch or individual flag rollback:
   ```bash
   # Via API
   POST /v1/admin/feature-flags/kill-switch { "engaged": true }
   ```

3. **Check release approvals** — Verify no pending approvals are blocking:
   ```bash
   GET /v1/admin/release-approvals
   ```

### Escalation (5-30 minutes)

4. **Initiate rollback** — Follow the step-by-step rollback procedure in `docs/runbooks/feature-rollback.md`

5. **Notify stakeholders** — Alert on-call team, product, and leadership

6. **Communicate with users** — Post status update if user-facing impact is significant

### Post-Incident (30+ minutes)

7. **Root cause analysis** — Document what went wrong and why

8. **Process improvement** — Update release checklist, feature flags, or deployment pipeline

9. **Metrics review** — Review release_deploy and release_health metrics for patterns

10. **Retrospective** — Schedule and conduct post-incident retrospective