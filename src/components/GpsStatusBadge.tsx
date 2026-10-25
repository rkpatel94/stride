import { StyleSheet, View } from 'react-native';

import { glow, Radius, Spacing } from '@/constants/theme';
import type { SignalLevel } from '@/features/tracking/gpsQuality';
import { useTheme } from '@/hooks/use-theme';
import { formatAccuracy } from '@/utils/format';

import { AppText } from './AppText';
import { Icon, type IconName } from './Icon';

const LABELS: Record<SignalLevel, string> = {
  searching: 'Searching for GPS…',
  good: 'GPS good',
  fair: 'GPS fair',
  poor: 'GPS weak',
  lost: 'GPS signal lost',
  disabled: 'Location is off',
};

const ICONS: Record<SignalLevel, IconName> = {
  searching: 'crosshairs-question',
  good: 'crosshairs-gps',
  fair: 'crosshairs-gps',
  poor: 'crosshairs',
  lost: 'crosshairs-off',
  disabled: 'map-marker-off',
};

type GpsStatusBadgeProps = {
  level: SignalLevel;
  accuracyMeters: number | null;
};

/** GPS chip: a status dot, the honest label with accuracy, and a matching icon. */
export function GpsStatusBadge({ level, accuracyMeters }: GpsStatusBadgeProps) {
  const theme = useTheme();
  const color = {
    searching: theme.textMuted,
    good: theme.success,
    fair: theme.warning,
    poor: theme.danger,
    lost: theme.danger,
    disabled: theme.danger,
  }[level];
  const showAccuracy = accuracyMeters !== null && level !== 'disabled' && level !== 'lost' && level !== 'searching';
  const label = `${LABELS[level]}${showAccuracy ? ` ${formatAccuracy(accuracyMeters)}` : ''}`;
  return (
    <View
      style={[styles.badge, { borderColor: theme.border, backgroundColor: theme.surfaceAlt }]}
      accessible
      accessibilityRole="text"
      accessibilityLabel={label}
      accessibilityLiveRegion="polite">
      <View style={[styles.dot, { backgroundColor: color }, level === 'good' ? glow(color, theme.scheme, 0.6) : null]} />
      <AppText variant="mono" tint={level === 'good' || level === 'searching' ? theme.textSecondary : color}>
        {label}
      </AppText>
      <Icon name={ICONS[level]} size={16} color={theme.textMuted} />
    </View>
  );
}

const styles = StyleSheet.create({
  badge: {
    flexDirection: 'row',
    alignItems: 'center',
    alignSelf: 'flex-start',
    gap: Spacing.sm,
    paddingHorizontal: Spacing.md,
    paddingVertical: 7,
    borderRadius: Radius.pill,
    borderWidth: 1,
  },
  dot: { width: 7, height: 7, borderRadius: 4 },
});
