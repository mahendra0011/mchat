/**
 * Aurora Paper Design System Tokens
 * Spec Reference: 05_DESIGN_SYSTEM.md & 06_MOTION_AND_INTERACTIONS.md
 */

export const colors = {
  light: {
    canvas: '#F7F8FC',
    surface: '#FFFFFF',
    surfaceElevated: '#FFFFFF',
    surfaceMuted: '#F0F2F8',
    surfaceSunken: '#EFF1F7',
    textPrimary: '#171A2B',
    textSecondary: '#5F6478',
    textTertiary: '#8C92AB',
    textMuted: '#8C92AB',
    borderSubtle: '#E3E6EF',
    borderStrong: '#CBD1E1',
    brandPrimary: '#5955E8',
    accentPrimary: '#5955E8',
    accentHover: '#4843D2',
    accentSoft: '#EEEDFF',
    accentText: '#FFFFFF',
    positive: '#16866A',
    positiveSoft: '#E6F6F2',
    caution: '#9C6200',
    cautionSoft: '#FEF6E7',
    danger: '#C33B52',
    dangerSoft: '#FEEBED',
    focusRing: '#726DFF',
    // Business Mode Tokens
    businessBadge: '#805AD5',
    businessAccent: '#6B46C1',
    internalNoteBg: '#FFFBEB',
    internalNoteBorder: '#F59E0B',
    internalNoteText: '#92400E',
    // Scannable QR surface (theme-independent by design)
    qrSurface: '#FFFFFF',
    qrInk: '#1A202C',
  },
  dark: {
    canvas: '#10121B',
    surface: '#171A26',
    surfaceElevated: '#202437',
    surfaceMuted: '#252A3D',
    surfaceSunken: '#131622',
    textPrimary: '#F3F4FB',
    textSecondary: '#B6BAD0',
    textTertiary: '#6D7392',
    textMuted: '#6D7392',
    borderSubtle: '#30364C',
    borderStrong: '#444C6B',
    brandPrimary: '#A5A1FF',
    accentPrimary: '#A5A1FF',
    accentHover: '#BBB8FF',
    accentSoft: '#302E58',
    accentText: '#10121B',
    positive: '#63D9B2',
    positiveSoft: '#153C31',
    caution: '#F1C56B',
    cautionSoft: '#3D3012',
    danger: '#FF8798',
    dangerSoft: '#3E1922',
    focusRing: '#B2AEFF',
    // Business Mode Tokens
    businessBadge: '#B794F4',
    businessAccent: '#9F7AEA',
    internalNoteBg: '#2A2010',
    internalNoteBorder: '#F59E0B',
    internalNoteText: '#FDE68A',
    // Scannable QR surface (theme-independent by design)
    qrSurface: '#FFFFFF',
    qrInk: '#1A202C',
  },
} as const;

export const spacing = {
  0: '0px',
  1: '4px',
  2: '8px',
  3: '12px',
  4: '16px',
  5: '20px',
  6: '24px',
  8: '32px',
  10: '40px',
  12: '48px',
  16: '64px',
} as const;

export const radii = {
  none: '0px',
  sm: '8px',     // small controls
  md: '12px',    // inputs, cards
  lg: '16px',    // panels, popovers
  xl: '20px',    // large sheets, dialogs
  full: '9999px' // pills, chips, avatars
} as const;

export const shadows = {
  none: 'none',
  sm: '0 1px 2px 0 rgba(16, 24, 40, 0.05)',
  md: '0 4px 8px -2px rgba(16, 24, 40, 0.08), 0 2px 4px -2px rgba(16, 24, 40, 0.04)',
  lg: '0 12px 16px -4px rgba(16, 24, 40, 0.08), 0 4px 6px -2px rgba(16, 24, 40, 0.03)',
  xl: '0 20px 24px -4px rgba(16, 24, 40, 0.1), 0 8px 8px -4px rgba(16, 24, 40, 0.04)',
} as const;

export const typography = {
  fontFamily: {
    sans: 'Inter, -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif',
    mono: 'ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace',
  },
  fontSize: {
    xs: '12px',
    sm: '13px',
    base: '15px',
    md: '16px',
    lg: '18px',
    xl: '20px',
    '2xl': '24px',
    '3xl': '30px',
  },
  lineHeight: {
    tight: '1.25',
    snug: '1.375',
    normal: '1.5',
    relaxed: '1.625',
  },
} as const;

export const motion = {
  duration: {
    micro: '120ms',
    hover: '150ms',
    surface: '200ms',
    sheet: '260ms',
  },
  // Canonical speed scale (Spec 05/06): --duration-fast / --duration-normal / --duration-slow
  speed: {
    fast: '120ms',
    normal: '200ms',
    slow: '320ms',
  },
  easing: {
    enter: 'cubic-bezier(0.16, 1, 0.3, 1)',
    exit: 'cubic-bezier(0.7, 0, 0.84, 0)',
    standard: 'cubic-bezier(0.4, 0, 0.2, 1)',
    emphasized: 'cubic-bezier(0.2, 0, 0, 1)',
  },
} as const;

export const zIndices = {
  base: 0,
  sticky: 100,
  dropdown: 1000,
  modal: 1100,
  toast: 1200,
} as const;

export const overlays = {
  scrim: {
    light: 'rgba(16, 18, 27, 0.65)',
    dark: 'rgba(6, 8, 16, 0.72)',
  },
} as const;

export const densityRowPadding = {
  default: '12px',
  cozy: '10px',
  compact: '8px',
} as const;

export const density = {
  compact: {
    messagePadding: '6px 10px',
    listItemHeight: '52px',
    composerMinHeight: '40px',
  },
  standard: {
    messagePadding: '10px 14px',
    listItemHeight: '64px',
    composerMinHeight: '48px',
  },
  comfortable: {
    messagePadding: '14px 18px',
    listItemHeight: '76px',
    composerMinHeight: '56px',
  },
} as const;
