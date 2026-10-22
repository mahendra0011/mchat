import React from 'react';
import { ShieldCheck, EyeOff, Users, Lock, type LucideIcon } from 'lucide-react';
import { type PrivacySettings } from '@orbit/schemas';
import { apiFetch } from '../lib/apiFetch.js';
import { useI18n } from '../i18n-context.js';

type PresetId = 'high' | 'balanced' | 'collaborative';

interface PresetDef {
  id: PresetId;
  labelKey: string;
  icon: LucideIcon;
  values: Partial<PrivacySettings>;
}

/**
 * Preset values mirror OnboardingModal's three privacy presets. OnboardingModal
 * only exposes labels + prose (no machine-readable field values), so these are
 * derived from those descriptions and the PrivacySettings schema.
 */
const PRESETS: PresetDef[] = [
  {
    id: 'high',
    labelKey: 'privacyPreset.high',
    icon: Lock,
    values: {
      defaultMessageExpiryDays: 7,
      hideNotificationPreviews: true,
      linkPreviews: false,
      lastActiveVisibility: 'nobody',
      readReceipts: false,
      typingIndicators: false,
      autoDownloadMedia: false,
    },
  },
  {
    id: 'balanced',
    labelKey: 'privacyPreset.balanced',
    icon: EyeOff,
    values: {
      defaultMessageExpiryDays: 30,
      hideNotificationPreviews: true,
      linkPreviews: true,
      lastActiveVisibility: 'contacts',
      readReceipts: true,
      typingIndicators: true,
      autoDownloadMedia: true,
    },
  },
  {
    id: 'collaborative',
    labelKey: 'privacyPreset.collaborative',
    icon: Users,
    values: {
      defaultMessageExpiryDays: 90,
      hideNotificationPreviews: false,
      linkPreviews: true,
      lastActiveVisibility: 'everyone',
      readReceipts: true,
      typingIndicators: true,
      autoDownloadMedia: true,
    },
  },
];

interface PrivacyPresetSwitcherProps {
  workspaceId: string;
  onApplied?: (preset: PresetId) => void;
}

export const PrivacyPresetSwitcher: React.FC<PrivacyPresetSwitcherProps> = ({ workspaceId, onApplied }) => {
  const { t } = useI18n();
  const [applied, setApplied] = React.useState<string | null>(null);
  const [isError, setIsError] = React.useState(false);
  const [isBusy, setIsBusy] = React.useState(false);

  const apply = async (preset: PresetDef) => {
    if (isBusy) return;
    setIsBusy(true);
    setIsError(false);
    try {
      await apiFetch('/v1/settings/privacy', {
        method: 'PUT',
        workspaceId,
        body: preset.values,
      });
      setApplied(preset.id);
      onApplied?.(preset.id);
    } catch {
      setIsError(true);
    } finally {
      setIsBusy(false);
    }
  };

  return (
    <div style={{ marginBottom: '20px' }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: '6px', marginBottom: '8px' }}>
        <ShieldCheck size={15} style={{ color: 'var(--positive)' }} />
        <h4
          style={{
            fontSize: '12px',
            fontWeight: 600,
            color: 'var(--text-muted)',
            textTransform: 'uppercase',
            margin: 0,
          }}
        >
          {t('privacyPreset.title')}
        </h4>
      </div>
      <div style={{ display: 'flex', flexDirection: 'column', gap: '6px' }}>
        {PRESETS.map((preset) => {
          const Icon = preset.icon;
          const isActive = applied === preset.id;
          return (
            <button
              key={preset.id}
              type="button"
              disabled={isBusy}
              onClick={() => void apply(preset)}
              style={{
                display: 'flex',
                alignItems: 'center',
                gap: '8px',
                padding: '8px 10px',
                borderRadius: '8px',
                border: isActive ? '1px solid var(--positive)' : '1px solid var(--border-subtle)',
                backgroundColor: isActive ? 'var(--positive-soft)' : 'var(--surface-muted)',
                color: 'var(--text-primary)',
                fontSize: '12px',
                fontWeight: 600,
                cursor: isBusy ? 'not-allowed' : 'pointer',
                textAlign: 'left',
              }}
            >
              <Icon size={14} color={isActive ? 'var(--positive)' : 'var(--text-secondary)'} />
              {t(preset.labelKey)}
            </button>
          );
        })}
      </div>
      {applied && !isError && (
        <p role="status" style={{ margin: '8px 0 0', fontSize: '12px', fontWeight: 600, color: 'var(--positive)' }}>
          {t('privacyPreset.applied', { preset: t(`privacyPreset.${applied}`) })}
        </p>
      )}
      {isError && (
        <p role="alert" style={{ margin: '8px 0 0', fontSize: '12px', fontWeight: 600, color: 'var(--danger)' }}>
          {t('privacyPreset.failed')}
        </p>
      )}
    </div>
  );
};
