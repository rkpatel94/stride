import { getDatabase } from '@/database/database';
import { notifyDataChanged } from '@/database/dataEvents';
import { listGoals, upsertGoal } from '@/database/goalRepository';
import { getPreferences } from '@/database/preferencesRepository';
import { writeTransaction } from '@/database/writeQueue';
import { recomputeAchievements } from '@/features/achievements/achievementService';
import { localDayKey } from '@/utils/dates';

import { DEFAULT_GOAL_METERS, goalForPeriod, type GoalPeriod } from './goals';

/**
 * Sets a goal from today onward. A weekly or monthly goal applies to the whole current week or
 * month (see goalForPeriod); earlier periods keep the goal that applied to them.
 */
export async function setGoal(period: GoalPeriod, targetMeters: number): Promise<void> {
  const db = await getDatabase();
  await writeTransaction(db, async () => {
    await upsertGoal(db, { periodType: period, targetDistanceMeters: targetMeters, startDate: localDayKey(Date.now()), enabled: true });
    await recomputeAchievements(db);
  });
  notifyDataChanged();
}

/** Turns a goal off (or back on) from today onward, keeping the last target value. */
export async function setGoalEnabled(period: GoalPeriod, enabled: boolean): Promise<void> {
  const db = await getDatabase();
  const now = Date.now();
  const today = localDayKey(now);
  const [goals, preferences] = await Promise.all([listGoals(db), getPreferences(db)]);
  const latest = goals.filter((goal) => goal.periodType === period && goal.startDate <= today).pop();
  const current = enabled ? goalForPeriod(goals, period, now, preferences.weekStartsOn) : null;
  const target = current?.targetDistanceMeters ?? latest?.targetDistanceMeters ?? DEFAULT_GOAL_METERS[period];
  await writeTransaction(db, async () => {
    await upsertGoal(db, { periodType: period, targetDistanceMeters: target, startDate: today, enabled });
    await recomputeAchievements(db);
  });
  notifyDataChanged();
}
