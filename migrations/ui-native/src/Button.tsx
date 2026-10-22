import { useCallback } from 'react';
import { ActivityIndicator, Pressable, StyleSheet, Text, type GestureResponderEvent } from 'react-native';

export type ButtonVariant = 'primary' | 'secondary' | 'ghost' | 'danger';
export type ButtonSize = 'sm' | 'md';

export interface NativeButtonProps {
  label: string;
  variant?: ButtonVariant;
  size?: ButtonSize;
  loading?: boolean;
  disabled?: boolean;
  onPress?: (event: GestureResponderEvent) => void;
  accessibilityLabel?: string;
}

const PALETTE = {
  accent: '#5955E8',
  accentText: '#FFFFFF',
  surface: '#FFFFFF',
  textPrimary: '#171A2B',
  textSecondary: '#5F6478',
  border: '#CBD1E1',
  danger: '#C33B52',
} as const;

export function NativeButton({
  label,
  variant = 'primary',
  size = 'md',
  loading = false,
  disabled = false,
  onPress,
  accessibilityLabel,
}: NativeButtonProps) {
  const isDisabled = disabled || loading;
  const handlePress = useCallback(
    (event: GestureResponderEvent) => {
      if (isDisabled) return;
      onPress?.(event);
    },
    [isDisabled, onPress]
  );

  const tone = VARIANT_TONES[variant];

  return (
    <Pressable
      onPress={handlePress}
      disabled={isDisabled}
      accessibilityRole="button"
      accessibilityLabel={accessibilityLabel ?? label}
      accessibilityState={{ disabled: isDisabled, busy: loading }}
      style={({ pressed }) => [
        styles.base,
        size === 'sm' ? styles.sm : styles.md,
        tone,
        isDisabled && styles.disabled,
        pressed && !isDisabled && styles.pressed,
      ]}
    >
      {loading ? (
        <ActivityIndicator size="small" color={variant === 'primary' ? PALETTE.accentText : PALETTE.accent} />
      ) : (
        <Text style={[styles.label, { color: variant === 'primary' ? PALETTE.accentText : labelColor(variant) }]}>
          {label}
        </Text>
      )}
    </Pressable>
  );
}

function labelColor(variant: ButtonVariant): string {
  if (variant === 'danger') return PALETTE.accentText;
  if (variant === 'ghost') return PALETTE.textSecondary;
  return PALETTE.textPrimary;
}

const VARIANT_TONES: Record<ButtonVariant, object> = {
  primary: { backgroundColor: PALETTE.accent, borderColor: PALETTE.accent },
  secondary: { backgroundColor: PALETTE.surface, borderColor: PALETTE.border },
  ghost: { backgroundColor: 'transparent', borderColor: 'transparent' },
  danger: { backgroundColor: PALETTE.danger, borderColor: PALETTE.danger },
};

const styles = StyleSheet.create({
  base: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 6,
    borderRadius: 8,
    borderWidth: 1,
  },
  sm: { minHeight: 32, paddingHorizontal: 10 },
  md: { minHeight: 44, paddingHorizontal: 16 },
  disabled: { opacity: 0.5 },
  pressed: { opacity: 0.85 },
  label: { fontSize: 14, fontWeight: '600' },
});
