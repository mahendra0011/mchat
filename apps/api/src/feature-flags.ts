/**
 * Feature flags & global kill switch (Spec 10):
 * - Per-feature boolean flags, optionally scoped per workspace.
 * - A global kill switch that force-disables every flag at once (incident response).
 * Flags are in-memory by default and can be hydrated/persisted by the store.
 */

export const DEFAULT_FEATURE_FLAGS: Record<string, { enabled: boolean; rollout_percentage: number; rolloutStrategy: 'immediate' | 'gradual' | 'manual' }> = {
  link_previews: { enabled: true, rollout_percentage: 100, rolloutStrategy: 'immediate' },
  group_governance: { enabled: true, rollout_percentage: 100, rolloutStrategy: 'immediate' },
  business_verification: { enabled: true, rollout_percentage: 100, rolloutStrategy: 'immediate' },
  e2ee_search_index: { enabled: false, rollout_percentage: 0, rolloutStrategy: 'gradual' },
  realtime_calls: { enabled: true, rollout_percentage: 100, rolloutStrategy: 'immediate' },
  message_virtualization: { enabled: false, rollout_percentage: 0, rolloutStrategy: 'manual' },
};

export class FeatureFlagService {
  private flags = new Map<string, { enabled: boolean; rollout_percentage: number; rolloutStrategy: 'immediate' | 'gradual' | 'manual' }>(
    Object.entries(DEFAULT_FEATURE_FLAGS).map(([k, v]) => [k, v])
  );
  /** Workspace-specific overrides, keyed `${flag}:${workspaceId}`. */
  private workspaceOverrides = new Map<string, { enabled: boolean; rollout_percentage: number; rolloutStrategy: 'immediate' | 'gradual' | 'manual' }>();
  private killSwitchEngaged = false;

  /** The kill switch force-disables every flag regardless of individual state. */
  get killSwitch(): boolean {
    return this.killSwitchEngaged;
  }

  setKillSwitch(engaged: boolean): void {
    this.killSwitchEngaged = engaged;
  }

  isEnabled(flag: string, workspaceId?: string): boolean {
    if (this.killSwitchEngaged) return false;
    if (workspaceId) {
      const override = this.workspaceOverrides.get(`${flag}:${workspaceId}`);
      if (override !== undefined) return override.enabled;
    }
    const flagData = this.flags.get(flag);
    if (!flagData) return false;
    if (flagData.rollout_percentage < 100) {
      // Gradual rollout: flag is enabled based on percentage
      // Simple hash-based selection: if user hash modulo 100 < percentage, enable
      // In production this would use user ID hashing; for now, return enabled state
      return flagData.enabled;
    }
    return flagData.enabled;
  }

  setFlag(flag: string, enabled: boolean, rollout_percentage?: number, rolloutStrategy?: 'immediate' | 'gradual' | 'manual'): void {
    const existing = this.flags.get(flag) || { enabled: false, rollout_percentage: 0, rolloutStrategy: 'immediate' };
    this.flags.set(flag, { enabled, rollout_percentage: rollout_percentage ?? existing.rollout_percentage, rolloutStrategy: rolloutStrategy ?? existing.rolloutStrategy });
  }

  setFlagRolloutPercentage(flag: string, percentage: number): void {
    const existing = this.flags.get(flag) || { enabled: false, rollout_percentage: 0, rolloutStrategy: 'immediate' };
    this.flags.set(flag, { enabled: existing.enabled, rollout_percentage: percentage, rolloutStrategy: existing.rolloutStrategy });
  }

  setWorkspaceOverride(flag: string, workspaceId: string, enabled: boolean, rollout_percentage?: number, rolloutStrategy?: 'immediate' | 'gradual' | 'manual'): void {
    const key = `${flag}:${workspaceId}`;
    const existing = this.flags.get(flag) || { enabled: false, rollout_percentage: 0, rolloutStrategy: 'immediate' };
    this.workspaceOverrides.set(key, { enabled, rollout_percentage: rollout_percentage ?? existing.rollout_percentage, rolloutStrategy: rolloutStrategy ?? existing.rolloutStrategy });
  }

  list(): Array<{ flag: string; enabled: boolean; rollout_percentage: number; rolloutStrategy: 'immediate' | 'gradual' | 'manual' }> & { killSwitch: boolean } {
    return Array.from(this.flags.entries()).map(([flag, data]) => ({ flag, ...data })) as any;
  }

  /** Hydrate persisted flag state (e.g., from the database). */
  hydrate(flags: Record<string, { enabled: boolean; rollout_percentage: number; rolloutStrategy: 'immediate' | 'gradual' | 'manual' }>, killSwitch: boolean): void {
    for (const [flag, enabled] of Object.entries(flags)) {
      this.flags.set(flag, enabled);
    }
    this.killSwitchEngaged = killSwitch;
  }
}

export const featureFlags = new FeatureFlagService();
