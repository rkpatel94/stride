import type { ReactNode } from 'react';
import { Pressable, StyleSheet, View, type StyleProp, type ViewStyle } from 'react-native';

import { Radius, Spacing } from '@/constants/theme';
import { useTheme } from '@/hooks/use-theme';

type CardProps = {
  children: ReactNode;
  style?: StyleProp<ViewStyle>;
  onPress?: () => void;
  onLongPress?: () => void;
  accessibilityLabel?: string;
  accessibilityHint?: string;
};

export function Card({ children, style, onPress, onLongPress, accessibilityLabel, accessibilityHint }: CardProps) {
  const theme = useTheme();
  const cardStyle = [styles.card, { backgroundColor: theme.surface, borderColor: theme.border }, style];
  if (!onPress) return <View style={cardStyle}>{children}</View>;
  return (
    <Pressable
      onPress={onPress}
      onLongPress={onLongPress}
      android_ripple={{ color: theme.surfaceAlt }}
      accessibilityRole="button"
      accessibilityLabel={accessibilityLabel}
      accessibilityHint={accessibilityHint}
      style={cardStyle}>
      {children}
    </Pressable>
  );
}

const styles = StyleSheet.create({
  card: {
    borderRadius: Radius.lg,
    borderWidth: 1,
    padding: Spacing.screen,
    gap: Spacing.sm,
    overflow: 'hidden',
  },
});
