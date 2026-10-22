# Feature Rollback Procedure

## Step-by-Step Rollback

### Step 1: Identify the Affected Feature

- Determine which feature flag(s) caused the issue
- Check feature flag rollout percentages and current state
- Identify affected workspaces/users

### Step 2: Disable the Feature Flag

**Option A: Individual flag rollback**

```bash
# Via API — set flag to disabled
POST /v1/admin/feature-flags/rollout
{
  "flagId": "<flag-name>",
  "percentage": 0
}
```

**Option B: Global kill switch**

```bash
# Via API — engage kill switch
POST /v1/admin/feature-flags/kill-switch
{
  "engaged": true
}
```

### Step 3: Verify Rollback

- Confirm the feature is disabled across all environments
- Check that no new users are being affected
- Verify metrics show the expected state

### Step 4: Deploy Previous Version (if needed)

If the issue is a code deployment rather than a feature flag:

```bash
# Roll to previous Docker image tag
git checkout <previous-tag>
pnpm build
# Redeploy with previous version
```

### Step 5: Document and Review

- Record the rollback in the release approval log
- Update the incident playbook with lessons learned
- Review feature flag states before future releases