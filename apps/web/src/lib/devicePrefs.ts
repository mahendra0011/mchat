/** Device-only preferences persisted locally (never sent to the server). */

export interface DevicePrefs {
  translationDisplay: string;
  callQuality: string;
  micDevice: string;
  speakerDevice: string;
}

export const DEVICE_PREFS_KEY = 'orbit_device_prefs_v1';

const DEFAULT_DEVICE_PREFS: DevicePrefs = {
  translationDisplay: 'below',
  callQuality: 'hd',
  micDevice: 'default-mic',
  speakerDevice: 'default-speaker',
};

export function loadDevicePrefs(): DevicePrefs {
  try {
    const raw = localStorage.getItem(DEVICE_PREFS_KEY);
    if (!raw) return DEFAULT_DEVICE_PREFS;
    const parsed = JSON.parse(raw) as Partial<DevicePrefs>;
    return { ...DEFAULT_DEVICE_PREFS, ...parsed };
  } catch {
    return DEFAULT_DEVICE_PREFS;
  }
}

export function saveDevicePrefs(prefs: DevicePrefs): void {
  try {
    localStorage.setItem(DEVICE_PREFS_KEY, JSON.stringify(prefs));
  } catch {
    // best-effort local persistence
  }
}
