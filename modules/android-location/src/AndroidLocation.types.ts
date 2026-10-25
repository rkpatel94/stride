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
};

export type NativeTrackingStatus = {
  hasSession: boolean;
  serviceRunning: boolean;
  activityId: number | null;
  activityType: ActivityType | null;
  state: NativeSessionState;
  elapsedMs: number | null;
  activeMs: number | null;
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
};

export type AndroidLocationEvents = {
  onLocationRecorded: (payload: unknown) => void;
  onStatusChanged: (payload: unknown) => void;
  onPreviewLocation: (payload: unknown) => void;
};
