import type { CSSProperties, ReactNode } from 'react';
import { colors, radii, spacing } from '@orbit/design-tokens';

export type ButtonVariant = 'primary' | 'secondary' | 'ghost' | 'danger';
export type ButtonSize = 'sm' | 'md';

export interface ButtonProps {
  variant?: ButtonVariant;
  size?: ButtonSize;
  loading?: boolean;
  disabled?: boolean;
  type?: 'button' | 'submit' | 'reset';
  onClick?: () => void;
  children?: ReactNode;
  'aria-label'?: string;
  style?: CSSProperties;
}

const VARIANT_STYLES: Record<ButtonVariant, CSSProperties> = {
  primary: {
    background: colors.light.accentPrimary,
    color: colors.light.accentText,
    border: `1px solid ${colors.light.accentPrimary}`,
  },
  secondary: {
    background: colors.light.surface,
    color: colors.light.textPrimary,
    border: `1px solid ${colors.light.borderStrong}`,
  },
  ghost: {
    background: 'transparent',
    color: colors.light.textSecondary,
    border: '1px solid transparent',
  },
  danger: {
    background: colors.light.danger,
    color: '#FFFFFF',
    border: `1px solid ${colors.light.danger}`,
  },
};

const SIZE_STYLES: Record<ButtonSize, CSSProperties> = {
  sm: {
    padding: `${spacing[2] ?? '4px'} ${spacing[3] ?? '8px'}`,
    fontSize: '12px',
    minHeight: '28px',
  },
  md: {
    padding: `${spacing[3] ?? '8px'} ${spacing[4] ?? '12px'}`,
    fontSize: '13px',
    minHeight: '36px',
  },
};

export function Button({
  variant = 'primary',
  size = 'md',
  loading = false,
  disabled = false,
  type = 'button',
  onClick,
  children,
  'aria-label': ariaLabel,
  style,
}: ButtonProps) {
  const isDisabled = disabled || loading;

  return (
    <button
      type={type}
      onClick={onClick}
      disabled={isDisabled}
      aria-label={ariaLabel}
      aria-busy={loading || undefined}
      style={{
        display: 'inline-flex',
        alignItems: 'center',
        justifyContent: 'center',
        gap: spacing[2] ?? '4px',
        borderRadius: radii.md ?? '8px',
        fontFamily: 'inherit',
        fontWeight: 600,
        cursor: isDisabled ? 'not-allowed' : 'pointer',
        opacity: loading ? 0.7 : 1,
        transition: 'background 120ms ease, border-color 120ms ease',
        ...VARIANT_STYLES[variant],
        ...SIZE_STYLES[size],
        ...(disabled ? { opacity: 0.5 } : null),
        ...style,
      }}
    >
      {loading ? '…' : children}
    </button>
  );
}
