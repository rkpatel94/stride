import { StyleSheet, View } from 'react-native';

import { Radius, Spacing } from '@/constants/theme';
import type { GoalProgress } from '@/features/goals/goals';
import { useTheme } from '@/hooks/use-theme';
import { formatDistance, formatPercent } from '@/utils/format';

import { AppText } from './AppText';
import { Icon } from './Icon';

type GoalProgressBarProps = {
  progress: GoalProgress | null;
  /** Share of the goal covered by walking (the rest of the filled bar is running). */
  walkMeters?: number;
};

export function GoalProgressBar({ progress, walkMeters = 0 }: GoalProgressBarProps) {
  const theme = useTheme();
  if (!progress) {
    return (
      <AppText color="textSecondary">No daily goal set. Set one to track your progress each day.</AppText>
    );
  }
  const walkFraction = progress.targetMeters > 0 ? Math.min(progress.fraction, walkMeters / progress.targetMeters) : 0;
  const runFraction = Math.max(0, progress.fraction - walkFraction);
  return (
    <View
      style={styles.container}
      accessible
      accessibilityRole="progressbar"
      accessibilityLabel="Daily goal progress"
      accessibilityValue={{ min: 0, max: 100, now: Math.round(progress.fraction * 100) }}>
      <View style={styles.header}>
        <AppText variant="metric">{formatPercent(progress.fraction)}</AppText>
        {progress.completed ? (
          <View style={[styles.badge, { backgroundColor: theme.successSurface }]}>
            <Icon name="check-decagram" size={18} color={theme.success} />
            <AppText variant="label" tint={theme.success}>
              Goal reached
            </AppText>
          </View>
        ) : (
          <AppText color="textSecondary">{formatDistance(progress.remainingMeters)} to go</AppText>
        )}
      </View>
      <View style={[styles.track, { backgroundColor: theme.surfaceAlt }]}>
        <View style={[styles.fill, { flex: walkFraction, backgroundColor: theme.walk }]} />
        <View style={[styles.fill, { flex: runFraction, backgroundColor: theme.run }]} />
        <View style={{ flex: Math.max(0, 1 - progress.fraction) }} />
      </View>
      <AppText variant="caption" color="textSecondary">
        {formatDistance(progress.achievedMeters)} of {formatDistance(progress.targetMeters, { alwaysKm: true })}
      </AppText>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { gap: Spacing.sm },
  header: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  badge: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.xs,
    paddingHorizontal: Spacing.sm,
    paddingVertical: 4,
    borderRadius: Radius.pill,
  },
  track: { height: 14, borderRadius: Radius.pill, overflow: 'hidden', flexDirection: 'row' },
  fill: { height: '100%' },
});
