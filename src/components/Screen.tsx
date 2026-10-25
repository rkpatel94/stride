import type { ReactNode } from 'react';
import { ScrollView, StyleSheet, View, type RefreshControlProps, type StyleProp, type ViewStyle } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { Spacing } from '@/constants/theme';
import { useTheme } from '@/hooks/use-theme';

import { useTabBarInset } from './FloatingTabBar';

type ScreenProps = {
  children: ReactNode;
  /** Fixed bar above the scrolling content (it takes the status-bar inset). */
  header?: ReactNode;
  /** Pad for the status bar; disable on stack screens that show a header. */
  topInset?: boolean;
  scroll?: boolean;
  refreshControl?: React.ReactElement<RefreshControlProps>;
  contentStyle?: StyleProp<ViewStyle>;
};

export function Screen({ children, header, topInset = true, scroll = true, refreshControl, contentStyle }: ScreenProps) {
  const theme = useTheme();
  const insets = useSafeAreaInsets();
  // Tab screens scroll their last content clear of the floating tab bar.
  const paddingBottom = Spacing.xxl + useTabBarInset();
  const statusBar = topInset ? insets.top : 0;
  const paddingTop = header ? Spacing.lg : statusBar + Spacing.md;
  const fixedHeader = header ? <View style={{ paddingTop: statusBar, backgroundColor: theme.background }}>{header}</View> : null;

  if (!scroll) {
    return (
      <View style={[styles.flex, { backgroundColor: theme.background }]}>
        {fixedHeader}
        <View style={[styles.flex, { paddingTop, paddingBottom }, contentStyle]}>{children}</View>
      </View>
    );
  }
  return (
    <View style={[styles.flex, { backgroundColor: theme.background }]}>
      {fixedHeader}
      <ScrollView
        style={styles.flex}
        contentContainerStyle={[styles.content, { paddingTop, paddingBottom }, contentStyle]}
        keyboardShouldPersistTaps="handled"
        refreshControl={refreshControl}>
        {children}
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  flex: { flex: 1 },
  content: { paddingHorizontal: Spacing.screen, gap: Spacing.xl },
});
