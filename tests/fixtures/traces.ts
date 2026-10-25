import type { Measurement } from '@/features/tracking/gpsFilter';
import { destinationPoint, type LatLng } from '@/utils/geo';

/**
 * Deterministic synthetic GPS traces. Noise is generated with a seeded PRNG so every test run
 * sees exactly the same fixes.
 */

export const ORIGIN: LatLng = { latitude: 51.5007, longitude: -0.1246 };
export const T0 = 1_700_000_000_000; // wall clock
export const E0 = 5_000_000; // elapsedRealtime at the first fix

export function mulberry32(seed: number) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export function gaussian(random: () => number) {
  const u = Math.max(random(), 1e-12);
  const v = random();
  return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * v);
}

/** Moves `point` by a random offset with the given standard deviation per axis (meters). */
export function jitter(point: LatLng, sigmaMeters: number, random: () => number): LatLng {
  if (sigmaMeters === 0) return point;
  const north = gaussian(random) * sigmaMeters;
  const east = gaussian(random) * sigmaMeters;
  return destinationPoint(destinationPoint(point, north, 0), east, 90);
}

type Options = {
  seed?: number;
  sigmaMeters?: number;
  accuracy?: number | (() => number);
  speed?: number | null;
  segmentIndex?: number;
  startIndex?: number;
  intervalMs?: number;
};

let sequenceCounter = 0;
export function resetSequence() {
  sequenceCounter = 0;
}

export function fix(
  position: LatLng,
  secondsFromStart: number,
  options: { accuracy?: number | null; speed?: number | null; segmentIndex?: number } = {},
): Measurement {
  sequenceCounter += 1;
  return {
    sequence: sequenceCounter,
    segmentIndex: options.segmentIndex ?? 0,
    latitude: position.latitude,
    longitude: position.longitude,
    wallTimeMs: T0 + secondsFromStart * 1000,
    elapsedRealtimeMs: E0 + secondsFromStart * 1000,
    accuracyMeters: options.accuracy === undefined ? 5 : options.accuracy,
    speedMps: options.speed === undefined ? null : options.speed,
  };
}

/** A phone lying still for `seconds`, with scattered fixes. */
export function stationaryTrace(seconds: number, options: Options = {}): Measurement[] {
  const random = mulberry32(options.seed ?? 1);
  const sigma = options.sigmaMeters ?? 3;
  const result: Measurement[] = [];
  for (let s = 0; s < seconds; s += 1) {
    const accuracy = typeof options.accuracy === 'function' ? options.accuracy() : options.accuracy ?? 5 + random() * 3;
    result.push(
      fix(jitter(ORIGIN, sigma, random), (options.startIndex ?? 0) + s, {
        accuracy,
        speed: options.speed === undefined ? 0.1 + random() * 0.2 : options.speed,
        segmentIndex: options.segmentIndex,
      }),
    );
  }
  return result;
}

export type Leg = { bearing: number; meters: number };

/** Moves along `legs` at a constant speed with one fix per second. Returns fixes and true distance. */
export function routeTrace(
  legs: Leg[],
  speedMps: number,
  options: Options & { start?: LatLng; startSecond?: number } = {},
): { fixes: Measurement[]; trueDistance: number; end: LatLng; endSecond: number } {
  const random = mulberry32(options.seed ?? 7);
  const sigma = options.sigmaMeters ?? 0.5;
  const fixes: Measurement[] = [];
  let position = options.start ?? ORIGIN;
  let second = options.startSecond ?? 0;
  let trueDistance = 0;
  const reportedSpeed = options.speed === undefined ? speedMps : options.speed;

  const emit = () => {
    const accuracy = typeof options.accuracy === 'function' ? options.accuracy() : options.accuracy ?? 4 + random() * 2;
    fixes.push(
      fix(jitter(position, sigma, random), second, {
        accuracy,
        speed: reportedSpeed === null ? null : Math.max(0, reportedSpeed + gaussian(random) * 0.1),
        segmentIndex: options.segmentIndex,
      }),
    );
  };

  emit();
  for (const leg of legs) {
    let remaining = leg.meters;
    while (remaining > 1e-9) {
      const step = Math.min(speedMps, remaining);
      position = destinationPoint(position, step, leg.bearing);
      remaining -= step;
      trueDistance += step;
      second += step / speedMps;
      emit();
    }
  }
  return { fixes, trueDistance, end: position, endSecond: second };
}
