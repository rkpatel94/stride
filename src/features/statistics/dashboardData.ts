import { listAchievements, type StoredAchievement } from '@/database/achievementRepository';
import { listActivities, listActivitySummaries } from '@/database/activityRepository';
import { listGoals } from '@/database/goalRepository';
import { getPreferences, type Preferences } from '@/database/preferencesRepository';
import type { SqlDatabase } from '@/database/types';
import type { Activity } from '@/features/activities/types';
import { goalInEffect, goalProgress, type GoalProgress } from '@/features/goals/goals';
import { localDayKey, startOfLocalDay } from '@/utils/dates';

import {
  computeStreaks,
  monthlySummary,
  personalRecords,
  todaySummary,
  weeklySummary,
  type ComparedPeriod,
  type PeriodSummary,
  type PersonalRecords,
  type Streaks,
} from './statistics';

export type DashboardData = {
  today: PeriodSummary;
  goal: GoalProgress | null;
  /** This week with its days and the change against last week. */
  week: ComparedPeriod;
  /** Local midnight of the day the data was loaded for (marks today in the week). */
  todayStartMs: number;
  month: PeriodSummary;
  streaks: Streaks;
  records: PersonalRecords;
  totalActivities: number;
  recent: Activity[];
  achievements: StoredAchievement[];
  preferences: Preferences;
};

export async function loadDashboard(db: SqlDatabase, nowMs = Date.now()): Promise<DashboardData> {
  const [summaries, goals, achievements, preferences, recent] = await Promise.all([
    listActivitySummaries(db),
    listGoals(db),
    listAchievements(db),
    getPreferences(db),
    listActivities(db, { limit: 3 }),
  ]);
  const today = todaySummary(summaries, nowMs);
  const goal = goalInEffect(goals, localDayKey(nowMs));
  return {
    today,
    goal: goal ? goalProgress(goal.targetDistanceMeters, today.totalDistanceMeters) : null,
    week: weeklySummary(summaries, nowMs, preferences.weekStartsOn),
    todayStartMs: startOfLocalDay(nowMs),
    month: monthlySummary(summaries, nowMs).current,
    streaks: computeStreaks(summaries, nowMs),
    records: personalRecords(summaries, preferences.weekStartsOn),
    totalActivities: summaries.length,
    recent,
    achievements,
    preferences,
  };
}
