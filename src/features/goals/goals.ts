import type { ActivitySummary } from '@/features/activities/types';
import { isCompleted } from '@/features/statistics/statistics';
import { localDayKey } from '@/utils/dates';

export type GoalPeriod = 'daily' | 'weekly' | 'monthly';

/**
 * Goals are versioned by start date: changing the target (or turning goals off) writes a row
 * effective from that day, so past days keep being judged against the target that applied then.
 */
export type Goal = {
  id: number;
  periodType: GoalPeriod;
  targetDistanceMeters: number;
  /** Local day key (YYYY-MM-DD) from which this row applies. */
  startDate: string;
  enabled: boolean;
  createdAt: number;
  updatedAt: number;
};

export const DEFAULT_DAILY_GOAL_METERS = 5000;
export const MIN_GOAL_METERS = 100;
export const MAX_GOAL_METERS = 200_000;

/** The goal row in effect on `dayKey`, or null if none (or goals were turned off). */
export function goalInEffect(goals: Goal[], dayKey: string, periodType: GoalPeriod = 'daily'): Goal | null {
  let best: Goal | null = null;
  for (const goal of goals) {
    if (goal.periodType !== periodType || goal.startDate > dayKey) continue;
    if (
      !best ||
      goal.startDate > best.startDate ||
      (goal.startDate === best.startDate && (goal.updatedAt > best.updatedAt || (goal.updatedAt === best.updatedAt && goal.id > best.id)))
    ) {
      best = goal;
    }
  }
  return best && best.enabled ? best : null;
}

export type GoalProgress = {
  targetMeters: number;
  achievedMeters: number;
  remainingMeters: number;
  fraction: number;
  completed: boolean;
};

export function goalProgress(targetMeters: number, achievedMeters: number): GoalProgress {
  const target = Math.max(0, targetMeters);
  const achieved = Math.max(0, achievedMeters);
  return {
    targetMeters: target,
    achievedMeters: achieved,
    remainingMeters: Math.max(0, target - achieved),
    fraction: target > 0 ? Math.min(1, achieved / target) : 0,
    completed: target > 0 && achieved >= target,
  };
}

/** Local days on which the daily goal in effect was met, with that day's distance. */
export function dailyGoalCompletions(
  activities: ActivitySummary[],
  goals: Goal[],
): { dayKey: string; distanceMeters: number; targetMeters: number }[] {
  const totals = new Map<string, number>();
  for (const activity of activities) {
    if (!isCompleted(activity)) continue;
    const key = localDayKey(activity.startedAt);
    totals.set(key, (totals.get(key) ?? 0) + Math.max(0, activity.distanceMeters));
  }
  const completions: { dayKey: string; distanceMeters: number; targetMeters: number }[] = [];
  for (const [dayKey, distanceMeters] of [...totals].sort(([a], [b]) => (a < b ? -1 : 1))) {
    const goal = goalInEffect(goals, dayKey);
    if (goal && distanceMeters >= goal.targetDistanceMeters) {
      completions.push({ dayKey, distanceMeters, targetMeters: goal.targetDistanceMeters });
    }
  }
  return completions;
}

export function validateGoalKilometers(input: string): { meters: number } | { error: string } {
  const normalized = input.trim().replace(',', '.');
  if (!/^\d+(\.\d+)?$/.test(normalized)) return { error: 'Enter a distance such as 5 or 7.5.' };
  const meters = Math.round(Number(normalized) * 1000);
  if (meters < MIN_GOAL_METERS) return { error: 'The goal must be at least 0.1 km.' };
  if (meters > MAX_GOAL_METERS) return { error: 'The goal can be at most 200 km.' };
  return { meters };
}
