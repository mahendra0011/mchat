import React from 'react';
import {
  X,
  User,
  Shield,
  ShieldAlert,
  Key,
  Palette,
  Bell,
  MessageCircle,
  Briefcase,
  Eye,
  Database,
  HelpCircle,
  Check,
  Phone,
  Globe,
  Lock,
  Search,
  AlertTriangle,
  Smartphone,
  Fingerprint,
  Mail,
  type LucideIcon,
} from 'lucide-react';
import {
  IdentityWorkspace,
  UserAccount,
  AppearanceSettings,
  PrivacySettings,
  NotificationSettings,
  MessagingSettings,
  AccessibilitySettings,
  LanguageRegionSettings,
  SettingsSection,
  SECTION_SCHEMAS,
} from '@orbit/schemas';
import { i18n } from '@orbit/localization';
import { useI18n } from '../i18n-context';
import { getAccessToken } from '../lib/secure-storage.js';
import { apiUrl } from '../config';

// ---------------------------------------------------------------------------
// Types & constants
// ---------------------------------------------------------------------------

interface SettingsState {
  appearance: AppearanceSettings;
  privacy: PrivacySettings;
  notifications: NotificationSettings;
  messaging: MessagingSettings;
  accessibility: AccessibilitySettings;
  language: LanguageRegionSettings;
}

const DEFAULT_SETTINGS: SettingsState = {
  appearance: SECTION_SCHEMAS.appearance.parse({}),
  privacy: SECTION_SCHEMAS.privacy.parse({}),
  notifications: SECTION_SCHEMAS.notifications.parse({}),
  messaging: SECTION_SCHEMAS.messaging.parse({}),
  accessibility: SECTION_SCHEMAS.accessibility.parse({}),
  language: SECTION_SCHEMAS.language.parse({}),
};

type SectionDirtyMap = Record<SettingsSection, boolean>;
const EMPTY_DIRTY: SectionDirtyMap = {
  appearance: false,
  privacy: false,
  notifications: false,
  messaging: false,
  accessibility: false,
  language: false,
};

interface DevicePrefs {
  translationDisplay: string;
  callQuality: string;
  micDevice: string;
  speakerDevice: string;
}

const DEVICE_PREFS_KEY = 'orbit_device_prefs_v1';

const DEFAULT_DEVICE_PREFS: DevicePrefs = {
  translationDisplay: 'below',
  callQuality: 'hd',
  micDevice: 'default-mic',
  speakerDevice: 'default-speaker',
};

interface LegalDocumentDisplay {
  id?: string;
  type: string;
  version: string;
  contentMarkdown: string;
  effectiveAt: string;
  requiredConsent: boolean;
}

const LEGAL_DOCUMENTS: Record<string, LegalDocumentDisplay> = {
  tos: { type: 'tos', version: '2.0', contentMarkdown: '', effectiveAt: '', requiredConsent: true },
  privacy: { type: 'privacy', version: '1.5', contentMarkdown: '', effectiveAt: '', requiredConsent: true },
  aup: { type: 'aup', version: '1.0', contentMarkdown: '', effectiveAt: '', requiredConsent: true },
  cookie: { type: 'cookie', version: '1.0', contentMarkdown: '', effectiveAt: '', requiredConsent: false },
  business_terms: { type: 'business_terms', version: '1.0', contentMarkdown: '', effectiveAt: '', requiredConsent: true },
  dpa: { type: 'dpa', version: '1.0', contentMarkdown: '', effectiveAt: '', requiredConsent: true },
};

function loadDevicePrefs(): DevicePrefs {
  try {
    const raw = localStorage.getItem(DEVICE_PREFS_KEY);
    if (!raw) return DEFAULT_DEVICE_PREFS;
    const parsed = JSON.parse(raw) as Partial<DevicePrefs>;
    return { ...DEFAULT_DEVICE_PREFS, ...parsed };
  } catch {
    return DEFAULT_DEVICE_PREFS;
  }
}

function saveDevicePrefs(prefs: DevicePrefs): void {
  try {
    localStorage.setItem(DEVICE_PREFS_KEY, JSON.stringify(prefs));
  } catch {
    // best-effort local persistence
  }
}

interface CategoryDef {
  id: string;
  label: string;
  icon: LucideIcon;
  section?: SettingsSection;
}

const CATEGORIES: CategoryDef[] = [
  { id: 'account', label: 'Account & Profile', icon: User },
  { id: 'privacy', label: 'Privacy & Safety', icon: Shield, section: 'privacy' },
  { id: 'security', label: 'Security & Devices', icon: Key },
  { id: 'appearance', label: 'Appearance', icon: Palette, section: 'appearance' },
  { id: 'notifications', label: 'Notifications', icon: Bell, section: 'notifications' },
  { id: 'chats', label: 'Chats & Messaging', icon: MessageCircle, section: 'messaging' },
  { id: 'business', label: 'Business Settings', icon: Briefcase },
  { id: 'calls', label: 'Calls & Media', icon: Phone },
  { id: 'accessibility', label: 'Accessibility', icon: Eye, section: 'accessibility' },
  { id: 'language', label: 'Language & Region', icon: Globe, section: 'language' },
  { id: 'data', label: 'Data & Storage', icon: Database },
  { id: 'legal', label: 'Legal', icon: ShieldAlert },
  { id: 'help', label: 'Help & About', icon: HelpCircle },
];

// Static search index over every settings control in the modal.
interface SearchEntry {
  category: string;
  controlId: string;
  label: string;
  keywords: string;
}

const SETTINGS_SEARCH_INDEX: SearchEntry[] = [
  // Account
  { category: 'account', controlId: 'account.displayName', label: 'Display name', keywords: 'profile name display account rename' },
  { category: 'account', controlId: 'account.statusEmoji', label: 'Status emoji', keywords: 'status emoji profile custom status' },
  { category: 'account', controlId: 'account.email', label: 'Email address', keywords: 'email address login account' },
  { category: 'account', controlId: 'account.handle', label: 'Handle', keywords: 'handle username @ mention' },
  { category: 'account', controlId: 'account.sessions', label: 'Active sessions', keywords: 'sessions devices active logged in sign out revoke' },
  // Appearance
  { category: 'appearance', controlId: 'appearance.theme', label: 'Color theme', keywords: 'theme dark light system mode color appearance' },
  { category: 'appearance', controlId: 'appearance.density', label: 'Interface density', keywords: 'density compact standard comfortable spacing layout' },
  { category: 'appearance', controlId: 'appearance.fontSize', label: 'Font size', keywords: 'font size text size small base large typography' },
  { category: 'appearance', controlId: 'appearance.timestampFormat', label: 'Timestamp format', keywords: 'time format 12 hour 24 hour clock timestamp' },
  { category: 'appearance', controlId: 'appearance.showAvatars', label: 'Show avatars', keywords: 'avatars profile pictures photos display' },
  { category: 'appearance', controlId: 'appearance.reduceMotion', label: 'Reduce motion', keywords: 'reduce motion animation transitions' },
  // Privacy
  { category: 'privacy', controlId: 'privacy.lastActiveVisibility', label: 'Last active visibility', keywords: 'last active online status visibility seen' },
  { category: 'privacy', controlId: 'privacy.readReceipts', label: 'Read receipts', keywords: 'read receipts checkmarks blue ticks seen' },
  { category: 'privacy', controlId: 'privacy.typingIndicators', label: 'Typing indicators', keywords: 'typing indicators typing showing' },
  { category: 'privacy', controlId: 'privacy.profilePhotoVisibility', label: 'Profile photo visibility', keywords: 'profile photo picture avatar privacy visibility' },
  { category: 'privacy', controlId: 'privacy.bioVisibility', label: 'Bio visibility', keywords: 'bio about me visibility profile' },
  { category: 'privacy', controlId: 'privacy.groupInvitePermission', label: 'Group invite permission', keywords: 'groups invites add me contacts everyone nobody' },
  { category: 'privacy', controlId: 'privacy.linkPreviews', label: 'Link previews', keywords: 'link previews urls rich preview' },
  { category: 'privacy', controlId: 'privacy.hideNotificationPreviews', label: 'Hide notification previews', keywords: 'notification preview hide lock screen privacy' },
  { category: 'privacy', controlId: 'privacy.defaultMessageExpiryDays', label: 'Default message expiry', keywords: 'expiry disappearing messages auto delete retention' },
  { category: 'privacy', controlId: 'privacy.restricted', label: 'Restrict messages to contacts', keywords: 'restricted mode contacts only spam block messages' },
  { category: 'privacy', controlId: 'privacy.restrictUnknownCalls', label: 'Restrict unknown calls', keywords: 'calls unknown restrict block spam caller' },
  { category: 'privacy', controlId: 'privacy.autoDownloadMedia', label: 'Auto-download media', keywords: 'auto download media photos voice notes cache' },
  // Notifications
  { category: 'notifications', controlId: 'notifications.globalEnabled', label: 'Enable notifications', keywords: 'notifications enable disable master toggle push' },
  { category: 'notifications', controlId: 'notifications.previewDetail', label: 'Notification preview detail', keywords: 'notification preview full sender hidden content privacy' },
  { category: 'notifications', controlId: 'notifications.soundEnabled', label: 'Sound alerts', keywords: 'sound alerts tone audio notification' },
  { category: 'notifications', controlId: 'notifications.vibrationEnabled', label: 'Vibration', keywords: 'vibration haptic mobile' },
  { category: 'notifications', controlId: 'notifications.quietHours', label: 'Quiet hours', keywords: 'quiet hours do not disturb dnd schedule night mute' },
  { category: 'notifications', controlId: 'notifications.mentionsOnly', label: 'Mentions only', keywords: 'mentions only just mentions starred' },
  // Messaging
  { category: 'chats', controlId: 'messaging.enterToSend', label: 'Enter to send', keywords: 'enter send keyboard return newline' },
  { category: 'chats', controlId: 'messaging.mediaAutoplay', label: 'Media autoplay', keywords: 'autoplay video media automatic play' },
  { category: 'chats', controlId: 'messaging.linkPreviewBehavior', label: 'Link preview behavior', keywords: 'link preview always contacts never urls' },
  { category: 'chats', controlId: 'messaging.defaultRetentionDays', label: 'Default retention', keywords: 'retention days auto delete messages history' },
  { category: 'chats', controlId: 'messaging.forwardAttribution', label: 'Forward attribution', keywords: 'forward attribution source forwarded by' },
  { category: 'chats', controlId: 'messaging.translationDisplay', label: 'Inline translation display (device only)', keywords: 'translation translate display language device' },
  // Accessibility
  { category: 'accessibility', controlId: 'accessibility.textScaling', label: 'Text scaling', keywords: 'text scaling zoom font size accessibility bigger smaller' },
  { category: 'accessibility', controlId: 'accessibility.highContrast', label: 'High contrast', keywords: 'high contrast accessibility contrast borders' },
  { category: 'accessibility', controlId: 'accessibility.reducedMotion', label: 'Reduced motion', keywords: 'reduced motion accessibility animation vestibular' },
  { category: 'accessibility', controlId: 'accessibility.screenReaderVerbosity', label: 'Screen reader verbosity', keywords: 'screen reader verbosity minimal normal verbose nvda jaws voiceover' },
  // Language
  { category: 'language', controlId: 'language.appLanguage', label: 'App interface language', keywords: 'language app interface locale english spanish hindi german french' },
  { category: 'language', controlId: 'language.translationLanguage', label: 'Translation language', keywords: 'translation language translate target' },
  { category: 'language', controlId: 'language.timezone', label: 'Timezone', keywords: 'timezone time zone region utc offset' },
  { category: 'language', controlId: 'language.clockFormat', label: 'Clock format', keywords: 'clock format 12 hour 24 hour time' },
  { category: 'language', controlId: 'language.numberFormat', label: 'Number format', keywords: 'number format decimal comma period us eu' },
  // Security & devices
  { category: 'security', controlId: 'security.passkeys', label: 'Passkeys & authentication', keywords: 'passkey webauthn fido2 security key windows hello touch id authentication' },
  { category: 'security', controlId: 'security.sessions', label: 'Active sessions & devices', keywords: 'sessions devices active logged in revoke sign out' },
  // Calls
  { category: 'calls', controlId: 'calls.microphone', label: 'Microphone input (device only)', keywords: 'microphone mic input audio device' },
  { category: 'calls', controlId: 'calls.speaker', label: 'Speaker output (device only)', keywords: 'speaker output headphones audio device' },
  { category: 'calls', controlId: 'calls.callQuality', label: 'Call quality (device only)', keywords: 'call quality hd bandwidth data saver video audio' },
  // Data
  { category: 'data', controlId: 'data.export', label: 'Export account data', keywords: 'export data download archive json portability' },
  { category: 'data', controlId: 'data.delete', label: 'Delete account', keywords: 'delete account danger remove erase deletion' },
];

const APP_LANGUAGE_OPTIONS: Array<{ value: string; label: string }> = [
  { value: 'en', label: 'English' },
  { value: 'es', label: 'Español (Spanish)' },
  { value: 'hi', label: 'हिन्दी (Hindi)' },
  { value: 'de', label: 'Deutsch (German)' },
  { value: 'fr', label: 'Français (French)' },
  { value: 'ar', label: 'العربية (Arabic)' },
  { value: 'ja', label: '日本語 (Japanese)' },
  { value: 'pt', label: 'Português (Portuguese)' },
  { value: 'zh', label: '中文 (Chinese)' },
];

// ---------------------------------------------------------------------------
// Small presentational helpers
// ---------------------------------------------------------------------------

interface ToggleRowProps {
  controlId: string;
  label: string;
  description?: string;
  checked: boolean;
  onChange: (checked: boolean) => void;
  disabled?: boolean;
  badge?: string;
}

const ToggleRow: React.FC<ToggleRowProps> = ({
  controlId,
  label,
  description,
  checked,
  onChange,
  disabled,
  badge,
}) => (
  <div
    data-settings-control-id={controlId}
    style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: '16px' }}
  >
    <div>
      <label
        htmlFor={controlId}
        style={{ fontSize: '14px', fontWeight: 600, color: 'var(--text-primary)', cursor: disabled ? 'default' : 'pointer' }}
      >
        {label}
        {badge && (
          <span style={{ fontSize: '11px', color: 'var(--text-muted)', fontWeight: 500, marginLeft: '6px' }}>{badge}</span>
        )}
      </label>
      {description && (
        <div style={{ fontSize: '12px', color: 'var(--text-secondary)', marginTop: '2px' }}>{description}</div>
      )}
    </div>
    <input
      id={controlId}
      type="checkbox"
      checked={checked}
      disabled={disabled}
      onChange={(e) => onChange(e.target.checked)}
      style={{ width: '18px', height: '18px', cursor: disabled ? 'default' : 'pointer', flexShrink: 0 }}
    />
  </div>
);

interface SegmentedOption {
  value: string;
  label: string;
}

interface SegmentedControlProps {
  controlId: string;
  label: string;
  value: string;
  options: SegmentedOption[];
  onChange: (value: string) => void;
  description?: string;
}

const SegmentedControl: React.FC<SegmentedControlProps> = ({
  controlId,
  label,
  value,
  options,
  onChange,
  description,
}) => (
  <div data-settings-control-id={controlId}>
    <div id={`${controlId}-label`} style={{ fontSize: '14px', fontWeight: 600, color: 'var(--text-primary)', marginBottom: description ? '2px' : '8px' }}>
      {label}
    </div>
    {description && (
      <div style={{ fontSize: '12px', color: 'var(--text-secondary)', marginBottom: '8px' }}>{description}</div>
    )}
    <div role="radiogroup" aria-labelledby={`${controlId}-label`} style={{ display: 'flex', gap: '10px', flexWrap: 'wrap' }}>
      {options.map((opt) => {
        const selected = value === opt.value;
        return (
          <button
            key={opt.value}
            type="button"
            role="radio"
            aria-checked={selected}
            onClick={() => onChange(opt.value)}
            style={{
              padding: '8px 14px',
              borderRadius: 'var(--radius-md)',
              border: selected ? '2px solid var(--accent-primary)' : '1px solid var(--border-subtle)',
              backgroundColor: selected ? 'var(--accent-soft)' : 'var(--surface-muted)',
              color: selected ? 'var(--accent-primary)' : 'var(--text-primary)',
              fontWeight: 600,
              fontSize: '13px',
              cursor: 'pointer',
            }}
          >
            {opt.label}
          </button>
        );
      })}
    </div>
  </div>
);

interface SelectRowProps {
  controlId: string;
  label: string;
  value: string;
  options: SegmentedOption[];
  onChange: (value: string) => void;
  description?: string;
  badge?: string;
}

const SelectRow: React.FC<SelectRowProps> = ({ controlId, label, value, options, onChange, description, badge }) => (
  <div data-settings-control-id={controlId}>
    <label
      htmlFor={controlId}
      style={{ fontSize: '14px', fontWeight: 600, color: 'var(--text-primary)', display: 'block', marginBottom: description ? '2px' : '6px' }}
    >
      {label}
      {badge && (
        <span style={{ fontSize: '11px', color: 'var(--text-muted)', fontWeight: 500, marginLeft: '6px' }}>{badge}</span>
      )}
    </label>
    {description && (
      <div style={{ fontSize: '12px', color: 'var(--text-secondary)', marginBottom: '6px' }}>{description}</div>
    )}
    <select
      id={controlId}
      value={value}
      onChange={(e) => onChange(e.target.value)}
      style={{
        width: '100%',
        padding: '8px 12px',
        borderRadius: 'var(--radius-md)',
        border: '1px solid var(--border-subtle)',
        backgroundColor: 'var(--surface-muted)',
        color: 'var(--text-primary)',
        fontSize: '13px',
      }}
    >
      {options.map((opt) => (
        <option key={opt.value} value={opt.value}>
          {opt.label}
        </option>
      ))}
    </select>
  </div>
);

interface TextFieldRowProps {
  controlId: string;
  label: string;
  value: string;
  onChange?: (value: string) => void;
  type?: string;
  placeholder?: string;
  disabled?: boolean;
  description?: string;
  maxLength?: number;
}

const TextFieldRow: React.FC<TextFieldRowProps> = ({
  controlId,
  label,
  value,
  onChange,
  type = 'text',
  placeholder,
  disabled,
  description,
  maxLength,
}) => (
  <div data-settings-control-id={controlId}>
    <label
      htmlFor={controlId}
      style={{ fontSize: '13px', fontWeight: 600, color: 'var(--text-primary)', display: 'block', marginBottom: description ? '2px' : '6px' }}
    >
      {label}
    </label>
    {description && (
      <div style={{ fontSize: '12px', color: 'var(--text-secondary)', marginBottom: '6px' }}>{description}</div>
    )}
    <input
      id={controlId}
      type={type}
      value={value}
      placeholder={placeholder}
      disabled={disabled}
      maxLength={maxLength}
      onChange={(e) => onChange?.(e.target.value)}
      style={{
        width: '100%',
        padding: '8px 12px',
        borderRadius: 'var(--radius-md)',
        border: '1px solid var(--border-subtle)',
        backgroundColor: 'var(--surface-muted)',
        color: disabled ? 'var(--text-muted)' : 'var(--text-primary)',
        fontSize: '13px',
      }}
    />
  </div>
);

interface SectionSaveBarProps {
  dirty: boolean;
  saving: boolean;
  onSave: () => void;
}

const SectionSaveBar: React.FC<SectionSaveBarProps> = ({ dirty, saving, onSave }) => (
  <div
    style={{
      paddingTop: '16px',
      marginTop: '4px',
      borderTop: '1px solid var(--border-subtle)',
      display: 'flex',
      alignItems: 'center',
      justifyContent: 'space-between',
      gap: '12px',
    }}
  >
    <span style={{ fontSize: '12px', color: dirty ? 'var(--caution)' : 'var(--text-muted)', fontWeight: dirty ? 600 : 400 }}>
      {dirty ? 'Unsaved changes' : 'All changes saved'}
    </span>
    <button
      type="button"
      onClick={onSave}
      disabled={!dirty || saving}
      style={{
        padding: '8px 16px',
        backgroundColor: dirty ? 'var(--accent-primary)' : 'var(--surface-muted)',
        color: dirty ? 'var(--accent-text)' : 'var(--text-muted)',
        border: 'none',
        borderRadius: 'var(--radius-md)',
        fontWeight: 600,
        fontSize: '13px',
        cursor: dirty && !saving ? 'pointer' : 'default',
        opacity: saving ? 0.7 : 1,
      }}
    >
      {saving ? 'Saving…' : 'Save'}
    </button>
  </div>
);

// ---------------------------------------------------------------------------
// Settings modal
// ---------------------------------------------------------------------------

interface SettingsModalProps {
  isOpen: boolean;
  onClose: () => void;
  user: UserAccount;
  activeWorkspace: IdentityWorkspace;
  theme: 'light' | 'dark';
  onToggleTheme: () => void;
  density: 'compact' | 'standard' | 'comfortable';
  onChangeDensity: (density: 'compact' | 'standard' | 'comfortable') => void;
  onRequestAccountDeletion: () => Promise<void>;
  onExportData: () => Promise<void>;
  /** Optional: App-level handler that opens SessionsAndDevicesModal (owned by App.tsx). */
  onRequestOpenSessions?: () => void;
}

type SaveStatus = { type: 'success' | 'error'; message: string } | null;

export const SettingsModal: React.FC<SettingsModalProps> = ({
  isOpen,
  onClose,
  user,
  activeWorkspace,
  theme,
  onToggleTheme,
  density,
  onChangeDensity,
  onRequestAccountDeletion,
  onExportData,
  onRequestOpenSessions,
}) => {
  const { t } = useI18n();
  const [activeCategory, setActiveCategory] = React.useState<string>('account');
  const [settings, setSettings] = React.useState<SettingsState>(DEFAULT_SETTINGS);
  const [isLoadingSettings, setIsLoadingSettings] = React.useState<boolean>(false);
  const [dirty, setDirty] = React.useState<SectionDirtyMap>(EMPTY_DIRTY);
  const [saving, setSaving] = React.useState<Record<string, boolean>>({});
  const [saveStatus, setSaveStatus] = React.useState<SaveStatus>(null);
  const [searchQuery, setSearchQuery] = React.useState<string>('');
  const [pendingScrollId, setPendingScrollId] = React.useState<string | null>(null);

  // Account profile (PATCH /v1/me)
  const [localUser, setLocalUser] = React.useState<UserAccount>(user);
  const [profileDraft, setProfileDraft] = React.useState({ displayName: user.displayName, statusEmoji: user.statusEmoji ?? '' });
  const [profileSaving, setProfileSaving] = React.useState<boolean>(false);
  const [profileStatus, setProfileStatus] = React.useState<SaveStatus>(null);

  // Device-only prefs (never sent to the settings API)
  const [devicePrefs, setDevicePrefs] = React.useState<DevicePrefs>(() => loadDevicePrefs());

  const panelRef = React.useRef<HTMLDivElement>(null);
  const saveStatusTimerRef = React.useRef<number | null>(null);
  const profileStatusTimerRef = React.useRef<number | null>(null);
  const [requestType, setRequestType] = React.useState<'access' | 'correction' | 'deletion' | 'consent_withdrawal' | 'appeal'>('access');
  const [requestNotes, setRequestNotes] = React.useState<string>('');
  const [legalDocumentsDisplay, setLegalDocumentsDisplay] = React.useState<Record<string, LegalDocumentDisplay>>({});

  const showSaveStatus = React.useCallback((status: SaveStatus) => {
    setSaveStatus(status);
    if (saveStatusTimerRef.current) window.clearTimeout(saveStatusTimerRef.current);
    saveStatusTimerRef.current = window.setTimeout(() => setSaveStatus(null), 3500);
  }, []);

  const showProfileStatus = React.useCallback((status: SaveStatus) => {
    setProfileStatus(status);
    if (profileStatusTimerRef.current) window.clearTimeout(profileStatusTimerRef.current);
    profileStatusTimerRef.current = window.setTimeout(() => setProfileStatus(null), 4000);
  }, []);

  React.useEffect(
    () => () => {
      if (saveStatusTimerRef.current) window.clearTimeout(saveStatusTimerRef.current);
      if (profileStatusTimerRef.current) window.clearTimeout(profileStatusTimerRef.current);
    },
    []
  );

  const buildHeaders = React.useCallback(
    async (extra?: Record<string, string>): Promise<Record<string, string>> => {
      const token = await getAccessToken();
      return {
        ...(extra ?? {}),
        'x-workspace-id': activeWorkspace.id,
        ...(token ? { Authorization: `Bearer ${token}` } : {}),
      };
    },
    [activeWorkspace.id]
  );

  const handleLegalConsent = React.useCallback(
    async (doc: LegalDocumentDisplay): Promise<void> => {
      try {
        const res = await fetch(apiUrl('/v1/legal/consent'), {
          method: 'POST',
          headers: await buildHeaders({ 'Content-Type': 'application/json' }),
          body: JSON.stringify({ documentId: doc.id ?? doc.type, consentedAt: new Date().toISOString() }),
        });
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        showSaveStatus({ type: 'success', message: 'Consent recorded' });
      } catch {
        showSaveStatus({ type: 'error', message: 'Could not record consent' });
      }
    },
    [buildHeaders, showSaveStatus]
  );

  const submitDataRequest = React.useCallback(async (): Promise<void> => {
    try {
      const res = await fetch(apiUrl('/v1/privacy/requests'), {
        method: 'POST',
        headers: await buildHeaders({ 'Content-Type': 'application/json' }),
        body: JSON.stringify({ type: requestType, scope: requestNotes || undefined }),
      });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      setRequestNotes('');
      showSaveStatus({ type: 'success', message: 'Data request submitted' });
    } catch {
      showSaveStatus({ type: 'error', message: 'Could not submit data request' });
    }
  }, [buildHeaders, requestNotes, requestType, showSaveStatus]);

  // ---------------------------------------------------------------------
  // Load settings on open
  // ---------------------------------------------------------------------
  const loadSettings = React.useCallback(async () => {
    setIsLoadingSettings(true);
    try {
      const res = await fetch(apiUrl('/v1/settings'), { headers: await buildHeaders() });
      if (res.status === 401) {
        showSaveStatus({ type: 'error', message: 'Session expired — sign in again to load settings.' });
        return;
      }
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const body = (await res.json()) as { data?: Partial<SettingsState> };
      const data = body?.data ?? {};
      setSettings({
        appearance: { ...DEFAULT_SETTINGS.appearance, ...(data.appearance ?? {}) },
        privacy: { ...DEFAULT_SETTINGS.privacy, ...(data.privacy ?? {}) },
        notifications: { ...DEFAULT_SETTINGS.notifications, ...(data.notifications ?? {}) },
        messaging: { ...DEFAULT_SETTINGS.messaging, ...(data.messaging ?? {}) },
        accessibility: { ...DEFAULT_SETTINGS.accessibility, ...(data.accessibility ?? {}) },
        language: { ...DEFAULT_SETTINGS.language, ...(data.language ?? {}) },
      });
      setDirty(EMPTY_DIRTY);
    } catch {
      showSaveStatus({ type: 'error', message: 'Could not load settings from the server.' });
    } finally {
      setIsLoadingSettings(false);
    }
  }, [buildHeaders, showSaveStatus]);

  // Initialize legal documents display (fetch current versions when open)
  React.useEffect(() => {
    setLegalDocumentsDisplay(LEGAL_DOCUMENTS);
    if (!isOpen) return;
    let cancelled = false;
    const loadLegalDocuments = async () => {
      try {
        const res = await fetch(apiUrl('/v1/legal/documents'), { headers: await buildHeaders() });
        if (!res.ok) return;
        const body = (await res.json()) as { data?: Record<string, LegalDocumentDisplay> };
        if (!cancelled && body?.data) {
          setLegalDocumentsDisplay((prev) => ({ ...prev, ...body.data }));
        }
      } catch {
        // keep bundled defaults
      }
    };
    void loadLegalDocuments();
    return () => {
      cancelled = true;
    };
  }, [buildHeaders, isOpen]);

  React.useEffect(() => {
    if (!isOpen) return;
    void loadSettings();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isOpen, activeWorkspace.id]);

  React.useEffect(() => {
    if (!isOpen) return;
    void loadDevices();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isOpen, activeWorkspace.id]);

  React.useEffect(() => {
    if (isOpen) {
      setLocalUser(user);
      setProfileDraft({ displayName: user.displayName, statusEmoji: user.statusEmoji ?? '' });
      setProfileStatus(null);
    }
  }, [isOpen, user]);

  // ---------------------------------------------------------------------
  // Escape closes; simple focus trap while open
  // ---------------------------------------------------------------------
  React.useEffect(() => {
    if (!isOpen) return;
    const handleKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.stopPropagation();
        onClose();
        return;
      }
      if (e.key !== 'Tab') return;
      const panel = panelRef.current;
      if (!panel) return;
      const focusables = Array.from(
        panel.querySelectorAll<HTMLElement>(
          'a[href], button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])'
        )
      );
      if (focusables.length === 0) return;
      const first = focusables[0];
      const last = focusables[focusables.length - 1];
      const activeEl = document.activeElement as HTMLElement | null;
      if (e.shiftKey) {
        if (activeEl === first || !panel.contains(activeEl)) {
          e.preventDefault();
          last.focus();
        }
      } else if (activeEl === last || !panel.contains(activeEl)) {
        e.preventDefault();
        first.focus();
      }
    };
    document.addEventListener('keydown', handleKey, true);
    const focusTimer = window.setTimeout(() => panelRef.current?.focus(), 0);
    return () => {
      document.removeEventListener('keydown', handleKey, true);
      window.clearTimeout(focusTimer);
    };
  }, [isOpen, onClose]);

  // ---------------------------------------------------------------------
  // Optimistic DOM application of appearance + accessibility settings
  // ---------------------------------------------------------------------
  React.useEffect(() => {
    if (!isOpen || !settings) return;
    const { appearance, accessibility } = settings;
    const root = document.documentElement;

    // Theme (supports 'system' via prefers-color-scheme)
    const mediaQuery = window.matchMedia('(prefers-color-scheme: dark)');
    const applyTheme = () => {
      const resolved = appearance.theme === 'system' ? (mediaQuery.matches ? 'dark' : 'light') : appearance.theme;
      root.setAttribute('data-theme', resolved);
      // Keep App-owned theme state in sync (it re-applies data-theme on change).
      if (resolved !== theme) onToggleTheme();
    };
    applyTheme();
    mediaQuery.addEventListener('change', applyTheme);

    // Density
    root.setAttribute('data-density', appearance.density);
    if (appearance.density !== density) onChangeDensity(appearance.density);

    // Font scaling: base size from fontSize preset × accessibility textScaling
    const fontSizeFactor = appearance.fontSize === 'sm' ? 0.9 : appearance.fontSize === 'lg' ? 1.125 : 1;
    const scale = fontSizeFactor * accessibility.textScaling;
    root.style.setProperty('--orbit-font-scale', String(scale));
    root.style.fontSize = `${16 * scale}px`;

    // Motion & contrast
    const reduce = appearance.reduceMotion || accessibility.reducedMotion;
    root.setAttribute('data-reduced-motion', reduce ? 'true' : 'false');
    root.setAttribute('data-high-contrast', accessibility.highContrast ? 'true' : 'false');

    return () => mediaQuery.removeEventListener('change', applyTheme);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isOpen, settings, theme, density, onToggleTheme, onChangeDensity]);

  // ---------------------------------------------------------------------
  // Scroll to a control after a search-result click
  // ---------------------------------------------------------------------
  React.useEffect(() => {
    if (!pendingScrollId) return;
    const raf = requestAnimationFrame(() => {
      const el = document.querySelector(`[data-settings-control-id="${pendingScrollId}"]`);
      el?.scrollIntoView({ block: 'center', behavior: 'smooth' });
      setPendingScrollId(null);
    });
    return () => cancelAnimationFrame(raf);
  }, [pendingScrollId, activeCategory]);

  // ---------------------------------------------------------------------
  // Section state mutation + persistence
  // ---------------------------------------------------------------------
  const updateSection = React.useCallback(
    <K extends SettingsSection>(section: K, patch: Partial<SettingsState[K]>) => {
      setSettings((prev) => {
        const current = prev[section];
        return { ...prev, [section]: { ...current, ...patch } } as SettingsState;
      });
      setDirty((prev) => ({ ...prev, [section]: true }));
    },
    []
  );

  const saveSection = React.useCallback(
    async (section: SettingsSection): Promise<boolean> => {
      setSaving((prev) => ({ ...prev, [section]: true }));
      try {
        const res = await fetch(apiUrl(`/v1/settings/${section}`), {
          method: 'PUT',
          headers: await buildHeaders({ 'Content-Type': 'application/json' }),
          body: JSON.stringify(settings[section]),
        });
        if (res.status === 401) {
          showSaveStatus({ type: 'error', message: 'Session expired — sign in again to save settings.' });
          return false;
        }
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        const body = (await res.json()) as { data?: Partial<SettingsState> };
        const confirmed = body?.data?.[section];
        if (confirmed) {
          setSettings((prev) => ({ ...prev, [section]: { ...prev[section], ...confirmed } } as SettingsState));
        }
        setDirty((prev) => ({ ...prev, [section]: false }));
        const label = CATEGORIES.find((c) => c.section === section)?.label ?? section;
        showSaveStatus({ type: 'success', message: `${label} saved` });
        return true;
      } catch {
        showSaveStatus({ type: 'error', message: `Could not save ${section} settings.` });
        return false;
      } finally {
        setSaving((prev) => ({ ...prev, [section]: false }));
      }
    },
    [buildHeaders, settings, showSaveStatus]
  );

  const saveAllDirty = React.useCallback(async () => {
    const dirtySections = (Object.keys(dirty) as SettingsSection[]).filter((s) => dirty[s]);
    if (dirtySections.length === 0) return;
    for (const section of dirtySections) {
      // eslint-disable-next-line no-await-in-loop
      await saveSection(section);
    }
  }, [dirty, saveSection]);

  const dirtyCount = React.useMemo(() => (Object.keys(dirty) as SettingsSection[]).filter((s) => dirty[s]).length, [dirty]);

  // ---------------------------------------------------------------------
  // Account profile save (PATCH /v1/me)
  // ---------------------------------------------------------------------
  const saveProfile = React.useCallback(async () => {
    const patch: { displayName?: string; statusEmoji?: string | null } = {};
    const nextName = profileDraft.displayName.trim();
    if (!nextName) {
      showProfileStatus({ type: 'error', message: 'Display name cannot be empty.' });
      return;
    }
    if (nextName !== localUser.displayName) patch.displayName = nextName;
    const nextEmoji = profileDraft.statusEmoji.trim();
    const currentEmoji = localUser.statusEmoji ?? '';
    if (nextEmoji !== currentEmoji) patch.statusEmoji = nextEmoji === '' ? null : nextEmoji;
    if (Object.keys(patch).length === 0) {
      showProfileStatus({ type: 'success', message: 'No profile changes to save.' });
      return;
    }
    setProfileSaving(true);
    try {
      const res = await fetch(apiUrl('/v1/me'), {
        method: 'PATCH',
        headers: await buildHeaders({ 'Content-Type': 'application/json' }),
        body: JSON.stringify(patch),
      });
      if (res.status === 401) {
        showProfileStatus({ type: 'error', message: 'Session expired — sign in again to edit your profile.' });
        return;
      }
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const body = (await res.json()) as { user?: UserAccount; data?: UserAccount };
      const updated = body?.user ?? body?.data;
      if (updated) {
        setLocalUser(updated);
        setProfileDraft({ displayName: updated.displayName, statusEmoji: updated.statusEmoji ?? '' });
      }
      showProfileStatus({ type: 'success', message: 'Profile updated' });
    } catch {
      showProfileStatus({ type: 'error', message: 'Could not update profile.' });
    } finally {
      setProfileSaving(false);
    }
  }, [buildHeaders, localUser, profileDraft, showProfileStatus]);

  // ---------------------------------------------------------------------
  // Security & Recovery handlers
  // ---------------------------------------------------------------------
  const [isAddingPasskey, setIsAddingPasskey] = React.useState(false);
  const [devices, setDevices] = React.useState<any[]>([]);
  const [isLoadingDevices, setIsLoadingDevices] = React.useState<boolean>(false);

  /** Load registered devices from the server for device management UI. */
  const loadDevices = React.useCallback(async (): Promise<void> => {
    setIsLoadingDevices(true);
    try {
      const token = await getAccessToken();
      const res = await fetch(apiUrl('/v1/crypto/keys'), {
        headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: `Bearer ${token}` } : {}) },
      });
      if (!res.ok) throw new Error('Failed to load devices');
      const data = (await res.json()) as { data: any[] };
      setDevices(data.data ?? []);
    } catch (err) {
      console.error('Failed to load devices:', err);
      setDevices([]);
      showSaveStatus({ type: 'error', message: 'Could not load registered devices.' });
    } finally {
      setIsLoadingDevices(false);
    }
  }, [showSaveStatus]);

  const handleAddPasskey = React.useCallback(async () => {
    if (!window.PublicKeyCredential) {
      showSaveStatus({ type: 'error', message: 'Passkeys are not supported in this browser' });
      return;
    }
    setIsAddingPasskey(true);
    try {
      const token = await getAccessToken();
      const challengeRes = await fetch(apiUrl('/v1/security/keys/register/begin'), {
        headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: `Bearer ${token}` } : {}) },
      });
      const challengeData = await challengeRes.json();
      if (!challengeData?.data) throw new Error('Failed to get challenge');

      const publicKey: PublicKeyCredentialCreationOptions = {
        challenge: Uint8Array.from(atob(challengeData.data.challenge), c => c.charCodeAt(0)),
        rp: { name: 'Orbit Chat', id: window.location.hostname },
        user: {
          id: Uint8Array.from(atob(challengeData.data.userId), c => c.charCodeAt(0)),
          name: activeWorkspace.handle,
          displayName: activeWorkspace.displayName,
        },
        pubKeyCredParams: [{ type: 'public-key', alg: -7 }],
        authenticatorSelection: { authenticatorAttachment: 'platform', userVerification: 'preferred', residentKey: 'preferred' },
        timeout: 60000,
        attestation: 'direct',
      };

      const credential = await navigator.credentials.create({ publicKey }) as any;
      if (!credential) throw new Error('Passkey creation cancelled');

      const attestationResponse = {
        id: credential.id,
        rawId: btoa(String.fromCharCode(...new Uint8Array(credential.rawId))),
        response: {
          attestationObject: btoa(String.fromCharCode(...new Uint8Array(credential.response.attestationObject))),
          clientDataJSON: btoa(String.fromCharCode(...new Uint8Array(credential.response.clientDataJSON))),
        },
        type: credential.type,
      };

      const registerRes = await fetch(apiUrl('/v1/security/keys/register'), {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: `Bearer ${token}` } : {}) },
        body: JSON.stringify({ label: `Passkey added ${new Date().toLocaleDateString()}`, credential: attestationResponse }),
      });
      if (!registerRes.ok) throw new Error('Failed to register passkey');
      showSaveStatus({ type: 'success', message: 'Passkey added successfully' });
    } catch (err) {
      showSaveStatus({ type: 'error', message: err instanceof Error ? err.message : 'Passkey registration failed' });
    } finally {
      setIsAddingPasskey(false);
    }
  }, [activeWorkspace, showSaveStatus]);

  const handlePasskeyRecovery = React.useCallback(async () => {
    // Opens a modal or flow for passkey recovery (email OTP + step-up)
    showSaveStatus({ type: 'error', message: 'Passkey recovery flow: use email OTP verification in account recovery settings' });
  }, [showSaveStatus]);

  const handleChangeEmail = React.useCallback(async () => {
    const newEmail = prompt('Enter new email address:');
    if (!newEmail || !newEmail.includes('@')) return;
    try {
      const token = await getAccessToken();
      const res = await fetch(apiUrl('/v1/me'), {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: `Bearer ${token}` } : {}) },
        body: JSON.stringify({ email: newEmail, confirmCurrentEmail: true }),
      });
      if (!res.ok) throw new Error('Failed to initiate email change');
      showSaveStatus({ type: 'success', message: 'Verification sent to old and new email addresses' });
    } catch (err) {
      showSaveStatus({ type: 'error', message: err instanceof Error ? err.message : 'Failed to change email' });
    }
  }, [showSaveStatus]);

  const handleChangePhone = React.useCallback(async () => {
    const newPhone = prompt('Enter new phone number (E.164 format, e.g. +15551234567):');
    if (!newPhone || !newPhone.startsWith('+')) return;
    try {
      const token = await getAccessToken();
      const res = await fetch(apiUrl('/v1/me'), {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: `Bearer ${token}` } : {}) },
        body: JSON.stringify({ phone: newPhone, confirmCurrentPhone: true }),
      });
      if (!res.ok) throw new Error('Failed to initiate phone change');
      showSaveStatus({ type: 'success', message: 'Verification sent to old and new phone numbers' });
    } catch (err) {
      showSaveStatus({ type: 'error', message: err instanceof Error ? err.message : 'Failed to change phone' });
    }
  }, [showSaveStatus]);

  const handleTransferOwnership = React.useCallback(async () => {
    // This would open a modal to select new owner from admins
    showSaveStatus({ type: 'error', message: 'Ownership transfer: select new owner from admins (requires step-up authentication)' });
  }, [showSaveStatus]);

  // ---------------------------------------------------------------------
  // Search
  // ---------------------------------------------------------------------
  const searchResults = React.useMemo(() => {
    const q = searchQuery.trim().toLowerCase();
    if (!q) return null;
    const hits = SETTINGS_SEARCH_INDEX.filter(
      (entry) => entry.label.toLowerCase().includes(q) || entry.keywords.toLowerCase().includes(q)
    );
    const grouped: Array<{ category: CategoryDef; entries: SearchEntry[] }> = [];
    for (const cat of CATEGORIES) {
      const entries = hits.filter((h) => h.category === cat.id);
      if (entries.length > 0) grouped.push({ category: cat, entries });
    }
    return grouped;
  }, [searchQuery]);

  const handleSearchResultClick = React.useCallback((entry: SearchEntry) => {
    setSearchQuery('');
    setActiveCategory(entry.category);
    setPendingScrollId(entry.controlId);
  }, []);

  const updateDevicePref = React.useCallback((patch: Partial<DevicePrefs>) => {
    setDevicePrefs((prev) => {
      const next = { ...prev, ...patch };
      saveDevicePrefs(next);
      return next;
    });
  }, []);

  if (!isOpen) return null;

  const inputStyle: React.CSSProperties = {
    width: '100%',
    padding: '8px 12px',
    borderRadius: 'var(--radius-md)',
    border: '1px solid var(--border-subtle)',
    backgroundColor: 'var(--surface-muted)',
    color: 'var(--text-primary)',
    fontSize: '13px',
  };

  const sectionHeadingStyle: React.CSSProperties = {
    fontSize: '15px',
    fontWeight: 700,
    color: 'var(--text-primary)',
    marginBottom: '4px',
  };

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-label="Settings dialog"
      style={{
        position: 'fixed',
        inset: 0,
        backgroundColor: 'var(--overlay-scrim, rgba(16, 18, 27, 0.65))',
        backdropFilter: 'blur(4px)',
        zIndex: 100,
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        padding: '24px',
        animation: 'fadeIn 150ms ease-out forwards',
      }}
    >
      <div
        ref={panelRef}
        tabIndex={-1}
        style={{
          width: '880px',
          maxWidth: '100%',
          height: '620px',
          maxHeight: '100%',
          backgroundColor: 'var(--surface)',
          borderRadius: 'var(--radius-xl)',
          boxShadow: 'var(--shadow-xl)',
          border: '1px solid var(--border-subtle)',
          display: 'flex',
          overflow: 'hidden',
          position: 'relative',
          outline: 'none',
        }}
      >
        {/* Left Sidebar of Categories */}
        <div
          style={{
            width: '240px',
            backgroundColor: 'var(--surface-muted)',
            borderRight: '1px solid var(--border-subtle)',
            padding: '20px 12px',
            display: 'flex',
            flexDirection: 'column',
          }}
        >
          <div style={{ fontSize: '16px', fontWeight: 700, color: 'var(--text-primary)', padding: '0 8px 12px' }}>
            Settings
          </div>

          {/* Settings search */}
          <div style={{ position: 'relative', marginBottom: '12px' }}>
            <Search
              size={14}
              style={{
                position: 'absolute',
                left: '10px',
                top: '50%',
                transform: 'translateY(-50%)',
                color: 'var(--text-muted)',
                pointerEvents: 'none',
              }}
            />
            <input
              type="text"
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              aria-label="Search settings"
              placeholder="Search settings…"
              style={{
                ...inputStyle,
                paddingLeft: '30px',
                fontSize: '12px',
              }}
            />
          </div>

          <div style={{ display: 'flex', flexDirection: 'column', gap: '4px', flex: 1, overflowY: 'auto' }}>
            {CATEGORIES.map((cat) => {
              const isSelected = activeCategory === cat.id && !searchQuery.trim();
              const Icon = cat.icon;
              const isDirty = cat.section ? dirty[cat.section] : false;
              return (
                <button
                  key={cat.id}
                  onClick={() => {
                    setSearchQuery('');
                    setActiveCategory(cat.id);
                  }}
                  aria-current={isSelected ? 'true' : undefined}
                  style={{
                    display: 'flex',
                    alignItems: 'center',
                    gap: '10px',
                    padding: '8px 10px',
                    borderRadius: 'var(--radius-md)',
                    border: 'none',
                    backgroundColor: isSelected ? 'var(--surface)' : 'transparent',
                    color: isSelected ? 'var(--accent-primary)' : 'var(--text-secondary)',
                    fontWeight: isSelected ? 600 : 500,
                    fontSize: '13px',
                    cursor: 'pointer',
                    textAlign: 'left',
                    boxShadow: isSelected ? 'var(--shadow-sm)' : 'none',
                    transition: 'all 120ms ease',
                  }}
                >
                  <Icon size={16} />
                  <span style={{ flex: 1 }}>{cat.label}</span>
                  {isDirty && (
                    <span
                      aria-label="Unsaved changes"
                      style={{ width: '7px', height: '7px', borderRadius: '50%', backgroundColor: 'var(--caution)', flexShrink: 0 }}
                    />
                  )}
                </button>
              );
            })}
          </div>

          {dirtyCount > 0 && (
            <button
              type="button"
              onClick={() => void saveAllDirty()}
              style={{
                marginTop: '10px',
                padding: '8px 12px',
                backgroundColor: 'var(--accent-primary)',
                color: 'var(--accent-text)',
                border: 'none',
                borderRadius: 'var(--radius-md)',
                fontWeight: 600,
                fontSize: '12px',
                cursor: 'pointer',
              }}
            >
              Save all changes ({dirtyCount})
            </button>
          )}

          {saveStatus && (
            <div
              role="status"
              style={{
                marginTop: '8px',
                backgroundColor: saveStatus.type === 'success' ? 'var(--positive-soft)' : 'var(--danger-soft)',
                color: saveStatus.type === 'success' ? 'var(--positive)' : 'var(--danger)',
                padding: '6px 10px',
                borderRadius: 'var(--radius-md)',
                fontSize: '11px',
                fontWeight: 600,
                display: 'flex',
                alignItems: 'center',
                gap: '4px',
              }}
            >
              {saveStatus.type === 'success' ? <Check size={14} /> : <AlertTriangle size={14} />} {saveStatus.message}
            </div>
          )}
        </div>

        {/* Right Content Area */}
        <div style={{ flex: 1, display: 'flex', flexDirection: 'column', overflow: 'hidden' }}>
          {/* Header */}
          <div
            style={{
              padding: '16px 24px',
              borderBottom: '1px solid var(--border-subtle)',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'space-between',
            }}
          >
            <h2 style={{ fontSize: '18px', fontWeight: 700, color: 'var(--text-primary)' }}>
              {searchQuery.trim() ? 'Search results' : CATEGORIES.find((c) => c.id === activeCategory)?.label}
            </h2>
            <button
              onClick={onClose}
              aria-label="Close settings"
              style={{
                background: 'none',
                border: 'none',
                color: 'var(--text-secondary)',
                cursor: 'pointer',
                padding: '4px',
              }}
            >
              <X size={20} />
            </button>
          </div>

          {/* Form Content */}
          <div style={{ flex: 1, overflowY: 'auto', padding: '24px' }}>
            {isLoadingSettings && (
              <div style={{ fontSize: '12px', color: 'var(--text-muted)', marginBottom: '16px' }}>Loading settings…</div>
            )}

            {/* Search results view */}
            {searchResults !== null && (
              <div style={{ display: 'flex', flexDirection: 'column', gap: '24px' }}>
                {searchResults.length === 0 && (
                  <div style={{ fontSize: '13px', color: 'var(--text-secondary)' }}>
                    No settings match “{searchQuery.trim()}”.
                  </div>
                )}
                {searchResults.map((group) => {
                  const Icon = group.category.icon;
                  return (
                    <div key={group.category.id}>
                      <div
                        style={{
                          display: 'flex',
                          alignItems: 'center',
                          gap: '8px',
                          fontSize: '13px',
                          fontWeight: 700,
                          color: 'var(--accent-primary)',
                          marginBottom: '8px',
                        }}
                      >
                        <Icon size={15} />
                        {group.category.label}
                      </div>
                      <div style={{ display: 'flex', flexDirection: 'column', gap: '6px' }}>
                        {group.entries.map((entry) => (
                          <button
                            key={entry.controlId}
                            type="button"
                            onClick={() => handleSearchResultClick(entry)}
                            style={{
                              display: 'flex',
                              alignItems: 'center',
                              justifyContent: 'space-between',
                              padding: '10px 14px',
                              backgroundColor: 'var(--surface-muted)',
                              border: '1px solid var(--border-subtle)',
                              borderRadius: 'var(--radius-md)',
                              cursor: 'pointer',
                              textAlign: 'left',
                            }}
                          >
                            <span style={{ fontSize: '13px', fontWeight: 600, color: 'var(--text-primary)' }}>{entry.label}</span>
                            <span style={{ fontSize: '11px', color: 'var(--text-muted)' }}>Open</span>
                          </button>
                        ))}
                      </div>
                    </div>
                  );
                })}
              </div>
            )}

            {/* Normal category views */}
            {searchResults === null && activeCategory === 'account' && (
              <div style={{ display: 'flex', flexDirection: 'column', gap: '16px' }}>
                <TextFieldRow
                  controlId="account.displayName"
                  label="Display name"
                  value={profileDraft.displayName}
                  maxLength={80}
                  onChange={(v) => setProfileDraft((p) => ({ ...p, displayName: v }))}
                />
                <TextFieldRow
                  controlId="account.statusEmoji"
                  label="Status emoji"
                  description="A short emoji shown next to your name (max 16 characters)."
                  value={profileDraft.statusEmoji}
                  maxLength={16}
                  placeholder="👋"
                  onChange={(v) => setProfileDraft((p) => ({ ...p, statusEmoji: v }))}
                />
                <TextFieldRow controlId="account.handle" label="Handle" value={`@${activeWorkspace.handle}`} disabled />
                <TextFieldRow controlId="account.email" label="Email" type="email" value={localUser.email} disabled />

                {profileStatus && (
                  <div
                    role="status"
                    style={{
                      padding: '8px 12px',
                      borderRadius: 'var(--radius-md)',
                      fontSize: '12px',
                      fontWeight: 600,
                      backgroundColor: profileStatus.type === 'success' ? 'var(--positive-soft)' : 'var(--danger-soft)',
                      color: profileStatus.type === 'success' ? 'var(--positive)' : 'var(--danger)',
                    }}
                  >
                    {profileStatus.message}
                  </div>
                )}

                <div style={{ display: 'flex', gap: '10px', alignItems: 'center' }}>
                  <button
                    type="button"
                    onClick={() => void saveProfile()}
                    disabled={profileSaving}
                    style={{
                      padding: '8px 16px',
                      backgroundColor: 'var(--accent-primary)',
                      color: 'var(--accent-text)',
                      border: 'none',
                      borderRadius: 'var(--radius-md)',
                      fontWeight: 600,
                      cursor: profileSaving ? 'default' : 'pointer',
                      opacity: profileSaving ? 0.7 : 1,
                    }}
                  >
                    {profileSaving ? 'Saving…' : 'Save profile'}
                  </button>
                  <button
                    type="button"
                    data-settings-control-id="account.sessions"
                    onClick={() => {
                      if (onRequestOpenSessions) onRequestOpenSessions();
                      else showSaveStatus({ type: 'error', message: 'Sessions panel is not wired into Settings yet — open it from the account menu.' });
                    }}
                    style={{
                      padding: '8px 14px',
                      backgroundColor: 'var(--surface-muted)',
                      border: '1px solid var(--border-subtle)',
                      color: 'var(--text-primary)',
                      borderRadius: 'var(--radius-md)',
                      fontWeight: 600,
                      fontSize: '13px',
                      cursor: 'pointer',
                      display: 'flex',
                      alignItems: 'center',
                      gap: '6px',
                    }}
                  >
                    <Smartphone size={14} /> Active sessions
                  </button>
                </div>
              </div>
            )}

            {searchResults === null && activeCategory === 'privacy' && (
              <div style={{ display: 'flex', flexDirection: 'column', gap: '20px' }}>
                <div
                  style={{
                    padding: '10px 12px',
                    backgroundColor: 'var(--accent-soft)',
                    borderRadius: 'var(--radius-md)',
                    fontSize: '12px',
                    color: 'var(--accent-primary)',
                    display: 'flex',
                    alignItems: 'center',
                    gap: '6px',
                  }}
                >
                  <ShieldAlert size={16} /> Privacy and safety controls are saved to your workspace and enforced by the server.
                </div>

                <ToggleRow
                  controlId="privacy.readReceipts"
                  label="Read receipts"
                  description="If disabled, you won’t share or see read checkmarks."
                  checked={settings.privacy.readReceipts}
                  onChange={(v) => updateSection('privacy', { readReceipts: v })}
                />
                <ToggleRow
                  controlId="privacy.typingIndicators"
                  label="Typing indicators"
                  description="Show others when you are typing a reply."
                  checked={settings.privacy.typingIndicators}
                  onChange={(v) => updateSection('privacy', { typingIndicators: v })}
                />
                <SelectRow
                  controlId="privacy.lastActiveVisibility"
                  label="Last active visibility"
                  description="Who can see when you were last online."
                  value={settings.privacy.lastActiveVisibility}
                  options={[
                    { value: 'everyone', label: 'Everyone' },
                    { value: 'contacts', label: 'Contacts only' },
                    { value: 'nobody', label: 'Nobody' },
                  ]}
                  onChange={(v) => updateSection('privacy', { lastActiveVisibility: v as PrivacySettings['lastActiveVisibility'] })}
                />
                <SelectRow
                  controlId="privacy.profilePhotoVisibility"
                  label="Profile photo visibility"
                  value={settings.privacy.profilePhotoVisibility}
                  options={[
                    { value: 'everyone', label: 'Everyone' },
                    { value: 'contacts', label: 'Contacts only' },
                    { value: 'nobody', label: 'Nobody' },
                  ]}
                  onChange={(v) => updateSection('privacy', { profilePhotoVisibility: v as PrivacySettings['profilePhotoVisibility'] })}
                />
                <SelectRow
                  controlId="privacy.bioVisibility"
                  label="Bio visibility"
                  value={settings.privacy.bioVisibility}
                  options={[
                    { value: 'everyone', label: 'Everyone' },
                    { value: 'contacts', label: 'Contacts only' },
                    { value: 'nobody', label: 'Nobody' },
                  ]}
                  onChange={(v) => updateSection('privacy', { bioVisibility: v as PrivacySettings['bioVisibility'] })}
                />
                <SelectRow
                  controlId="privacy.groupInvitePermission"
                  label="Who can add you to groups"
                  value={settings.privacy.groupInvitePermission}
                  options={[
                    { value: 'everyone', label: 'Everyone' },
                    { value: 'contacts', label: 'Contacts only (Recommended)' },
                    { value: 'nobody', label: 'Nobody' },
                  ]}
                  onChange={(v) => updateSection('privacy', { groupInvitePermission: v as PrivacySettings['groupInvitePermission'] })}
                />
                <ToggleRow
                  controlId="privacy.linkPreviews"
                  label="Show link previews"
                  description="Generate previews for links you send and receive."
                  checked={settings.privacy.linkPreviews}
                  onChange={(v) => updateSection('privacy', { linkPreviews: v })}
                />
                <ToggleRow
                  controlId="privacy.hideNotificationPreviews"
                  label="Hide notification previews"
                  description="Obscure message content in lock-screen notifications."
                  checked={settings.privacy.hideNotificationPreviews}
                  onChange={(v) => updateSection('privacy', { hideNotificationPreviews: v })}
                />
                <SelectRow
                  controlId="privacy.defaultMessageExpiryDays"
                  label="Default message expiry"
                  description="Automatically delete new messages after this period."
                  value={settings.privacy.defaultMessageExpiryDays === null ? '0' : String(settings.privacy.defaultMessageExpiryDays)}
                  options={[
                    { value: '0', label: 'Off (keep messages)' },
                    { value: '7', label: '7 days' },
                    { value: '30', label: '30 days' },
                    { value: '90', label: '90 days' },
                  ]}
                  onChange={(v) => updateSection('privacy', { defaultMessageExpiryDays: v === '0' ? null : Number(v) })}
                />
                <ToggleRow
                  controlId="privacy.restricted"
                  label="Restrict messages to contacts"
                  description="Only people in your contacts can start new conversations with you."
                  checked={settings.privacy.restricted}
                  onChange={(v) => updateSection('privacy', { restricted: v })}
                />
                <ToggleRow
                  controlId="privacy.restrictUnknownCalls"
                  label="Restrict calls from unknown people"
                  description="Only accept calls from contacts; others are declined."
                  checked={settings.privacy.restrictUnknownCalls}
                  onChange={(v) => updateSection('privacy', { restrictUnknownCalls: v })}
                />
                <ToggleRow
                  controlId="privacy.autoDownloadMedia"
                  label="Auto-download media"
                  description="Automatically download photos and voice notes."
                  checked={settings.privacy.autoDownloadMedia}
                  onChange={(v) => updateSection('privacy', { autoDownloadMedia: v })}
                />

                <SectionSaveBar
                  dirty={dirty.privacy}
                  saving={Boolean(saving.privacy)}
                  onSave={() => void saveSection('privacy')}
                />
              </div>
            )}

            {searchResults === null && activeCategory === 'security' && (
              <div style={{ display: 'flex', flexDirection: 'column', gap: '20px' }}>
                <div data-settings-control-id="security.passkeys">
                  <h4 style={sectionHeadingStyle}>Passkeys & Authentication</h4>
                  <p style={{ fontSize: '12px', color: 'var(--text-secondary)', marginBottom: '10px' }}>
                    FIDO2 WebAuthn cryptographic keys protect your account from phishing and credential theft.
                  </p>
                  <div
                    style={{
                      display: 'flex',
                      alignItems: 'center',
                      justifyContent: 'space-between',
                      padding: '10px 14px',
                      backgroundColor: 'var(--surface-muted)',
                      borderRadius: 'var(--radius-md)',
                      border: '1px solid var(--border-subtle)',
                    }}
                  >
                    <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                      <Lock size={16} color="var(--positive)" />
                      <div>
                        <div style={{ fontSize: '13px', fontWeight: 600, color: 'var(--text-primary)' }}>
                          Windows Hello / Touch ID Key
                        </div>
                        <div style={{ fontSize: '11px', color: 'var(--text-secondary)' }}>
                          Synced via Platform Authenticator
                        </div>
                      </div>
                    </div>
                  </div>
                  <div style={{ display: 'flex', gap: '8px', marginTop: '10px', flexWrap: 'wrap' }}>
                    <button
                      type="button"
                      onClick={handleAddPasskey}
                      disabled={isAddingPasskey}
                      style={{
                        padding: '8px 14px',
                        backgroundColor: 'var(--brand-primary)',
                        color: 'var(--accent-text)',
                        border: 'none',
                        borderRadius: 'var(--radius-md)',
                        fontWeight: 600,
                        fontSize: '13px',
                        cursor: isAddingPasskey ? 'wait' : 'pointer',
                        display: 'flex',
                        alignItems: 'center',
                        gap: '6px',
                      }}
                    >
                      <Fingerprint size={14} /> {isAddingPasskey ? t('security.addingPasskey') : t('security.addPasskey')}
                    </button>
                    <button
                      type="button"
                      onClick={handlePasskeyRecovery}
                      style={{
                        padding: '8px 14px',
                        backgroundColor: 'var(--surface-muted)',
                        border: '1px solid var(--border-subtle)',
                        color: 'var(--text-primary)',
                        borderRadius: 'var(--radius-md)',
                        fontWeight: 600,
                        fontSize: '13px',
                        cursor: 'pointer',
                        display: 'flex',
                        alignItems: 'center',
                        gap: '6px',
                      }}
                    >
                      <ShieldAlert size={14} /> {t('security.passkeyRecovery')}
                    </button>
                  </div>
                </div>

                <div data-settings-control-id="security.recovery" style={{ paddingTop: '16px', borderTop: '1px solid var(--border-subtle)' }}>
                  <h4 style={sectionHeadingStyle}>Account Recovery</h4>
                  <p style={{ fontSize: '12px', color: 'var(--text-secondary)', marginBottom: '10px' }}>
                    Configure recovery options for lost access scenarios.
                  </p>
                  <div style={{ display: 'flex', flexDirection: 'column', gap: '10px' }}>
                    <div
                      style={{
                        padding: '12px 14px',
                        backgroundColor: 'var(--surface-muted)',
                        borderRadius: 'var(--radius-md)',
                        border: '1px solid var(--border-subtle)',
                      }}
                    >
                      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '6px' }}>
                        <div>
                          <div style={{ fontSize: '13px', fontWeight: 600, color: 'var(--text-primary)' }}>
                            {t('security.verifiedEmail')}
                          </div>
                          <div style={{ fontSize: '11px', color: 'var(--text-secondary)' }}>
                            {localUser.email}
                          </div>
                        </div>
                        <span style={{ fontSize: '11px', fontWeight: 600, padding: '2px 8px', borderRadius: '9999px', backgroundColor: 'var(--positive-soft)', color: 'var(--positive)' }}>
                          {t('security.verified')}
                        </span>
                      </div>
                      <div style={{ fontSize: '12px', color: 'var(--text-secondary)' }}>
                        {t('security.emailRecoveryDesc')}
                      </div>
                    </div>
                    <button
                      type="button"
                      onClick={() => handleChangeEmail()}
                      style={{
                        padding: '8px 14px',
                        backgroundColor: 'var(--surface-muted)',
                        border: '1px solid var(--border-subtle)',
                        color: 'var(--text-primary)',
                        borderRadius: 'var(--radius-md)',
                        fontWeight: 600,
                        fontSize: '13px',
                        cursor: 'pointer',
                        display: 'flex',
                        alignItems: 'center',
                        gap: '6px',
                      }}
                    >
                      <Mail size={14} /> {t('security.changeEmail')}
                    </button>
                    <button
                      type="button"
                      onClick={() => handleChangePhone()}
                      style={{
                        padding: '8px 14px',
                        backgroundColor: 'var(--surface-muted)',
                        border: '1px solid var(--border-subtle)',
                        color: 'var(--text-primary)',
                        borderRadius: 'var(--radius-md)',
                        fontWeight: 600,
                        fontSize: '13px',
                        cursor: 'pointer',
                        display: 'flex',
                        alignItems: 'center',
                        gap: '6px',
                      }}
                    >
                      <Smartphone size={14} /> {t('security.changePhone')}
                    </button>
                  </div>
                </div>

                <div data-settings-control-id="security.handle-protection" style={{ paddingTop: '16px', borderTop: '1px solid var(--border-subtle)' }}>
                  <h4 style={sectionHeadingStyle}>Handle Protection</h4>
                  <p style={{ fontSize: '12px', color: 'var(--text-secondary)', marginBottom: '10px' }}>
                    Protect your handle from unauthorized changes.
                  </p>
                  <div style={{ display: 'flex', flexDirection: 'column', gap: '10px' }}>
                    <ToggleRow
                      controlId="security.handleChangeNotify"
                      label={t('security.notifyHandleChange')}
                      description={t('security.notifyHandleChangeDesc')}
                      checked={false}
                      onChange={() => {}}
                      disabled
                    />
                    <div
                      style={{
                        padding: '10px 12px',
                        backgroundColor: 'var(--caution-soft)',
                        borderRadius: 'var(--radius-md)',
                        border: '1px solid var(--caution)',
                        fontSize: '12px',
                        color: 'var(--caution)',
                      }}
                    >
                      {t('security.handleRateLimitNote')}
                    </div>
                  </div>
                </div>

                {activeWorkspace.type === 'business' && (
                  <div data-settings-control-id="security.ownership" style={{ paddingTop: '16px', borderTop: '1px solid var(--border-subtle)' }}>
                    <h4 style={sectionHeadingStyle}>Business Ownership</h4>
                    <p style={{ fontSize: '12px', color: 'var(--text-secondary)', marginBottom: '10px' }}>
                      Transfer workspace ownership to another admin.
                    </p>
                    <button
                      type="button"
                      onClick={handleTransferOwnership}
                      style={{
                        padding: '8px 14px',
                        backgroundColor: 'var(--danger-soft)',
                        border: '1px solid var(--danger)',
                        color: 'var(--danger)',
                        borderRadius: 'var(--radius-md)',
                        fontWeight: 600,
                        fontSize: '13px',
                        cursor: 'pointer',
                        display: 'flex',
                        alignItems: 'center',
                        gap: '6px',
                      }}
                    >
                      <AlertTriangle size={14} /> {t('security.transferOwnership')}
                    </button>
                  </div>
                )}

                <div data-settings-control-id="security.sessions">
                  <h4 style={sectionHeadingStyle}>Active Devices & Sessions</h4>
                  <p style={{ fontSize: '12px', color: 'var(--text-secondary)', marginBottom: '10px' }}>
                    Manage authorized sessions linked to your identity.
                  </p>
                  <button
                    type="button"
                    onClick={() => {
                      if (onRequestOpenSessions) onRequestOpenSessions();
                      else showSaveStatus({ type: 'error', message: 'Sessions panel is not wired into Settings yet — open it from the account menu.' });
                    }}
                    style={{
                      padding: '8px 14px',
                      backgroundColor: 'var(--surface-muted)',
                      border: '1px solid var(--border-subtle)',
                      color: 'var(--text-primary)',
                      borderRadius: 'var(--radius-md)',
                      fontWeight: 600,
                      fontSize: '13px',
                      cursor: 'pointer',
                      display: 'flex',
                      alignItems: 'center',
                      gap: '6px',
                    }}
                  >
                    <Smartphone size={14} /> Open Sessions & Devices
                  </button>
                </div>

                <div data-settings-control-id="security.device-management" style={{ paddingTop: '16px', borderTop: '1px solid var(--border-subtle)' }}>
                  <h4 style={sectionHeadingStyle}>Manage Devices</h4>
                  <p style={{ fontSize: '12px', color: 'var(--text-secondary)', marginBottom: '10px' }}>
                    Registered devices and passkeys for this account.
                  </p>
                  {isLoadingDevices ? (
                    <div style={{ fontSize: '12px', color: 'var(--text-muted)', marginBottom: '16px' }}>Loading devices…</div>
                  ) : devices.map((device) => (
                    <div
                      key={device.id}
                      style={{
                        padding: '12px 14px',
                        backgroundColor: 'var(--surface-muted)',
                        borderRadius: 'var(--radius-md)',
                        marginBottom: '8px',
                        border: '1px solid var(--border-subtle)',
                      }}
                    >
                      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '4px' }}>
                        <span style={{ fontSize: '13px', fontWeight: 600, color: 'var(--text-primary)' }}>
                          {device.label || device.type}
                        </span>
                        <span style={{ fontSize: '11px', color: 'var(--text-muted)' }}>
                          {device.type}
                        </span>
                      </div>
                      <p style={{ fontSize: '11px', color: 'var(--text-secondary)' }}>
                        {device.ipAddress || '—'} • {device.lastUsedAt || 'never used'}
                      </p>
                      <button
                        type="button"
                        style={{
                          marginTop: '8px',
                          padding: '6px 12px',
                          backgroundColor: 'var(--danger-soft)',
                          border: '1px solid var(--danger)',
                          color: 'var(--danger)',
                          borderRadius: 'var(--radius-md)',
                          fontSize: '12px',
                          cursor: 'pointer',
                        }}
                        onClick={() => {
                          // TODO: Implement device removal with re-verification
                          showSaveStatus({ type: 'error', message: 'Device removal: verify with old passcode or passkey' });
                        }}
                      >
                        Remove device
                      </button>
                    </div>
                  ))}

                  {devices.length === 0 && (
                    <p style={{ fontSize: '13px', color: 'var(--text-secondary)' }}>
                      No registered devices. Add a passkey or device to enable management.
                    </p>
                  )}

                  <button
                    type="button"
                    onClick={() => {
                      // TODO: Implement change passcode flow
                      showSaveStatus({ type: 'error', message: 'Change passcode: verify with old passcode' });
                    }}
                    style={{
                      marginTop: '12px',
                      padding: '8px 14px',
                      backgroundColor: 'var(--brand-primary)',
                      color: 'var(--accent-text)',
                      border: 'none',
                      borderRadius: 'var(--radius-md)',
                      fontWeight: 600,
                      fontSize: '13px',
                      cursor: 'pointer',
                    }}
                  >
                    <Key size={14} /> Change passcode
                  </button>
                </div>
              </div>
            )}

            {searchResults === null && activeCategory === 'appearance' && (
              <div style={{ display: 'flex', flexDirection: 'column', gap: '20px' }}>
                <SegmentedControl
                  controlId="appearance.theme"
                  label="Color theme"
                  value={settings.appearance.theme}
                  options={[
                    { value: 'light', label: 'Light' },
                    { value: 'dark', label: 'Dark' },
                    { value: 'system', label: 'System' },
                  ]}
                  onChange={(v) => updateSection('appearance', { theme: v as AppearanceSettings['theme'] })}
                />
                <SegmentedControl
                  controlId="appearance.density"
                  label="Interface density"
                  value={settings.appearance.density}
                  options={[
                    { value: 'compact', label: 'Compact' },
                    { value: 'standard', label: 'Standard' },
                    { value: 'comfortable', label: 'Comfortable' },
                  ]}
                  onChange={(v) => updateSection('appearance', { density: v as AppearanceSettings['density'] })}
                />
                <SegmentedControl
                  controlId="appearance.fontSize"
                  label="Font size"
                  value={settings.appearance.fontSize}
                  options={[
                    { value: 'sm', label: 'Small' },
                    { value: 'base', label: 'Default' },
                    { value: 'lg', label: 'Large' },
                  ]}
                  onChange={(v) => updateSection('appearance', { fontSize: v as AppearanceSettings['fontSize'] })}
                />
                <SegmentedControl
                  controlId="appearance.timestampFormat"
                  label="Timestamp format"
                  value={settings.appearance.timestampFormat}
                  options={[
                    { value: '12h', label: '12-hour (1:45 PM)' },
                    { value: '24h', label: '24-hour (13:45)' },
                  ]}
                  onChange={(v) => updateSection('appearance', { timestampFormat: v as AppearanceSettings['timestampFormat'] })}
                />
                <ToggleRow
                  controlId="appearance.showAvatars"
                  label="Show avatars"
                  description="Display profile pictures in conversation lists and messages."
                  checked={settings.appearance.showAvatars}
                  onChange={(v) => updateSection('appearance', { showAvatars: v })}
                />
                <ToggleRow
                  controlId="appearance.reduceMotion"
                  label="Reduce motion"
                  description="Disables surface transitions and animated decorative effects."
                  checked={settings.appearance.reduceMotion}
                  onChange={(v) => updateSection('appearance', { reduceMotion: v })}
                />

                <SectionSaveBar
                  dirty={dirty.appearance}
                  saving={Boolean(saving.appearance)}
                  onSave={() => void saveSection('appearance')}
                />
              </div>
            )}

            {searchResults === null && activeCategory === 'notifications' && (
              <div style={{ display: 'flex', flexDirection: 'column', gap: '20px' }}>
                <ToggleRow
                  controlId="notifications.globalEnabled"
                  label="Enable notifications"
                  description="Master switch for all push and in-app notifications."
                  checked={settings.notifications.globalEnabled}
                  onChange={(v) => updateSection('notifications', { globalEnabled: v })}
                />
                <SegmentedControl
                  controlId="notifications.previewDetail"
                  label="Notification preview detail"
                  description="What appears on the lock screen and in notification banners."
                  value={settings.notifications.previewDetail}
                  options={[
                    { value: 'full', label: 'Full content' },
                    { value: 'sender_only', label: 'Sender only' },
                    { value: 'hidden', label: 'Hidden' },
                  ]}
                  onChange={(v) => updateSection('notifications', { previewDetail: v as NotificationSettings['previewDetail'] })}
                />
                <ToggleRow
                  controlId="notifications.soundEnabled"
                  label="Sound alerts"
                  description="Play subtle harmonic notification tones on new messages."
                  checked={settings.notifications.soundEnabled}
                  onChange={(v) => updateSection('notifications', { soundEnabled: v })}
                />
                <ToggleRow
                  controlId="notifications.vibrationEnabled"
                  label="Vibration"
                  description="Vibrate for incoming notifications on supported devices."
                  checked={settings.notifications.vibrationEnabled}
                  onChange={(v) => updateSection('notifications', { vibrationEnabled: v })}
                />
                <div data-settings-control-id="notifications.quietHours" style={{ display: 'flex', flexDirection: 'column', gap: '10px' }}>
                  <ToggleRow
                    controlId="notifications.quietHoursToggle"
                    label="Quiet hours"
                    description="Mute incoming alert sounds during a scheduled window."
                    checked={settings.notifications.quietHoursStart !== null || settings.notifications.quietHoursEnd !== null}
                    onChange={(v) =>
                      updateSection(
                        'notifications',
                        v ? { quietHoursStart: '22:00', quietHoursEnd: '08:00' } : { quietHoursStart: null, quietHoursEnd: null }
                      )
                    }
                  />
                  <div style={{ display: 'flex', gap: '12px', alignItems: 'center', paddingLeft: '2px' }}>
                    <label htmlFor="notifications.quietHoursStart" style={{ fontSize: '12px', color: 'var(--text-secondary)' }}>
                      From
                    </label>
                    <input
                      id="notifications.quietHoursStart"
                      type="time"
                      value={settings.notifications.quietHoursStart ?? ''}
                      disabled={settings.notifications.quietHoursStart === null && settings.notifications.quietHoursEnd === null}
                      onChange={(e) => updateSection('notifications', { quietHoursStart: e.target.value || null })}
                      style={{ ...inputStyle, width: 'auto', fontSize: '12px' }}
                    />
                    <label htmlFor="notifications.quietHoursEnd" style={{ fontSize: '12px', color: 'var(--text-secondary)' }}>
                      To
                    </label>
                    <input
                      id="notifications.quietHoursEnd"
                      type="time"
                      value={settings.notifications.quietHoursEnd ?? ''}
                      disabled={settings.notifications.quietHoursStart === null && settings.notifications.quietHoursEnd === null}
                      onChange={(e) => updateSection('notifications', { quietHoursEnd: e.target.value || null })}
                      style={{ ...inputStyle, width: 'auto', fontSize: '12px' }}
                    />
                  </div>
                </div>
                <ToggleRow
                  controlId="notifications.mentionsOnly"
                  label="Mentions only"
                  description="Only notify me when I am @mentioned."
                  checked={settings.notifications.mentionsOnly}
                  onChange={(v) => updateSection('notifications', { mentionsOnly: v })}
                />

                <SectionSaveBar
                  dirty={dirty.notifications}
                  saving={Boolean(saving.notifications)}
                  onSave={() => void saveSection('notifications')}
                />
              </div>
            )}

            {searchResults === null && activeCategory === 'chats' && (
              <div style={{ display: 'flex', flexDirection: 'column', gap: '20px' }}>
                <ToggleRow
                  controlId="messaging.enterToSend"
                  label="Enter key to send"
                  description="Press Enter to send a message; Shift+Enter for a new line."
                  checked={settings.messaging.enterToSend}
                  onChange={(v) => updateSection('messaging', { enterToSend: v })}
                />
                <ToggleRow
                  controlId="messaging.mediaAutoplay"
                  label="Media autoplay"
                  description="Automatically play videos and animated media in conversations."
                  checked={settings.messaging.mediaAutoplay}
                  onChange={(v) => updateSection('messaging', { mediaAutoplay: v })}
                />
                <SelectRow
                  controlId="messaging.linkPreviewBehavior"
                  label="Link preview behavior"
                  value={settings.messaging.linkPreviewBehavior}
                  options={[
                    { value: 'always', label: 'Always show previews' },
                    { value: 'contacts_only', label: 'Contacts only' },
                    { value: 'never', label: 'Never show previews' },
                  ]}
                  onChange={(v) => updateSection('messaging', { linkPreviewBehavior: v as MessagingSettings['linkPreviewBehavior'] })}
                />
                <SelectRow
                  controlId="messaging.defaultRetentionDays"
                  label="Default message retention"
                  description="Applies to new conversations unless overridden."
                  value={String(settings.messaging.defaultRetentionDays)}
                  options={[
                    { value: '0', label: 'Never delete' },
                    { value: '7', label: '7 days' },
                    { value: '30', label: '30 days' },
                    { value: '90', label: '90 days' },
                    { value: '365', label: '1 year' },
                  ]}
                  onChange={(v) => updateSection('messaging', { defaultRetentionDays: Number(v) })}
                />
                <ToggleRow
                  controlId="messaging.forwardAttribution"
                  label="Forward attribution"
                  description="Show the original sender when forwarding messages."
                  checked={settings.messaging.forwardAttribution}
                  onChange={(v) => updateSection('messaging', { forwardAttribution: v })}
                />
                <SelectRow
                  controlId="messaging.translationDisplay"
                  label="Inline translation display"
                  badge="(device only)"
                  value={devicePrefs.translationDisplay}
                  options={[
                    { value: 'below', label: 'Below original' },
                    { value: 'side', label: 'Side-by-side' },
                    { value: 'off', label: 'Disabled' },
                  ]}
                  onChange={(v) => updateDevicePref({ translationDisplay: v })}
                />

                <SectionSaveBar
                  dirty={dirty.messaging}
                  saving={Boolean(saving.messaging)}
                  onSave={() => void saveSection('messaging')}
                />
              </div>
            )}

            {searchResults === null && activeCategory === 'business' && (
              <div style={{ display: 'flex', flexDirection: 'column', gap: '20px' }}>
                <div>
                  <h4 style={sectionHeadingStyle}>Business Profile & Operating Hours</h4>
                  <p style={{ fontSize: '12px', color: 'var(--text-secondary)', marginBottom: '10px' }}>
                    Customer-facing profile details for {activeWorkspace.displayName}.
                  </p>
                  <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
                    <div
                      style={{
                        padding: '10px 12px',
                        backgroundColor: 'var(--surface-muted)',
                        borderRadius: 'var(--radius-md)',
                        border: '1px solid var(--border-subtle)',
                      }}
                    >
                      <div style={{ fontSize: '11px', color: 'var(--text-muted)' }}>Business Hours</div>
                      <div style={{ fontSize: '13px', fontWeight: 600, color: 'var(--text-primary)' }}>
                        Mon - Fri: 09:00 - 18:00 EST
                      </div>
                    </div>
                  </div>
                </div>

                <div
                  style={{
                    padding: '12px 14px',
                    backgroundColor: 'var(--internal-note-bg)',
                    border: '1px solid var(--internal-note-border)',
                    borderRadius: 'var(--radius-md)',
                  }}
                >
                  <div
                    style={{
                      display: 'flex',
                      alignItems: 'center',
                      gap: '6px',
                      fontSize: '12px',
                      fontWeight: 700,
                      color: 'var(--internal-note-text)',
                      marginBottom: '4px',
                    }}
                  >
                    <Lock size={14} /> INTERNAL TEAM NOTES INVARIANT (SPEC 00 & 07)
                  </div>
                  <p style={{ fontSize: '11px', color: 'var(--internal-note-text)', lineHeight: 1.4 }}>
                    Internal notes are segregated into a dedicated repository, never exposed over customer WebSocket
                    subscriptions, excluded from customer exports, and covered by automated authorization tests.
                  </p>
                </div>

                <div>
                  <h4 style={sectionHeadingStyle}>Team Roles & Permissions (MVP)</h4>
                  <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '8px' }}>
                    {[
                      { role: 'Owner', desc: 'Full ownership, billing, delete workspace' },
                      { role: 'Admin', desc: 'Team invite, configuration, templates' },
                      { role: 'Agent', desc: 'Respond to customers, internal notes' },
                      { role: 'Analyst', desc: 'Read-only operational analytics' },
                    ].map((r) => (
                      <div
                        key={r.role}
                        style={{
                          padding: '8px 10px',
                          backgroundColor: 'var(--surface-muted)',
                          borderRadius: 'var(--radius-md)',
                          border: '1px solid var(--border-subtle)',
                        }}
                      >
                        <div style={{ fontSize: '12px', fontWeight: 700, color: 'var(--accent-primary)' }}>{r.role}</div>
                        <div style={{ fontSize: '11px', color: 'var(--text-secondary)' }}>{r.desc}</div>
                      </div>
                    ))}
                  </div>
                </div>
              </div>
            )}

            {searchResults === null && activeCategory === 'calls' && (
              <div style={{ display: 'flex', flexDirection: 'column', gap: '20px' }}>
                <div data-settings-control-id="calls.microphone">
                  <label htmlFor="calls.microphoneSelect" style={{ fontSize: '13px', fontWeight: 600, color: 'var(--text-primary)', display: 'block', marginBottom: '6px' }}>
                    Microphone Input <span style={{ fontSize: '11px', color: 'var(--text-muted)', fontWeight: 500 }}>(device only)</span>
                  </label>
                  <select
                    id="calls.microphoneSelect"
                    value={devicePrefs.micDevice}
                    onChange={(e) => updateDevicePref({ micDevice: e.target.value })}
                    style={inputStyle}
                  >
                    <option value="default-mic">Default - Integrated Microphone Array</option>
                    <option value="headset-mic">Headset Microphone (Bluetooth)</option>
                  </select>
                </div>

                <div data-settings-control-id="calls.speaker">
                  <label htmlFor="calls.speakerSelect" style={{ fontSize: '13px', fontWeight: 600, color: 'var(--text-primary)', display: 'block', marginBottom: '6px' }}>
                    Speaker Output <span style={{ fontSize: '11px', color: 'var(--text-muted)', fontWeight: 500 }}>(device only)</span>
                  </label>
                  <select
                    id="calls.speakerSelect"
                    value={devicePrefs.speakerDevice}
                    onChange={(e) => updateDevicePref({ speakerDevice: e.target.value })}
                    style={inputStyle}
                  >
                    <option value="default-speaker">Default - Stereo Speakers (Realtek Audio)</option>
                    <option value="headset-speaker">Headset Stereo</option>
                  </select>
                </div>

                <SegmentedControl
                  controlId="calls.callQuality"
                  label="Call quality & bandwidth adaptation"
                  description="Device-only preference; not synced to your account settings."
                  value={devicePrefs.callQuality}
                  options={[
                    { value: 'hd', label: 'HD Adaptive (VP9/Opus)' },
                    { value: 'saver', label: 'Low-Bandwidth Data Saver' },
                  ]}
                  onChange={(v) => updateDevicePref({ callQuality: v })}
                />

                <div
                  style={{
                    padding: '10px 12px',
                    backgroundColor: 'var(--positive-soft)',
                    borderRadius: 'var(--radius-md)',
                    color: 'var(--positive)',
                    fontSize: '12px',
                    display: 'flex',
                    alignItems: 'center',
                    gap: '6px',
                  }}
                >
                  <Shield size={16} /> WebRTC Media is end-to-end encrypted with DTLS-SRTP.
                </div>
              </div>
            )}

            {searchResults === null && activeCategory === 'accessibility' && (
              <div style={{ display: 'flex', flexDirection: 'column', gap: '20px' }}>
                <div data-settings-control-id="accessibility.textScaling">
                  <label
                    htmlFor="accessibility.textScalingRange"
                    style={{ fontSize: '14px', fontWeight: 600, color: 'var(--text-primary)', display: 'block', marginBottom: '2px' }}
                  >
                    Text scaling: {settings.accessibility.textScaling.toFixed(1)}×
                  </label>
                  <div style={{ fontSize: '12px', color: 'var(--text-secondary)', marginBottom: '8px' }}>
                    Scale all interface text. Applies immediately.
                  </div>
                  <input
                    id="accessibility.textScalingRange"
                    type="range"
                    min={0.5}
                    max={3}
                    step={0.1}
                    value={settings.accessibility.textScaling}
                    onChange={(e) => updateSection('accessibility', { textScaling: Number(e.target.value) })}
                    style={{ width: '100%', accentColor: 'var(--accent-primary)' }}
                  />
                </div>
                <ToggleRow
                  controlId="accessibility.highContrast"
                  label="High contrast mode"
                  description="Enforces maximum border and foreground contrast."
                  checked={settings.accessibility.highContrast}
                  onChange={(v) => updateSection('accessibility', { highContrast: v })}
                />
                <ToggleRow
                  controlId="accessibility.reducedMotion"
                  label="Reduced motion"
                  description="Disables surface transitions and animated decorative effects."
                  checked={settings.accessibility.reducedMotion}
                  onChange={(v) => updateSection('accessibility', { reducedMotion: v })}
                />
                <SelectRow
                  controlId="accessibility.screenReaderVerbosity"
                  label="Screen reader verbosity"
                  description="How much contextual detail is announced by assistive technology."
                  value={settings.accessibility.screenReaderVerbosity}
                  options={[
                    { value: 'minimal', label: 'Minimal' },
                    { value: 'normal', label: 'Normal' },
                    { value: 'verbose', label: 'Verbose' },
                  ]}
                  onChange={(v) =>
                    updateSection('accessibility', { screenReaderVerbosity: v as AccessibilitySettings['screenReaderVerbosity'] })
                  }
                />

                <SectionSaveBar
                  dirty={dirty.accessibility}
                  saving={Boolean(saving.accessibility)}
                  onSave={() => void saveSection('accessibility')}
                />
              </div>
            )}

            {searchResults === null && activeCategory === 'language' && (
              <div style={{ display: 'flex', flexDirection: 'column', gap: '20px' }}>
                <SelectRow
                  controlId="language.appLanguage"
                  label="App interface language"
                  value={settings.language.appLanguage}
                  options={APP_LANGUAGE_OPTIONS}
                  onChange={(v) => updateSection('language', { appLanguage: v })}
                />
                <SelectRow
                  controlId="language.translationLanguage"
                  label="Translation language"
                  description="Default target language for message translation."
                  value={settings.language.translationLanguage}
                  options={APP_LANGUAGE_OPTIONS}
                  onChange={(v) => updateSection('language', { translationLanguage: v })}
                />
                <TextFieldRow
                  controlId="language.timezone"
                  label="Timezone"
                  placeholder="UTC"
                  value={settings.language.timezone}
                  onChange={(v) => updateSection('language', { timezone: v })}
                />
                <SegmentedControl
                  controlId="language.clockFormat"
                  label="Clock format"
                  value={settings.language.clockFormat}
                  options={[
                    { value: '12h', label: '12-hour (1:45 PM)' },
                    { value: '24h', label: '24-hour (13:45)' },
                  ]}
                  onChange={(v) => updateSection('language', { clockFormat: v as LanguageRegionSettings['clockFormat'] })}
                />
                <SegmentedControl
                  controlId="language.numberFormat"
                  label="Number format"
                  value={settings.language.numberFormat}
                  options={[
                    { value: 'system', label: 'System default' },
                    { value: 'us', label: 'US (1,234.56)' },
                    { value: 'eu', label: 'EU (1.234,56)' },
                  ]}
                  onChange={(v) => updateSection('language', { numberFormat: v as LanguageRegionSettings['numberFormat'] })}
                />

                <SectionSaveBar
                  dirty={dirty.language}
                  saving={Boolean(saving.language)}
                  onSave={() => {
                    void (async () => {
                      const ok = await saveSection('language');
                      if (ok) {
                        const lang = settings.language.appLanguage;
                        if (lang === 'en' || lang === 'es') i18n.setLocale(lang);
                      }
                    })();
                  }}
                />
              </div>
            )}

{searchResults === null && activeCategory === 'data' && (
              <div style={{ display: 'flex', flexDirection: 'column', gap: '20px' }}>
                <div data-settings-control-id="data.export">
                  <h4 style={sectionHeadingStyle}>Export Account Data</h4>
                  <p style={{ fontSize: '12px', color: 'var(--text-secondary)', marginBottom: '10px' }}>
                    Download a portable JSON archive of your personal workspace, contacts, and saved vault items.
                  </p>
                  <button
                    type="button"
                    onClick={async () => {
                      await onExportData();
                      showSaveStatus({ type: 'success', message: 'Data export generated and downloaded' });
                    }}
                    style={{
                      padding: '8px 14px',
                      backgroundColor: 'var(--surface-muted)',
                      border: '1px solid var(--border-subtle)',
                      color: 'var(--text-primary)',
                      borderRadius: 'var(--radius-md)',
                      fontSize: '13px',
                      fontWeight: 600,
                      cursor: 'pointer',
                    }}
                  >
                    Request Data Export
                  </button>
                </div>

                <div data-settings-control-id="data.backup" style={{ paddingTop: '16px', borderTop: '1px solid var(--border-subtle)' }}>
                  <h4 style={sectionHeadingStyle}>Encrypted Backup & Restore</h4>
                  <p style={{ fontSize: '12px', color: 'var(--text-secondary)', marginBottom: '10px' }}>
                    Create a fully encrypted backup of all your data (conversations, messages, vault, settings, keys).
                    Protected by your recovery passphrase — only you can decrypt it.
                  </p>
                  <div style={{ display: 'flex', flexDirection: 'column', gap: '12px' }}>
                    <button
                      type="button"
                      onClick={async () => {
                        const passphrase = prompt('Enter a strong recovery passphrase (min 12 chars):\n\n⚠️ Save this passphrase! Without it, the backup cannot be restored.');
                        if (!passphrase || passphrase.length < 12) {
                          showSaveStatus({ type: 'error', message: 'Passphrase must be at least 12 characters' });
                          return;
                        }
                        try {
                          const token = await getAccessToken();
                          const res = await fetch(apiUrl('/v1/portability/backup'), {
                            method: 'POST',
                            headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: `Bearer ${token}` } : {}) },
                            body: JSON.stringify({ passphrase }),
                          });
                          if (!res.ok) {
                            const err = await res.json();
                            throw new Error(err.error?.message || 'Backup failed');
                          }
                          const { data: backup } = await res.json();
                          const blob = new Blob([JSON.stringify(backup, null, 2)], { type: 'application/json' });
                          const url = URL.createObjectURL(blob);
                          const a = document.createElement('a');
                          a.href = url;
                          a.download = `orbit-backup-${new Date().toISOString().split('T')[0]}.orbit-backup`;
                          a.click();
                          URL.revokeObjectURL(url);
                          showSaveStatus({ type: 'success', message: 'Encrypted backup downloaded as .orbit-backup file' });
                        } catch (err) {
                          showSaveStatus({ type: 'error', message: err instanceof Error ? err.message : 'Backup failed' });
                        }
                      }}
                      style={{
                        padding: '10px 14px',
                        backgroundColor: 'var(--surface-muted)',
                        border: '1px solid var(--border-subtle)',
                        color: 'var(--text-primary)',
                        borderRadius: 'var(--radius-md)',
                        fontSize: '13px',
                        fontWeight: 600,
                        cursor: 'pointer',
                        display: 'flex',
                        alignItems: 'center',
                        justifyContent: 'center',
                        gap: '8px',
                      }}
                    >
                      <Database size={16} /> Create Encrypted Backup
                    </button>

                    <div style={{ display: 'flex', gap: '8px', flexWrap: 'wrap' }}>
                      <input
                        type="file"
                        id="backup-restore-file"
                        accept=".orbit-backup,application/json"
                        style={{ display: 'none' }}
                        onChange={async (e) => {
                          const file = e.target.files?.[0];
                          if (!file) return;
                          const passphrase = prompt('Enter the recovery passphrase to decrypt this backup:');
                          if (!passphrase || passphrase.length < 12) {
                            showSaveStatus({ type: 'error', message: 'Passphrase must be at least 12 characters' });
                            (e.target as HTMLInputElement).value = '';
                            return;
                          }
                          try {
                            const text = await file.text();
                            const backup = JSON.parse(text);
                            const token = await getAccessToken();
                            const res = await fetch(apiUrl('/v1/portability/restore'), {
                              method: 'POST',
                              headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: `Bearer ${token}` } : {}) },
                              body: JSON.stringify({ backup, passphrase }),
                            });
                            if (!res.ok) {
                              const err = await res.json();
                              throw new Error(err.error?.message || 'Restore failed');
                            }
                            const { data } = await res.json();
                            showSaveStatus({
                              type: 'success',
                              message: `Restore completed: ${data.restoredConversations} conversations, ${data.restoredMessages} messages, ${data.restoredVaultCollections} vault collections`,
                            });
                            setTimeout(() => window.location.reload(), 1500);
                          } catch (err) {
                            showSaveStatus({ type: 'error', message: err instanceof Error ? err.message : 'Restore failed' });
                          }
                          (e.target as HTMLInputElement).value = '';
                        }}
                      />
                      <label
                        htmlFor="backup-restore-file"
                        style={{
                          padding: '10px 14px',
                          backgroundColor: 'var(--surface-muted)',
                          border: '1px solid var(--border-subtle)',
                          color: 'var(--text-primary)',
                          borderRadius: 'var(--radius-md)',
                          fontSize: '13px',
                          fontWeight: 600,
                          cursor: 'pointer',
                          display: 'flex',
                          alignItems: 'center',
                          justifyContent: 'center',
                          gap: '8px',
                        }}
                      >
                        <Database size={16} /> Restore from Backup
                      </label>
                    </div>
                  </div>
                </div>

                <div data-settings-control-id="data.delete" style={{ paddingTop: '16px', borderTop: '1px solid var(--border-subtle)' }}>
                  <h4 style={{ ...sectionHeadingStyle, color: 'var(--danger)' }}>Danger Zone: Request Account Deletion</h4>
                  <p style={{ fontSize: '12px', color: 'var(--text-secondary)', marginBottom: '10px' }}>
                    Revokes all active sessions immediately and enqueues permanent deletion following the 30-day
                    retention schedule.
                  </p>
                  <button
                    type="button"
                    onClick={async () => {
                      if (confirm('Are you sure you want to request permanent account deletion? This will revoke all sessions.')) {
                        await onRequestAccountDeletion();
                        showSaveStatus({ type: 'success', message: 'Account deletion request registered' });
                      }
                    }}
                    style={{
                      padding: '8px 14px',
                      backgroundColor: 'var(--danger-soft)',
                      border: '1px solid var(--danger)',
                      color: 'var(--danger)',
                      borderRadius: 'var(--radius-md)',
                      fontSize: '13px',
                      fontWeight: 600,
                      cursor: 'pointer',
                    }}
                  >
                    Delete Account
                  </button>
                </div>
              </div>
            )}

            {searchResults === null && activeCategory === 'help' && (
              <div>
                <h3 style={{ fontSize: '15px', fontWeight: 700, color: 'var(--text-primary)', marginBottom: '6px' }}>
                  Orbit Chat Platform — Build v0.1.0
                </h3>
                <p style={{ fontSize: '13px', color: 'var(--text-secondary)', lineHeight: 1.5 }}>
                  Calm, fast, private, and human digital workspace. Implemented strictly in accordance with
                  specification modules 00 through 20.
                </p>
              </div>
            )}

            {searchResults === null && activeCategory === 'legal' && (
              <div style={{ display: 'flex', flexDirection: 'column', gap: '20px' }}>
                <h3 style={{ fontSize: '15px', fontWeight: 700, color: 'var(--text-primary)', marginBottom: '8px' }}>
                  Legal Documents
                </h3>
                <div style={{ fontSize: '12px', color: 'var(--text-secondary)', marginBottom: '16px' }}>
                  Current version agreements for your workspace
                </div>
                <div style={{ display: 'flex', flexDirection: 'column', gap: '12px' }}>
                  {['tos', 'privacy', 'aup'].map((type) => {
                    const doc = legalDocumentsDisplay[type];
                    return (
                      <div
                        key={type}
                        style={{
                          padding: '12px 16px',
                          borderRadius: '10px',
                          border: '1px solid var(--border-subtle)',
                          backgroundColor: 'var(--surface-muted)',
                          marginBottom: '8px',
                        }}
                      >
                        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '4px' }}>
                          <strong style={{ fontSize: '13px', color: 'var(--text-primary)' }}>{type.toUpperCase()}</strong>
                          {doc?.requiredConsent && (
                            <span style={{
                              fontSize: '10px',
                              fontWeight: 700,
                              padding: '1px 6px',
                              borderRadius: '4px',
                              backgroundColor: 'var(--surface-sunken)',
                              color: 'var(--text-secondary)',
                            }}>
                              Consent required
                            </span>
                          )}
                        </div>
                        <div style={{ fontSize: '12px', color: 'var(--text-secondary)' }}>
                          Effective: {doc?.effectiveAt ? new Date(doc.effectiveAt).toLocaleDateString() : 'N/A'}
                        </div>
                        {!doc && (
                          <span style={{ fontSize: '11px', color: 'var(--text-tertiary)' }}>No version available</span>
                        )}
                        {doc && doc.contentMarkdown && (
                          <div
                            style={{
                              marginTop: '8px',
                              fontSize: '12px',
                              color: 'var(--text-primary)',
                              whiteSpace: 'pre-wrap',
                            }}
                          >
                            {doc.contentMarkdown.substring(0, 200)}...
                          </div>
                        )}
{doc && !doc.requiredConsent && (
                          <button
                            style={{
                              marginTop: '8px',
                              padding: '6px 12px',
                              borderRadius: '6px',
                              background: 'var(--primary)',
                              color: '#fff',
                              border: 'none',
                              fontSize: '12px',
                              fontWeight: 600,
                              cursor: 'pointer',
                            }}
                            onClick={() => {
                              void handleLegalConsent(doc);
                            }}
                          >
                            I Agree
                          </button>
                        )}
                      </div>
                    );
                  })}
                </div>
              </div>
            )}

            {searchResults === null && activeCategory === 'data' && (
              <div style={{ display: 'flex', flexDirection: 'column', gap: '20px' }}>
                <h3 style={{ fontSize: '15px', fontWeight: 700, color: 'var(--text-primary)', marginBottom: '8px' }}>
                  Data & Storage
                </h3>
                <p style={{ fontSize: '12px', color: 'var(--text-secondary)', marginBottom: '16px' }}>
                  Manage your data exports and submission requests
                </p>
                {/* Export Section (existing) */}
                <div data-settings-control-id="data.export">
                  <h4 style={sectionHeadingStyle}>Export Account Data</h4>
                  <p style={{ fontSize: '12px', color: 'var(--text-secondary)', marginBottom: '10px' }}>
                    Download a portable JSON archive of your personal workspace, contacts, and saved vault items.
                  </p>
                  <button
                    type="button"
                    onClick={async () => {
                      await onExportData();
                      showSaveStatus({ type: 'success', message: 'Data export generated and downloaded' });
                    }}
                    style={{
                      padding: '8px 14px',
                      backgroundColor: 'var(--surface-muted)',
                      border: '1px solid var(--border-subtle)',
                      color: 'var(--text-primary)',
                      borderRadius: 'var(--radius-md)',
                      fontSize: '13px',
                      fontWeight: 600,
                      cursor: 'pointer',
                    }}
                  >
                    Request Data Export
                  </button>
                </div>

                {/* Submit Data Request Section (new) */}
                <div data-settings-control-id="data.request" style={{ paddingTop: '16px', borderTop: '1px solid var(--border-subtle)' }}>
                  <h4 style={{ ...sectionHeadingStyle, color: 'var(--primary)' }}>Submit Data Request</h4>
                  <p style={{ fontSize: '12px', color: 'var(--text-secondary)', marginBottom: '12px' }}>
                    Request access, correction, deletion, or consent withdrawal for your data.
                  </p>
                  <select
                    style={inputStyle}
                    onChange={(e) => setRequestType(e.target.value as typeof requestType)}
                  >
                    <option value="access">Access personal data</option>
                    <option value="correction">Request data correction</option>
                    <option value="deletion">Request data deletion</option>
                    <option value="consent_withdrawal">Withdraw consent</option>
                    <option value="appeal">Submit appeal</option>
                  </select>
                  <textarea
                    style={inputStyle}
                    placeholder="Describe the scope of your request..."
                    onChange={(e) => setRequestNotes(e.target.value)}
                    rows={3}
                  ></textarea>
                  <div style={{ display: 'flex', gap: '8px', marginTop: '16px' }}>
                    <button
                      type="button"
                      onClick={async () => {
                        await submitDataRequest();
                      }}
                      style={{
                        padding: '8px 16px',
                        backgroundColor: 'var(--primary)',
                        color: '#fff',
                        border: 'none',
                        borderRadius: '8px',
                        fontSize: '13px',
                        fontWeight: 600,
                        cursor: 'pointer',
                      }}
                    >
                      Submit Request
                    </button>
                    <button
                      type="button"
                      onClick={() => setRequestNotes('')}
                      style={{
                        padding: '8px 16px',
                        backgroundColor: 'var(--surface-muted)',
                        color: 'var(--text-primary)',
                        border: '1px solid var(--border-subtle)',
                        borderRadius: '8px',
                        fontSize: '13px',
                        fontWeight: 600,
                        cursor: 'pointer',
                      }}
                    >
                      Clear
                    </button>
                  </div>
                </div>
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
};
