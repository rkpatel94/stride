import { reconcileAchievements } from '@/database/achievementRepository';
import { listActivitySummaries } from '@/database/activityRepository';
import { listGoals } from '@/database/goalRepository';
import { getPreferences } from '@/database/preferencesRepository';
import type { SqlDatabase } from '@/database/types';

import { evaluateAchievements, type AchievementType } from './achievements';

/**
 * Re-derives achievements from the saved activities and goals. Call inside the same write
 * transaction as the change that could affect them (finish, delete, import, goal change).
 */
export async function recomputeAchievements(db: SqlDatabase): Promise<AchievementType[]> {
  const [activities, goals, preferences] = await Promise.all([
    listActivitySummaries(db),
    listGoals(db),
    getPreferences(db),
  ]);
  return reconcileAchievements(db, evaluateAchievements(activities, goals, preferences.weekStartsOn));
}
