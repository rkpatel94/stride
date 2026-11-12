import { StyleSheet, Text, type TextProps, type TextStyle } from 'react-native';

import { Fonts, type ThemeColor } from '@/constants/theme';
import { useTheme } from '@/hooks/use-theme';

/**
 * hero/metric: numbers (Space Grotesk, tabular). title/section: display (Unbounded).
 * heading: card titles and button labels (Space Grotesk). body/label/caption: Inter. mono: JetBrains Mono.
 */
export type TextVariant = 'hero' | 'metric' | 'title' | 'section' | 'heading' | 'body' | 'label' | 'caption' | 'mono';

type Role = 'display' | 'number' | 'body' | 'mono';

type AppTextProps = TextProps & {
  variant?: TextVariant;
  color?: ThemeColor;
  /** Raw colour override, e.g. an activity accent. */
  tint?: string;
  weight?: TextStyle['fontWeight'];
  align?: TextStyle['textAlign'];
};

const ROLES: Record<TextVariant, Role> = {
  hero: 'number',
  metric: 'number',
  title: 'display',
  section: 'display',
  heading: 'number',
  body: 'body',
  label: 'body',
  caption: 'body',
  mono: 'mono',
};

export function AppText({ variant = 'body', color = 'text', tint, weight, align, style, ...rest }: AppTextProps) {
  const theme = useTheme();
  return (
    <Text
      style={[
        styles[variant],
        // Every weight is its own family; fontWeight stays normal so Android never fakes bold.
        { color: tint ?? theme[color], fontFamily: faceFor(ROLES[variant], weight ?? styles[variant].fontWeight), fontWeight: 'normal' },
        align ? { textAlign: align } : null,
        style,
      ]}
      {...rest}
    />
  );
}

function faceFor(role: Role, weight: TextStyle['fontWeight']): string {
  const numeric = weight === 'bold' ? 700 : weight === undefined || weight === 'normal' ? 400 : Number(weight);
  switch (role) {
    case 'display':
      return Fonts.display;
    case 'number':
      return numeric >= 700 ? Fonts.number[700] : numeric >= 600 ? Fonts.number[600] : Fonts.number[500];
    case 'mono':
      return numeric >= 600 ? Fonts.mono[700] : Fonts.mono[500];
    default:
      return numeric >= 600 ? Fonts.body[600] : Fonts.body[400];
  }
}

const styles = StyleSheet.create({
  hero: { fontSize: 64, lineHeight: 68, fontWeight: '700', letterSpacing: -2.5, fontVariant: ['tabular-nums'] },
  metric: { fontSize: 30, lineHeight: 36, fontWeight: '700', letterSpacing: -0.6, fontVariant: ['tabular-nums'] },
  title: { fontSize: 30, lineHeight: 40, fontWeight: '700', letterSpacing: -0.8 },
  section: { fontSize: 19, lineHeight: 26, fontWeight: '700', letterSpacing: -0.3 },
  heading: { fontSize: 19, lineHeight: 24, fontWeight: '600', letterSpacing: -0.2, fontVariant: ['tabular-nums'] },
  body: { fontSize: 16, lineHeight: 23, fontWeight: '400' },
  label: { fontSize: 12, lineHeight: 16, fontWeight: '600', letterSpacing: 0.7 },
  caption: { fontSize: 13, lineHeight: 18, fontWeight: '400' },
  mono: { fontSize: 12, lineHeight: 16, fontWeight: '500' },
});
