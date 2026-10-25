import { getDatabase } from '@/database/database';
import { notifyDataChanged } from '@/database/dataEvents';
import { listGoals, upsertGoal } from '@/database/goalRepository';
import { writeTransaction } from '@/database/writeQueue';
import { recomputeAchievements } from '@/features/achievements/achievementService';
import { localDayKey } from '@/utils/dates';

import { DEFAULT_DAILY_GOAL_METERS, goalInEffect } from './goals';

/** Sets the daily goal from today onward; earlier days keep the goal that applied to them. */
export async function setDailyGoal(targetMeters: number): Promise<void> {
  const db = await getDatabase();
  await writeTransaction(db, async () => {
    await upsertGoal(db, { periodType: 'daily', targetDistanceMeters: targetMeters, startDate: localDayKey(Date.now()), enabled: true });
    await recomputeAchievements(db);
  });
  notifyDataChanged();
}

/** Turns the daily goal off (or back on) from today onward, keeping the last target value. */
export async function setDailyGoalEnabled(enabled: boolean): Promise<void> {
  const db = await getDatabase();
  const today = localDayKey(Date.now());
  const goals = await listGoals(db);
  const latest = goals.filter((goal) => goal.periodType === 'daily' && goal.startDate <= today).pop();
  const target = (enabled ? goalInEffect(goals, today)?.targetDistanceMeters : undefined) ?? latest?.targetDistanceMeters ?? DEFAULT_DAILY_GOAL_METERS;
  await writeTransaction(db, async () => {
    await upsertGoal(db, { periodType: 'daily', targetDistanceMeters: target, startDate: today, enabled });
    await recomputeAchievements(db);
  });
  notifyDataChanged();
}
