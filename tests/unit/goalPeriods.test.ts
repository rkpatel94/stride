import { evaluateAchievements } from '@/features/achievements/achievements';
import type { ActivitySummary } from '@/features/activities/types';
import {
  currentGoalProgress,
  goalCompletions,
  goalForPeriod,
  goalsReachedBy,
  periodRange,
  validateGoalKilometers,
  type Goal,
  type GoalPeriod,
} from '@/features/goals/goals';
import { localDayKey } from '@/utils/dates';

let nextId = 1;
const activity = (start: Date, meters: number): ActivitySummary => ({
  id: nextId++,
  type: 'walk',
  status: 'completed',
  startedAt: start.getTime(),
  endedAt: start.getTime() + 1_800_000,
  distanceMeters: meters,
  activeDurationSeconds: 1800,
  elapsedDurationSeconds: 1800,
  walkDistanceMeters: meters,
  runDistanceMeters: 0,
});

const goal = (periodType: GoalPeriod, startDate: string, km: number, enabled = true): Goal => ({
  id: nextId++,
  periodType,
  targetDistanceMeters: km * 1000,
  startDate,
  enabled,
  createdAt: 0,
  updatedAt: 0,
});

// Wednesday 15 May 2024, local time.
const WED = new Date(2024, 4, 15, 12).getTime();

describe('weekly and monthly goals', () => {
  it('finds the local day, week and month around a time', () => {
    const week = periodRange('weekly', WED, 1);
    expect(localDayKey(week.startMs)).toBe('2024-05-13');
    expect(localDayKey(week.endMs)).toBe('2024-05-20');
    expect(week.lastDayKey).toBe('2024-05-19');
    expect(periodRange('weekly', WED, 0).lastDayKey).toBe('2024-05-18');
    const month = periodRange('monthly', WED);
    expect(localDayKey(month.startMs)).toBe('2024-05-01');
    expect(month.lastDayKey).toBe('2024-05-31');
    expect(periodRange('daily', WED).lastDayKey).toBe('2024-05-15');
  });

  it('applies a weekly goal set mid-week to that whole week; earlier weeks keep the old goal', () => {
    const goals = [goal('weekly', '2024-05-01', 20), goal('weekly', '2024-05-15', 30)];
    expect(goalForPeriod(goals, 'weekly', new Date(2024, 4, 13, 8).getTime())?.targetDistanceMeters).toBe(30_000);
    expect(goalForPeriod(goals, 'weekly', new Date(2024, 4, 8).getTime())?.targetDistanceMeters).toBe(20_000);
    expect(goalForPeriod(goals, 'weekly', new Date(2024, 3, 20).getTime())).toBeNull();
    // Daily goals are separate rows.
    expect(goalForPeriod(goals, 'daily', WED)).toBeNull();
  });

  it('has no goal for a month in which it was turned off', () => {
    const goals = [goal('monthly', '2024-04-01', 100), goal('monthly', '2024-05-20', 100, false)];
    expect(goalForPeriod(goals, 'monthly', WED)).toBeNull();
    expect(goalForPeriod(goals, 'monthly', new Date(2024, 3, 10).getTime())?.targetDistanceMeters).toBe(100_000);
  });

  it('measures progress and completions per week and per month', () => {
    const goals = [goal('weekly', '2024-01-01', 10), goal('monthly', '2024-01-01', 30)];
    const history = [
      activity(new Date(2024, 4, 6, 9), 6000),
      activity(new Date(2024, 4, 8, 9), 5000),
      activity(new Date(2024, 4, 13, 9), 4000),
      activity(new Date(2024, 4, 15, 9), 3000),
      activity(new Date(2024, 4, 27, 9), 14_000),
    ];
    expect(currentGoalProgress(history, goals, 'weekly', WED)).toMatchObject({ achievedMeters: 7000, remainingMeters: 3000, completed: false });
    expect(currentGoalProgress(history, goals, 'daily', WED)).toBeNull();
    expect(goalCompletions(history, goals, 'weekly').map((c) => localDayKey(c.startMs))).toEqual(['2024-05-06', '2024-05-27']);
    expect(goalCompletions(history, goals, 'monthly').map((c) => localDayKey(c.startMs))).toEqual(['2024-05-01']);

    const earned = evaluateAchievements(history, goals);
    expect(earned.find((a) => a.type === 'weekly_goal_completed')?.activityId).toBe(history[1].id);
    expect(earned.find((a) => a.type === 'monthly_goal_completed')?.activityId).toBe(history[4].id);
  });

  it('says which goals a just-finished workout reached', () => {
    const goals = [goal('daily', '2024-01-01', 5), goal('weekly', '2024-01-01', 10), goal('monthly', '2024-01-01', 100)];
    const before = [activity(new Date(2024, 4, 13, 9), 6000)];
    expect(goalsReachedBy(before, goals, { startedAt: WED, distanceMeters: 5000 })).toEqual(['daily', 'weekly']);
    expect(goalsReachedBy(before, goals, { startedAt: WED, distanceMeters: 3000 })).toEqual([]);
    // The week was already over its goal, so only today's goal is new.
    const already = [...before, activity(new Date(2024, 4, 14, 9), 5000)];
    expect(goalsReachedBy(already, goals, { startedAt: WED, distanceMeters: 5000 })).toEqual(['daily']);
  });

  it('allows longer weekly and monthly targets', () => {
    expect(validateGoalKilometers('250')).toHaveProperty('error');
    expect(validateGoalKilometers('250', 'weekly')).toEqual({ meters: 250_000 });
    expect(validateGoalKilometers('2500', 'monthly')).toEqual({ meters: 2_500_000 });
    expect(validateGoalKilometers('5000', 'monthly')).toHaveProperty('error');
  });
});
