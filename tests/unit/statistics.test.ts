import type { ActivitySummary } from '@/features/activities/types';
import {
  computeStreaks,
  dailyTotals,
  isEligible,
  monthlySummary,
  personalRecords,
  summarizePeriod,
  todaySummary,
  weeklySummary,
} from '@/features/statistics/statistics';
import { localDayKey, startOfLocalWeek } from '@/utils/dates';

let nextId = 1;
function activity(
  start: Date,
  distanceMeters: number,
  activeSeconds: number,
  overrides: Partial<ActivitySummary> = {},
): ActivitySummary {
  const startedAt = start.getTime();
  const type = overrides.type ?? 'walk';
  return {
    id: nextId++,
    type,
    status: 'completed',
    startedAt,
    endedAt: startedAt + activeSeconds * 1000,
    distanceMeters,
    activeDurationSeconds: activeSeconds,
    elapsedDurationSeconds: activeSeconds,
    walkDistanceMeters: type === 'walk' ? distanceMeters : 0,
    runDistanceMeters: type === 'run' ? distanceMeters : 0,
    ...overrides,
  };
}

// Wednesday 15 May 2024, local time.
const NOW = new Date(2024, 4, 15, 18, 0, 0).getTime();
const day = (offset: number, hour = 9) => new Date(2024, 4, 15 + offset, hour, 0, 0);

describe('calendar grouping', () => {
  it('weeks start on Monday by default', () => {
    expect(new Date(startOfLocalWeek(NOW)).getDay()).toBe(1);
    expect(localDayKey(startOfLocalWeek(NOW))).toBe('2024-05-13');
    expect(localDayKey(startOfLocalWeek(NOW, 0))).toBe('2024-05-12');
  });

  it('assigns an activity crossing midnight to the day it started', () => {
    const lateRun = activity(new Date(2024, 4, 14, 23, 40), 6000, 2400, { type: 'run' });
    const totals = dailyTotals([lateRun], new Date(2024, 4, 14).getTime(), 2);
    expect(totals.map((d) => [d.dayKey, d.totalMeters])).toEqual([
      ['2024-05-14', 6000],
      ['2024-05-15', 0],
    ]);
    expect(todaySummary([lateRun], NOW).totalDistanceMeters).toBe(0);
  });
});

describe('period summaries', () => {
  const activities = [
    activity(day(0, 7), 3000, 1800),
    activity(day(0, 12), 5000, 1500, { type: 'run' }),
    activity(day(-1), 2000, 1200),
    activity(day(-8), 10000, 3600, { type: 'run' }), // previous week (Tue 7 May)
    activity(day(-20), 4000, 2400), // previous month? No: 25 April
    activity(day(0, 15), 9999, 3000, { status: 'recovering' }), // unfinished: ignored
  ];

  it('summarizes today with a walk/run breakdown and ignores unfinished activities', () => {
    const today = todaySummary(activities, NOW);
    expect(today.walkDistanceMeters).toBe(3000);
    expect(today.runDistanceMeters).toBe(5000);
    expect(today.totalDistanceMeters).toBe(8000);
    expect(today.activityCount).toBe(2);
    expect(today.activeDurationSeconds).toBe(3300);
  });

  it('computes combined pace as total time / total distance, not an average of paces', () => {
    const today = todaySummary(activities, NOW);
    // 3300 s over 8 km = 412.5 s/km. (Average of 600 and 300 would wrongly give 450.)
    expect(today.averagePaceSecondsPerKm).toBeCloseTo(412.5, 6);
  });

  it('compares the week with the previous week', () => {
    const week = weeklySummary(activities, NOW);
    expect(week.current.totalDistanceMeters).toBe(10000);
    expect(week.previous.totalDistanceMeters).toBe(10000);
    expect(week.distanceChange).toBeCloseTo(0, 9);
    expect(week.days).toHaveLength(7);
    expect(week.days[2].totalMeters).toBe(8000); // Wednesday
  });

  it('compares the month with the previous month', () => {
    const month = monthlySummary(activities, NOW);
    expect(month.current.totalDistanceMeters).toBe(20000);
    expect(month.previous.totalDistanceMeters).toBe(4000);
    expect(month.distanceChange).toBeCloseTo(4, 9);
    expect(month.days).toHaveLength(31);
  });

  it('handles an empty history', () => {
    const empty = summarizePeriod([], 0, NOW);
    expect(empty.totalDistanceMeters).toBe(0);
    expect(empty.averagePaceSecondsPerKm).toBeNull();
    expect(weeklySummary([], NOW).distanceChange).toBeNull();
  });
});

describe('eligibility', () => {
  it('excludes very short recordings from records and streaks but not from totals', () => {
    const tiny = activity(day(0), 40, 20);
    expect(isEligible(tiny)).toBe(false);
    expect(todaySummary([tiny], NOW).totalDistanceMeters).toBe(40);
    expect(todaySummary([tiny], NOW).averagePaceSecondsPerKm).toBeNull();
    expect(computeStreaks([tiny], NOW).current).toBe(0);
  });
});

describe('streaks', () => {
  it('counts consecutive days ending today', () => {
    const streak = computeStreaks([activity(day(0), 1000, 600), activity(day(-1), 1000, 600), activity(day(-2), 1000, 600)], NOW);
    expect(streak).toEqual({ current: 3, longest: 3, activeToday: true });
  });

  it('keeps the streak alive today when the last activity was yesterday', () => {
    const streak = computeStreaks([activity(day(-1), 1000, 600), activity(day(-2), 1000, 600)], NOW);
    expect(streak.current).toBe(2);
    expect(streak.activeToday).toBe(false);
  });

  it('resets after a missed day and remembers the longest run', () => {
    const history = [
      activity(day(-10), 1000, 600),
      activity(day(-9), 1000, 600),
      activity(day(-8), 1000, 600),
      activity(day(-7), 1000, 600),
      activity(day(-2), 1000, 600),
    ];
    expect(computeStreaks(history, NOW)).toEqual({ current: 0, longest: 4, activeToday: false });
  });

  it('counts two activities on one day once', () => {
    expect(computeStreaks([activity(day(0, 7), 1000, 600), activity(day(0, 19), 1000, 600)], NOW).current).toBe(1);
  });
});

describe('personal records', () => {
  it('finds longest, fastest (≥ 1 km), highest week and month, and lifetime totals', () => {
    const history = [
      activity(day(-30), 8000, 3000),
      activity(day(-3), 5000, 1500, { type: 'run' }), // 5:00 /km
      activity(day(-2), 900, 200, { type: 'run' }), // faster but < 1 km
      activity(day(-1), 12000, 5400),
    ];
    const records = personalRecords(history);
    expect(records.longestDistance?.value).toBe(12000);
    expect(records.longestDuration?.value).toBe(5400);
    expect(records.fastestPace?.value).toBe(300);
    // Sun 12 May belongs to the previous Monday-based week, so the best week is Mon 13 – Sun 19 May.
    expect(records.highestWeek?.totalMeters).toBe(12900);
    expect(records.highestMonth?.totalMeters).toBe(17900);
    expect(records.lifetimeDistanceMeters).toBe(25900);
    expect(records.completedActivities).toBe(4);
  });
});
