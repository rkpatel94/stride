import { buildReplayTimeline, frameAt, type ReplayInputPoint } from '@/features/activities/replay';
import { appendVertex, buildRouteGeometry, buildRoutePreview, emptyGeometry } from '@/features/activities/routeGeometry';
import { destinationPoint, type LatLng } from '@/utils/geo';

const origin: LatLng = { latitude: 48.2082, longitude: 16.3738 };

function point(meters: number, t: number, extra: Partial<ReplayInputPoint> = {}): ReplayInputPoint {
  return {
    ...destinationPoint(origin, meters, 90),
    timeMs: t * 1000,
    segmentIndex: 0,
    startsNewLine: false,
    gapBeforeSeconds: null,
    segmentDistanceMeters: 0,
    ...extra,
  };
}

describe('route geometry', () => {
  const vertices = [
    { ...origin, startsNewLine: true, gapBeforeSeconds: null },
    { ...destinationPoint(origin, 10, 90), startsNewLine: false, gapBeforeSeconds: null },
    { ...destinationPoint(origin, 60, 90), startsNewLine: false, gapBeforeSeconds: 40 }, // bridged gap
    { ...destinationPoint(origin, 70, 90), startsNewLine: false, gapBeforeSeconds: null },
    { ...destinationPoint(origin, 500, 90), startsNewLine: true, gapBeforeSeconds: null }, // after pause
    { ...destinationPoint(origin, 510, 90), startsNewLine: false, gapBeforeSeconds: null },
  ];

  it('splits lines at pauses and gaps and records dashed gap connectors', () => {
    const geometry = buildRouteGeometry(vertices);
    expect(geometry.lines.map((line) => line.length)).toEqual([2, 2, 2]);
    expect(geometry.gapConnectors).toHaveLength(1);
    expect(geometry.start).toEqual({ latitude: origin.latitude, longitude: origin.longitude });
  });

  it('builds the same geometry incrementally (live) as in one pass (saved)', () => {
    const incremental = vertices.reduce(appendVertex, emptyGeometry());
    expect(incremental).toEqual(buildRouteGeometry(vertices));
  });

  it('simplifies a preview to at most the requested number of points, keeping the ends', () => {
    const wiggly = Array.from({ length: 500 }, (_, i) => destinationPoint(origin, i * 2, 45 + Math.sin(i / 20) * 30));
    const [line] = buildRoutePreview([wiggly], 40);
    expect(line.length).toBeLessThanOrEqual(40);
    expect(line[0]).toEqual([Number(wiggly[0].latitude.toFixed(6)), Number(wiggly[0].longitude.toFixed(6))]);
  });

  it('keeps line breaks (pauses, long gaps) in the preview and drops single points', () => {
    const geometry = buildRouteGeometry(vertices);
    const preview = buildRoutePreview(geometry.lines);
    expect(preview).toHaveLength(3);
    expect(buildRoutePreview([[origin]])).toEqual([]);
  });
});

describe('route replay', () => {
  it('moves along recorded timestamps and reports cumulative distance', () => {
    const timeline = buildReplayTimeline([
      point(0, 0, { startsNewLine: true }),
      point(10, 10, { segmentDistanceMeters: 10 }),
      point(30, 20, { segmentDistanceMeters: 20 }),
    ]);
    expect(timeline.durationSeconds).toBe(20);
    expect(timeline.totalDistanceMeters).toBe(30);
    const middle = frameAt(timeline, 5);
    expect(middle?.distanceMeters).toBeCloseTo(5, 6);
    expect(middle?.inGap).toBe(false);
    expect(frameAt(timeline, 15)?.distanceMeters).toBeCloseTo(20, 6);
    expect(frameAt(timeline, 999)?.progress).toBe(1);
  });

  it('skips paused time and never glides across a pause', () => {
    const timeline = buildReplayTimeline([
      point(0, 0, { startsNewLine: true }),
      point(10, 10, { segmentDistanceMeters: 10 }),
      // Resumed 10 minutes later and 400 m away.
      point(410, 610, { segmentIndex: 1, startsNewLine: true }),
      point(420, 620, { segmentIndex: 1, segmentDistanceMeters: 10 }),
    ]);
    expect(timeline.durationSeconds).toBe(20); // active time only
    const atPause = frameAt(timeline, 10);
    expect(atPause?.longitude).toBeCloseTo(destinationPoint(origin, 410, 90).longitude, 9);
  });

  it('holds position during a recorded GPS gap and then jumps', () => {
    const timeline = buildReplayTimeline([
      point(0, 0, { startsNewLine: true }),
      point(10, 10, { segmentDistanceMeters: 10 }),
      point(60, 50, { segmentDistanceMeters: 50, gapBeforeSeconds: 40 }),
    ]);
    const during = frameAt(timeline, 30);
    expect(during?.inGap).toBe(true);
    expect(during?.longitude).toBeCloseTo(destinationPoint(origin, 10, 90).longitude, 9);
    expect(frameAt(timeline, 50)?.distanceMeters).toBe(60);
  });

  it('handles empty and single-point routes', () => {
    expect(frameAt(buildReplayTimeline([]), 0)).toBeNull();
    const single = buildReplayTimeline([point(0, 0, { startsNewLine: true })]);
    expect(frameAt(single, 3)).toMatchObject({ progress: 1, distanceMeters: 0 });
  });
});
