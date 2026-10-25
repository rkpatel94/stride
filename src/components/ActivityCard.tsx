import { StyleSheet, View } from 'react-native';

import { Radius, Spacing, withAlpha } from '@/constants/theme';
import { ACTIVITY_LABELS, type Activity, type ActivityType } from '@/features/activities/types';
import { useTheme } from '@/hooks/use-theme';
import { formatDate, formatDistance, formatDuration, formatDurationShort, formatPace, formatRelativeDay, formatTime } from '@/utils/format';

import { AppText } from './AppText';
import { Card } from './Card';
import { RouteThumbnail } from './RouteThumbnail';

type ActivityCardProps = {
  activity: Activity;
  onPress: () => void;
  onLongPress?: () => void;
};

/** One activity: its route as a glowing "light painting", type chip, when, distance, time and pace. */
export function ActivityCard({ activity, onPress, onLongPress }: ActivityCardProps) {
  const theme = useTheme();
  const accent = activity.type === 'run' ? theme.run : theme.walk;
  const label = `${ACTIVITY_LABELS[activity.type]} on ${formatDate(activity.startedAt)} at ${formatTime(activity.startedAt)}, ${formatDistance(activity.distanceMeters)}, ${formatDurationShort(activity.activeDurationSeconds)}`;
  return (
    <Card
      onPress={onPress}
      onLongPress={onLongPress}
      accessibilityLabel={label}
      accessibilityHint={onLongPress ? 'Opens the activity details. Long press to delete.' : 'Opens the activity details'}
      style={styles.card}>
      <RouteThumbnail lines={activity.routePreview} width={72} height={72} color={accent} strokeWidth={3} glow round />
      <View style={styles.body}>
        <View style={styles.row}>
          <ActivityChip type={activity.type} />
          <AppText variant="caption" color="textSecondary" numberOfLines={1} style={styles.shrink}>
            {formatRelativeDay(activity.startedAt)} {formatTime(activity.startedAt)}
          </AppText>
        </View>
        <View style={styles.row}>
          <AppText variant="heading" weight="700" numberOfLines={1}>
            {formatDistance(activity.distanceMeters)}
          </AppText>
          <AppText variant="caption" color="textMuted" numberOfLines={1} style={[styles.shrink, styles.numbers]}>
            {formatDuration(activity.activeDurationSeconds)} · {formatPace(activity.averagePaceSecondsPerKm)} /km
          </AppText>
        </View>
      </View>
    </Card>
  );
}

export function ActivityChip({ type }: { type: ActivityType }) {
  const theme = useTheme();
  const color = type === 'run' ? theme.run : theme.walk;
  return (
    <View
      style={[styles.chip, { backgroundColor: type === 'run' ? theme.runSurface : theme.walkSurface, borderColor: withAlpha(color, 0.35) }]}>
      <AppText variant="label" tint={color} style={styles.chipLabel}>
        {ACTIVITY_LABELS[type]}
      </AppText>
    </View>
  );
}

const styles = StyleSheet.create({
  card: { flexDirection: 'row', alignItems: 'center', gap: Spacing.md + 2, padding: Spacing.md, borderRadius: Radius.md + 4 },
  body: { flex: 1, gap: Spacing.xs },
  row: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: Spacing.sm },
  shrink: { flexShrink: 1, textAlign: 'right' },
  numbers: { fontVariant: ['tabular-nums'] },
  chip: { borderRadius: Radius.pill, borderWidth: 1, paddingHorizontal: Spacing.sm, paddingVertical: 2 },
  chipLabel: { fontSize: 11, lineHeight: 15, letterSpacing: 0.2 },
});
