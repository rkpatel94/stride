import { getRoutePoints, insertRoutePoints, type NewRoutePoint } from '@/database/routePointRepository';
import { listGoals, upsertGoal } from '@/database/goalRepository';
import { LATEST_SCHEMA_VERSION } from '@/database/migrations';
import type { SqlDatabase } from '@/database/types';
import { recomputeAchievements } from '@/features/achievements/achievementService';
import type { GoalPeriod } from '@/features/goals/goals';
import { isValidCoordinate } from '@/utils/geo';

/**
 * Local backup format. A backup is a single JSON file the user saves wherever they choose
 * (the app never uploads it). Route points are stored column-wise to keep files compact.
 */
export const BACKUP_FORMAT = 'stride-backup';
export const BACKUP_VERSION = 1;

const POINT_COLUMNS = [
  'sequenceNumber',
  'segmentIndex',
  'latitude',
  'longitude',
  'recordedAt',
  'elapsedRealtimeMs',
  'accuracyMeters',
  'altitudeMeters',
  'providerSpeedMps',
  'bearingDegrees',
  'segmentDistanceMeters',
  'segmentValid',
  'rejectionReason',
  'startsNewLine',
  'gapBeforeSeconds',
] as const;

type PointRow = (string | number | null)[];

type BackupActivity = {
  type: 'walk' | 'run';
  startedAt: number;
  endedAt: number | null;
  elapsedDurationSeconds: number | null;
  activeDurationSeconds: number | null;
  distanceMeters: number;
  averagePaceSecondsPerKm: number | null;
  averageSpeedMps: number | null;
  gpsQualitySummary: string | null;
  routePreview: string | null;
  notes: string | null;
  createdAt: number;
  updatedAt: number;
  points: { columns: readonly string[]; rows: PointRow[] };
};

type BackupGoal = {
  periodType: GoalPeriod;
  targetDistanceMeters: number;
  startDate: string;
  enabled: boolean;
};

export type Backup = {
  format: typeof BACKUP_FORMAT;
  version: number;
  schemaVersion: number;
  exportedAt: number;
  activities: BackupActivity[];
  goals: BackupGoal[];
};

type ActivityRow = {
  id: number;
  type: 'walk' | 'run';
  started_at: number;
  ended_at: number | null;
  elapsed_duration_seconds: number | null;
  active_duration_seconds: number | null;
  distance_meters: number;
  average_pace_seconds_per_km: number | null;
  average_speed_mps: number | null;
  gps_quality_summary: string | null;
  route_preview: string | null;
  notes: string | null;
  created_at: number;
  updated_at: number;
};

/** Completed activities only; a workout that is still recording is not part of a backup. */
export async function createBackup(db: SqlDatabase, now = Date.now()): Promise<Backup> {
  const rows = await db.getAllAsync<ActivityRow>("SELECT * FROM activities WHERE status = 'completed' ORDER BY started_at ASC", []);
  const activities: BackupActivity[] = [];
  for (const row of rows) {
    const points = await getRoutePoints(db, row.id);
    activities.push({
      type: row.type,
      startedAt: row.started_at,
      endedAt: row.ended_at,
      elapsedDurationSeconds: row.elapsed_duration_seconds,
      activeDurationSeconds: row.active_duration_seconds,
      distanceMeters: row.distance_meters,
      averagePaceSecondsPerKm: row.average_pace_seconds_per_km,
      averageSpeedMps: row.average_speed_mps,
      gpsQualitySummary: row.gps_quality_summary,
      routePreview: row.route_preview,
      notes: row.notes,
      createdAt: row.created_at,
      updatedAt: row.updated_at,
      points: {
        columns: POINT_COLUMNS,
        rows: points.map((point) => [
          point.sequenceNumber,
          point.segmentIndex,
          point.latitude,
          point.longitude,
          point.recordedAt,
          point.elapsedRealtimeMs,
          point.accuracyMeters,
          point.altitudeMeters,
          point.providerSpeedMps,
          point.bearingDegrees,
          point.segmentDistanceMeters,
          point.segmentValid ? 1 : 0,
          point.rejectionReason,
          point.startsNewLine ? 1 : 0,
          point.gapBeforeSeconds,
        ]),
      },
    });
  }
  const goals = (await listGoals(db)).map((goal) => ({
    periodType: goal.periodType,
    targetDistanceMeters: goal.targetDistanceMeters,
    startDate: goal.startDate,
    enabled: goal.enabled,
  }));
  return { format: BACKUP_FORMAT, version: BACKUP_VERSION, schemaVersion: LATEST_SCHEMA_VERSION, exportedAt: now, activities, goals };
}

class BackupError extends Error {}

const finite = (value: unknown): value is number => typeof value === 'number' && Number.isFinite(value);
const finiteOrNull = (value: unknown): number | null => (finite(value) ? value : null);
const stringOrNull = (value: unknown): string | null => (typeof value === 'string' ? value : null);

/** Validates untrusted JSON. Throws a readable error instead of importing anything partial. */
export function parseBackup(input: unknown): Backup {
  if (!input || typeof input !== 'object') throw new BackupError('This file is not a Stride backup.');
  const data = input as Record<string, unknown>;
  if (data.format !== BACKUP_FORMAT) throw new BackupError('This file is not a Stride backup.');
  if (data.version !== BACKUP_VERSION) {
    throw new BackupError(`Unsupported backup version ${String(data.version)}. Update the app and try again.`);
  }
  if (!Array.isArray(data.activities) || !Array.isArray(data.goals)) throw new BackupError('The backup file is incomplete.');

  const activities = data.activities.map((raw, index): BackupActivity => {
    const activity = raw as Record<string, unknown>;
    if (activity.type !== 'walk' && activity.type !== 'run') throw new BackupError(`Activity ${index + 1} has an unknown type.`);
    if (!finite(activity.startedAt) || !finite(activity.distanceMeters) || activity.distanceMeters < 0) {
      throw new BackupError(`Activity ${index + 1} is missing its start time or distance.`);
    }
    const points = activity.points as { columns?: unknown; rows?: unknown } | undefined;
    if (!points || !Array.isArray(points.columns) || !Array.isArray(points.rows)) {
      throw new BackupError(`Activity ${index + 1} has no route data.`);
    }
    if (points.columns.join(',') !== POINT_COLUMNS.join(',')) throw new BackupError('Route data uses an unknown layout.');
    for (const row of points.rows) {
      if (!Array.isArray(row) || row.length !== POINT_COLUMNS.length || !isValidCoordinate({ latitude: row[2], longitude: row[3] })) {
        throw new BackupError(`Activity ${index + 1} contains an invalid route point.`);
      }
    }
    return {
      type: activity.type,
      startedAt: activity.startedAt,
      endedAt: finiteOrNull(activity.endedAt),
      elapsedDurationSeconds: finiteOrNull(activity.elapsedDurationSeconds),
      activeDurationSeconds: finiteOrNull(activity.activeDurationSeconds),
      distanceMeters: activity.distanceMeters,
      averagePaceSecondsPerKm: finiteOrNull(activity.averagePaceSecondsPerKm),
      averageSpeedMps: finiteOrNull(activity.averageSpeedMps),
      gpsQualitySummary: stringOrNull(activity.gpsQualitySummary),
      routePreview: stringOrNull(activity.routePreview),
      notes: stringOrNull(activity.notes),
      createdAt: finiteOrNull(activity.createdAt) ?? activity.startedAt,
      updatedAt: finiteOrNull(activity.updatedAt) ?? activity.startedAt,
      points: { columns: POINT_COLUMNS, rows: points.rows as PointRow[] },
    };
  });

  const goals = data.goals.map((raw, index): BackupGoal => {
    const goal = raw as Record<string, unknown>;
    if (
      (goal.periodType !== 'daily' && goal.periodType !== 'weekly' && goal.periodType !== 'monthly') ||
      !finite(goal.targetDistanceMeters) ||
      goal.targetDistanceMeters <= 0 ||
      typeof goal.startDate !== 'string' ||
      !/^\d{4}-\d{2}-\d{2}$/.test(goal.startDate)
    ) {
      throw new BackupError(`Goal ${index + 1} is invalid.`);
    }
    return { periodType: goal.periodType, targetDistanceMeters: goal.targetDistanceMeters, startDate: goal.startDate, enabled: goal.enabled !== false };
  });

  return {
    format: BACKUP_FORMAT,
    version: BACKUP_VERSION,
    schemaVersion: finite(data.schemaVersion) ? data.schemaVersion : 1,
    exportedAt: finite(data.exportedAt) ? data.exportedAt : 0,
    activities,
    goals,
  };
}

export type ImportResult = { imported: number; skipped: number; goals: number };

/**
 * Merges a backup into the database. Activities already present (same type and start time) are
 * skipped, so importing the same file twice changes nothing. Call inside a write transaction.
 */
export async function importBackup(db: SqlDatabase, backup: Backup): Promise<ImportResult> {
  let imported = 0;
  let skipped = 0;
  for (const activity of backup.activities) {
    const existing = await db.getFirstAsync<{ id: number }>('SELECT id FROM activities WHERE started_at = ? AND type = ?', [
      activity.startedAt,
      activity.type,
    ]);
    if (existing) {
      skipped += 1;
      continue;
    }
    const result = await db.runAsync(
      `INSERT INTO activities (type, status, started_at, ended_at, elapsed_duration_seconds, active_duration_seconds, distance_meters,
         average_pace_seconds_per_km, average_speed_mps, gps_quality_summary, route_preview, notes, created_at, updated_at)
       VALUES (?, 'completed', ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        activity.type,
        activity.startedAt,
        activity.endedAt,
        activity.elapsedDurationSeconds,
        activity.activeDurationSeconds,
        activity.distanceMeters,
        activity.averagePaceSecondsPerKm,
        activity.averageSpeedMps,
        activity.gpsQualitySummary,
        activity.routePreview,
        activity.notes,
        activity.createdAt,
        activity.updatedAt,
      ],
    );
    const activityId = result.lastInsertRowId;
    const points: NewRoutePoint[] = activity.points.rows.map((row) => ({
      activityId,
      sequenceNumber: Number(row[0]),
      segmentIndex: Number(row[1] ?? 0),
      latitude: Number(row[2]),
      longitude: Number(row[3]),
      recordedAt: Number(row[4]),
      elapsedRealtimeMs: finiteOrNull(row[5]),
      accuracyMeters: finiteOrNull(row[6]),
      altitudeMeters: finiteOrNull(row[7]),
      providerSpeedMps: finiteOrNull(row[8]),
      bearingDegrees: finiteOrNull(row[9]),
      segmentDistanceMeters: finiteOrNull(row[10]) ?? 0,
      segmentValid: row[11] === 1,
      rejectionReason: stringOrNull(row[12]),
      startsNewLine: row[13] === 1,
      gapBeforeSeconds: finiteOrNull(row[14]),
    }));
    await insertRoutePoints(db, points);
    imported += 1;
  }

  let goals = 0;
  const existingGoals = new Set((await listGoals(db)).map((goal) => `${goal.periodType}:${goal.startDate}`));
  for (const goal of backup.goals) {
    if (existingGoals.has(`${goal.periodType}:${goal.startDate}`)) continue;
    await upsertGoal(db, goal);
    goals += 1;
  }
  await recomputeAchievements(db);
  return { imported, skipped, goals };
}
