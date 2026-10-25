import { interpolate, type LatLng } from '@/utils/geo';

/**
 * Route replay built from the saved accepted points and their recorded timestamps.
 *
 * Replay time runs on the workout's *active* clock: time spent paused (between recording
 * segments) is skipped. Within a segment the marker moves between consecutive fixes in real
 * proportion to their timestamps. Across any discontinuity (pause, long GPS gap, relocation)
 * the marker does not glide: it waits at the last fix and then jumps, and the frame reports
 * that it is in a gap.
 */

export type ReplayInputPoint = LatLng & {
  /** Monotonic time if available, otherwise wall time. */
  timeMs: number;
  segmentIndex: number;
  startsNewLine: boolean;
  gapBeforeSeconds: number | null;
  segmentDistanceMeters: number;
};

export type ReplayKeyframe = LatLng & {
  /** Seconds since replay start. */
  t: number;
  cumulativeDistanceMeters: number;
  /** How the marker reaches this keyframe from the previous one. */
  arrival: 'start' | 'move' | 'jump';
};

export type ReplayTimeline = {
  keyframes: ReplayKeyframe[];
  durationSeconds: number;
  totalDistanceMeters: number;
};

export type ReplayFrame = LatLng & {
  t: number;
  progress: number;
  distanceMeters: number;
  /** True while waiting at a discontinuity (no recorded fixes for this stretch). */
  inGap: boolean;
  /** Index of the last keyframe passed; the drawn trail ends here. */
  keyframeIndex: number;
};

export function buildReplayTimeline(points: ReplayInputPoint[]): ReplayTimeline {
  const keyframes: ReplayKeyframe[] = [];
  let t = 0;
  let distance = 0;
  let previous: ReplayInputPoint | null = null;

  for (const point of points) {
    if (!previous) {
      keyframes.push({ latitude: point.latitude, longitude: point.longitude, t: 0, cumulativeDistanceMeters: 0, arrival: 'start' });
      previous = point;
      continue;
    }
    const sameSegment = point.segmentIndex === previous.segmentIndex;
    const dt = Math.max(0, (point.timeMs - previous.timeMs) / 1000);
    distance += point.segmentDistanceMeters;

    if (!sameSegment) {
      // Paused time is not part of the active clock: jump immediately.
      keyframes.push({ latitude: point.latitude, longitude: point.longitude, t, cumulativeDistanceMeters: distance, arrival: 'jump' });
    } else if (point.startsNewLine || point.gapBeforeSeconds !== null) {
      // Real elapsed time with no route in between: hold, then jump.
      t += dt;
      keyframes.push({ latitude: point.latitude, longitude: point.longitude, t, cumulativeDistanceMeters: distance, arrival: 'jump' });
    } else {
      t += dt;
      keyframes.push({ latitude: point.latitude, longitude: point.longitude, t, cumulativeDistanceMeters: distance, arrival: 'move' });
    }
    previous = point;
  }
  return { keyframes, durationSeconds: t, totalDistanceMeters: distance };
}

/** Position at replay time `t` (seconds), clamped to the timeline. */
export function frameAt(timeline: ReplayTimeline, t: number): ReplayFrame | null {
  const { keyframes, durationSeconds } = timeline;
  if (keyframes.length === 0) return null;
  const time = Math.min(Math.max(0, t), durationSeconds);
  const progress = durationSeconds > 0 ? time / durationSeconds : 1;

  // Last keyframe with keyframe.t <= time; on ties (instant jumps) take the latest.
  let low = 0;
  let high = keyframes.length - 1;
  while (low < high) {
    const mid = Math.ceil((low + high) / 2);
    if (keyframes[mid].t <= time) low = mid;
    else high = mid - 1;
  }
  const current = keyframes[low];
  const next = keyframes[low + 1];

  if (!next) {
    return { latitude: current.latitude, longitude: current.longitude, t: time, progress, distanceMeters: current.cumulativeDistanceMeters, inGap: false, keyframeIndex: low };
  }
  if (next.arrival === 'jump') {
    return {
      latitude: current.latitude,
      longitude: current.longitude,
      t: time,
      progress,
      distanceMeters: current.cumulativeDistanceMeters,
      inGap: next.t > current.t,
      keyframeIndex: low,
    };
  }
  const span = next.t - current.t;
  const fraction = span > 0 ? (time - current.t) / span : 1;
  const position = interpolate(current, next, fraction);
  return {
    ...position,
    t: time,
    progress,
    distanceMeters:
      current.cumulativeDistanceMeters + (next.cumulativeDistanceMeters - current.cumulativeDistanceMeters) * fraction,
    inGap: false,
    keyframeIndex: low,
  };
}

export const REPLAY_SPEEDS = [1, 2, 5, 10, 30, 60] as const;
export type ReplaySpeed = (typeof REPLAY_SPEEDS)[number];
