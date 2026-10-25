import { StyleSheet, View } from 'react-native';
import Svg, { Circle, G } from 'react-native-svg';

import type { GoalProgress } from '@/features/goals/goals';
import { useTheme } from '@/hooks/use-theme';
import { formatPercent } from '@/utils/format';

import { AppText } from './AppText';

type GoalRingProps = {
  progress: GoalProgress;
  /** Part of today's distance that was walked; the rest of the arc is running. */
  walkMeters: number;
  size?: number;
};

const RADIUS = 40;
const STROKE = 10;
const CIRCUMFERENCE = 2 * Math.PI * RADIUS;

/** Daily goal as a ring: a walking (ion) arc, then a running (ember) arc, with a glowing tip. */
export function GoalRing({ progress, walkMeters, size = 112 }: GoalRingProps) {
  const theme = useTheme();
  const total = Math.min(1, Math.max(0, progress.fraction));
  const walk = progress.targetMeters > 0 ? Math.min(total, walkMeters / progress.targetMeters) : 0;
  const run = Math.max(0, total - walk);
  const tipColor = run > 0 ? theme.run : theme.walk;
  // Angle 0 is 12 o'clock (the arcs are rotated -90° so they start at the top).
  const tipAngle = total * 2 * Math.PI;
  const tipX = 50 + RADIUS * Math.sin(tipAngle);
  const tipY = 50 - RADIUS * Math.cos(tipAngle);

  return (
    <View
      style={{ width: size, height: size }}
      accessible
      accessibilityRole="progressbar"
      accessibilityLabel="Daily goal progress"
      accessibilityValue={{ min: 0, max: 100, now: Math.round(total * 100) }}>
      <Svg width={size} height={size} viewBox="0 0 100 100">
        <Circle cx={50} cy={50} r={RADIUS} stroke={theme.surfaceAlt} strokeWidth={STROKE} fill="none" />
        <G transform="rotate(-90 50 50)">
          {walk > 0 ? (
            <Circle
              cx={50}
              cy={50}
              r={RADIUS}
              stroke={theme.walk}
              strokeWidth={STROKE}
              fill="none"
              strokeLinecap="round"
              strokeDasharray={`${walk * CIRCUMFERENCE} ${CIRCUMFERENCE}`}
            />
          ) : null}
          {run > 0 ? (
            <Circle
              cx={50}
              cy={50}
              r={RADIUS}
              stroke={theme.run}
              strokeWidth={STROKE}
              fill="none"
              strokeLinecap="round"
              strokeDasharray={`${run * CIRCUMFERENCE} ${CIRCUMFERENCE}`}
              strokeDashoffset={-walk * CIRCUMFERENCE}
            />
          ) : null}
        </G>
        {total > 0 ? (
          <>
            <Circle cx={tipX} cy={tipY} r={8} fill={tipColor} opacity={theme.scheme === 'dark' ? 0.3 : 0} />
            <Circle cx={tipX} cy={tipY} r={5} fill={tipColor} stroke={theme.surface} strokeWidth={1.5} />
          </>
        ) : null}
      </Svg>
      <View style={styles.center} pointerEvents="none">
        <AppText variant="heading" weight="700">
          {formatPercent(progress.fraction)}
        </AppText>
        <AppText variant="label" color="textMuted" style={styles.caption}>
          {progress.completed ? 'GOAL MET' : 'DONE'}
        </AppText>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  center: { ...StyleSheet.absoluteFill, alignItems: 'center', justifyContent: 'center' },
  caption: { fontSize: 10, lineHeight: 13 },
});
