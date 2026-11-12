/**
 * "Afterglow" design tokens (docs/ui-redesign/DESIGN.md): ink surfaces, volt for the main action
 * and progress, ion for walking and ember for running. The light "Daylight" palette keeps the same
 * roles; volt stays a fill there, and `accent` is its readable colour for text and icons.
 */

export const Colors = {
  light: {
    background: '#F5F4EF',
    surface: '#FFFFFF',
    surfaceAlt: '#ECEAE3',
    border: '#DCD9CF',
    text: '#0A0B0F',
    textSecondary: '#4E5263',
    textMuted: '#646878',
    primary: '#C6FF3D',
    primaryPressed: '#B4EE29',
    primaryBorder: '#9ED11C',
    onPrimary: '#0A0B0F',
    accent: '#4A6B00',
    walk: '#0A72C2',
    walkSurface: '#E2F0FA',
    run: '#C2410C',
    runSurface: '#FBE9E1',
    danger: '#C8243F',
    onDanger: '#FFFFFF',
    warning: '#9A5B00',
    warningSurface: '#FBF1DC',
    success: '#4A6B00',
    successSurface: '#EDF6D5',
    info: '#0A72C2',
    infoSurface: '#E2F0FA',
    errorSurface: '#FBE5E9',
    route: '#4A6B00',
    routeGap: '#8A8E9C',
    holoStart: '#FFB8F2',
    holoMid: '#A5F3FF',
    holoEnd: '#FFF3A6',
    glass: '#FFFFFF',
    shadow: 'rgba(10, 11, 15, 0.14)',
  },
  dark: {
    background: '#0A0B0F',
    surface: '#14161C',
    surfaceAlt: '#1C1F27',
    border: '#2A2E38',
    text: '#F5F6FA',
    textSecondary: '#A4A9B8',
    textMuted: '#7D8295',
    primary: '#C6FF3D',
    primaryPressed: '#A9E31F',
    primaryBorder: '#C6FF3D',
    onPrimary: '#0A0B0F',
    accent: '#C6FF3D',
    walk: '#46C8FF',
    walkSurface: '#112433',
    run: '#FF6B3D',
    runSurface: '#2E1710',
    danger: '#FF4D6A',
    onDanger: '#0A0B0F',
    warning: '#FFC94D',
    warningSurface: '#2A2412',
    success: '#C6FF3D',
    successSurface: '#1C2812',
    info: '#46C8FF',
    infoSurface: '#112433',
    errorSurface: '#2E121A',
    route: '#C6FF3D',
    routeGap: '#7D8295',
    holoStart: '#FFB8F2',
    holoMid: '#A5F3FF',
    holoEnd: '#FFF3A6',
    glass: '#14161C',
    shadow: 'rgba(0, 0, 0, 0.55)',
  },
} as const;

// `glass` is the floating nav bar and map buttons. Android has no backdrop blur here, so it stays
// opaque: a translucent bar without blur lets the text scrolling underneath show through.

export type ThemeColors = { [K in keyof typeof Colors.light]: string };
export type ThemeColor = keyof ThemeColors;

/** `#RRGGBB` at the given opacity, for tinted borders and glows. */
export function withAlpha(hex: string, opacity: number): string {
  const value = Number.parseInt(hex.slice(1, 7), 16);
  return `rgba(${(value >> 16) & 255}, ${(value >> 8) & 255}, ${value & 255}, ${opacity})`;
}

/**
 * The "afterglow": a soft halo in the element's colour, only for live or active elements and only
 * in dark mode (on light surfaces it reads as a smudge). Needs Android 9+; older versions skip it.
 */
export function glow(color: string, scheme: 'light' | 'dark', opacity = 0.4) {
  return scheme === 'dark' ? { boxShadow: `0px 0px 24px -2px ${withAlpha(color, opacity)}` } : null;
}

/**
 * Font faces, loaded at startup from assets/fonts (src/constants/fonts.ts). Each weight is its
 * own family so Android never synthesises bold on top of an already bold face. Body text has
 * two weights only (each Inter face adds ~165 KB to the APK): medium renders as regular and bold
 * as semibold.
 */
export const Fonts = {
  display: 'Unbounded_700Bold',
  number: { 500: 'SpaceGrotesk_500Medium', 600: 'SpaceGrotesk_600SemiBold', 700: 'SpaceGrotesk_700Bold' },
  body: { 400: 'Inter_400Regular', 600: 'Inter_600SemiBold' },
  mono: { 500: 'JetBrainsMono_500Medium', 700: 'JetBrainsMono_700Bold' },
} as const;

export const Spacing = {
  xs: 4,
  sm: 8,
  md: 12,
  lg: 16,
  screen: 20,
  xl: 24,
  xxl: 32,
} as const;

export const Radius = {
  sm: 12,
  md: 16,
  lg: 28,
  xl: 32,
  pill: 999,
} as const;

/** Minimum touch target; tracking controls use the larger size for gloved/outdoor use. */
export const TouchTarget = {
  min: 48,
  large: 64,
} as const;
