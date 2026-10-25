import MaterialCommunityIcons from '@expo/vector-icons/MaterialCommunityIcons';
import type { ComponentProps } from 'react';

export type IconName = ComponentProps<typeof MaterialCommunityIcons>['name'];

type IconProps = {
  name: IconName;
  size?: number;
  color: string;
  accessibilityLabel?: string;
};

export function Icon({ name, size = 22, color, accessibilityLabel }: IconProps) {
  return (
    <MaterialCommunityIcons
      name={name}
      size={size}
      color={color}
      accessibilityLabel={accessibilityLabel}
      accessibilityElementsHidden={!accessibilityLabel}
      importantForAccessibility={accessibilityLabel ? 'yes' : 'no-hide-descendants'}
    />
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
