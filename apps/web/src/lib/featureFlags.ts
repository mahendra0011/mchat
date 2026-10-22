/** User-specific feature flag resolution (Spec 27) */
import { getAccessToken } from './secure-storage.js';

export interface UserFeatureFlags {
  flags: Record<string, { enabled: boolean; rollout_percentage: number }>;
  lastCheckedAt: string;
}

export async function getUserFeatureFlags(userId: string): Promise<UserFeatureFlags> {
  // Read from the server-side feature flag service via API
  const token = await getAccessToken();
  const res = await fetch(`/v1/feature-flags/user/${userId}`, {
    headers: {
      Authorization: `Bearer ${token}`,
      Accept: 'application/json',
    },
  });

  if (!res.ok) {
    throw new Error('Failed to fetch user feature flags');
  }

  const data = (await res.json()) as { data: UserFeatureFlags };
  return data.data;
}