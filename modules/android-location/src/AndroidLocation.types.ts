export type ActivityType = 'walk' | 'run';

export type NativeSessionState = 'idle' | 'recording' | 'paused' | 'interrupted' | 'finished';

/** A single fix as delivered by the Android location provider. */
export type RawLocation = {
  latitude: number;
  longitude: number;
  /** UTC time of the fix (Location.getTime). Used for calendar placement only. */
  wallTimeMs: number;
  /** Monotonic time of the fix (Location.getElapsedRealtimeNanos / 1e6). Used for durations and speed. */
  elapsedRealtimeMs: number | null;
  accuracyMeters: number | null;
  altitudeMeters: number | null;
  speedMps: number | null;
  bearingDegrees: number | null;
  provider: string | null;
  isMock: boolean;
};

/** A fix stored in the native journal while a workout records. */
export type JournalPoint = RawLocation & {
  sequence: number;
  activityId: number;
  segmentIndex: number;
  /** The walk/run part the fix was recorded in; null for fixes from an older app version. */
  activityType: ActivityType | null;
};

/** Run/walk intervals: run, then walk, `repeats` times, timed on the active clock. */
export type IntervalPlan = {
  runSeconds: number;
  walkSeconds: number;
  repeats: number;
};

export type NativeTrackingStatus = {
  hasSession: boolean;
  serviceRunning: boolean;
  activityId: number | null;
  /** The current walk/run part. */
  activityType: ActivityType | null;
  state: NativeSessionState;
  elapsedMs: number | null;
  activeMs: number | null;
  /** The part of activeMs spent running. */
  runActiveMs: number | null;
  /** Recording but standing still: the active clock is stopped. */
  autoPaused: boolean;
  autoPauseEnabled: boolean;
  intervals: IntervalPlan | null;
  startedAtWallMs: number | null;
  finishedAtWallMs: number | null;
  segmentIndex: number | null;
  lastFixAgeMs: number | null;
  interruptionReason: string | null;
  stateBeforeInterruption: string | null;
  pendingJournalPoints: number | null;
  gpsAvailable: boolean | null;
  signalLost: boolean;
  locationServicesEnabled: boolean;
  lowBattery: boolean;
  locationSource: string | null;
  error: string | null;
};

export type DeviceLocationStatus = {
  sdkInt: number;
  hasFineLocation: boolean;
  hasCoarseLocation: boolean;
  hasBackgroundLocation: boolean;
  notificationsEnabled: boolean;
  locationEnabled: boolean;
  gpsProviderEnabled: boolean;
  networkProviderEnabled: boolean;
  playServicesAvailable: boolean;
  powerSaveMode: boolean;
  /** PowerManager.LOCATION_MODE_*; non-zero means battery saver restricts location. */
  locationPowerSaveMode: number;
  ignoringBatteryOptimizations: boolean;
  batteryPercent: number | null;
};

export type PreviewEvent =
  | ({ kind: 'location' } & RawLocation)
  | { kind: 'availability'; available: boolean }
  | { kind: 'error'; message: string };

export type StartTrackingOptions = {
  activityId: number;
  activityType: ActivityType;
  intervalMs: number;
  /** Deep link opened when the notification is tapped. */
  openUri?: string;
  /** Deep link opened by the notification's Finish action (the app asks for confirmation). */
  finishUri?: string;
  /** Stop the active clock while standing still. */
  autoPause?: boolean;
  /** Run/walk intervals (all three > 0), flattened for the native record. */
  intervalRunSeconds?: number;
  intervalWalkSeconds?: number;
  intervalRepeats?: number;
};

/** What the home-screen widget shows besides a workout in progress. */
export type WidgetSummary = {
  /** Local day (YYYY-MM-DD) the totals are for; the widget shows 0 once that day is over. */
  dayKey: string;
  /** Distance of the workouts saved today. */
  todayMeters: number;
  /** The daily goal in effect today; 0 when there is none. */
  goalMeters: number;
  /** The app's URL scheme, for the widget's buttons. */
  scheme: string;
};

export type AndroidLocationEvents = {
  onLocationRecorded: (payload: unknown) => void;
  onStatusChanged: (payload: unknown) => void;
  onPreviewLocation: (payload: unknown) => void;
};
