import { z } from 'zod';

/**
 * Settings schema (Spec 09 — Settings & Information Architecture).
 * Sections A–L with scope: account | identity | device | chat.
 */

export const SettingScopeSchema = z.enum(['account', 'identity', 'device', 'chat']);
export type SettingScope = z.infer<typeof SettingScopeSchema>;

export const AppearanceSettingsSchema = z.object({
  theme: z.enum(['light', 'dark', 'system']).default('system'),
  density: z.enum(['compact', 'standard', 'comfortable']).default('standard'),
  fontSize: z.enum(['sm', 'base', 'lg']).default('base'),
  timestampFormat: z.enum(['12h', '24h']).default('24h'),
  showAvatars: z.boolean().default(true),
  reduceMotion: z.boolean().default(false),
});
export type AppearanceSettings = z.infer<typeof AppearanceSettingsSchema>;

export const PrivacySettingsSchema = z.object({
  lastActiveVisibility: z.enum(['everyone', 'contacts', 'nobody']).default('contacts'),
  readReceipts: z.boolean().default(true),
  typingIndicators: z.boolean().default(true),
  profilePhotoVisibility: z.enum(['everyone', 'contacts', 'nobody']).default('contacts'),
  bioVisibility: z.enum(['everyone', 'contacts', 'nobody']).default('contacts'),
  groupInvitePermission: z.enum(['everyone', 'contacts', 'nobody']).default('contacts'),
  linkPreviews: z.boolean().default(true),
  hideNotificationPreviews: z.boolean().default(true),
  defaultMessageExpiryDays: z.number().int().min(0).max(365).nullable().default(null),
  // Spec 14 — restrict messaging to accepted contacts; block unknown callers.
  restricted: z.boolean().default(false),
  restrictUnknownCalls: z.boolean().default(false),
  autoDownloadMedia: z.boolean().default(true),
});
export type PrivacySettings = z.infer<typeof PrivacySettingsSchema>;

export const NotificationSettingsSchema = z.object({
  globalEnabled: z.boolean().default(true),
  previewDetail: z.enum(['full', 'sender_only', 'hidden']).default('sender_only'),
  soundEnabled: z.boolean().default(false),
  vibrationEnabled: z.boolean().default(true),
  quietHoursStart: z.string().regex(/^\d{2}:\d{2}$/).nullable().default(null),
  quietHoursEnd: z.string().regex(/^\d{2}:\d{2}$/).nullable().default(null),
  mentionsOnly: z.boolean().default(false),
});
export type NotificationSettings = z.infer<typeof NotificationSettingsSchema>;

export const MessagingSettingsSchema = z.object({
  enterToSend: z.boolean().default(true),
  mediaAutoplay: z.boolean().default(false),
  linkPreviewBehavior: z.enum(['always', 'contacts_only', 'never']).default('contacts_only'),
  defaultRetentionDays: z.number().int().min(0).max(365).default(365),
  forwardAttribution: z.boolean().default(true),
});
export type MessagingSettings = z.infer<typeof MessagingSettingsSchema>;

export const AccessibilitySettingsSchema = z.object({
  textScaling: z.number().min(0.5).max(3).default(1),
  highContrast: z.boolean().default(false),
  reducedMotion: z.boolean().default(false),
  screenReaderVerbosity: z.enum(['minimal', 'normal', 'verbose']).default('normal'),
});
export type AccessibilitySettings = z.infer<typeof AccessibilitySettingsSchema>;

export const LanguageRegionSettingsSchema = z.object({
  appLanguage: z.string().default('en'),
  translationLanguage: z.string().default('en'),
  timezone: z.string().default('UTC'),
  clockFormat: z.enum(['12h', '24h']).default('24h'),
  numberFormat: z.enum(['system', 'us', 'eu']).default('system'),
});
export type LanguageRegionSettings = z.infer<typeof LanguageRegionSettingsSchema>;

export const ALL_SETTINGS_SECTIONS = [
  'appearance',
  'privacy',
  'notifications',
  'messaging',
  'accessibility',
  'language',
] as const;

export type SettingsSection = (typeof ALL_SETTINGS_SECTIONS)[number];

export const SECTION_SCOPES: Record<SettingsSection, SettingScope> = {
  appearance: 'account',
  privacy: 'identity',
  notifications: 'device',
  messaging: 'account',
  accessibility: 'account',
  language: 'account',
};

export const SECTION_SCHEMAS = {
  appearance: AppearanceSettingsSchema,
  privacy: PrivacySettingsSchema,
  notifications: NotificationSettingsSchema,
  messaging: MessagingSettingsSchema,
  accessibility: AccessibilitySettingsSchema,
  language: LanguageRegionSettingsSchema,
} as const;

export function isSettingsSection(value: string): value is SettingsSection {
  return (ALL_SETTINGS_SECTIONS as readonly string[]).includes(value);
}

export function validateSettingsUpdate(
  section: string,
  payload: unknown
): { ok: true; data: unknown } | { ok: false; error: string } {
  if (!isSettingsSection(section)) {
    return { ok: false, error: `Unknown settings section: ${section}` };
  }
  const result = SECTION_SCHEMAS[section].safeParse(payload);
  if (!result.success) {
    return { ok: false, error: result.error.issues.map((i) => `${i.path.join('.')}: ${i.message}`).join('; ') };
  }
  return { ok: true, data: result.data };
}
