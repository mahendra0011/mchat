import type { CSSProperties } from 'react';
import { colors, radii } from '@orbit/design-tokens';
import { initials, hueFor } from './utils.js';

export type PresenceState = 'online' | 'away' | 'offline';

export interface AvatarProps {
  name: string;
  size?: number;
  presence?: PresenceState;
  style?: CSSProperties;
}

const PRESENCE_COLORS: Record<PresenceState, string> = {
  online: colors.light.positive,
  away: colors.light.caution,
  offline: colors.light.textMuted,
};

export function Avatar({ name, size = 36, presence, style }: AvatarProps) {
  const hue = hueFor(name);
  const label = initials(name);

  return (
    <span
      role="img"
      aria-label={name}
      style={{
        position: 'relative',
        display: 'inline-flex',
        alignItems: 'center',
        justifyContent: 'center',
        width: size,
        height: size,
        borderRadius: radii.full,
        background: `hsl(${hue} 62% 92%)`,
        color: `hsl(${hue} 58% 32%)`,
        fontWeight: 700,
        fontSize: Math.max(10, Math.round(size * 0.38)),
        userSelect: 'none',
        flexShrink: 0,
        ...style,
      }}
    >
      {label}
      {presence ? (
        <span
          aria-hidden
          style={{
            position: 'absolute',
            right: -1,
            bottom: -1,
            width: Math.max(8, Math.round(size * 0.28)),
            height: Math.max(8, Math.round(size * 0.28)),
            borderRadius: radii.full,
            background: PRESENCE_COLORS[presence],
            border: '2px solid #FFFFFF',
          }}
        />
      ) : null}
    </span>
  );
}
