import type { ActivitySummary, ActivityType } from '@/features/activities/types';
import { ELIGIBILITY } from '@/features/tracking/trackingConfig';
import {
  addLocalDays,
  addLocalMonths,
  daysInLocalMonth,
  DEFAULT_WEEK_START,
  localDayKey,
  previousDayKey,
  startOfLocalDay,
  startOfLocalMonth,
  startOfLocalWeek,
  type WeekStart,
} from '@/utils/dates';
import { averagePaceSecondsPerKm } from '@/utils/pace';

/**
 * Statistics rules (also documented in README):
 *  - Only completed activities count. Live, paused or interrupted sessions never do.
 *  - An activity belongs to the local calendar day/week/month in which it started.
 *  - Distance and duration totals include every completed activity.
 *  - "Eligible" activities (≥ 100 m and ≥ 60 s active) are used for streaks, records and pace,
 *    so a test recording of a few seconds doesn't distort them.
 *  - Average pace over several activities = total eligible active time ÷ total eligible distance.
 */

export const isCompleted = (activity: ActivitySummary) => activity.status === 'completed';

export function isEligible(activity: ActivitySummary): boolean {
  return (
    isCompleted(activity) &&
    activity.distanceMeters >= ELIGIBILITY.minDistanceMeters &&
    (activity.activeDurationSeconds ?? 0) >= ELIGIBILITY.minActiveSeconds
  );
}

const activeSecondsOf = (activity: ActivitySummary) => Math.max(0, activity.activeDurationSeconds ?? 0);
const distanceOf = (activity: ActivitySummary) => Math.max(0, activity.distanceMeters);

export type PeriodSummary = {
  startMs: number;
  endMs: number;
  totalDistanceMeters: number;
  walkDistanceMeters: number;
  runDistanceMeters: number;
  activityCount: number;
  walkCount: number;
  runCount: number;
  activeDurationSeconds: number;
  averagePaceSecondsPerKm: number | null;
};

/** Completed activities that started in [startMs, endMs). */
export function summarizePeriod(activities: ActivitySummary[], startMs: number, endMs: number): PeriodSummary {
  const summary: PeriodSummary = {
    startMs,
    endMs,
    totalDistanceMeters: 0,
    walkDistanceMeters: 0,
    runDistanceMeters: 0,
    activityCount: 0,
    walkCount: 0,
    runCount: 0,
    activeDurationSeconds: 0,
    averagePaceSecondsPerKm: null,
  };
  let eligibleSeconds = 0;
  let eligibleMeters = 0;
  for (const activity of activities) {
    if (!isCompleted(activity) || activity.startedAt < startMs || activity.startedAt >= endMs) continue;
    const distance = distanceOf(activity);
    summary.totalDistanceMeters += distance;
    summary.activityCount += 1;
    summary.activeDurationSeconds += activeSecondsOf(activity);
    // Distance by part (a workout can be part walk, part run); counts by main type, so walks and
    // runs add up to the number of activities.
    summary.walkDistanceMeters += Math.max(0, activity.walkDistanceMeters);
    summary.runDistanceMeters += Math.max(0, activity.runDistanceMeters);
    if (activity.type === 'run') summary.runCount += 1;
    else summary.walkCount += 1;
    if (isEligible(activity)) {
      eligibleSeconds += activeSecondsOf(activity);
      eligibleMeters += distance;
    }
  }
  summary.averagePaceSecondsPerKm = averagePaceSecondsPerKm(eligibleSeconds, eligibleMeters);
  return summary;
}

export type DayTotal = {
  dayKey: string;
  startMs: number;
  walkMeters: number;
  runMeters: number;
  totalMeters: number;
  activityCount: number;
};

/** Per-day totals for `days` consecutive local days starting at the day containing `startMs`. */
export function dailyTotals(activities: ActivitySummary[], startMs: number, days: number): DayTotal[] {
  const result: DayTotal[] = [];
  const index = new Map<string, DayTotal>();
  let cursor = startOfLocalDay(startMs);
  for (let i = 0; i < days; i += 1) {
    const day: DayTotal = { dayKey: localDayKey(cursor), startMs: cursor, walkMeters: 0, runMeters: 0, totalMeters: 0, activityCount: 0 };
    result.push(day);
    index.set(day.dayKey, day);
    cursor = addLocalDays(cursor, 1);
  }
  for (const activity of activities) {
    if (!isCompleted(activity)) continue;
    const day = index.get(localDayKey(activity.startedAt));
    if (!day) continue;
    day.walkMeters += Math.max(0, activity.walkDistanceMeters);
    day.runMeters += Math.max(0, activity.runDistanceMeters);
    day.totalMeters += distanceOf(activity);
    day.activityCount += 1;
  }
  return result;
}

export type ComparedPeriod = {
  current: PeriodSummary;
  previous: PeriodSummary;
  /** Relative change of total distance vs the previous period; null when the previous was 0. */
  distanceChange: number | null;
  days: DayTotal[];
};

function compare(current: PeriodSummary, previous: PeriodSummary, days: DayTotal[]): ComparedPeriod {
  const distanceChange =
    previous.totalDistanceMeters > 0
      ? (current.totalDistanceMeters - previous.totalDistanceMeters) / previous.totalDistanceMeters
      : null;
  return { current, previous, distanceChange, days };
}

export function todaySummary(activities: ActivitySummary[], nowMs: number): PeriodSummary {
  const start = startOfLocalDay(nowMs);
  return summarizePeriod(activities, start, addLocalDays(start, 1));
}

export function weeklySummary(
  activities: ActivitySummary[],
  nowMs: number,
  weekStartsOn: WeekStart = DEFAULT_WEEK_START,
): ComparedPeriod {
  const start = startOfLocalWeek(nowMs, weekStartsOn);
  const end = addLocalDays(start, 7);
  const previousStart = addLocalDays(start, -7);
  return compare(
    summarizePeriod(activities, start, end),
    summarizePeriod(activities, previousStart, start),
    dailyTotals(activities, start, 7),
  );
}

export function monthlySummary(activities: ActivitySummary[], nowMs: number): ComparedPeriod {
  const start = startOfLocalMonth(nowMs);
  const end = addLocalMonths(start, 1);
  const previousStart = addLocalMonths(start, -1);
  return compare(
    summarizePeriod(activities, start, end),
    summarizePeriod(activities, previousStart, start),
    dailyTotals(activities, start, daysInLocalMonth(start)),
  );
}

export type WeekTotal = { startMs: number; totalMeters: number };

/** Weekly totals for the `count` weeks ending with the current one (oldest first). */
export function weeklyTrend(
  activities: ActivitySummary[],
  nowMs: number,
  count: number,
  weekStartsOn: WeekStart = DEFAULT_WEEK_START,
): WeekTotal[] {
  const currentStart = startOfLocalWeek(nowMs, weekStartsOn);
  const weeks: WeekTotal[] = [];
  for (let i = count - 1; i >= 0; i -= 1) {
    const start = addLocalDays(currentStart, -7 * i);
    weeks.push({ startMs: start, totalMeters: summarizePeriod(activities, start, addLocalDays(start, 7)).totalDistanceMeters });
  }
  return weeks;
}

export type Streaks = {
  current: number;
  longest: number;
  activeToday: boolean;
};

/**
 * A streak is a run of consecutive local days with at least one eligible completed activity.
 * The current streak stays alive through today until the day is over: if today has no activity
 * yet, it counts back from yesterday.
 */
export function computeStreaks(activities: ActivitySummary[], nowMs: number): Streaks {
  const days = new Set<string>();
  for (const activity of activities) {
    if (isEligible(activity)) days.add(localDayKey(activity.startedAt));
  }
  const today = localDayKey(nowMs);
  const activeToday = days.has(today);

  let current = 0;
  let cursor = activeToday ? today : previousDayKey(today);
  while (days.has(cursor)) {
    current += 1;
    cursor = previousDayKey(cursor);
  }

  let longest = 0;
  const sorted = [...days].sort();
  let run = 0;
  let previous: string | null = null;
  for (const day of sorted) {
    run = previous !== null && previousDayKey(day) === previous ? run + 1 : 1;
    longest = Math.max(longest, run);
    previous = day;
  }
  return { current, longest, activeToday };
}

export type ActivityRecord = { activityId: number; value: number; startedAt: number; type: ActivityType };
export type PeriodRecord = { startMs: number; totalMeters: number };

export type PersonalRecords = {
  longestDistance: ActivityRecord | null;
  longestDuration: ActivityRecord | null;
  /** Lowest average pace (s/km) among eligible activities of at least 1 km. */
  fastestPace: ActivityRecord | null;
  highestWeek: PeriodRecord | null;
  highestMonth: PeriodRecord | null;
  lifetimeDistanceMeters: number;
  lifetimeActiveSeconds: number;
  completedActivities: number;
};

export function personalRecords(
  activities: ActivitySummary[],
  weekStartsOn: WeekStart = DEFAULT_WEEK_START,
): PersonalRecords {
  const records: PersonalRecords = {
    longestDistance: null,
    longestDuration: null,
    fastestPace: null,
    highestWeek: null,
    highestMonth: null,
    lifetimeDistanceMeters: 0,
    lifetimeActiveSeconds: 0,
    completedActivities: 0,
  };
  const weeks = new Map<number, number>();
  const months = new Map<number, number>();

  for (const activity of activities) {
    if (!isCompleted(activity)) continue;
    const distance = distanceOf(activity);
    const seconds = activeSecondsOf(activity);
    records.lifetimeDistanceMeters += distance;
    records.lifetimeActiveSeconds += seconds;
    records.completedActivities += 1;

    const weekStart = startOfLocalWeek(activity.startedAt, weekStartsOn);
    weeks.set(weekStart, (weeks.get(weekStart) ?? 0) + distance);
    const monthStart = startOfLocalMonth(activity.startedAt);
    months.set(monthStart, (months.get(monthStart) ?? 0) + distance);

    if (!isEligible(activity)) continue;
    const base = { activityId: activity.id, startedAt: activity.startedAt, type: activity.type };
    if (!records.longestDistance || distance > records.longestDistance.value) {
      records.longestDistance = { ...base, value: distance };
    }
    if (!records.longestDuration || seconds > records.longestDuration.value) {
      records.longestDuration = { ...base, value: seconds };
    }
    if (distance >= ELIGIBILITY.minPaceRecordDistanceMeters) {
      const pace = averagePaceSecondsPerKm(seconds, distance);
      if (pace !== null && (!records.fastestPace || pace < records.fastestPace.value)) {
        records.fastestPace = { ...base, value: pace };
      }
    }
  }

  for (const [startMs, totalMeters] of weeks) {
    if (totalMeters > 0 && (!records.highestWeek || totalMeters > records.highestWeek.totalMeters)) {
      records.highestWeek = { startMs, totalMeters };
    }
  }
  for (const [startMs, totalMeters] of months) {
    if (totalMeters > 0 && (!records.highestMonth || totalMeters > records.highestMonth.totalMeters)) {
      records.highestMonth = { startMs, totalMeters };
    }
  }
  return records;
}
