import Svg, { Path } from 'react-native-svg';

import { ICON_PATHS, type IconName } from './iconPaths';

export type { IconName };

type IconProps = {
  name: IconName;
  size?: number;
  color: string;
  accessibilityLabel?: string;
};

/** Material Design icon drawn from its SVG path (see iconPaths.ts). */
export function Icon({ name, size = 22, color, accessibilityLabel }: IconProps) {
  return (
    <Svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      accessible={Boolean(accessibilityLabel)}
      accessibilityRole={accessibilityLabel ? 'image' : undefined}
      accessibilityLabel={accessibilityLabel}
      accessibilityElementsHidden={!accessibilityLabel}
      importantForAccessibility={accessibilityLabel ? 'yes' : 'no-hide-descendants'}>
      <Path d={ICON_PATHS[name]} fill={color} />
    </Svg>
  );
}

export const ACTIVITY_ICONS: Record<'walk' | 'run', IconName> = {
  walk: 'walk',
  run: 'run-fast',
};

const ACHIEVEMENT_ICONS: Record<string, IconName> = {
  first_activity: 'flag-variant',
  first_1k: 'shoe-print',
  first_5k: 'map-marker-path',
  first_10k: 'medal',
  first_25k_week: 'calendar-week',
  first_100k_month: 'calendar-month',
  daily_goal_completed: 'target',
  streak_7_days: 'fire',
  personal_best_distance: 'lightning-bolt',
};

export function achievementIcon(type: string): IconName {
  return ACHIEVEMENT_ICONS[type] ?? 'trophy';
}
