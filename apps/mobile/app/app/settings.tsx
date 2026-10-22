import React, { useState, useEffect } from 'react';
import { View, Text, ScrollView, Switch, TouchableOpacity, StyleSheet, Alert, ActivityIndicator } from 'react-native';
import { useRouter } from 'expo-router';
import * as SecureStore from 'expo-secure-store';
import Constants from 'expo-constants';
import { Appearance } from 'react-native';

const API_BASE_URL = Constants.expoConfig?.extra?.apiUrl ?? 'http://localhost:3000';

interface UserProfile {
  displayName: string;
  statusEmoji: string | null;
  email: string;
}

interface SettingsResponse {
  data: {
    appearance: { theme: 'light' | 'dark' | 'system' };
    privacy: { readReceipts: boolean; typingIndicators: boolean };
    notifications: { globalEnabled: boolean; soundEnabled: boolean; vibrationEnabled: boolean };
  };
}

export default function SettingsScreen() {
  const router = useRouter();
  const [profile, setProfile] = useState<UserProfile>({ displayName: '', statusEmoji: null, email: '' });
  const [settings, setSettings] = useState<SettingsResponse['data'] | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [theme, setTheme] = useState<'light' | 'dark' | 'system'>('system');
  const [saving, setSaving] = useState<string | null>(null);

  const loadData = async () => {
    try {
      const token = await SecureStore.getItemAsync('orbit.auth.token');
      const workspaceId = await SecureStore.getItemAsync('orbit.workspace.active');

      if (!token || !workspaceId) {
        router.replace('/(auth)/login');
        return;
      }

      // Fetch profile
      const profileRes = await fetch(`${API_BASE_URL}/v1/me`, {
        headers: { Authorization: `Bearer ${token}` },
      });
      const profileData = await profileRes.json();
      setProfile(profileData.user ?? profileData.data);

      // Fetch settings
      const settingsRes = await fetch(`${API_BASE_URL}/v1/settings`, {
        headers: { Authorization: `Bearer ${token}`, 'x-workspace-id': workspaceId },
      });
      const settingsData = await settingsRes.json();
      setSettings(settingsData.data);
      setTheme(settingsData.data?.appearance?.theme ?? 'system');
    } catch (err) {
      console.error('Failed to load settings:', err);
    } finally {
      setIsLoading(false);
    }
  };

  useEffect(() => {
    loadData();
    const subscription = Appearance.addColorSchemeListener(({ colorScheme }) => {
      // System theme changed
    });
    return () => subscription.remove();
  }, []);

  const saveSetting = async (section: string, value: any) => {
    const token = await SecureStore.getItemAsync('orbit.auth.token');
    const workspaceId = await SecureStore.getItemAsync('orbit.workspace.active');
    if (!token || !workspaceId) return;

    setSaving(section);
    try {
      const res = await fetch(`${API_BASE_URL}/v1/settings/${section}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}`, 'x-workspace-id': workspaceId },
        body: JSON.stringify(value),
      });
      if (!res.ok) throw new Error('Failed to save');
      const data = await res.json();
      setSettings((prev) => ({ ...prev!, [section]: { ...prev![section], ...data.data[section] } }));
    } catch (err) {
      Alert.alert('Error', 'Failed to save setting');
    } finally {
      setSaving(null);
    }
  };

  const handleThemeChange = async (newTheme: 'light' | 'dark' | 'system') => {
    setTheme(newTheme);
    await saveSetting('appearance', { ...settings?.appearance, theme: newTheme });
  };

  const handleToggle = async (section: keyof SettingsResponse['data'], key: string, value: boolean) => {
    if (!settings) return;
    await saveSetting(section, { ...settings[section], [key]: value });
  };

  const handleLogout = async () => {
    if (await Alert.alert('Logout', 'Are you sure you want to log out?', [
      { text: 'Cancel', style: 'cancel' },
      { text: 'Log Out', onPress: async () => {
        await SecureStore.deleteItemAsync('orbit.auth.token');
        router.replace('/(auth)/login');
      }, style: 'destructive' },
    ])) {}
  };

  if (isLoading) {
    return (
      <View style={styles.loadingContainer}>
        <ActivityIndicator size="large" color="#0066ff" />
      </View>
    );
  }

  return (
    <ScrollView style={styles.container} contentContainerStyle={styles.content}>
      <View style={styles.section}>
        <Text style={styles.sectionTitle}>Account</Text>
        <View style={styles.settingRow}>
          <View style={styles.profileInfo}>
            <Text style={styles.profileName}>{profile.displayName}</Text>
            {profile.statusEmoji && <Text style={styles.profileStatus}>{profile.statusEmoji}</Text>}
            <Text style={styles.profileEmail}>{profile.email}</Text>
          </View>
        </View>
      </View>

      <View style={styles.section}>
        <Text style={styles.sectionTitle}>Appearance</Text>
        <View style={styles.settingRow}>
          <Text style={styles.settingLabel}>Theme</Text>
          <View style={styles.segmentedControl}>
            {(['light', 'dark', 'system'] as const).map((t) => (
              <TouchableOpacity
                key={t}
                style={[
                  styles.segmentButton,
                  theme === t && styles.segmentButtonActive,
                ]}
                onPress={() => handleThemeChange(t)}
              >
                <Text style={[
                  styles.segmentButtonText,
                  theme === t && styles.segmentButtonTextActive,
                ]}>
                  {t.charAt(0).toUpperCase() + t.slice(1)}
                </Text>
              </TouchableOpacity>
            ))}
          </View>
        </View>
      </View>

      <View style={styles.section}>
        <Text style={styles.sectionTitle}>Privacy</Text>
        <View style={styles.settingRow}>
          <Text style={styles.settingLabel}>Read Receipts</Text>
          <Switch
            value={settings?.privacy.readReceipts ?? true}
            onValueChange={(v) => handleToggle('privacy', 'readReceipts', v)}
            disabled={saving === 'privacy'}
            trackColor={{ false: '#333', true: '#0066ff' }}
            thumbColor={theme === 'dark' ? '#000' : '#fff'}
          />
        </View>
        <View style={styles.settingRow}>
          <Text style={styles.settingLabel}>Typing Indicators</Text>
          <Switch
            value={settings?.privacy.typingIndicators ?? true}
            onValueChange={(v) => handleToggle('privacy', 'typingIndicators', v)}
            disabled={saving === 'privacy'}
            trackColor={{ false: '#333', true: '#0066ff' }}
            thumbColor={theme === 'dark' ? '#000' : '#fff'}
          />
        </View>
      </View>

      <View style={styles.section}>
        <Text style={styles.sectionTitle}>Notifications</Text>
        <View style={styles.settingRow}>
          <Text style={styles.settingLabel}>Enable Notifications</Text>
          <Switch
            value={settings?.notifications.globalEnabled ?? true}
            onValueChange={(v) => handleToggle('notifications', 'globalEnabled', v)}
            disabled={saving === 'notifications'}
            trackColor={{ false: '#333', true: '#0066ff' }}
            thumbColor={theme === 'dark' ? '#000' : '#fff'}
          />
        </View>
        <View style={styles.settingRow}>
          <Text style={styles.settingLabel}>Sound</Text>
          <Switch
            value={settings?.notifications.soundEnabled ?? false}
            onValueChange={(v) => handleToggle('notifications', 'soundEnabled', v)}
            disabled={saving === 'notifications'}
            trackColor={{ false: '#333', true: '#0066ff' }}
            thumbColor={theme === 'dark' ? '#000' : '#fff'}
          />
        </View>
        <View style={styles.settingRow}>
          <Text style={styles.settingLabel}>Vibration</Text>
          <Switch
            value={settings?.notifications.vibrationEnabled ?? true}
            onValueChange={(v) => handleToggle('notifications', 'vibrationEnabled', v)}
            disabled={saving === 'notifications'}
            trackColor={{ false: '#333', true: '#0066ff' }}
            thumbColor={theme === 'dark' ? '#000' : '#fff'}
          />
        </View>
      </View>

      <View style={styles.section}>
        <Text style={styles.sectionTitle}>Security</Text>
        <TouchableOpacity style={styles.actionButton} onPress={handleLogout}>
          <Text style={styles.actionButtonText}>Log Out</Text>
        </TouchableOpacity>
      </View>

      <View style={styles.version}>
        <Text style={styles.versionText}>Orbit Chat v0.1.0</Text>
      </View>
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#0f1118',
  },
  loadingContainer: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
  },
  content: {
    padding: 16,
    paddingBottom: 40,
  },
  section: {
    marginBottom: 24,
    backgroundColor: '#1a1d24',
    borderRadius: 12,
    borderWidth: 1,
    borderColor: '#333',
    overflow: 'hidden',
  },
  sectionTitle: {
    color: '#0066ff',
    fontSize: 13,
    fontWeight: '700',
    textTransform: 'uppercase',
    letterSpacing: 0.5,
    paddingHorizontal: 16,
    paddingTop: 16,
    paddingBottom: 8,
  },
  settingRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingHorizontal: 16,
    paddingVertical: 14,
    borderTopWidth: 1,
    borderTopColor: '#222',
  },
  profileInfo: {
    flex: 1,
  },
  profileName: {
    color: '#ffffff',
    fontSize: 16,
    fontWeight: '600',
  },
  profileStatus: {
    fontSize: 16,
    marginLeft: 8,
  },
  profileEmail: {
    color: '#888',
    fontSize: 13,
    marginTop: 2,
  },
  settingLabel: {
    color: '#ffffff',
    fontSize: 15,
    fontWeight: '500',
  },
  segmentedControl: {
    flexDirection: 'row',
    backgroundColor: '#0f1118',
    borderRadius: 8,
    padding: 2,
    gap: 2,
  },
  segmentButton: {
    flex: 1,
    paddingVertical: 8,
    paddingHorizontal: 12,
    borderRadius: 6,
    alignItems: 'center',
  },
  segmentButtonActive: {
    backgroundColor: '#0066ff',
  },
  segmentButtonText: {
    color: '#ccc',
    fontSize: 13,
    fontWeight: '600',
  },
  segmentButtonTextActive: {
    color: '#ffffff',
  },
  actionButton: {
    paddingVertical: 14,
    alignItems: 'center',
  },
  actionButtonText: {
    color: '#ff4444',
    fontSize: 15,
    fontWeight: '600',
  },
  version: {
    alignItems: 'center',
    paddingTop: 20,
  },
  versionText: {
    color: '#555',
    fontSize: 12,
  },
});