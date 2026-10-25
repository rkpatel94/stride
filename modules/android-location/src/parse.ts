import type {
  ActivityType,
  DeviceLocationStatus,
  JournalPoint,
  NativeSessionState,
  NativeTrackingStatus,
  PreviewEvent,
  RawLocation,
} from './AndroidLocation.types';

// Native payloads cross an untyped bridge. Everything is validated here so the rest of the app
// can trust the shapes (and so a malformed fix can never reach the distance calculation).

type Bag = Record<string, unknown>;

const isBag = (value: unknown): value is Bag => typeof value === 'object' && value !== null;

const finiteOrNull = (value: unknown): number | null =>
  typeof value === 'number' && Number.isFinite(value) ? value : null;

const stringOrNull = (value: unknown): string | null => (typeof value === 'string' ? value : null);

const SESSION_STATES: NativeSessionState[] = ['idle', 'recording', 'paused', 'interrupted', 'finished'];

function parseActivityType(value: unknown): ActivityType | null {
  return value === 'walk' || value === 'run' ? value : null;
}

export function parseRawLocation(value: unknown): RawLocation | null {
  if (!isBag(value)) return null;
  const latitude = finiteOrNull(value.latitude);
  const longitude = finiteOrNull(value.longitude);
  const wallTimeMs = finiteOrNull(value.wallTimeMs);
  if (latitude === null || longitude === null || wallTimeMs === null) return null;
  const accuracy = finiteOrNull(value.accuracyMeters);
  const speed = finiteOrNull(value.speedMps);
  return {
    latitude,
    longitude,
    wallTimeMs,
    elapsedRealtimeMs: finiteOrNull(value.elapsedRealtimeMs),
    accuracyMeters: accuracy !== null && accuracy >= 0 ? accuracy : null,
    altitudeMeters: finiteOrNull(value.altitudeMeters),
    speedMps: speed !== null && speed >= 0 ? speed : null,
    bearingDegrees: finiteOrNull(value.bearingDegrees),
    provider: stringOrNull(value.provider),
    isMock: value.isMock === true,
  };
}

export function parseJournalPoint(value: unknown): JournalPoint | null {
  const location = parseRawLocation(value);
  if (!location || !isBag(value)) return null;
  const sequence = finiteOrNull(value.sequence);
  const activityId = finiteOrNull(value.activityId);
  const segmentIndex = finiteOrNull(value.segmentIndex);
  if (sequence === null || activityId === null || segmentIndex === null) return null;
  return { ...location, sequence, activityId, segmentIndex };
}

export function parseStatus(value: unknown): NativeTrackingStatus {
  const bag: Bag = isBag(value) ? value : {};
  const state = SESSION_STATES.includes(bag.state as NativeSessionState)
    ? (bag.state as NativeSessionState)
    : 'idle';
  return {
    hasSession: bag.hasSession === true,
    serviceRunning: bag.serviceRunning === true,
    activityId: finiteOrNull(bag.activityId),
    activityType: parseActivityType(bag.activityType),
    state,
    elapsedMs: finiteOrNull(bag.elapsedMs),
    activeMs: finiteOrNull(bag.activeMs),
    startedAtWallMs: finiteOrNull(bag.startedAtWallMs),
    finishedAtWallMs: finiteOrNull(bag.finishedAtWallMs),
    segmentIndex: finiteOrNull(bag.segmentIndex),
    lastFixAgeMs: finiteOrNull(bag.lastFixAgeMs),
    interruptionReason: stringOrNull(bag.interruptionReason),
    stateBeforeInterruption: stringOrNull(bag.stateBeforeInterruption),
    pendingJournalPoints: finiteOrNull(bag.pendingJournalPoints),
    gpsAvailable: typeof bag.gpsAvailable === 'boolean' ? bag.gpsAvailable : null,
    signalLost: bag.signalLost === true,
    locationServicesEnabled: bag.locationServicesEnabled !== false,
    lowBattery: bag.lowBattery === true,
    locationSource: stringOrNull(bag.locationSource),
    error: stringOrNull(bag.error),
  };
}

export function parseDeviceStatus(value: unknown): DeviceLocationStatus {
  const bag: Bag = isBag(value) ? value : {};
  return {
    sdkInt: finiteOrNull(bag.sdkInt) ?? 0,
    hasFineLocation: bag.hasFineLocation === true,
    hasCoarseLocation: bag.hasCoarseLocation === true,
    hasBackgroundLocation: bag.hasBackgroundLocation === true,
    notificationsEnabled: bag.notificationsEnabled === true,
    locationEnabled: bag.locationEnabled === true,
    gpsProviderEnabled: bag.gpsProviderEnabled === true,
    networkProviderEnabled: bag.networkProviderEnabled === true,
    playServicesAvailable: bag.playServicesAvailable === true,
    powerSaveMode: bag.powerSaveMode === true,
    locationPowerSaveMode: finiteOrNull(bag.locationPowerSaveMode) ?? 0,
    ignoringBatteryOptimizations: bag.ignoringBatteryOptimizations === true,
    batteryPercent: finiteOrNull(bag.batteryPercent),
  };
}

export function parsePreviewEvent(value: unknown): PreviewEvent | null {
  if (!isBag(value)) return null;
  if (value.kind === 'availability') return { kind: 'availability', available: value.available === true };
  if (value.kind === 'error') return { kind: 'error', message: stringOrNull(value.message) ?? 'Location unavailable' };
  const location = parseRawLocation(value);
  return location ? { kind: 'location', ...location } : null;
}
