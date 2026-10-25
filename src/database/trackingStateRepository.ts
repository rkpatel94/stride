import { createFilterState, restoreFilterState, type FilterState } from '@/features/tracking/gpsFilter';

import type { SqlDatabase } from './types';

/**
 * Persisted engine state for a live session. Together with the native session it is enough to
 * resume journal processing exactly where it stopped after the JS runtime restarts.
 */
export type TrackingStateRecord = {
  activityId: number;
  state: string;
  /** Highest native journal sequence already committed as route points. */
  lastJournalSequence: number;
  /** Next per-activity route point sequence number. */
  nextSequenceNumber: number;
  lastAcceptedSequenceNumber: number | null;
  distanceMeters: number;
  activeDurationMs: number;
  elapsedDurationMs: number;
  filterState: FilterState;
  recovery: Record<string, unknown> | null;
  updatedAt: number;
};

type TrackingStateRow = {
  activity_id: number;
  state: string;
  last_journal_sequence: number;
  next_sequence_number: number;
  last_accepted_sequence_number: number | null;
  distance_meters: number;
  active_duration_ms: number;
  elapsed_duration_ms: number;
  filter_state: string;
  recovery_json: string | null;
  updated_at: number;
};

function parseRecovery(json: string | null): Record<string, unknown> | null {
  if (!json) return null;
  try {
    const parsed = JSON.parse(json) as unknown;
    return parsed && typeof parsed === 'object' ? (parsed as Record<string, unknown>) : null;
  } catch {
    return null;
  }
}

function mapRow(row: TrackingStateRow): TrackingStateRecord {
  return {
    activityId: row.activity_id,
    state: row.state,
    lastJournalSequence: row.last_journal_sequence,
    nextSequenceNumber: row.next_sequence_number,
    lastAcceptedSequenceNumber: row.last_accepted_sequence_number,
    distanceMeters: row.distance_meters,
    activeDurationMs: row.active_duration_ms,
    elapsedDurationMs: row.elapsed_duration_ms,
    filterState: restoreFilterState(row.filter_state),
    recovery: parseRecovery(row.recovery_json),
    updatedAt: row.updated_at,
  };
}

export function newTrackingState(activityId: number): TrackingStateRecord {
  return {
    activityId,
    state: 'recording',
    lastJournalSequence: 0,
    nextSequenceNumber: 0,
    lastAcceptedSequenceNumber: null,
    distanceMeters: 0,
    activeDurationMs: 0,
    elapsedDurationMs: 0,
    filterState: createFilterState(),
    recovery: null,
    updatedAt: Date.now(),
  };
}

export async function getTrackingState(db: SqlDatabase, activityId: number): Promise<TrackingStateRecord | null> {
  const row = await db.getFirstAsync<TrackingStateRow>('SELECT * FROM tracking_state WHERE activity_id = ?', [activityId]);
  return row ? mapRow(row) : null;
}

export async function saveTrackingState(db: SqlDatabase, record: TrackingStateRecord): Promise<void> {
  await db.runAsync(
    `INSERT INTO tracking_state (activity_id, state, last_journal_sequence, next_sequence_number, last_accepted_sequence_number,
       distance_meters, active_duration_ms, elapsed_duration_ms, filter_state, recovery_json, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
     ON CONFLICT (activity_id) DO UPDATE SET
       state = excluded.state,
       last_journal_sequence = excluded.last_journal_sequence,
       next_sequence_number = excluded.next_sequence_number,
       last_accepted_sequence_number = excluded.last_accepted_sequence_number,
       distance_meters = excluded.distance_meters,
       active_duration_ms = excluded.active_duration_ms,
       elapsed_duration_ms = excluded.elapsed_duration_ms,
       filter_state = excluded.filter_state,
       recovery_json = excluded.recovery_json,
       updated_at = excluded.updated_at`,
    [
      record.activityId,
      record.state,
      record.lastJournalSequence,
      record.nextSequenceNumber,
      record.lastAcceptedSequenceNumber,
      record.distanceMeters,
      record.activeDurationMs,
      record.elapsedDurationMs,
      JSON.stringify(record.filterState),
      record.recovery ? JSON.stringify(record.recovery) : null,
      record.updatedAt,
    ],
  );
}

export async function deleteTrackingState(db: SqlDatabase, activityId: number): Promise<void> {
  await db.runAsync('DELETE FROM tracking_state WHERE activity_id = ?', [activityId]);
}
