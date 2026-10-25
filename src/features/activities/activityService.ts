import { deleteActivity, getActivity, updateActivityType } from '@/database/activityRepository';
import { getDatabase } from '@/database/database';
import { notifyDataChanged } from '@/database/dataEvents';
import { writeTransaction } from '@/database/writeQueue';
import { recomputeAchievements } from '@/features/achievements/achievementService';

import type { ActivityType } from './types';

/**
 * Deletes a completed activity with its route points, then re-derives achievements so nothing
 * still refers to it. Statistics, goals and streaks are always computed from the remaining rows.
 */
export async function deleteCompletedActivity(activityId: number): Promise<void> {
  const db = await getDatabase();
  const activity = await getActivity(db, activityId);
  if (!activity) return;
  if (activity.status !== 'completed') {
    throw new Error('This workout is still in progress. Finish or discard it from the Track screen.');
  }
  await writeTransaction(db, async () => {
    await deleteActivity(db, activityId);
    await recomputeAchievements(db);
  });
  notifyDataChanged();
}

/** Corrects a walk recorded as a run (or vice versa). Distance and route are unchanged. */
export async function changeActivityType(activityId: number, type: ActivityType): Promise<void> {
  const db = await getDatabase();
  await writeTransaction(db, async () => {
    await updateActivityType(db, activityId, type);
    await recomputeAchievements(db);
  });
  notifyDataChanged();
}
