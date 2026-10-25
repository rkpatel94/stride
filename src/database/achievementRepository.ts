import type { AchievementType, EarnedAchievement } from '@/features/achievements/achievements';

import type { SqlDatabase } from './types';

export type StoredAchievement = {
  id: number;
  type: AchievementType;
  unlockedAt: number;
  activityId: number | null;
  metadata: Record<string, number | string>;
};

type AchievementRow = {
  id: number;
  achievement_type: AchievementType;
  unlocked_at: number;
  activity_id: number | null;
  metadata_json: string | null;
};

function parseMetadata(json: string | null): Record<string, number | string> {
  if (!json) return {};
  try {
    const parsed = JSON.parse(json) as unknown;
    return parsed && typeof parsed === 'object' ? (parsed as Record<string, number | string>) : {};
  } catch {
    return {};
  }
}

export async function listAchievements(db: SqlDatabase): Promise<StoredAchievement[]> {
  const rows = await db.getAllAsync<AchievementRow>('SELECT * FROM achievements ORDER BY unlocked_at ASC', []);
  return rows.map((row) => ({
    id: row.id,
    type: row.achievement_type,
    unlockedAt: row.unlocked_at,
    activityId: row.activity_id,
    metadata: parseMetadata(row.metadata_json),
  }));
}

/**
 * Makes the table match the freshly evaluated set: inserts new achievements, updates ones whose
 * unlocking activity changed, and removes ones that no longer hold (their activity was deleted).
 * Run inside a transaction. Returns the types that are newly unlocked.
 */
export async function reconcileAchievements(db: SqlDatabase, earned: EarnedAchievement[]): Promise<AchievementType[]> {
  const existing = await listAchievements(db);
  const existingByType = new Map(existing.map((achievement) => [achievement.type, achievement]));
  const earnedTypes = new Set(earned.map((achievement) => achievement.type));
  const unlocked: AchievementType[] = [];

  for (const achievement of earned) {
    const current = existingByType.get(achievement.type);
    const metadata = JSON.stringify(achievement.metadata);
    if (!current) {
      await db.runAsync(
        `INSERT INTO achievements (achievement_type, unlocked_at, activity_id, metadata_json) VALUES (?, ?, ?, ?)
         ON CONFLICT (achievement_type) DO NOTHING`,
        [achievement.type, achievement.unlockedAt, achievement.activityId, metadata],
      );
      unlocked.push(achievement.type);
    } else if (
      current.activityId !== achievement.activityId ||
      current.unlockedAt !== achievement.unlockedAt ||
      JSON.stringify(current.metadata) !== metadata
    ) {
      await db.runAsync(
        'UPDATE achievements SET unlocked_at = ?, activity_id = ?, metadata_json = ? WHERE achievement_type = ?',
        [achievement.unlockedAt, achievement.activityId, metadata, achievement.type],
      );
    }
  }
  for (const achievement of existing) {
    if (!earnedTypes.has(achievement.type)) {
      await db.runAsync('DELETE FROM achievements WHERE achievement_type = ?', [achievement.type]);
    }
  }
  return unlocked;
}
