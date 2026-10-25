import { ActivityIndicator, Pressable, StyleSheet, View, type StyleProp, type ViewStyle } from 'react-native';

import { glow, Radius, Spacing, TouchTarget, withAlpha } from '@/constants/theme';
import { useTheme } from '@/hooks/use-theme';

import { AppText } from './AppText';
import { Icon, type IconName } from './Icon';

export type ButtonVariant = 'primary' | 'secondary' | 'danger' | 'ghost' | 'walk' | 'run';

type ButtonProps = {
  label: string;
  onPress: () => void;
  variant?: ButtonVariant;
  size?: 'normal' | 'large';
  icon?: IconName;
  loading?: boolean;
  disabled?: boolean;
  accessibilityHint?: string;
  style?: StyleProp<ViewStyle>;
};

/** Pill button. Walk and run buttons are tinted in their activity colour with a soft glow. */
export function Button({
  label,
  onPress,
  variant = 'primary',
  size = 'normal',
  icon,
  loading = false,
  disabled = false,
  accessibilityHint,
  style,
}: ButtonProps) {
  const theme = useTheme();
  const palette: Record<ButtonVariant, { background: string; foreground: string; border: string }> = {
    primary: { background: theme.primary, foreground: theme.onPrimary, border: theme.primaryBorder },
    secondary: { background: theme.surfaceAlt, foreground: theme.text, border: theme.border },
    danger: { background: 'transparent', foreground: theme.danger, border: withAlpha(theme.danger, 0.6) },
    ghost: { background: 'transparent', foreground: theme.accent, border: 'transparent' },
    walk: { background: theme.walkSurface, foreground: theme.walk, border: withAlpha(theme.walk, 0.45) },
    run: { background: theme.runSurface, foreground: theme.run, border: withAlpha(theme.run, 0.45) },
  };
  const colors = palette[variant];
  const inactive = disabled || loading;
  const glowing = (variant === 'walk' || variant === 'run') && !inactive ? glow(colors.foreground, theme.scheme) : null;

  return (
    <Pressable
      onPress={onPress}
      disabled={inactive}
      accessibilityRole="button"
      accessibilityLabel={label}
      accessibilityHint={accessibilityHint}
      accessibilityState={{ disabled: inactive, busy: loading }}
      android_ripple={{ color: withAlpha(colors.foreground, 0.18), borderless: false }}
      style={[
        styles.button,
        {
          minHeight: size === 'large' ? TouchTarget.large : TouchTarget.min + 8,
          backgroundColor: colors.background,
          borderColor: colors.border,
          opacity: inactive ? 0.45 : 1,
        },
        glowing,
        style,
      ]}>
      <View style={styles.content}>
        {loading ? (
          <ActivityIndicator color={colors.foreground} />
        ) : icon ? (
          <Icon name={icon} size={size === 'large' ? 26 : 22} color={colors.foreground} />
        ) : null}
        {/* Android can lay a centred label out a fraction of a pixel narrower than it was
            measured, which wraps the last word out of view ("Start walk" → "Start"). The
            trailing space is measured but may hang past the line end, absorbing that error.
            Screen readers use accessibilityLabel, so they never hear it. */}
        <AppText
          variant="heading"
          weight="700"
          tint={colors.foreground}
          numberOfLines={1}
          style={size === 'large' ? styles.largeLabel : styles.label}>
          {`${label} `}
        </AppText>
      </View>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  button: {
    borderRadius: Radius.pill,
    borderWidth: 1,
    paddingHorizontal: Spacing.xl,
    justifyContent: 'center',
    overflow: 'hidden',
  },
  content: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: Spacing.sm,
  },
  label: { fontSize: 16, lineHeight: 22 },
  largeLabel: { fontSize: 18, lineHeight: 24 },
});
