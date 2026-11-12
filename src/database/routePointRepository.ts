import type { RoutePoint } from '@/features/activities/types';

import type { SqlDatabase, SqlValue } from './types';

export type NewRoutePoint = Omit<RoutePoint, 'id'>;

type RoutePointRow = {
  id: number;
  activity_id: number;
  sequence_number: number;
  segment_index: number;
  latitude: number;
  longitude: number;
  recorded_at: number;
  elapsed_realtime_ms: number | null;
  accuracy_meters: number | null;
  altitude_meters: number | null;
  provider_speed_mps: number | null;
  bearing_degrees: number | null;
  segment_distance_meters: number;
  segment_valid: number;
  rejection_reason: string | null;
  starts_new_line: number;
  gap_before_seconds: number | null;
  activity_type: string | null;
};

const COLUMNS = [
  'activity_id',
  'sequence_number',
  'segment_index',
  'latitude',
  'longitude',
  'recorded_at',
  'elapsed_realtime_ms',
  'accuracy_meters',
  'altitude_meters',
  'provider_speed_mps',
  'bearing_degrees',
  'segment_distance_meters',
  'segment_valid',
  'rejection_reason',
  'starts_new_line',
  'gap_before_seconds',
  'activity_type',
] as const;

// 17 columns × 40 rows = 680 bound parameters, under the 999 of Android 7's SQLite.
const ROWS_PER_STATEMENT = 40;

function toParams(point: NewRoutePoint): SqlValue[] {
  return [
    point.activityId,
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
    point.activityType,
  ];
}

/**
 * Batch insert. INSERT OR IGNORE on (activity_id, sequence_number) makes replays after a crash
 * idempotent. Callers run this inside a transaction together with the tracking-state update.
 */
export async function insertRoutePoints(db: SqlDatabase, points: NewRoutePoint[]): Promise<void> {
  const placeholders = `(${COLUMNS.map(() => '?').join(', ')})`;
  for (let start = 0; start < points.length; start += ROWS_PER_STATEMENT) {
    const chunk = points.slice(start, start + ROWS_PER_STATEMENT);
    await db.runAsync(
      `INSERT OR IGNORE INTO route_points (${COLUMNS.join(', ')}) VALUES ${chunk.map(() => placeholders).join(', ')}`,
      chunk.flatMap(toParams),
    );
  }
}

function mapPoint(row: RoutePointRow): RoutePoint {
  return {
    id: row.id,
    activityId: row.activity_id,
    sequenceNumber: row.sequence_number,
    segmentIndex: row.segment_index,
    latitude: row.latitude,
    longitude: row.longitude,
    recordedAt: row.recorded_at,
    elapsedRealtimeMs: row.elapsed_realtime_ms,
    accuracyMeters: row.accuracy_meters,
    altitudeMeters: row.altitude_meters,
    providerSpeedMps: row.provider_speed_mps,
    bearingDegrees: row.bearing_degrees,
    segmentDistanceMeters: row.segment_distance_meters,
    segmentValid: row.segment_valid === 1,
    rejectionReason: row.rejection_reason,
    startsNewLine: row.starts_new_line === 1,
    gapBeforeSeconds: row.gap_before_seconds,
    activityType: row.activity_type === 'walk' || row.activity_type === 'run' ? row.activity_type : null,
  };
}

export async function getRoutePoints(
  db: SqlDatabase,
  activityId: number,
  options: { acceptedOnly?: boolean } = {},
): Promise<RoutePoint[]> {
  const rows = await db.getAllAsync<RoutePointRow>(
    `SELECT * FROM route_points WHERE activity_id = ? ${options.acceptedOnly ? 'AND segment_valid = 1' : ''}
     ORDER BY sequence_number ASC`,
    [activityId],
  );
  return rows.map(mapPoint);
}

export async function countRoutePoints(db: SqlDatabase, activityId: number): Promise<{ total: number; accepted: number }> {
  const row = await db.getFirstAsync<{ total: number; accepted: number | null }>(
    'SELECT COUNT(*) AS total, SUM(segment_valid) AS accepted FROM route_points WHERE activity_id = ?',
    [activityId],
  );
  return { total: row?.total ?? 0, accepted: row?.accepted ?? 0 };
}

/** Sum of accepted segment distances; must equal the activity's distance_meters. */
export async function sumAcceptedDistance(db: SqlDatabase, activityId: number): Promise<number> {
  const row = await db.getFirstAsync<{ total: number | null }>(
    'SELECT SUM(segment_distance_meters) AS total FROM route_points WHERE activity_id = ? AND segment_valid = 1',
    [activityId],
  );
  return row?.total ?? 0;
}
