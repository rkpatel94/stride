import { createFilterState, processMeasurement, restoreFilterState, runFilter, type Measurement } from '@/features/tracking/gpsFilter';
import { filterConfigFor } from '@/features/tracking/trackingConfig';
import { destinationPoint, haversineDistanceMeters } from '@/utils/geo';

import { fix, ORIGIN, resetSequence, routeTrace, stationaryTrace } from '../fixtures/traces';

const config = filterConfigFor('walk');

/** Sum of segment distances of accepted points — must equal the filter's running total. */
function acceptedSum(decisions: ReturnType<typeof runFilter>['decisions']) {
  return decisions.reduce((sum, decision) => sum + (decision.accepted ? decision.segmentDistanceMeters : 0), 0);
}

beforeEach(() => resetSequence());

describe('stationary phone with GPS noise', () => {
  it('adds (almost) no distance over 10 minutes when the provider reports ~0 speed', () => {
    const { state, decisions } = runFilter(stationaryTrace(600, { seed: 11, sigmaMeters: 3 }), config);
    expect(state.totalDistanceMeters).toBeLessThan(10);
    expect(acceptedSum(decisions)).toBeCloseTo(state.totalDistanceMeters, 9);
    expect(state.quality.rejectionCounts.stationary_drift ?? 0).toBeGreaterThan(400);
  });

  it('also stays near zero when the provider does not report speed', () => {
    const { state } = runFilter(stationaryTrace(600, { seed: 12, sigmaMeters: 3, speed: null }), config);
    expect(state.totalDistanceMeters).toBeLessThan(15);
  });
});

describe('straight walking route', () => {
  it('measures a 1 km walk at 1.4 m/s within 3 %', () => {
    const { fixes, trueDistance } = routeTrace([{ bearing: 90, meters: 1000 }], 1.4, { seed: 3, sigmaMeters: 0.5 });
    const { state, decisions } = runFilter(fixes, config);
    expect(Math.abs(state.totalDistanceMeters - trueDistance) / trueDistance).toBeLessThan(0.03);
    expect(acceptedSum(decisions)).toBeCloseTo(state.totalDistanceMeters, 6);
  });

  it('does not undercount very slow walking (0.6 m/s) even though each step is below the noise floor', () => {
    const { fixes, trueDistance } = routeTrace([{ bearing: 10, meters: 300 }], 0.6, { seed: 4, sigmaMeters: 0.3, speed: 0.6 });
    const { state } = runFilter(fixes, config);
    expect(state.totalDistanceMeters).toBeGreaterThan(trueDistance * 0.95);
    expect(state.totalDistanceMeters).toBeLessThan(trueDistance * 1.05);
  });

  it('still measures walking when the provider reports no speed at all', () => {
    const { fixes, trueDistance } = routeTrace([{ bearing: 200, meters: 500 }], 1.3, { seed: 5, sigmaMeters: 0.5, speed: null });
    const { state } = runFilter(fixes, config);
    expect(Math.abs(state.totalDistanceMeters - trueDistance) / trueDistance).toBeLessThan(0.05);
  });

  it('measures every segment as the Haversine distance from the previous accepted point', () => {
    const { fixes } = routeTrace([{ bearing: 45, meters: 200 }], 1.4, { seed: 6 });
    const { decisions } = runFilter(fixes, config);
    let previous: (typeof fixes)[number] | null = null;
    fixes.forEach((measurement, index) => {
      const decision = decisions[index];
      if (!decision.accepted) return;
      if (previous && !decision.startsNewLine) {
        expect(decision.segmentDistanceMeters).toBeCloseTo(haversineDistanceMeters(previous, measurement), 9);
      }
      previous = measurement;
    });
  });
});

describe('running route with turns', () => {
  it('measures a 1 km square loop at 3.5 m/s within 3 %', () => {
    const legs = [0, 90, 180, 270].map((bearing) => ({ bearing, meters: 250 }));
    const { fixes, trueDistance } = routeTrace(legs, 3.5, { seed: 8, sigmaMeters: 0.7 });
    const { state } = runFilter(fixes, filterConfigFor('run'));
    expect(Math.abs(state.totalDistanceMeters - trueDistance) / trueDistance).toBeLessThan(0.03);
  });

  it('keeps sharp zig-zags (out-and-back every 20 m)', () => {
    const legs = Array.from({ length: 20 }, (_, i) => ({ bearing: i % 2 === 0 ? 0 : 180, meters: 20 }));
    const { fixes, trueDistance } = routeTrace(legs, 3, { seed: 9, sigmaMeters: 0.3 });
    const { state } = runFilter(fixes, filterConfigFor('run'));
    expect(state.totalDistanceMeters).toBeGreaterThan(trueDistance * 0.85);
    expect(state.totalDistanceMeters).toBeLessThan(trueDistance * 1.05);
  });
});

describe('duplicate and out-of-order measurements', () => {
  it('ignores an exact duplicate timestamp and replayed journal sequences', () => {
    const a = fix(ORIGIN, 0, { speed: 1.4 });
    const b = fix(destinationPoint(ORIGIN, 5, 90), 4, { speed: 1.4 });
    const duplicateTime = { ...b, sequence: 99, latitude: b.latitude + 0.0001 };
    const replay = { ...b };
    const { state, decisions } = runFilter([a, b, duplicateTime, replay], config);
    expect(decisions.map((d) => d.rejectionReason)).toEqual([null, null, 'duplicate', 'duplicate']);
    expect(state.totalDistanceMeters).toBeCloseTo(5, 6);
  });

  it('rejects measurements older than the last one', () => {
    const a = fix(ORIGIN, 0, { speed: 1.4 });
    const b = fix(destinationPoint(ORIGIN, 6, 90), 5, { speed: 1.4 });
    const late = fix(destinationPoint(ORIGIN, 3, 90), 3, { speed: 1.4 });
    const { decisions, state } = runFilter([a, b, late], config);
    expect(decisions[2].rejectionReason).toBe('out_of_order');
    expect(state.totalDistanceMeters).toBeCloseTo(6, 6);
  });

  it('rejects invalid coordinates without touching the timeline', () => {
    const first = fix(ORIGIN, 0);
    const bad = { ...fix(ORIGIN, 1), latitude: 123 };
    const { decisions, state } = runFilter([first, bad, fix(ORIGIN, 2)], config);
    expect(decisions[1].rejectionReason).toBe('invalid_coordinates');
    expect(state.quality.rejected).toBeGreaterThanOrEqual(1);
  });
});

describe('GPS jump', () => {
  it('ignores a single fix 300 m off the route', () => {
    const { fixes, trueDistance } = routeTrace([{ bearing: 0, meters: 300 }], 1.4, { seed: 10 });
    const jumped = fixes.slice();
    const index = 100;
    jumped[index] = { ...jumped[index], ...destinationPoint(jumped[index], 300, 90) };
    const { state, decisions } = runFilter(jumped, config);
    expect(decisions[index].rejectionReason).toBe('implausible_speed');
    expect(Math.abs(state.totalDistanceMeters - trueDistance) / trueDistance).toBeLessThan(0.04);
  });

  it('re-anchors without adding distance after several consistent far fixes', () => {
    const start = routeTrace([{ bearing: 0, meters: 50 }], 1.4, { seed: 13 });
    const relocated = routeTrace([{ bearing: 0, meters: 50 }], 1.4, {
      seed: 14,
      start: destinationPoint(start.end, 500, 90),
      startSecond: start.endSecond + 1,
    });
    const { state, decisions } = runFilter([...start.fixes, ...relocated.fixes], config);
    expect(state.quality.relocations).toBe(1);
    const relocation = decisions.findIndex((d, i) => i >= start.fixes.length && d.accepted && d.startsNewLine);
    expect(relocation).toBeGreaterThanOrEqual(start.fixes.length);
    expect(state.totalDistanceMeters).toBeLessThan(120); // ~100 m walked, the 500 m jump is excluded
  });
});

describe('GPS gaps', () => {
  it('bridges a short gap with the straight-line distance and marks it', () => {
    const before = routeTrace([{ bearing: 90, meters: 100 }], 1.4, { seed: 15 });
    // 40 s without fixes while walking ~56 m.
    const after = routeTrace([{ bearing: 90, meters: 100 }], 1.4, {
      seed: 16,
      start: destinationPoint(before.end, 56, 90),
      startSecond: before.endSecond + 40,
    });
    const { state, decisions } = runFilter([...before.fixes, ...after.fixes], config);
    const bridged = decisions[before.fixes.length];
    expect(bridged.accepted).toBe(true);
    expect(bridged.startsNewLine).toBe(false);
    expect(bridged.gapBeforeSeconds).toBeCloseTo(40, 0);
    expect(state.quality.bridgedGapCount).toBe(1);
    expect(state.totalDistanceMeters).toBeGreaterThan(245);
    expect(state.totalDistanceMeters).toBeLessThan(265);
  });

  it('does not invent distance across a prolonged gap and breaks the line', () => {
    const before = routeTrace([{ bearing: 90, meters: 100 }], 1.4, { seed: 17 });
    const after = routeTrace([{ bearing: 90, meters: 100 }], 1.4, {
      seed: 18,
      start: destinationPoint(before.end, 400, 90),
      startSecond: before.endSecond + 300,
    });
    const { state, decisions } = runFilter([...before.fixes, ...after.fixes], config);
    const resumed = decisions[before.fixes.length];
    expect(resumed.accepted).toBe(true);
    expect(resumed.startsNewLine).toBe(true);
    expect(resumed.segmentDistanceMeters).toBe(0);
    expect(state.quality.unbridgedGapCount).toBe(1);
    expect(state.totalDistanceMeters).toBeLessThan(210);
  });
});

describe('low-accuracy measurements', () => {
  it('rejects fixes worse than the poor-accuracy threshold', () => {
    const { fixes, trueDistance } = routeTrace([{ bearing: 0, meters: 200 }], 1.4, { seed: 19 });
    const degraded = fixes.map((m, i) =>
      i % 3 === 1 ? { ...m, accuracyMeters: 60, latitude: m.latitude + 0.0004 } : m,
    );
    const { state, decisions } = runFilter(degraded, config);
    expect(decisions.filter((d) => d.rejectionReason === 'poor_accuracy').length).toBeGreaterThan(40);
    expect(Math.abs(state.totalDistanceMeters - trueDistance) / trueDistance).toBeLessThan(0.05);
  });

  it('upgrades a coarse first fix instead of counting the jump to a precise one', () => {
    const coarse = fix(destinationPoint(ORIGIN, 15, 0), 0, { accuracy: 25, speed: 0 });
    const precise = fix(ORIGIN, 1, { accuracy: 4, speed: 0 });
    const { state, decisions } = runFilter([coarse, precise], config);
    expect(decisions[1].accepted).toBe(true);
    expect(decisions[1].startsNewLine).toBe(true);
    expect(state.totalDistanceMeters).toBe(0);
  });
});

describe('pause and resume', () => {
  it('never connects the last position before a pause to the first one after', () => {
    const first = routeTrace([{ bearing: 0, meters: 100 }], 1.4, { seed: 20, segmentIndex: 0 });
    // Moved 600 m while paused.
    const second = routeTrace([{ bearing: 0, meters: 100 }], 1.4, {
      seed: 21,
      segmentIndex: 1,
      start: destinationPoint(first.end, 600, 90),
      startSecond: first.endSecond + 600,
    });
    const { state, decisions } = runFilter([...first.fixes, ...second.fixes], config);
    const firstAfterResume = decisions[first.fixes.length];
    expect(firstAfterResume.startsNewLine).toBe(true);
    expect(firstAfterResume.segmentDistanceMeters).toBe(0);
    expect(firstAfterResume.gapBeforeSeconds).toBeNull();
    expect(state.quality.gapCount).toBe(0);
    expect(state.totalDistanceMeters).toBeGreaterThan(190);
    expect(state.totalDistanceMeters).toBeLessThan(210);
  });
});

describe('recovery after a reboot', () => {
  // elapsedRealtime restarts near zero when the phone reboots; recovery always opens a new segment.
  const afterReboot = (measurement: Measurement, elapsedRealtimeMs: number): Measurement => ({ ...measurement, elapsedRealtimeMs });

  it('keeps measuring in the new segment although its timestamps are lower than before', () => {
    const before = routeTrace([{ bearing: 0, meters: 200 }], 1.4, { seed: 23, segmentIndex: 0 });
    const after = routeTrace([{ bearing: 0, meters: 200 }], 1.4, {
      seed: 24,
      segmentIndex: 1,
      start: destinationPoint(before.end, 50, 90),
      startSecond: before.endSecond + 300,
    }).fixes.map((measurement, index) => afterReboot(measurement, 30_000 + index * 1000));
    const { state, decisions } = runFilter([...before.fixes, ...after], config);
    const afterDecisions = decisions.slice(before.fixes.length);
    expect(afterDecisions.filter((decision) => decision.rejectionReason === 'out_of_order')).toHaveLength(0);
    expect(afterDecisions[0].startsNewLine).toBe(true);
    expect(afterDecisions[0].segmentDistanceMeters).toBe(0);
    expect(state.totalDistanceMeters).toBeGreaterThan(380);
    expect(state.totalDistanceMeters).toBeLessThan(420);
  });

  it('still rejects out-of-order fixes inside the new segment', () => {
    const beforeReboot = fix(ORIGIN, 0, { speed: 1.4 });
    const a = afterReboot(fix(destinationPoint(ORIGIN, 100, 0), 600, { speed: 1.4, segmentIndex: 1 }), 20_000);
    const b = afterReboot(fix(destinationPoint(ORIGIN, 107, 0), 605, { speed: 1.4, segmentIndex: 1 }), 25_000);
    const late = afterReboot(fix(destinationPoint(ORIGIN, 103, 0), 602, { speed: 1.4, segmentIndex: 1 }), 22_000);
    const { decisions } = runFilter([beforeReboot, a, b, late], config);
    expect(decisions.map((decision) => decision.rejectionReason)).toEqual([null, null, null, 'out_of_order']);
  });
});

describe('state persistence', () => {
  it('produces identical results when processing is split and the state round-trips through JSON', () => {
    const { fixes } = routeTrace([{ bearing: 30, meters: 400 }], 1.4, { seed: 22 });
    const whole = runFilter(fixes, config);
    const firstHalf = runFilter(fixes.slice(0, 150), config);
    const restored = restoreFilterState(JSON.stringify(firstHalf.state));
    const secondHalf = runFilter(fixes.slice(150), config, restored);
    expect(secondHalf.state.totalDistanceMeters).toBeCloseTo(whole.state.totalDistanceMeters, 9);
    expect(secondHalf.state.quality.accepted).toBe(whole.state.quality.accepted);
  });

  it('falls back to a fresh state for corrupt JSON', () => {
    expect(restoreFilterState('{nope')).toEqual(createFilterState());
    expect(restoreFilterState(null)).toEqual(createFilterState());
  });

  it('is pure: the input state is not mutated', () => {
    const state = createFilterState();
    const snapshot = JSON.stringify(state);
    processMeasurement(state, fix(ORIGIN, 0), config);
    expect(JSON.stringify(state)).toBe(snapshot);
  });
});
