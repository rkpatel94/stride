import type { Goal, GoalPeriod } from '@/features/goals/goals';

import type { SqlDatabase } from './types';

type GoalRow = {
  id: number;
  period_type: GoalPeriod;
  target_distance_meters: number;
  start_date: string;
  enabled: number;
  created_at: number;
  updated_at: number;
};

const mapGoal = (row: GoalRow): Goal => ({
  id: row.id,
  periodType: row.period_type,
  targetDistanceMeters: row.target_distance_meters,
  startDate: row.start_date,
  enabled: row.enabled === 1,
  createdAt: row.created_at,
  updatedAt: row.updated_at,
});

export async function listGoals(db: SqlDatabase): Promise<Goal[]> {
  const rows = await db.getAllAsync<GoalRow>('SELECT * FROM goals ORDER BY start_date ASC, id ASC', []);
  return rows.map(mapGoal);
}

/**
 * Writes the goal that applies from `startDate` onward (one row per period and start day, so
 * changing the goal several times in a day just updates that day's row).
 */
export async function upsertGoal(
  db: SqlDatabase,
  input: { periodType: GoalPeriod; targetDistanceMeters: number; startDate: string; enabled: boolean },
): Promise<void> {
  const now = Date.now();
  await db.runAsync(
    `INSERT INTO goals (period_type, target_distance_meters, start_date, enabled, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?)
     ON CONFLICT (period_type, start_date) DO UPDATE SET
       target_distance_meters = excluded.target_distance_meters,
       enabled = excluded.enabled,
       updated_at = excluded.updated_at`,
    [input.periodType, input.targetDistanceMeters, input.startDate, input.enabled ? 1 : 0, now, now],
  );
}

export async function countGoals(db: SqlDatabase): Promise<number> {
  const row = await db.getFirstAsync<{ count: number }>('SELECT COUNT(*) AS count FROM goals', []);
  return row?.count ?? 0;
}
