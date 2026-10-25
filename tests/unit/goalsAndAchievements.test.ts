import { evaluateAchievements } from '@/features/achievements/achievements';
import type { ActivitySummary } from '@/features/activities/types';
import { dailyGoalCompletions, goalInEffect, goalProgress, validateGoalKilometers, type Goal } from '@/features/goals/goals';

let nextId = 1;
const activity = (start: Date, distanceMeters: number, activeSeconds = 1800, overrides: Partial<ActivitySummary> = {}): ActivitySummary => ({
  id: nextId++,
  type: 'walk',
  status: 'completed',
  startedAt: start.getTime(),
  endedAt: start.getTime() + activeSeconds * 1000,
  distanceMeters,
  activeDurationSeconds: activeSeconds,
  elapsedDurationSeconds: activeSeconds,
  ...overrides,
});

const goal = (startDate: string, km: number, enabled = true, id = 1): Goal => ({
  id,
  periodType: 'daily',
  targetDistanceMeters: km * 1000,
  startDate,
  enabled,
  createdAt: id,
  updatedAt: id,
});

describe('goal progress', () => {
  it('reports remaining distance and completion', () => {
    expect(goalProgress(5000, 3200)).toEqual({ targetMeters: 5000, achievedMeters: 3200, remainingMeters: 1800, fraction: 0.64, completed: false });
    expect(goalProgress(5000, 6100)).toMatchObject({ remainingMeters: 0, fraction: 1, completed: true });
    expect(goalProgress(0, 100)).toMatchObject({ fraction: 0, completed: false });
  });

  it('applies the goal row that was in effect on each day', () => {
    const goals = [goal('2024-05-01', 5, true, 1), goal('2024-05-10', 8, true, 2), goal('2024-05-20', 8, false, 3)];
    expect(goalInEffect(goals, '2024-04-30')).toBeNull();
    expect(goalInEffect(goals, '2024-05-05')?.targetDistanceMeters).toBe(5000);
    expect(goalInEffect(goals, '2024-05-10')?.targetDistanceMeters).toBe(8000);
    expect(goalInEffect(goals, '2024-05-25')).toBeNull(); // turned off
  });

  it('lists the days on which the goal was met', () => {
    const goals = [goal('2024-05-01', 5)];
    const history = [
      activity(new Date(2024, 4, 2, 8), 3000),
      activity(new Date(2024, 4, 2, 18), 2500),
      activity(new Date(2024, 4, 3, 8), 4000),
    ];
    expect(dailyGoalCompletions(history, goals).map((c) => c.dayKey)).toEqual(['2024-05-02']);
  });

  it('validates goal input', () => {
    expect(validateGoalKilometers('7,5')).toEqual({ meters: 7500 });
    expect(validateGoalKilometers('0.05')).toHaveProperty('error');
    expect(validateGoalKilometers('abc')).toHaveProperty('error');
    expect(validateGoalKilometers('500')).toHaveProperty('error');
  });
});

describe('achievements', () => {
  const goals = [goal('2024-01-01', 5)];

  it('unlocks distance milestones on the first qualifying activity', () => {
    const history = [
      activity(new Date(2024, 4, 1, 8), 800),
      activity(new Date(2024, 4, 2, 8), 1200),
      activity(new Date(2024, 4, 3, 8), 5100),
      activity(new Date(2024, 4, 4, 8), 4000),
    ];
    const earned = Object.fromEntries(evaluateAchievements(history, goals).map((a) => [a.type, a.activityId]));
    expect(earned.first_activity).toBe(history[0].id);
    expect(earned.first_1k).toBe(history[1].id);
    expect(earned.first_5k).toBe(history[2].id);
    expect(earned.first_10k).toBeUndefined();
    expect(earned.daily_goal_completed).toBe(history[2].id);
    expect(earned.personal_best_distance).toBe(history[1].id);
  });

  it('is idempotent: re-evaluating gives the same single entry per type', () => {
    const history = [activity(new Date(2024, 4, 1, 8), 6000), activity(new Date(2024, 4, 2, 8), 7000)];
    const first = evaluateAchievements(history, goals);
    const second = evaluateAchievements(history, goals);
    expect(second).toEqual(first);
    expect(new Set(first.map((a) => a.type)).size).toBe(first.length);
  });

  it('unlocks the 25 km week and 100 km month on the activity that crosses the line', () => {
    const week = [0, 1, 2, 3, 4].map((offset) => activity(new Date(2024, 4, 6 + offset, 8), 6000));
    const earned = evaluateAchievements(week, goals);
    expect(earned.find((a) => a.type === 'first_25k_week')?.activityId).toBe(week[4].id);

    const month = Array.from({ length: 11 }, (_, i) => activity(new Date(2024, 6, 1 + i * 2, 8), 10000));
    const monthEarned = evaluateAchievements(month, goals);
    expect(monthEarned.find((a) => a.type === 'first_100k_month')?.activityId).toBe(month[9].id);
  });

  it('unlocks the seven-day streak on the seventh consecutive day only', () => {
    const six = Array.from({ length: 6 }, (_, i) => activity(new Date(2024, 4, 10 + i, 8), 1500));
    expect(evaluateAchievements(six, goals).some((a) => a.type === 'streak_7_days')).toBe(false);
    const seventh = activity(new Date(2024, 4, 16, 8), 1500);
    expect(evaluateAchievements([...six, seventh], goals).find((a) => a.type === 'streak_7_days')?.activityId).toBe(seventh.id);
  });

  it('moves or removes achievements when their activity is deleted', () => {
    const a = activity(new Date(2024, 4, 1, 8), 5200);
    const b = activity(new Date(2024, 4, 3, 8), 5300);
    expect(evaluateAchievements([a, b], goals).find((x) => x.type === 'first_5k')?.activityId).toBe(a.id);
    expect(evaluateAchievements([b], goals).find((x) => x.type === 'first_5k')?.activityId).toBe(b.id);
    expect(evaluateAchievements([], goals)).toEqual([]);
  });

  it('ignores unfinished activities', () => {
    const live = activity(new Date(2024, 4, 1, 8), 12000, 3600, { status: 'recording' });
    expect(evaluateAchievements([live], goals)).toEqual([]);
  });
});
