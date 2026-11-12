import type { ActivitySummary } from '@/features/activities/types';
import { goalForPeriod, goalInEffect, type Goal } from '@/features/goals/goals';
import { isCompleted, isEligible } from '@/features/statistics/statistics';
import {
  DEFAULT_WEEK_START,
  localDayKey,
  previousDayKey,
  startOfLocalMonth,
  startOfLocalWeek,
  type WeekStart,
} from '@/utils/dates';

/**
 * Achievements are derived data: they are recomputed from the saved activities with the
 * deterministic rules below and reconciled with the achievements table. Re-running the
 * evaluation never creates duplicates (one row per type, enforced by a UNIQUE constraint),
 * and deleting an activity moves or removes the achievements that depended on it.
 */

export type AchievementType =
  | 'first_activity'
  | 'first_1k'
  | 'first_5k'
  | 'first_10k'
  | 'first_25k_week'
  | 'first_100k_month'
  | 'daily_goal_completed'
  | 'weekly_goal_completed'
  | 'monthly_goal_completed'
  | 'streak_7_days'
  | 'personal_best_distance';

export type AchievementDefinition = {
  type: AchievementType;
  title: string;
  description: string;
  /** Material Symbols icon name. */
  icon: string;
};

export const ACHIEVEMENTS: AchievementDefinition[] = [
  { type: 'first_activity', title: 'First steps', description: 'Complete your first activity.', icon: 'flag' },
  { type: 'first_1k', title: 'First kilometer', description: 'Cover 1 km in a single activity.', icon: 'directions_walk' },
  { type: 'first_5k', title: 'First 5K', description: 'Cover 5 km in a single activity.', icon: 'directions_run' },
  { type: 'first_10k', title: 'First 10K', description: 'Cover 10 km in a single activity.', icon: 'military_tech' },
  { type: 'first_25k_week', title: '25 km week', description: 'Cover 25 km in one calendar week.', icon: 'date_range' },
  { type: 'first_100k_month', title: '100 km month', description: 'Cover 100 km in one calendar month.', icon: 'calendar_month' },
  { type: 'daily_goal_completed', title: 'Daily goal reached', description: 'Reach your daily distance goal.', icon: 'task_alt' },
  { type: 'weekly_goal_completed', title: 'Weekly goal reached', description: 'Reach your weekly distance goal.', icon: 'event_available' },
  { type: 'monthly_goal_completed', title: 'Monthly goal reached', description: 'Reach your monthly distance goal.', icon: 'calendar_today' },
  { type: 'streak_7_days', title: 'Seven-day streak', description: 'Be active seven days in a row.', icon: 'local_fire_department' },
  {
    type: 'personal_best_distance',
    title: 'Personal best',
    description: 'Go further than ever before in a single activity.',
    icon: 'trending_up',
  },
];

export type EarnedAchievement = {
  type: AchievementType;
  unlockedAt: number;
  activityId: number | null;
  metadata: Record<string, number | string>;
};

const unlockTime = (activity: ActivitySummary) => activity.endedAt ?? activity.startedAt;

export function evaluateAchievements(
  activities: ActivitySummary[],
  goals: Goal[],
  weekStartsOn: WeekStart = DEFAULT_WEEK_START,
): EarnedAchievement[] {
  const completed = activities
    .filter(isCompleted)
    .sort((a, b) => a.startedAt - b.startedAt || a.id - b.id);
  const earned = new Map<AchievementType, EarnedAchievement>();
  const unlock = (type: AchievementType, activity: ActivitySummary, metadata: EarnedAchievement['metadata'] = {}) => {
    if (!earned.has(type)) earned.set(type, { type, unlockedAt: unlockTime(activity), activityId: activity.id, metadata });
  };

  const weekTotals = new Map<number, number>();
  const monthTotals = new Map<number, number>();
  const dayTotals = new Map<string, number>();
  let bestDistance: number | null = null;

  for (const activity of completed) {
    const distance = Math.max(0, activity.distanceMeters);

    if (isEligible(activity)) unlock('first_activity', activity);
    if (distance >= 1000) unlock('first_1k', activity, { distanceMeters: distance });
    if (distance >= 5000) unlock('first_5k', activity, { distanceMeters: distance });
    if (distance >= 10000) unlock('first_10k', activity, { distanceMeters: distance });

    const week = startOfLocalWeek(activity.startedAt, weekStartsOn);
    const weekTotal = (weekTotals.get(week) ?? 0) + distance;
    weekTotals.set(week, weekTotal);
    if (weekTotal >= 25_000) unlock('first_25k_week', activity, { weekStart: week, distanceMeters: weekTotal });
    const weekGoal = goalForPeriod(goals, 'weekly', activity.startedAt, weekStartsOn);
    if (weekGoal && weekTotal >= weekGoal.targetDistanceMeters) {
      unlock('weekly_goal_completed', activity, { weekStart: week, targetMeters: weekGoal.targetDistanceMeters });
    }

    const month = startOfLocalMonth(activity.startedAt);
    const monthTotal = (monthTotals.get(month) ?? 0) + distance;
    monthTotals.set(month, monthTotal);
    if (monthTotal >= 100_000) unlock('first_100k_month', activity, { monthStart: month, distanceMeters: monthTotal });
    const monthGoal = goalForPeriod(goals, 'monthly', activity.startedAt, weekStartsOn);
    if (monthGoal && monthTotal >= monthGoal.targetDistanceMeters) {
      unlock('monthly_goal_completed', activity, { monthStart: month, targetMeters: monthGoal.targetDistanceMeters });
    }

    const day = localDayKey(activity.startedAt);
    const dayTotal = (dayTotals.get(day) ?? 0) + distance;
    dayTotals.set(day, dayTotal);
    const goal = goalInEffect(goals, day);
    if (goal && dayTotal >= goal.targetDistanceMeters) {
      unlock('daily_goal_completed', activity, { day, targetMeters: goal.targetDistanceMeters });
    }

    if (isEligible(activity)) {
      if (bestDistance !== null && distance > bestDistance) {
        unlock('personal_best_distance', activity, { distanceMeters: distance, previousBestMeters: bestDistance });
      }
      bestDistance = bestDistance === null ? distance : Math.max(bestDistance, distance);
    }
  }

  // Seven consecutive local days with an eligible activity; unlocked by the first eligible
  // activity of the seventh day.
  const firstEligibleOfDay = new Map<string, ActivitySummary>();
  for (const activity of completed) {
    if (!isEligible(activity)) continue;
    const day = localDayKey(activity.startedAt);
    if (!firstEligibleOfDay.has(day)) firstEligibleOfDay.set(day, activity);
  }
  let run = 0;
  let previous: string | null = null;
  for (const day of [...firstEligibleOfDay.keys()].sort()) {
    run = previous !== null && previousDayKey(day) === previous ? run + 1 : 1;
    previous = day;
    if (run >= 7) {
      unlock('streak_7_days', firstEligibleOfDay.get(day) as ActivitySummary, { day });
      break;
    }
  }

  return ACHIEVEMENTS.map((definition) => earned.get(definition.type)).filter(
    (achievement): achievement is EarnedAchievement => achievement !== undefined,
  );
}

export function definitionFor(type: string): AchievementDefinition | undefined {
  return ACHIEVEMENTS.find((definition) => definition.type === type);
}
