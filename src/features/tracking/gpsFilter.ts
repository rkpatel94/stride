import { haversineDistanceMeters, isValidCoordinate } from '@/utils/geo';

import type { GpsFilterConfig } from './trackingConfig';

/**
 * Streaming GPS filter. It decides, one fix at a time, whether a measurement extends the route
 * and how much distance it adds. It is a pure function of (state, measurement, config) so the
 * same code runs live, when replaying the native journal after a restart, and in tests.
 *
 * Distance is measured from the last *accepted* point (the anchor), not from the previous raw
 * fix. Slow walking therefore still accumulates: small steps are rejected as noise until the
 * displacement from the anchor clears the threshold, and then the whole displacement is counted.
 *
 * Invariants relied upon elsewhere:
 *  - Rejected fixes add no distance.
 *  - For an accepted point that does not start a new line, segmentDistanceMeters is exactly the
 *    Haversine distance from the previous accepted point.
 *  - totalDistanceMeters is the sum of segmentDistanceMeters of accepted points.
 */

export type Measurement = {
  /** Native journal sequence; used to ignore replays of fixes that were already processed. */
  sequence?: number | null;
  /** Changes after every pause/resume or recovery; the route is never joined across it. */
  segmentIndex: number;
  latitude: number;
  longitude: number;
  wallTimeMs: number;
  /** Monotonic timestamp; preferred over wall time for ordering and speed. */
  elapsedRealtimeMs: number | null;
  accuracyMeters: number | null;
  speedMps: number | null;
  isMock?: boolean;
};

export type RejectionReason =
  | 'invalid_coordinates'
  | 'invalid_timestamp'
  | 'duplicate'
  | 'out_of_order'
  | 'poor_accuracy'
  | 'implausible_speed'
  | 'below_noise_threshold'
  | 'stationary_drift'
  | 'unconfirmed_movement';

export type FilterDecision = {
  accepted: boolean;
  rejectionReason: RejectionReason | null;
  /** Distance this point adds to the activity (0 when rejected or when it starts a new line). */
  segmentDistanceMeters: number;
  /** Accepted point that must not be connected to the previous accepted point. */
  startsNewLine: boolean;
  /** Seconds without a usable fix before this point, when that exceeded the gap threshold. */
  gapBeforeSeconds: number | null;
  impliedSpeedMps: number | null;
};

type FixRef = {
  latitude: number;
  longitude: number;
  timeMs: number;
  accuracyMeters: number;
};

export type AccuracyBuckets = {
  upTo5: number;
  upTo10: number;
  upTo20: number;
  upTo30: number;
  over30: number;
  unknown: number;
};

export type QualityCounters = {
  measurements: number;
  accepted: number;
  rejected: number;
  rejectionCounts: Partial<Record<RejectionReason, number>>;
  accuracyBuckets: AccuracyBuckets;
  gapCount: number;
  totalGapSeconds: number;
  longestGapSeconds: number;
  bridgedGapCount: number;
  bridgedDistanceMeters: number;
  unbridgedGapCount: number;
  relocations: number;
  mockLocations: number;
};

export type FilterState = {
  version: 1;
  lastSequence: number | null;
  lastTimeMs: number | null;
  segmentIndex: number | null;
  anchor: FixRef | null;
  /** The anchor starts a line and nothing has been connected to it yet. */
  anchorIsLineStart: boolean;
  /** Time of the last fix that passed validation and accuracy checks (for gap detection). */
  lastUsableTimeMs: number | null;
  /** Consecutive fixes beyond the stationary threshold that are waiting for confirmation. */
  pendingMovementFixes: number;
  /** Consecutive fixes rejected as jumps that agree with each other. */
  jumpCandidates: FixRef[];
  totalDistanceMeters: number;
  quality: QualityCounters;
};

export function createQualityCounters(): QualityCounters {
  return {
    measurements: 0,
    accepted: 0,
    rejected: 0,
    rejectionCounts: {},
    accuracyBuckets: { upTo5: 0, upTo10: 0, upTo20: 0, upTo30: 0, over30: 0, unknown: 0 },
    gapCount: 0,
    totalGapSeconds: 0,
    longestGapSeconds: 0,
    bridgedGapCount: 0,
    bridgedDistanceMeters: 0,
    unbridgedGapCount: 0,
    relocations: 0,
    mockLocations: 0,
  };
}

export function createFilterState(): FilterState {
  return {
    version: 1,
    lastSequence: null,
    lastTimeMs: null,
    segmentIndex: null,
    anchor: null,
    anchorIsLineStart: false,
    lastUsableTimeMs: null,
    pendingMovementFixes: 0,
    jumpCandidates: [],
    totalDistanceMeters: 0,
    quality: createQualityCounters(),
  };
}

function cloneQuality(quality: QualityCounters): QualityCounters {
  return {
    ...quality,
    rejectionCounts: { ...quality.rejectionCounts },
    accuracyBuckets: { ...quality.accuracyBuckets },
  };
}

function bucketFor(accuracy: number | null): keyof AccuracyBuckets {
  if (accuracy === null || !Number.isFinite(accuracy)) return 'unknown';
  if (accuracy <= 5) return 'upTo5';
  if (accuracy <= 10) return 'upTo10';
  if (accuracy <= 20) return 'upTo20';
  if (accuracy <= 30) return 'upTo30';
  return 'over30';
}

const timeOf = (measurement: Measurement) => measurement.elapsedRealtimeMs ?? measurement.wallTimeMs;

export function processMeasurement(
  state: FilterState,
  measurement: Measurement,
  config: GpsFilterConfig,
): { state: FilterState; decision: FilterDecision } {
  const next: FilterState = { ...state, quality: cloneQuality(state.quality) };
  const quality = next.quality;
  quality.measurements += 1;
  if (measurement.isMock) quality.mockLocations += 1;

  const reject = (reason: RejectionReason, impliedSpeedMps: number | null = null) => {
    quality.rejected += 1;
    quality.rejectionCounts[reason] = (quality.rejectionCounts[reason] ?? 0) + 1;
    const decision: FilterDecision = {
      accepted: false,
      rejectionReason: reason,
      segmentDistanceMeters: 0,
      startsNewLine: false,
      gapBeforeSeconds: null,
      impliedSpeedMps,
    };
    return { state: next, decision };
  };

  const accept = (
    fix: FixRef,
    distanceMeters: number,
    options: { startsNewLine: boolean; gapBeforeSeconds?: number | null; impliedSpeedMps?: number | null },
  ) => {
    quality.accepted += 1;
    next.totalDistanceMeters = state.totalDistanceMeters + distanceMeters;
    next.anchor = fix;
    next.anchorIsLineStart = options.startsNewLine;
    next.pendingMovementFixes = 0;
    next.jumpCandidates = [];
    const decision: FilterDecision = {
      accepted: true,
      rejectionReason: null,
      segmentDistanceMeters: distanceMeters,
      startsNewLine: options.startsNewLine,
      gapBeforeSeconds: options.gapBeforeSeconds ?? null,
      impliedSpeedMps: options.impliedSpeedMps ?? null,
    };
    return { state: next, decision };
  };

  // 1. Fixes replayed from the journal after a crash between commit and acknowledgement.
  const sequence = measurement.sequence ?? null;
  if (sequence !== null && state.lastSequence !== null && sequence <= state.lastSequence) {
    return reject('duplicate');
  }
  if (sequence !== null) next.lastSequence = sequence;

  // 2. Coordinates.
  if (!isValidCoordinate(measurement)) return reject('invalid_coordinates');

  // 3. A new recording segment (after pause/resume or recovery) never joins the previous one.
  //    It also restarts the ordering check: the monotonic clock restarts at zero when the phone
  //    reboots, and recovery after a reboot always begins a new segment.
  if (state.segmentIndex !== measurement.segmentIndex) {
    next.segmentIndex = measurement.segmentIndex;
    next.lastTimeMs = null;
    next.anchor = null;
    next.pendingMovementFixes = 0;
    next.jumpCandidates = [];
    next.lastUsableTimeMs = null;
  }

  // 4. Ordering within the segment. Monotonic time is used whenever the provider supplies it.
  const timeMs = timeOf(measurement);
  if (!Number.isFinite(timeMs) || timeMs <= 0) return reject('invalid_timestamp');
  if (next.lastTimeMs !== null) {
    if (timeMs === next.lastTimeMs) return reject('duplicate');
    if (timeMs < next.lastTimeMs) return reject('out_of_order');
  }
  next.lastTimeMs = timeMs;

  // 5. Accuracy.
  const accuracy = measurement.accuracyMeters;
  quality.accuracyBuckets[bucketFor(accuracy)] += 1;
  if (accuracy === null || !Number.isFinite(accuracy) || accuracy > config.poorAccuracyMeters) {
    return reject('poor_accuracy');
  }

  const fix: FixRef = {
    latitude: measurement.latitude,
    longitude: measurement.longitude,
    timeMs,
    accuracyMeters: accuracy,
  };

  const gapSeconds = next.lastUsableTimeMs !== null ? (timeMs - next.lastUsableTimeMs) / 1000 : 0;
  next.lastUsableTimeMs = timeMs;
  const isGap = gapSeconds > config.gapThresholdSeconds;
  if (isGap) {
    quality.gapCount += 1;
    quality.totalGapSeconds += gapSeconds;
    quality.longestGapSeconds = Math.max(quality.longestGapSeconds, gapSeconds);
  }

  // 6. First usable fix of a segment anchors a new line.
  const anchor = next.anchor;
  if (!anchor) return accept(fix, 0, { startsNewLine: true });

  const distance = haversineDistanceMeters(anchor, fix);
  const dtSeconds = Math.max((timeMs - anchor.timeMs) / 1000, 0.001);
  const impliedSpeed = distance / dtSeconds;
  const worseAccuracy = Math.max(anchor.accuracyMeters, accuracy);
  const combinedAccuracy = Math.hypot(anchor.accuracyMeters, accuracy);
  const movementThreshold = Math.max(config.minMovementMeters, config.movementAccuracyFactor * worseAccuracy);
  const stationaryThreshold = Math.max(movementThreshold, config.stationaryAccuracyFactor * combinedAccuracy);
  const speed = measurement.speedMps;
  const speedKnown = speed !== null && Number.isFinite(speed);
  const movingBySpeed = speedKnown && (speed as number) >= config.stationarySpeedMps;

  // 7. Anchor upgrade: a much more precise fix inside the uncertainty circle of a line-start
  //    anchor replaces it instead of adding a phantom displacement.
  if (
    !isGap &&
    next.anchorIsLineStart &&
    accuracy <= anchor.accuracyMeters * 0.5 &&
    distance <= anchor.accuracyMeters
  ) {
    return accept(fix, 0, { startsNewLine: true });
  }

  // 8. GPS gap: bridge short plausible gaps with the straight line (a lower bound), break the
  //    line for long ones. Nothing is invented in between.
  if (isGap) {
    next.pendingMovementFixes = 0;
    next.jumpCandidates = [];
    if (distance < stationaryThreshold) return reject('below_noise_threshold', impliedSpeed);
    if (gapSeconds <= config.maxBridgeableGapSeconds && impliedSpeed <= config.maxPlausibleSpeedMps) {
      quality.bridgedGapCount += 1;
      quality.bridgedDistanceMeters += distance;
      return accept(fix, distance, { startsNewLine: false, gapBeforeSeconds: gapSeconds, impliedSpeedMps: impliedSpeed });
    }
    quality.unbridgedGapCount += 1;
    return accept(fix, 0, { startsNewLine: true, gapBeforeSeconds: gapSeconds, impliedSpeedMps: impliedSpeed });
  }

  // 9. Jumps. A single wild fix is ignored; several consistent ones mean the anchor was wrong
  //    (or we really moved without fixes), so the line restarts there without adding distance.
  if (impliedSpeed > config.maxPlausibleSpeedMps) {
    const previous = next.jumpCandidates[next.jumpCandidates.length - 1];
    const consistent =
      previous !== undefined &&
      haversineDistanceMeters(previous, fix) / Math.max((timeMs - previous.timeMs) / 1000, 0.001) <=
        config.maxPlausibleSpeedMps;
    const candidates = consistent ? [...next.jumpCandidates, fix] : [fix];
    if (candidates.length >= config.relocationConfirmations) {
      quality.relocations += 1;
      return accept(fix, 0, { startsNewLine: true, impliedSpeedMps: impliedSpeed });
    }
    next.jumpCandidates = candidates;
    return reject('implausible_speed', impliedSpeed);
  }
  next.jumpCandidates = [];

  // 10. Movement versus noise.
  if (movingBySpeed) {
    next.pendingMovementFixes = 0;
    if (distance < movementThreshold) return reject('below_noise_threshold', impliedSpeed);
    return accept(fix, distance, { startsNewLine: false, impliedSpeedMps: impliedSpeed });
  }

  // Stationary or unknown speed: require a larger displacement that persists for several
  // consecutive fixes, so random scatter around a fixed point does not turn into distance.
  // The distance counted is still the full displacement from the anchor.
  if (distance < stationaryThreshold) {
    next.pendingMovementFixes = 0;
    return reject(speedKnown ? 'stationary_drift' : 'below_noise_threshold', impliedSpeed);
  }
  if (next.pendingMovementFixes < config.stationaryConfirmations) {
    next.pendingMovementFixes += 1;
    return reject('unconfirmed_movement', impliedSpeed);
  }
  return accept(fix, distance, { startsNewLine: false, impliedSpeedMps: impliedSpeed });
}

/** Runs a whole trace through the filter; used for tests and for re-analysing saved routes. */
export function runFilter(measurements: Measurement[], config: GpsFilterConfig, initial = createFilterState()) {
  let state = initial;
  const decisions: FilterDecision[] = [];
  for (const measurement of measurements) {
    const result = processMeasurement(state, measurement, config);
    state = result.state;
    decisions.push(result.decision);
  }
  return { state, decisions };
}

/** Parses persisted filter state, falling back to a fresh state if it is missing or corrupt. */
export function restoreFilterState(json: string | null | undefined): FilterState {
  if (!json) return createFilterState();
  try {
    const parsed = JSON.parse(json) as Partial<FilterState>;
    if (parsed?.version !== 1 || typeof parsed.totalDistanceMeters !== 'number') return createFilterState();
    return {
      ...createFilterState(),
      ...parsed,
      jumpCandidates: Array.isArray(parsed.jumpCandidates) ? parsed.jumpCandidates : [],
      pendingMovementFixes: typeof parsed.pendingMovementFixes === 'number' ? parsed.pendingMovementFixes : 0,
      quality: { ...createQualityCounters(), ...parsed.quality } as QualityCounters,
    };
  } catch {
    return createFilterState();
  }
}
