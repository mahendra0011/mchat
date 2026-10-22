import React from 'react';
import { en, es, type TranslationCatalog } from '@orbit/localization';

/**
 * App-level i18n provider (Spec 15).
 *
 * Translation catalogs live in @orbit/localization (workspace package — read-only
 * here). Keys resolve from the active catalog first, then from the local FALLBACKS
 * table for strings that are not yet present in the shipped catalogs.
 */
export type Locale = 'en' | 'es';

export const AVAILABLE_LOCALES: Locale[] = ['en', 'es'];

const CATALOGS: Record<Locale, TranslationCatalog> = { en, es };

/** RTL language codes — honored as soon as a catalog for them ships. */
const RTL_LOCALES = ['ar', 'he', 'fa', 'ur'];

const STORAGE_KEY = 'orbit_locale';

/**
 * English fallbacks for keys that exist in the UI but are not yet in the
 * @orbit/localization catalogs (packages/* is read-only from this app).
 */
const FALLBACKS: Record<string, string> = {
  'labels.reply': 'Reply',
  'labels.editMessage': 'Edit message',
  'labels.deleteMessage': 'Delete message',
  'labels.saveEdit': 'Save edit',
  'labels.cancelEdit': 'Cancel edit',
  'messages.jumpToLatest': 'Jump to latest',
  'messages.emptyTitle': 'No messages yet',
  'messages.emptyHint': 'Send a message to start communicating securely with {name}.',
  'compose.title': 'New conversation',
  'compose.searchPlaceholder': 'Search people and handles',
  'compose.noMatches': 'No matching contacts yet',
  'compose.createBusiness': 'Create business workspace',
  'notifications.title': 'Notifications',
  'notifications.markAllRead': 'Mark all read',
  'notifications.empty': 'No notifications yet',
  'studio.title': 'Studio settings',
  'studio.showAvatars': 'Show avatars',
  'studio.density': 'Density',
  'studio.bubbleRadius': 'Bubble shape',
  'studio.sound': 'Conversation sounds',
  'call.unavailable': 'Call service unavailable.',
  'call.mediaDenied': 'Camera or microphone access was denied.',
  'upload.failed': 'Upload failed. Try again.',
  'upload.cancel': 'Cancel upload',
  'upload.retry': 'Retry upload',
  'delete.forMe': 'Delete for me',
  'delete.forEveryone': 'Delete for everyone',
  'delete.windowNote': 'Deleting for everyone is only available within 15 minutes of sending.',
  'errors.editFailed': "Couldn't save changes.",
  'errors.deleteFailed': "Couldn't delete this message.",
  'common.saving': 'Saving…',
  'common.close': 'Close',
  'common.file': 'File',
  'common.deletedMessage': 'This message was deleted',
  'delete.title': 'Delete message',
  'delete.body.self': 'This message will be deleted for you. Others will still see it.',
  'delete.body.admin':
    'You can delete this message for everyone, or only for yourself. This cannot be undone.',
  'delete.body.expired':
    'The edit window has passed, so this message can only be deleted for yourself.',
  // ---- Scheduling (Wave B) ----
  'schedule.title': 'Schedule send',
  'schedule.tonight': 'Tonight 6:00 PM',
  'schedule.tomorrow': 'Tomorrow 9:00 AM',
  'schedule.custom': 'Custom date & time',
  'schedule.schedule': 'Schedule send',
  'schedule.scheduledFor': 'Scheduled for',
  'schedule.cancel': 'Cancel',
  'schedule.empty': 'No scheduled messages',
  'schedule.success': 'Message scheduled',
  'schedule.failed': 'Could not schedule message',
  'schedule.cancelFailed': 'Could not cancel scheduled message',
  'schedule.pickTime': 'Pick a date and time',
  // ---- Saved replies (Wave B) ----
  'savedReplies.title': 'Saved replies',
  'savedReplies.search': 'Search saved replies…',
  'savedReplies.empty': 'No saved replies yet',
  'savedReplies.save': 'Save draft as reply',
  'savedReplies.name': 'Title',
  'savedReplies.create': 'Save reply',
  'savedReplies.created': 'Saved reply created',
  'savedReplies.failed': 'Could not save reply',
  // ---- Translation (Wave B) ----
  'translation.unavailable': 'Translation unavailable',
  'translation.unavailableNote': 'Translation is not available on this server.',
  'translation.dismiss': 'Dismiss',
  // ---- Intent mode (Wave B) ----
  'intent.personal': 'Personal',
  'intent.business': 'Business',
  'intent.toggleFailed': 'Could not update intent',
  // ---- Workflow actions (Wave B) ----
  'workflow.approve': 'Approve',
  'workflow.reject': 'Reject',
  'workflow.start': 'Start',
  'workflow.complete': 'Complete',
  'workflow.toggle': 'Toggle',
  'workflow.actionFailed': 'Could not run workflow action',
  // ---- Timeline (Wave B) ----
  'timeline.title': 'Timeline',
  'timeline.empty': 'No activity yet',
  'timeline.message': 'Message',
  'timeline.edited': 'edited',
  'timeline.deleted': 'deleted',
  'timeline.assigned': 'Assigned',
  'timeline.unassigned': 'Unassigned',
  'timeline.workflow': 'Workflow',
  'timeline.call': 'Call',
  // ---- Privacy receipt (Wave B) ----
  'receipt.e2eeTooltip': 'End-to-end encrypted • Delivered {time} • Server sequence #{seq}',
  'receipt.deletedAt': 'Deleted {time}',
  // ---- Presence (Wave B) ----
  'presence.online': 'Online',
  'presence.away': 'Away',
  'presence.offline': 'Offline',
  'presence.lastSeen': 'Last seen {time}',
  'presence.offlineHint': "They're offline — messages will be delivered when they return",
  // ---- Privacy presets (Wave B) ----
  'privacyPreset.title': 'Privacy presets',
  'privacyPreset.high': 'Maximum Privacy',
  'privacyPreset.balanced': 'Standard Balanced',
  'privacyPreset.collaborative': 'Extended Archive',
  'privacyPreset.applied': 'Applied {preset}',
  'privacyPreset.failed': 'Could not apply preset',
  // ---- Cross-device handoff (Wave B) ----
  'handoff.title': 'Cross-device handoff',
  'handoff.generate': 'Generate handoff code',
  'handoff.copy': 'Copy code',
  'handoff.copied': 'Copied!',
  'handoff.note': 'Open Orbit on your mobile device and paste this code to continue this conversation.',
  // ---- Business analytics (Wave B) ----
  'analytics.title': 'Business analytics',
  'analytics.total': 'Total conversations',
  'analytics.open': 'Open',
  'analytics.resolved': 'Resolved',
  'analytics.messagesPerDay': 'Messages per day (last 7 days)',
  'analytics.avgFirstResponse': 'Avg first response',
  'analytics.noData': 'No analytics data yet',
  'analytics.minutes': 'min',
  // ---- Semantic search (Wave B) ----
  'search.results': 'Message results',
  'search.noResults': 'No matching messages',
  'search.open': 'Open',
  // ---- Onboarding (Spec 21) ----
  'onboarding.welcome': 'Welcome to Orbit Chat',
  'onboarding.stepChooseMethod': 'Choose how to sign in',
  'onboarding.chooseSignInMethod': 'Choose your sign-in method',
  'onboarding.chooseSignInMethodDesc': 'Each method has different recovery options. You can add more methods later in Settings.',
  'onboarding.email': 'Email',
  'onboarding.emailDesc': 'Sign in with email and password',
  'onboarding.emailRecovery': 'Recovery: email link to verified address',
  'onboarding.passkey': 'Passkey (WebAuthn)',
  'onboarding.passkeyDesc': 'Use device biometrics or security key',
  'onboarding.passkeyRecovery': 'Recovery: device sync (iCloud/Google Password Manager)',
  'onboarding.phone': 'Phone / SMS',
  'onboarding.phoneDesc': 'Sign in with phone number and OTP',
  'onboarding.phoneRecovery': 'Recovery: SMS code to verified number',
  'onboarding.chooseHandle': 'Choose Your Unique Handle',
  'onboarding.passkeyRegistration': 'Create your passkey',
  'onboarding.passkeyRegistrationDesc': 'Use your device biometrics (Face ID, Touch ID, Windows Hello) or a security key to create a phishing-resistant credential.',
  'onboarding.createPasskey': 'Create Passkey',
  'onboarding.otpSent': 'Check your phone',
  'onboarding.otpSentDesc': 'We sent a 6-digit code to {handle}. Enter it below to verify.',
  'onboarding.verify': 'Verify',
  'onboarding.choosePrivacyPreset': 'Choose Your Privacy Preset',
  'onboarding.choosePrivacyPresetDesc': 'Select how Orbit handles message retention, telemetry, and link previews on this device.',
  'onboarding.presetHigh': 'Maximum Privacy (Recommended)',
  'onboarding.presetHighDesc': '7-day disappearing messages by default. Generic push notification previews. Zero product telemetry.',
  'onboarding.presetBalanced': 'Standard Balanced',
  'onboarding.presetBalancedDesc': '30-day message history. Sender name in push notifications. Anonymous error telemetry.',
  'onboarding.presetCollaborative': 'Extended Archive',
  'onboarding.presetCollaborativeDesc': '90-day search history. Context Vault synchronization. Full notification previews.',
  'onboarding.profileSetup': 'Personalize your profile',
  'onboarding.profileSetupDesc': 'Add a display name and avatar. These help contacts recognize you. Both are optional.',
  'onboarding.displayName': 'Display name',
  'onboarding.displayNamePlaceholder': 'Alex Chen',
  'onboarding.avatar': 'Avatar',
  'onboarding.avatarDesc': 'Upload a photo or pick from defaults later. Max 5MB, JPG/PNG/WebP.',
  'onboarding.chooseFile': 'Choose file',
  'onboarding.allSet': 'You are all set, @{handle}!',
  'onboarding.allSetDesc': 'Your personal identity is activated. You can now start end-to-end encrypted chats, create shareable links, or explore business workspace features.',
  'onboarding.startMessaging': 'Start Messaging',
  'common.optional': 'optional',
  'common.back': 'Back',
  'common.next': 'Next',
  'common.search': 'Search',
  'common.copy': 'Copy',
  'common.copied': 'Copied!',
  // ---- Contact Discovery (Spec 21) ----
  'discovery.title': 'Find People & Connections',
  'discovery.subtitle': 'Anti-enumeration search, revocable invite links, and request inbox',
  'discovery.tabSearch': 'Find by Handle',
  'discovery.tabRequests': 'Message Requests',
  'discovery.tabContacts': 'Find Contacts',
  'discovery.tabShare': 'Invite & QR',
  'discovery.searchPlaceholder': 'Search by exact handle (e.g. maya or acme_support)...',
  'discovery.connect': 'Connect',
  'discovery.requestsDesc': 'Messages from unknown contacts remain separated in message requests until accepted.',
  'discovery.noRequests': 'No pending message requests.',
  'discovery.accept': 'Accept',
  'discovery.ignore': 'Ignore',
  'discovery.block': 'Block',
  'discovery.contactsDesc': 'Find Orbit users from your device contacts. We only match hashed identifiers — your address book never leaves your device.',
  'discovery.contactsPrivacyNote': 'We only match hashes; your address book never leaves your device.',
  'discovery.findContacts': 'Find contacts',
  'discovery.findingContacts': 'Finding contacts…',
  'discovery.contactsNotSupported': 'Contact Picker API not available in this browser.',
  'discovery.contactsNotSupportedBtn': 'Not supported in this browser',
  'discovery.contactsNotSupportedDesc': 'You can still search for people by handle using the "Find by Handle" tab.',
  'discovery.contactsPermissionDenied': 'Permission to access contacts was denied. You can search by handle instead.',
  'discovery.contactsError': 'Failed to match contacts. Please try again or search by handle.',
  'discovery.noContactsMatched': 'No Orbit users found in your contacts.',
  'discovery.matchedContacts': 'Found {count} contact(s) on Orbit',
  'discovery.invite': 'Invite',
  'discovery.alreadyConnected': 'Already connected',
  'discovery.shareDesc': 'Share your short-lived revocable invite link or QR code without revealing personal phone numbers or email addresses.',
  'discovery.qrAlt': 'QR code for invite link',
  'discovery.qrDesc': 'Scan to connect via verified E2EE key exchange',
  'discovery.inviteLinkLabel': 'Shareable Invite Link (Expires in 7 days)',
  'discovery.noUserFound': 'No user found with handle "@{handle}". Uniform responses are enforced to protect user identity enumeration.',
  // ---- Business Onboarding (Spec 21) ----
  'business.workspaceName': 'Workspace name',
  'business.workspaceNamePlaceholder': 'Acme Studio Support',
  'business.handle': 'Handle',
  'business.handlePlaceholder': 'acme_support',
  'business.category': 'Category',
  'business.categoryPlaceholder': 'Design & Engineering Services',
  'business.bio': 'Bio',
  'business.hours': 'Business hours',
  'business.hoursPlaceholder': 'Mon-Fri 9:00-18:00',
  'business.website': 'Website',
  'business.errorName': 'Workspace name must be at least 2 characters.',
  'business.errorHandle': 'Handle must be 3-30 letters, numbers or underscores.',
  'business.errorCategory': 'Category must be at least 2 characters.',
  'business.errorCreateFailed': 'Workspace creation failed. The handle may already be taken.',
  'business.preview': 'Preview',
  'business.confirmCreate': 'Confirm & Create',
  'business.previewTitle': 'Review before creating',
  'business.previewDesc': 'Please review the customer-facing identity, team permissions, privacy notice, and notification settings below.',
  'business.customerFacingIdentity': 'Customer-facing identity',
  'business.teamPermissions': 'Team roles & permissions preview',
  'business.customerPrivacyNotice': 'Customer privacy notice',
  'business.privacyNoticeText': 'This workspace will be visible to customers. The following information will be public: workspace name, handle, category, bio, business hours, and website. Internal notes are never visible to customers.',
  'business.privacyNoticeFull': 'Customer Privacy Notice:\n- Your business profile (name, handle, category, bio, hours, website) is visible to customers.\n- Customer messages are end-to-end encrypted.\n- Internal team notes are NEVER shared with customers.\n- Customer data is processed per your workspace retention settings.\n- Customers can request data export/deletion per applicable law.',
  'business.notificationOwnership': 'Notification ownership',
  'business.notificationOwnershipDesc': 'Choose who receives notifications for new customer messages.',
  'business.notifAllAdmins': 'All admins & owner (recommended)',
  'business.notifAssignedOnly': 'Only assigned agent',
  'business.notifCustom': 'Custom routing (configure later)',
  'business.ackRequired': 'Acknowledgment required',
  'business.ackConfirmed': 'Acknowledged',
  'business.ackDesc': 'I have reviewed the customer-facing identity, team permissions, privacy notice, and notification settings.',
  // ---- Security & Recovery (Spec 21) ----
  'security.addPasskey': 'Add another passkey',
  'security.addingPasskey': 'Adding…',
  'security.passkeyRecovery': 'Passkey recovery options',
  'security.verifiedEmail': 'Verified email',
  'security.verified': 'Verified',
  'security.emailRecoveryDesc': 'If you lose all passkeys, you can recover access via OTP sent to this verified email address, followed by step-up authentication.',
  'security.changeEmail': 'Change email',
  'security.changePhone': 'Change phone',
  'security.notifyHandleChange': 'Notify on handle change',
  'security.notifyHandleChangeDesc': 'Receive an email notification when your handle is changed.',
  'security.handleRateLimitNote': 'Handle changes are rate-limited. Frequent changes may be temporarily blocked to prevent takeover attempts.',
  'security.transferOwnership': 'Transfer ownership',
};

const resolveKey = (catalog: TranslationCatalog, key: string): string | undefined => {
  const parts = key.split('.');
  let node: unknown = catalog;
  for (const part of parts) {
    if (typeof node !== 'object' || node === null) return undefined;
    node = (node as Record<string, unknown>)[part];
  }
  return typeof node === 'string' ? node : undefined;
};

const interpolate = (template: string, params?: Record<string, string | number>): string => {
  if (!params) return template;
  return template.replace(/\{(\w+)\}/g, (match, name: string) => {
    const value = params[name];
    return value === undefined ? match : String(value);
  });
};

export type TFunction = (key: string, params?: Record<string, string | number>) => string;

export interface I18nContextValue {
  locale: Locale;
  setLocale: (locale: Locale) => void;
  t: TFunction;
}

const I18nContext = React.createContext<I18nContextValue | null>(null);

const isRtl = (locale: string): boolean =>
  RTL_LOCALES.includes(locale.toLowerCase().split('-')[0] ?? '');

const readStoredLocale = (): Locale => {
  try {
    const stored = window.localStorage.getItem(STORAGE_KEY);
    if (stored && (stored === 'en' || stored === 'es')) return stored;
  } catch {
    // Storage may be unavailable (private mode) — default locale is fine.
  }
  return 'en';
};

export const I18nProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const [locale, setLocaleState] = React.useState<Locale>(readStoredLocale);

  const setLocale = React.useCallback((next: Locale) => {
    setLocaleState(next);
    try {
      window.localStorage.setItem(STORAGE_KEY, next);
    } catch {
      // Persisting the locale is best-effort.
    }
  }, []);

  React.useEffect(() => {
    document.documentElement.lang = locale;
    document.documentElement.dir = isRtl(locale) ? 'rtl' : 'ltr';
  }, [locale]);

  const t = React.useCallback<TFunction>(
    (key, params) => {
      const fromCatalog = resolveKey(CATALOGS[locale], key);
      if (fromCatalog !== undefined) return interpolate(fromCatalog, params);
      const fromEn = resolveKey(en, key);
      if (fromEn !== undefined) return interpolate(fromEn, params);
      const fallback = FALLBACKS[key];
      if (fallback !== undefined) return interpolate(fallback, params);
      return key.split('.').pop() ?? key;
    },
    [locale]
  );

  const value = React.useMemo<I18nContextValue>(() => ({ locale, setLocale, t }), [locale, setLocale, t]);

  return <I18nContext.Provider value={value}>{children}</I18nContext.Provider>;
};

export const useI18n = (): I18nContextValue => {
  const ctx = React.useContext(I18nContext);
  if (!ctx) {
    throw new Error('useI18n must be used within an I18nProvider');
  }
  return ctx;
};
