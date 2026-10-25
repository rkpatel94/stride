/** Below this speed the user is effectively standing; pace would be meaningless. */
export const MIN_SPEED_FOR_PACE_MPS = 0.3;
/** Pace is not reported for distances shorter than this (division by ~0). */
export const MIN_DISTANCE_FOR_PACE_METERS = 10;

export function averageSpeedMps(distanceMeters: number, activeSeconds: number): number | null {
  if (!Number.isFinite(distanceMeters) || !Number.isFinite(activeSeconds)) return null;
  if (activeSeconds <= 0 || distanceMeters < 0) return null;
  return distanceMeters / activeSeconds;
}

/** Seconds per kilometre from total active time and distance — never an average of paces. */
export function averagePaceSecondsPerKm(activeSeconds: number, distanceMeters: number): number | null {
  if (!Number.isFinite(distanceMeters) || !Number.isFinite(activeSeconds)) return null;
  if (distanceMeters < MIN_DISTANCE_FOR_PACE_METERS || activeSeconds <= 0) return null;
  return activeSeconds / (distanceMeters / 1000);
}

export function paceFromSpeed(speedMps: number | null): number | null {
  if (speedMps === null || !Number.isFinite(speedMps) || speedMps < MIN_SPEED_FOR_PACE_MPS) return null;
  return 1000 / speedMps;
}

export type PaceSample = {
  timeMs: number;
  cumulativeDistanceMeters: number;
};

/**
 * Current speed over a trailing window of accepted points. `nowMs` is the time of the most
 * recent fix (accepted or not), so standing still makes the speed fall instead of freezing.
 * Returns null while there is not enough data to say anything.
 */
export function currentSpeedMps(samples: PaceSample[], nowMs: number | null, windowSeconds: number): number | null {
  if (samples.length === 0 || nowMs === null) return null;
  const last = samples[samples.length - 1];
  const end = Math.max(nowMs, last.timeMs);
  const windowStart = end - windowSeconds * 1000;

  if (last.timeMs < windowStart) return 0; // No accepted movement inside the window.

  // Baseline: the last sample at or before the window start, else the earliest sample in it.
  let baseline = samples[0];
  for (const sample of samples) {
    if (sample.timeMs <= windowStart) baseline = sample;
    else break;
  }
  const spanSeconds = (end - baseline.timeMs) / 1000;
  if (spanSeconds < 3) return null;
  const distance = last.cumulativeDistanceMeters - baseline.cumulativeDistanceMeters;
  return Math.max(0, distance) / spanSeconds;
}
