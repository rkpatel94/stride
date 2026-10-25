import type { ReactNode } from 'react';
import { ActivityIndicator, Pressable, StyleSheet, View } from 'react-native';

import { Radius, Spacing, withAlpha } from '@/constants/theme';
import { useTheme } from '@/hooks/use-theme';

import { AppText } from './AppText';
import { Button } from './Button';
import { Icon, type IconName } from './Icon';

type BannerTone = 'info' | 'warning' | 'error' | 'success';

type BannerProps = {
  tone: BannerTone;
  title: string;
  message?: string;
  actionLabel?: string;
  onAction?: () => void;
  secondaryLabel?: string;
  onSecondary?: () => void;
};

const TONE_ICONS: Record<BannerTone, IconName> = {
  info: 'information-outline',
  warning: 'alert-outline',
  error: 'alert-circle-outline',
  success: 'check-circle-outline',
};

/** Nudge card with optional actions. Used for permissions, GPS problems and errors. */
export function Banner({ tone, title, message, actionLabel, onAction, secondaryLabel, onSecondary }: BannerProps) {
  const theme = useTheme();
  const colors = {
    info: { surface: theme.infoSurface, accent: theme.info },
    warning: { surface: theme.warningSurface, accent: theme.warning },
    error: { surface: theme.errorSurface, accent: theme.danger },
    success: { surface: theme.successSurface, accent: theme.success },
  }[tone];
  return (
    <View
      style={[styles.banner, { backgroundColor: colors.surface, borderColor: withAlpha(colors.accent, 0.35) }]}
      accessibilityRole={tone === 'error' ? 'alert' : undefined}>
      <View style={styles.row}>
        <View style={[styles.iconWell, { backgroundColor: withAlpha(colors.accent, 0.14) }]}>
          <Icon name={TONE_ICONS[tone]} size={20} color={colors.accent} />
        </View>
        <View style={styles.text}>
          <AppText variant="body" weight="600">
            {title}
          </AppText>
          {message ? (
            <AppText variant="caption" color="textSecondary" style={styles.message}>
              {message}
            </AppText>
          ) : null}
        </View>
      </View>
      {actionLabel || secondaryLabel ? (
        <View style={styles.actions}>
          {secondaryLabel && onSecondary ? (
            <Button label={secondaryLabel} variant="secondary" onPress={onSecondary} style={styles.action} />
          ) : null}
          {actionLabel && onAction ? <Button label={actionLabel} onPress={onAction} style={styles.action} /> : null}
        </View>
      ) : null}
    </View>
  );
}

type EmptyStateProps = {
  icon: IconName;
  title: string;
  message: string;
  children?: ReactNode;
};

export function EmptyState({ icon, title, message, children }: EmptyStateProps) {
  const theme = useTheme();
  return (
    <View style={styles.empty}>
      <View style={[styles.emptyIcon, { backgroundColor: theme.surfaceAlt, borderColor: theme.border }]}>
        <Icon name={icon} size={34} color={theme.accent} />
      </View>
      <AppText variant="heading" align="center">
        {title}
      </AppText>
      <AppText variant="body" color="textSecondary" align="center">
        {message}
      </AppText>
      {children}
    </View>
  );
}

export function LoadingState({ label = 'Loading…' }: { label?: string }) {
  const theme = useTheme();
  return (
    <View style={styles.loading} accessibilityLabel={label}>
      <ActivityIndicator color={theme.accent} size="large" />
      <AppText color="textSecondary">{label}</AppText>
    </View>
  );
}

type SectionHeaderProps = {
  title: string;
  actionLabel?: string;
  onAction?: () => void;
};

export function SectionHeader({ title, actionLabel, onAction }: SectionHeaderProps) {
  const theme = useTheme();
  return (
    <View style={styles.sectionHeader}>
      <AppText variant="section" accessibilityRole="header" style={styles.sectionTitle}>
        {title}
      </AppText>
      {actionLabel && onAction ? (
        <Pressable onPress={onAction} accessibilityRole="button" hitSlop={12} style={styles.sectionAction}>
          <AppText variant="body" weight="600" tint={theme.accent}>
            {actionLabel}
          </AppText>
        </Pressable>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  banner: {
    borderRadius: Radius.md + 4,
    borderWidth: 1,
    padding: Spacing.md,
    gap: Spacing.md,
  },
  row: { flexDirection: 'row', gap: Spacing.md, alignItems: 'flex-start' },
  iconWell: { width: 36, height: 36, borderRadius: Radius.pill, alignItems: 'center', justifyContent: 'center' },
  text: { flex: 1, gap: 2, paddingTop: 1 },
  message: { fontSize: 14, lineHeight: 20 },
  actions: { flexDirection: 'row', gap: Spacing.sm, justifyContent: 'flex-end', flexWrap: 'wrap' },
  action: { minWidth: 120 },
  empty: { alignItems: 'center', gap: Spacing.sm, paddingVertical: Spacing.xl, paddingHorizontal: Spacing.lg },
  emptyIcon: {
    width: 72,
    height: 72,
    borderRadius: Radius.pill,
    borderWidth: 1,
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: Spacing.xs,
  },
  loading: { flex: 1, alignItems: 'center', justifyContent: 'center', gap: Spacing.md, padding: Spacing.xl },
  sectionHeader: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', minHeight: 32, gap: Spacing.md },
  sectionTitle: { flexShrink: 1 },
  sectionAction: { minHeight: 32, justifyContent: 'center' },
});
