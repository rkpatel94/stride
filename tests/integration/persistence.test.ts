import { listAchievements, reconcileAchievements } from '@/database/achievementRepository';
import {
  completeActivity,
  createActivity,
  deleteActivity,
  getActivity,
  listActivities,
  listActivitySummaries,
} from '@/database/activityRepository';
import { listGoals, upsertGoal } from '@/database/goalRepository';
import { LATEST_SCHEMA_VERSION, migrate } from '@/database/migrations';
import { getPreferences, setPreference } from '@/database/preferencesRepository';
import { countRoutePoints, insertRoutePoints, type NewRoutePoint } from '@/database/routePointRepository';
import { newTrackingState, saveTrackingState, getTrackingState } from '@/database/trackingStateRepository';
import { recomputeAchievements } from '@/features/achievements/achievementService';
import { evaluateAchievements } from '@/features/achievements/achievements';
import { createBackup, importBackup, parseBackup } from '@/features/backup/backup';
import { summarizeQuality } from '@/features/tracking/gpsQuality';
import { createQualityCounters } from '@/features/tracking/gpsFilter';
import { todaySummary, weeklySummary } from '@/features/statistics/statistics';
import { localDayKey } from '@/utils/dates';

import { createTestDatabase, type TestDatabase } from '../support/testDatabase';

let db: TestDatabase;

beforeEach(async () => {
  db = await createTestDatabase();
});
afterEach(() => db.close());

async function addCompletedActivity(startedAt: number, distanceMeters: number, type: 'walk' | 'run' = 'walk', points = 3) {
  const id = await createActivity(db, { type, startedAt });
  const rows: NewRoutePoint[] = Array.from({ length: points }, (_, i) => ({
    activityId: id,
    sequenceNumber: i,
    segmentIndex: 0,
    latitude: 51.5 + i * 0.0001,
    longitude: -0.12,
    recordedAt: startedAt + i * 1000,
    elapsedRealtimeMs: 1_000_000 + i * 1000,
    accuracyMeters: 5,
    altitudeMeters: null,
    providerSpeedMps: 1.4,
    bearingDegrees: null,
    segmentDistanceMeters: i === 0 ? 0 : distanceMeters / (points - 1),
    segmentValid: true,
    rejectionReason: null,
    startsNewLine: i === 0,
    gapBeforeSeconds: null,
  }));
  await insertRoutePoints(db, rows);
  await completeActivity(db, id, {
    endedAt: startedAt + 1_800_000,
    elapsedDurationSeconds: 1800,
    activeDurationSeconds: 1800,
    distanceMeters,
    averagePaceSecondsPerKm: 1800 / (distanceMeters / 1000),
    averageSpeedMps: distanceMeters / 1800,
    gpsQualitySummary: summarizeQuality(createQualityCounters()),
    routePreview: [rows.map((r): [number, number] => [r.latitude, r.longitude])],
  });
  return id;
}

describe('schema and migrations', () => {
  it('migrates to the latest version and is idempotent', async () => {
    expect(await db.getFirstAsync<{ user_version: number }>('PRAGMA user_version', [])).toEqual({ user_version: LATEST_SCHEMA_VERSION });
    await migrate(db);
    expect(await db.getFirstAsync<{ user_version: number }>('PRAGMA user_version', [])).toEqual({ user_version: LATEST_SCHEMA_VERSION });
  });

  it('refuses to open a database created by a newer app version', async () => {
    await db.execAsync(`PRAGMA user_version = ${LATEST_SCHEMA_VERSION + 1}`);
    await expect(migrate(db)).rejects.toThrow(/newer version/);
  });

  it('enforces activity constraints', async () => {
    await expect(
      db.runAsync("INSERT INTO activities (type, status, started_at, created_at, updated_at) VALUES ('swim', 'completed', 1, 1, 1)", []),
    ).rejects.toThrow();
    await expect(
      db.runAsync("INSERT INTO activities (type, status, started_at, distance_meters, created_at, updated_at) VALUES ('walk', 'completed', 1, -5, 1, 1)", []),
    ).rejects.toThrow();
  });
});

describe('route points', () => {
  it('ignores duplicate sequence numbers so journal replays are idempotent', async () => {
    const id = await addCompletedActivity(Date.UTC(2024, 4, 1, 8), 1000);
    await insertRoutePoints(db, [
      {
        activityId: id,
        sequenceNumber: 0,
        segmentIndex: 0,
        latitude: 1,
        longitude: 1,
        recordedAt: 1,
        elapsedRealtimeMs: 1,
        accuracyMeters: 1,
        altitudeMeters: null,
        providerSpeedMps: null,
        bearingDegrees: null,
        segmentDistanceMeters: 999,
        segmentValid: true,
        rejectionReason: null,
        startsNewLine: true,
        gapBeforeSeconds: null,
      },
    ]);
    expect((await countRoutePoints(db, id)).total).toBe(3);
  });

  it('cascades route points and tracking state when an activity is deleted', async () => {
    const id = await addCompletedActivity(Date.UTC(2024, 4, 1, 8), 1000, 'walk', 120);
    await saveTrackingState(db, newTrackingState(id));
    await deleteActivity(db, id);
    expect((await countRoutePoints(db, id)).total).toBe(0);
    expect(await getTrackingState(db, id)).toBeNull();
  });

  it('inserts large batches in chunks within a transaction', async () => {
    const id = await addCompletedActivity(Date.UTC(2024, 4, 1, 8), 1000, 'walk', 1000);
    expect((await countRoutePoints(db, id)).accepted).toBe(1000);
  });
});

describe('deleting an activity updates derived data', () => {
  it('recalculates statistics, goals and achievements', async () => {
    const now = Date.now();
    await upsertGoal(db, { periodType: 'daily', targetDistanceMeters: 5000, startDate: '2000-01-01', enabled: true });
    const small = await addCompletedActivity(now - 60_000 * 60, 2000);
    const big = await addCompletedActivity(now - 60_000 * 30, 6000, 'run');
    await db.withTransactionAsync(async () => {
      await recomputeAchievements(db);
    });

    let summaries = await listActivitySummaries(db);
    expect(todaySummary(summaries, now).totalDistanceMeters).toBe(8000);
    let achievements = await listAchievements(db);
    expect(achievements.find((a) => a.type === 'first_5k')?.activityId).toBe(big);
    expect(achievements.find((a) => a.type === 'daily_goal_completed')?.activityId).toBe(big);

    await db.withTransactionAsync(async () => {
      await deleteActivity(db, big);
      await recomputeAchievements(db);
    });

    summaries = await listActivitySummaries(db);
    expect(todaySummary(summaries, now).totalDistanceMeters).toBe(2000);
    expect(weeklySummary(summaries, now).current.runDistanceMeters).toBe(0);
    achievements = await listAchievements(db);
    expect(achievements.some((a) => a.type === 'first_5k')).toBe(false);
    expect(achievements.some((a) => a.type === 'daily_goal_completed')).toBe(false);
    expect(achievements.find((a) => a.type === 'first_activity')?.activityId).toBe(small);
  });

  it('never stores the same achievement twice, however often it is recomputed', async () => {
    await addCompletedActivity(Date.UTC(2024, 4, 1, 8), 5500);
    for (let i = 0; i < 3; i += 1) {
      await db.withTransactionAsync(async () => {
        await recomputeAchievements(db);
      });
    }
    const types = (await listAchievements(db)).map((a) => a.type);
    expect(new Set(types).size).toBe(types.length);
    // The unique constraint also protects against a direct double insert.
    await expect(
      db.runAsync("INSERT INTO achievements (achievement_type, unlocked_at) VALUES ('first_5k', 1)", []),
    ).rejects.toThrow();
    // Reconciling an unchanged set reports nothing new.
    const summaries = await listActivitySummaries(db);
    expect(await reconcileAchievements(db, evaluateAchievements(summaries, await listGoals(db)))).toEqual([]);
  });
});

describe('goals and preferences', () => {
  it('versions goals by start date and updates same-day changes in place', async () => {
    const today = localDayKey(Date.now());
    await upsertGoal(db, { periodType: 'daily', targetDistanceMeters: 5000, startDate: '2024-01-01', enabled: true });
    await upsertGoal(db, { periodType: 'daily', targetDistanceMeters: 7000, startDate: today, enabled: true });
    await upsertGoal(db, { periodType: 'daily', targetDistanceMeters: 8000, startDate: today, enabled: true });
    const goals = await listGoals(db);
    expect(goals.map((g) => [g.startDate, g.targetDistanceMeters])).toEqual([
      ['2024-01-01', 5000],
      [today, 8000],
    ]);
  });

  it('overwrites a saved preference and a saved tracking state instead of adding rows', async () => {
    await setPreference(db, 'weekStartsOn', 0);
    await setPreference(db, 'weekStartsOn', 3);
    expect((await getPreferences(db)).weekStartsOn).toBe(3);
    expect(await db.getAllAsync("SELECT value FROM preferences WHERE key = 'weekStartsOn'", [])).toEqual([{ value: '3' }]);

    const activityId = await createActivity(db, { type: 'walk', startedAt: Date.now() });
    await saveTrackingState(db, { ...newTrackingState(activityId), lastJournalSequence: 10, distanceMeters: 100 });
    await saveTrackingState(db, { ...newTrackingState(activityId), lastJournalSequence: 25, distanceMeters: 240 });
    const saved = await getTrackingState(db, activityId);
    expect(saved?.lastJournalSequence).toBe(25);
    expect(saved?.distanceMeters).toBe(240);
    expect(await db.getAllAsync('SELECT activity_id FROM tracking_state', [])).toHaveLength(1);
  });

  it('stores preferences and falls back to defaults for corrupt values', async () => {
    await setPreference(db, 'weekStartsOn', 0);
    await db.runAsync("INSERT INTO preferences (key, value) VALUES ('keepScreenOnWhileTracking', '{broken')", []);
    const preferences = await getPreferences(db);
    expect(preferences.weekStartsOn).toBe(0);
    expect(preferences.keepScreenOnWhileTracking).toBe(false);
  });
});

describe('backup export and import', () => {
  it('round-trips activities, route points and goals, and skips duplicates on re-import', async () => {
    await upsertGoal(db, { periodType: 'daily', targetDistanceMeters: 6000, startDate: '2024-01-01', enabled: true });
    const a = await addCompletedActivity(Date.UTC(2024, 4, 1, 8), 3200, 'walk', 50);
    await addCompletedActivity(Date.UTC(2024, 4, 2, 8), 7400, 'run', 80);
    // An unfinished workout is not exported.
    await createActivity(db, { type: 'walk', startedAt: Date.UTC(2024, 4, 3, 8) });

    const backup = parseBackup(JSON.parse(JSON.stringify(await createBackup(db))));
    expect(backup.activities).toHaveLength(2);

    const target = await createTestDatabase();
    try {
      let result = { imported: 0, skipped: 0, goals: 0 };
      await target.withTransactionAsync(async () => {
        result = await importBackup(target, backup);
      });
      expect(result).toEqual({ imported: 2, skipped: 0, goals: 1 });
      const imported = await listActivities(target);
      expect(imported.map((x) => x.distanceMeters).sort()).toEqual([3200, 7400]);
      const original = await getActivity(db, a);
      const copy = imported.find((x) => x.startedAt === original?.startedAt);
      expect((await countRoutePoints(target, copy?.id ?? -1)).total).toBe(50);
      expect((await listAchievements(target)).length).toBeGreaterThan(0);

      await target.withTransactionAsync(async () => {
        result = await importBackup(target, backup);
      });
      expect(result).toEqual({ imported: 0, skipped: 2, goals: 0 });
    } finally {
      target.close();
    }
  });

  it('rejects files that are not valid backups', () => {
    expect(() => parseBackup({ format: 'something-else' })).toThrow(/not a Stride backup/);
    expect(() => parseBackup({ format: 'stride-backup', version: 99, activities: [], goals: [] })).toThrow(/Unsupported/);
    expect(() =>
      parseBackup({
        format: 'stride-backup',
        version: 1,
        goals: [],
        activities: [{ type: 'walk', startedAt: 1, distanceMeters: 10, points: { columns: ['x'], rows: [] } }],
      }),
    ).toThrow(/unknown layout/);
  });
});
