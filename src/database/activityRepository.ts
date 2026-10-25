import type { Activity, ActivityStatus, ActivitySummary, ActivityType } from '@/features/activities/types';
import { parseQualitySummary, type GpsQualitySummary } from '@/features/tracking/gpsQuality';

import type { SqlDatabase, SqlValue } from './types';

type ActivityRow = {
  id: number;
  type: ActivityType;
  status: ActivityStatus;
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

const isPair = (value: unknown): value is [number, number] =>
  Array.isArray(value) && value.length === 2 && Number.isFinite(value[0]) && Number.isFinite(value[1]);

/** Route preview: a list of lines of [lat, lon] pairs (a single flat line is also accepted). */
function parsePreview(json: string | null): [number, number][][] | null {
  if (!json) return null;
  try {
    const parsed = JSON.parse(json) as unknown;
    if (!Array.isArray(parsed)) return null;
    if (parsed.every(isPair)) return [parsed as [number, number][]];
    return parsed.filter(Array.isArray).map((line) => (line as unknown[]).filter(isPair));
  } catch {
    return null;
  }
}

function mapActivity(row: ActivityRow): Activity {
  return {
    id: row.id,
    type: row.type,
    status: row.status,
    startedAt: row.started_at,
    endedAt: row.ended_at,
    elapsedDurationSeconds: row.elapsed_duration_seconds,
    activeDurationSeconds: row.active_duration_seconds,
    distanceMeters: row.distance_meters,
    averagePaceSecondsPerKm: row.average_pace_seconds_per_km,
    averageSpeedMps: row.average_speed_mps,
    gpsQualitySummary: parseQualitySummary(row.gps_quality_summary),
    routePreview: parsePreview(row.route_preview),
    notes: row.notes,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

export async function createActivity(db: SqlDatabase, input: { type: ActivityType; startedAt: number }): Promise<number> {
  const now = Date.now();
  const result = await db.runAsync(
    `INSERT INTO activities (type, status, started_at, distance_meters, created_at, updated_at)
     VALUES (?, 'recording', ?, 0, ?, ?)`,
    [input.type, input.startedAt, now, now],
  );
  return result.lastInsertRowId;
}

export async function getActivity(db: SqlDatabase, id: number): Promise<Activity | null> {
  const row = await db.getFirstAsync<ActivityRow>('SELECT * FROM activities WHERE id = ?', [id]);
  return row ? mapActivity(row) : null;
}

export type ActivityListFilter = {
  type?: ActivityType | null;
  fromMs?: number | null;
  toMs?: number | null;
  limit?: number;
  offset?: number;
};

/** Completed activities, newest first. */
export async function listActivities(db: SqlDatabase, filter: ActivityListFilter = {}): Promise<Activity[]> {
  const clauses = ["status = 'completed'"];
  const params: SqlValue[] = [];
  if (filter.type) {
    clauses.push('type = ?');
    params.push(filter.type);
  }
  if (filter.fromMs !== null && filter.fromMs !== undefined) {
    clauses.push('started_at >= ?');
    params.push(filter.fromMs);
  }
  if (filter.toMs !== null && filter.toMs !== undefined) {
    clauses.push('started_at < ?');
    params.push(filter.toMs);
  }
  params.push(filter.limit ?? 500, filter.offset ?? 0);
  const rows = await db.getAllAsync<ActivityRow>(
    `SELECT * FROM activities WHERE ${clauses.join(' AND ')} ORDER BY started_at DESC, id DESC LIMIT ? OFFSET ?`,
    params,
  );
  return rows.map(mapActivity);
}

/** Lightweight rows for statistics and achievements (completed only). */
export async function listActivitySummaries(db: SqlDatabase): Promise<ActivitySummary[]> {
  const rows = await db.getAllAsync<
    Pick<ActivityRow, 'id' | 'type' | 'status' | 'started_at' | 'ended_at' | 'distance_meters' | 'active_duration_seconds' | 'elapsed_duration_seconds'>
  >(
    `SELECT id, type, status, started_at, ended_at, distance_meters, active_duration_seconds, elapsed_duration_seconds
     FROM activities WHERE status = 'completed' ORDER BY started_at ASC, id ASC`,
    [],
  );
  return rows.map((row) => ({
    id: row.id,
    type: row.type,
    status: row.status,
    startedAt: row.started_at,
    endedAt: row.ended_at,
    distanceMeters: row.distance_meters,
    activeDurationSeconds: row.active_duration_seconds,
    elapsedDurationSeconds: row.elapsed_duration_seconds,
  }));
}

export async function listUnfinishedActivities(db: SqlDatabase): Promise<Activity[]> {
  const rows = await db.getAllAsync<ActivityRow>(
    "SELECT * FROM activities WHERE status IN ('recording', 'paused', 'recovering') ORDER BY started_at ASC",
    [],
  );
  return rows.map(mapActivity);
}

export async function updateActivityStatus(db: SqlDatabase, id: number, status: ActivityStatus): Promise<void> {
  await db.runAsync('UPDATE activities SET status = ?, updated_at = ? WHERE id = ?', [status, Date.now(), id]);
}

export async function updateLiveProgress(
  db: SqlDatabase,
  id: number,
  progress: { distanceMeters: number; elapsedSeconds: number | null; activeSeconds: number | null },
): Promise<void> {
  await db.runAsync(
    `UPDATE activities
     SET distance_meters = ?, elapsed_duration_seconds = COALESCE(?, elapsed_duration_seconds),
         active_duration_seconds = COALESCE(?, active_duration_seconds), updated_at = ?
     WHERE id = ? AND status != 'completed'`,
    [progress.distanceMeters, progress.elapsedSeconds, progress.activeSeconds, Date.now(), id],
  );
}

export type ActivityFinalization = {
  endedAt: number;
  elapsedDurationSeconds: number;
  activeDurationSeconds: number;
  distanceMeters: number;
  averagePaceSecondsPerKm: number | null;
  averageSpeedMps: number | null;
  gpsQualitySummary: GpsQualitySummary;
  routePreview: [number, number][][];
};

export async function completeActivity(db: SqlDatabase, id: number, data: ActivityFinalization): Promise<void> {
  await db.runAsync(
    `UPDATE activities SET status = 'completed', ended_at = ?, elapsed_duration_seconds = ?, active_duration_seconds = ?,
       distance_meters = ?, average_pace_seconds_per_km = ?, average_speed_mps = ?, gps_quality_summary = ?,
       route_preview = ?, updated_at = ?
     WHERE id = ?`,
    [
      data.endedAt,
      data.elapsedDurationSeconds,
      data.activeDurationSeconds,
      data.distanceMeters,
      data.averagePaceSecondsPerKm,
      data.averageSpeedMps,
      JSON.stringify(data.gpsQualitySummary),
      JSON.stringify(data.routePreview),
      Date.now(),
      id,
    ],
  );
}

export async function updateActivityType(db: SqlDatabase, id: number, type: ActivityType): Promise<void> {
  await db.runAsync('UPDATE activities SET type = ?, updated_at = ? WHERE id = ?', [type, Date.now(), id]);
}

export async function updateActivityNotes(db: SqlDatabase, id: number, notes: string | null): Promise<void> {
  await db.runAsync('UPDATE activities SET notes = ?, updated_at = ? WHERE id = ?', [notes, Date.now(), id]);
}

/** Route points and tracking state are removed by ON DELETE CASCADE. */
export async function deleteActivity(db: SqlDatabase, id: number): Promise<void> {
  await db.runAsync('DELETE FROM activities WHERE id = ?', [id]);
}

export async function countCompletedActivities(db: SqlDatabase): Promise<number> {
  const row = await db.getFirstAsync<{ count: number }>(
    "SELECT COUNT(*) AS count FROM activities WHERE status = 'completed'",
    [],
  );
  return row?.count ?? 0;
}
