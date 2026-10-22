import { test } from 'node:test';
import assert from 'node:assert/strict';
import { FeatureFlagService } from './feature-flags.js';

test('feature flags default, per-workspace override, and kill switch', () => {
  const svc = new FeatureFlagService();

  assert.equal(svc.isEnabled('link_previews'), true);
  assert.equal(svc.isEnabled('e2ee_search_index'), false);
  assert.equal(svc.isEnabled('unknown_flag'), false);

  // Workspace override wins over the global flag.
  svc.setFlag('link_previews', false);
  svc.setWorkspaceOverride('link_previews', 'ws_a', true);
  assert.equal(svc.isEnabled('link_previews', 'ws_a'), true);
  assert.equal(svc.isEnabled('link_previews', 'ws_b'), false);

  // Kill switch force-disables everything, including overrides.
  svc.setKillSwitch(true);
  assert.equal(svc.isEnabled('link_previews', 'ws_a'), false);
  assert.equal(svc.isEnabled('link_previews'), false);

  // Disengaging the kill switch restores normal resolution.
  svc.setKillSwitch(false);
  assert.equal(svc.isEnabled('link_previews', 'ws_a'), true);
});
