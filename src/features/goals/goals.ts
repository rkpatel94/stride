import type { ActivitySummary } from '@/features/activities/types';
import { isCompleted } from '@/features/statistics/statistics';
import {
  addLocalDays,
  addLocalMonths,
  DEFAULT_WEEK_START,
  localDayKey,
  startOfLocalDay,
  startOfLocalMonth,
  startOfLocalWeek,
  type WeekStart,
} from '@/utils/dates';

export type GoalPeriod = 'daily' | 'weekly' | 'monthly';

export const GOAL_PERIODS: GoalPeriod[] = ['daily', 'weekly', 'monthly'];

/**
 * Goals are versioned by start date: changing the target (or turning goals off) writes a row
 * effective from that day, so past days, weeks and months keep being judged against the target
 * that applied then.
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

export const DEFAULT_GOAL_METERS: Record<GoalPeriod, number> = {
  daily: DEFAULT_DAILY_GOAL_METERS,
  weekly: 25_000,
  monthly: 100_000,
};

export const MAX_GOAL_METERS_FOR: Record<GoalPeriod, number> = {
  daily: MAX_GOAL_METERS,
  weekly: 1_000_000,
  monthly: 3_000_000,
};

export const GOAL_PERIOD_LABELS: Record<GoalPeriod, { title: string; current: string; unit: string }> = {
  daily: { title: 'Daily goal', current: 'Today', unit: 'day' },
  weekly: { title: 'Weekly goal', current: 'This week', unit: 'week' },
  monthly: { title: 'Monthly goal', current: 'This month', unit: 'month' },
};

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

export type PeriodRange = {
  /** Local midnight that starts the period. */
  startMs: number;
  /** Local midnight that starts the next period. */
  endMs: number;
  /** Key of the period's last day. */
  lastDayKey: string;
};

/** The local day, week or month containing `ms`. */
export function periodRange(period: GoalPeriod, ms: number, weekStartsOn: WeekStart = DEFAULT_WEEK_START): PeriodRange {
  let startMs: number;
  let endMs: number;
  if (period === 'daily') {
    startMs = startOfLocalDay(ms);
    endMs = addLocalDays(startMs, 1);
  } else if (period === 'weekly') {
    startMs = startOfLocalWeek(ms, weekStartsOn);
    endMs = addLocalDays(startMs, 7);
  } else {
    startMs = startOfLocalMonth(ms);
    endMs = addLocalMonths(startMs, 1);
  }
  return { startMs, endMs, lastDayKey: localDayKey(addLocalDays(endMs, -1)) };
}

/**
 * The goal for the day, week or month containing `ms`: the row in effect on the period's last
 * day. So a weekly goal set on a Wednesday already counts for that week, and a change of the
 * week's first day never loses a goal.
 */
export function goalForPeriod(goals: Goal[], period: GoalPeriod, ms: number, weekStartsOn: WeekStart = DEFAULT_WEEK_START): Goal | null {
  return goalInEffect(goals, periodRange(period, ms, weekStartsOn).lastDayKey, period);
}

/** Distance of the completed activities that started in the range. */
export function distanceInRange(activities: ActivitySummary[], range: { startMs: number; endMs: number }): number {
  let total = 0;
  for (const activity of activities) {
    if (!isCompleted(activity) || activity.startedAt < range.startMs || activity.startedAt >= range.endMs) continue;
    total += Math.max(0, activity.distanceMeters);
  }
  return total;
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

/** Progress towards the goal of the period containing `nowMs`, or null when that goal is off. */
export function currentGoalProgress(
  activities: ActivitySummary[],
  goals: Goal[],
  period: GoalPeriod,
  nowMs: number,
  weekStartsOn: WeekStart = DEFAULT_WEEK_START,
): GoalProgress | null {
  const goal = goalForPeriod(goals, period, nowMs, weekStartsOn);
  if (!goal) return null;
  return goalProgress(goal.targetDistanceMeters, distanceInRange(activities, periodRange(period, nowMs, weekStartsOn)));
}

export type GoalCompletion = { startMs: number; distanceMeters: number; targetMeters: number };

/** Days, weeks or months (oldest first) in which the goal in effect was met. */
export function goalCompletions(
  activities: ActivitySummary[],
  goals: Goal[],
  period: GoalPeriod,
  weekStartsOn: WeekStart = DEFAULT_WEEK_START,
): GoalCompletion[] {
  const totals = new Map<number, number>();
  for (const activity of activities) {
    if (!isCompleted(activity)) continue;
    const start = periodRange(period, activity.startedAt, weekStartsOn).startMs;
    totals.set(start, (totals.get(start) ?? 0) + Math.max(0, activity.distanceMeters));
  }
  const completions: GoalCompletion[] = [];
  for (const [startMs, distanceMeters] of [...totals].sort(([a], [b]) => a - b)) {
    const goal = goalForPeriod(goals, period, startMs, weekStartsOn);
    if (goal && distanceMeters >= goal.targetDistanceMeters) {
      completions.push({ startMs, distanceMeters, targetMeters: goal.targetDistanceMeters });
    }
  }
  return completions;
}

/** Local days on which the daily goal in effect was met, with that day's distance. */
export function dailyGoalCompletions(
  activities: ActivitySummary[],
  goals: Goal[],
): { dayKey: string; distanceMeters: number; targetMeters: number }[] {
  return goalCompletions(activities, goals, 'daily').map(({ startMs, distanceMeters, targetMeters }) => ({
    dayKey: localDayKey(startMs),
    distanceMeters,
    targetMeters,
  }));
}

/**
 * The goals whose target a just-finished activity reached: the period's total was below the
 * target before it and at or above it after. `completedBefore` must not include the activity.
 */
export function goalsReachedBy(
  completedBefore: ActivitySummary[],
  goals: Goal[],
  activity: { startedAt: number; distanceMeters: number },
  weekStartsOn: WeekStart = DEFAULT_WEEK_START,
): GoalPeriod[] {
  const reached: GoalPeriod[] = [];
  for (const period of GOAL_PERIODS) {
    const goal = goalForPeriod(goals, period, activity.startedAt, weekStartsOn);
    if (!goal) continue;
    const before = distanceInRange(completedBefore, periodRange(period, activity.startedAt, weekStartsOn));
    const after = before + Math.max(0, activity.distanceMeters);
    if (before < goal.targetDistanceMeters && after >= goal.targetDistanceMeters) reached.push(period);
  }
  return reached;
}

export function validateGoalKilometers(input: string, period: GoalPeriod = 'daily'): { meters: number } | { error: string } {
  const normalized = input.trim().replace(',', '.');
  if (!/^\d+(\.\d+)?$/.test(normalized)) return { error: 'Enter a distance such as 5 or 7.5.' };
  const meters = Math.round(Number(normalized) * 1000);
  const max = MAX_GOAL_METERS_FOR[period];
  if (meters < MIN_GOAL_METERS) return { error: 'The goal must be at least 0.1 km.' };
  if (meters > max) return { error: `The goal can be at most ${Math.round(max / 1000).toLocaleString()} km.` };
  return { meters };
}
