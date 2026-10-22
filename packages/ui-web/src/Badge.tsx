import type { CSSProperties, ReactNode } from 'react';
import { colors, radii, spacing } from '@orbit/design-tokens';

export type BadgeTone = 'neutral' | 'positive' | 'caution' | 'danger' | 'accent';

export interface BadgeProps {
  tone?: BadgeTone;
  children?: ReactNode;
  style?: CSSProperties;
}

const TONES: Record<BadgeTone, CSSProperties> = {
  neutral: {
    background: colors.light.surfaceMuted,
    color: colors.light.textSecondary,
  },
  positive: {
    background: colors.light.positiveSoft,
    color: colors.light.positive,
  },
  caution: {
    background: colors.light.cautionSoft,
    color: colors.light.caution,
  },
  danger: {
    background: colors.light.dangerSoft,
    color: colors.light.danger,
  },
  accent: {
    background: colors.light.accentSoft,
    color: colors.light.accentPrimary,
  },
};

export function Badge({ tone = 'neutral', children, style }: BadgeProps) {
  return (
    <span
      style={{
        display: 'inline-flex',
        alignItems: 'center',
        gap: spacing[1] ?? '4px',
        padding: `2px ${spacing[2] ?? '8px'}`,
        borderRadius: radii.full,
        fontSize: '11px',
        fontWeight: 600,
        lineHeight: '18px',
        whiteSpace: 'nowrap',
        ...TONES[tone],
        ...style,
      }}
    >
      {children}
    </span>
  );
}
