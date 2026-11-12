import type { GpsQualitySummary } from '@/features/tracking/gpsQuality';

export type ActivityType = 'walk' | 'run';

/**
 * recording / paused: a live session. recovering: the session was cut off (process killed,
 * reboot, service failure) and waits for the user to resume or finish it. completed: saved.
 * Discarded workouts are deleted outright, so there is no "discarded" status.
 */
export type ActivityStatus = 'recording' | 'paused' | 'recovering' | 'completed';

export const UNFINISHED_STATUSES: ActivityStatus[] = ['recording', 'paused', 'recovering'];

/**
 * A workout can switch between walking and running (by hand or with run/walk intervals). `type`
 * is the main type (the one with the larger distance); the per-type totals say how much of the
 * workout was walked and run, and statistics count them separately.
 */
export type Activity = {
  id: number;
  type: ActivityType;
  status: ActivityStatus;
  startedAt: number;
  endedAt: number | null;
  elapsedDurationSeconds: number | null;
  activeDurationSeconds: number | null;
  distanceMeters: number;
  walkDistanceMeters: number;
  runDistanceMeters: number;
  walkActiveSeconds: number;
  runActiveSeconds: number;
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
  | 'id'
  | 'type'
  | 'status'
  | 'startedAt'
  | 'endedAt'
  | 'distanceMeters'
  | 'activeDurationSeconds'
  | 'elapsedDurationSeconds'
  | 'walkDistanceMeters'
  | 'runDistanceMeters'
>;

/** Below this, a part is too short to call a workout "walk + run" (e.g. a switch right at the start). */
export const MIN_PART_METERS = 50;

/** The type with the larger distance; `fallback` (usually the starting type) when they are equal. */
export function mainType(walkMeters: number, runMeters: number, fallback: ActivityType): ActivityType {
  if (runMeters > walkMeters) return 'run';
  if (walkMeters > runMeters) return 'walk';
  return fallback;
}

export function isMixed(activity: Pick<Activity, 'walkDistanceMeters' | 'runDistanceMeters'>): boolean {
  return activity.walkDistanceMeters >= MIN_PART_METERS && activity.runDistanceMeters >= MIN_PART_METERS;
}

/** "Walk", "Run" or "Walk + run". */
export function activityLabel(activity: Pick<Activity, 'type' | 'walkDistanceMeters' | 'runDistanceMeters'>): string {
  return isMixed(activity) ? 'Walk + run' : ACTIVITY_LABELS[activity.type];
}

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
  /** What the workout was at this fix; null for points recorded before walk/run parts existed. */
  activityType: ActivityType | null;
};

export const ACTIVITY_LABELS: Record<ActivityType, string> = {
  walk: 'Walk',
  run: 'Run',
};
