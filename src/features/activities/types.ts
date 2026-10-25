import type { GpsQualitySummary } from '@/features/tracking/gpsQuality';

export type ActivityType = 'walk' | 'run';

/**
 * recording / paused: a live session. recovering: the session was cut off (process killed,
 * reboot, service failure) and waits for the user to resume or finish it. completed: saved.
 * Discarded workouts are deleted outright, so there is no "discarded" status.
 */
export type ActivityStatus = 'recording' | 'paused' | 'recovering' | 'completed';

export const UNFINISHED_STATUSES: ActivityStatus[] = ['recording', 'paused', 'recovering'];

export type Activity = {
  id: number;
  type: ActivityType;
  status: ActivityStatus;
  startedAt: number;
  endedAt: number | null;
  elapsedDurationSeconds: number | null;
  activeDurationSeconds: number | null;
  distanceMeters: number;
  averagePaceSecondsPerKm: number | null;
  averageSpeedMps: number | null;
  gpsQualitySummary: GpsQualitySummary | null;
  routePreview: [number, number][][] | null;
  notes: string | null;
  createdAt: number;
  updatedAt: number;
};

/** The subset statistics and achievements are computed from. */
export type ActivitySummary = Pick<
  Activity,
  'id' | 'type' | 'status' | 'startedAt' | 'endedAt' | 'distanceMeters' | 'activeDurationSeconds' | 'elapsedDurationSeconds'
>;

export type RoutePoint = {
  id: number;
  activityId: number;
  sequenceNumber: number;
  segmentIndex: number;
  latitude: number;
  longitude: number;
  recordedAt: number;
  elapsedRealtimeMs: number | null;
  accuracyMeters: number | null;
  altitudeMeters: number | null;
  providerSpeedMps: number | null;
  bearingDegrees: number | null;
  segmentDistanceMeters: number;
  segmentValid: boolean;
  rejectionReason: string | null;
  startsNewLine: boolean;
  gapBeforeSeconds: number | null;
};

export const ACTIVITY_LABELS: Record<ActivityType, string> = {
  walk: 'Walk',
  run: 'Run',
};
