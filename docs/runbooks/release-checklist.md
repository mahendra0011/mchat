# Release Checklist

## Pre-Release Checks

- [ ] Staging/prod config parity validated (env.ts STAGING check)
- [ ] All feature flags have defined rollout_percentage values
- [ ] Integration test results verified
- [ ] Accessibility pass verification — automated a11y test run completed
- [ ] Performance benchmark results compared against baseline
- [ ] Security scan results:
  - [ ] SAST scan passed
  - [ ] DAST scan passed
  - [ ] Dependency check (npm audit) — no critical vulnerabilities
- [ ] Rollback procedure verified and documented
- [ ] Release approval gates all passed (no pending approvals)
- [ ] Staging deploy successful with test data
- [ ] Feature flag rollout percentages confirmed

## Post-Release Checks

- [ ] Production deploy completed
- [ ] Monitoring dashboards showing healthy metrics
- [ ] Error rate within acceptable thresholds
- [ ] User-facing functionality verified
- [ ] Feature flag rollouts functioning as configured
- [ ] No rollback needed

## Rollback Procedure

- [ ] Rollback procedure verified (see `docs/runbooks/feature-rollback.md`)
- [ ] Rollback test performed in staging
- [ ] Emergency contact list updated and accessible
- [ ] Rollback approval chain confirmed