/**
 * Tuning values for GPS recording and filtering. These are starting points meant to be tuned
 * against real-device traces (see docs/FIELD_TESTING.md); keep every threshold here rather than
 * inlining numbers in the filter.
 */
export type GpsFilterConfig = {
  /** Fixes with a reported 68 % horizontal accuracy worse than this are not used at all. */
  poorAccuracyMeters: number;
  /** Accuracy at or below which a fix is considered good (shown as "good" signal). */
  preferredAccuracyMeters: number;
  /** Accuracy above which the UI shows a caution state. */
  cautionAccuracyMeters: number;
  /** Floor for the movement threshold; displacement below this is always treated as noise. */
  minMovementMeters: number;
  /**
   * While the provider reports walking/running speed, a displacement must exceed
   * max(minMovementMeters, movementAccuracyFactor × worse accuracy of the two fixes).
   */
  movementAccuracyFactor: number;
  /** Provider speed below which the phone is considered stationary. */
  stationarySpeedMps: number;
  /**
   * When the phone looks stationary (or speed is unknown) a displacement must exceed
   * stationaryAccuracyFactor × combined accuracy ...
   */
  stationaryAccuracyFactor: number;
  /** ... and stay beyond it for this many additional consecutive fixes. */
  stationaryConfirmations: number;
  /** Implied speed above this is treated as a GPS jump (configurable per activity type). */
  maxPlausibleSpeedMps: number;
  /** Consecutive mutually-consistent "jump" fixes needed to accept that we really moved. */
  relocationConfirmations: number;
  /** A pause in usable fixes longer than this is recorded as a GPS gap. */
  gapThresholdSeconds: number;
  /**
   * Gaps up to this length are bridged with the straight-line distance between the fixes on
   * either side (a lower bound of what was covered), if the implied speed is plausible. Longer
   * gaps add no distance and break the route line.
   */
  maxBridgeableGapSeconds: number;
};

export type TrackingConfig = {
  /** Requested location interval; Android treats it as a hint, not a guarantee. */
  desiredIntervalMs: number;
  /** Minimum requested update distance passed to the provider. */
  minUpdateDistanceMeters: number;
  /** Accuracy needed for the initial fix before a workout can start without warning. */
  startAccuracyMeters: number;
  /** How long to wait for the first usable fix before offering to start anyway. */
  initialFixTimeoutSeconds: number;
  /** A fix older than this does not count as "current" on the start screen. */
  maxFixAgeMs: number;
  /** No fix for this long while recording shows a "GPS signal lost" warning. */
  signalLostAfterSeconds: number;
  /** Window used for the live "current pace" value. */
  currentPaceWindowSeconds: number;
  filter: GpsFilterConfig;
};

const baseFilter: GpsFilterConfig = {
  poorAccuracyMeters: 30,
  preferredAccuracyMeters: 10,
  cautionAccuracyMeters: 25,
  minMovementMeters: 2.5,
  movementAccuracyFactor: 0.5,
  stationarySpeedMps: 0.5,
  stationaryAccuracyFactor: 1.5,
  stationaryConfirmations: 2,
  maxPlausibleSpeedMps: 7,
  relocationConfirmations: 3,
  gapThresholdSeconds: 15,
  maxBridgeableGapSeconds: 120,
};

export const TRACKING_CONFIG: TrackingConfig = {
  desiredIntervalMs: 1000,
  minUpdateDistanceMeters: 0,
  startAccuracyMeters: 20,
  initialFixTimeoutSeconds: 45,
  maxFixAgeMs: 10_000,
  signalLostAfterSeconds: 10,
  currentPaceWindowSeconds: 20,
  filter: baseFilter,
};

/** Walking and running share thresholds today; kept separate so they can diverge after field tests. */
export function filterConfigFor(activityType: 'walk' | 'run'): GpsFilterConfig {
  return activityType === 'run' ? { ...baseFilter } : { ...baseFilter };
}

/** Activities shorter than these are kept but excluded from records, streaks and pace averages. */
export const ELIGIBILITY = {
  minDistanceMeters: 100,
  minActiveSeconds: 60,
  /** Minimum distance for "fastest average pace" records. */
  minPaceRecordDistanceMeters: 1000,
} as const;
