import { listAchievements } from '@/database/achievementRepository';
import { createActivity, getActivity, listUnfinishedActivities, updateLiveProgress } from '@/database/activityRepository';
import { upsertGoal } from '@/database/goalRepository';
import { countRoutePoints, getRoutePoints, sumAcceptedDistance } from '@/database/routePointRepository';
import { getTrackingState } from '@/database/trackingStateRepository';
import { buildReplayTimeline } from '@/features/activities/replay';
import type { Measurement } from '@/features/tracking/gpsFilter';
import { TrackingEngine } from '@/features/tracking/trackingEngine';
import { widgetSummary } from '@/features/widget/widgetSync';
import { localDayKey } from '@/utils/dates';
import { destinationPoint } from '@/utils/geo';

import { resetSequence, routeTrace, T0 } from '../fixtures/traces';
import { FakeNative } from '../support/fakeNative';
import { createTestDatabase, type TestDatabase } from '../support/testDatabase';

let db: TestDatabase;
let clock: { now: number };
let native: FakeNative;
let engines: TrackingEngine[] = [];

function newEngine() {
  const engine = new TrackingEngine({ native, getDatabase: async () => db, now: () => clock.now, monotonicNow: () => clock.now });
  engines.push(engine);
  return engine;
}

/** Feeds fixes through the fake service, advancing its clock by the time between fixes. */
function feed(fixes: Measurement[]) {
  let previous: Measurement | null = null;
  for (const fix of fixes) {
    native.advance(previous ? (fix.elapsedRealtimeMs ?? 0) - (previous.elapsedRealtimeMs ?? 0) : 1000);
    native.record(fix, { emit: false });
    previous = fix;
  }
}

beforeEach(async () => {
  resetSequence();
  db = await createTestDatabase();
  clock = { now: T0 };
  native = new FakeNative(clock);
});

afterEach(() => {
  for (const engine of engines) engine.dispose();
  engines = [];
  db.close();
});

describe('workout lifecycle', () => {
  it('starts, pauses, resumes and finishes a walk with consistent persisted data', async () => {
    const engine = newEngine();
    await engine.initialize();
    const activityId = await engine.start('walk');
    expect(engine.getSnapshot().phase).toBe('recording');

    const first = routeTrace([{ bearing: 90, meters: 400 }], 1.4, { seed: 1 });
    feed(first.fixes);
    await engine.syncNow();
    expect(engine.getSnapshot().distanceMeters).toBeGreaterThan(380);

    await engine.pause();
    expect(engine.getSnapshot().phase).toBe('paused');
    native.advance(10 * 60 * 1000); // ten minutes paused
    // Fixes are not recorded while paused.
    expect(native.record(first.fixes[0], { emit: false })).toBeNull();

    await engine.resume();
    // Resumed 300 m away from where we paused: this must not add distance.
    const second = routeTrace([{ bearing: 0, meters: 300 }], 1.4, {
      seed: 2,
      start: destinationPoint(first.end, 300, 180),
      startSecond: first.endSecond + 600,
    });
    feed(second.fixes);
    const activeMsBeforeFinish = native.session?.activeMs ?? -1;

    const result = await engine.finish();
    expect(result.activityId).toBe(activityId);

    const activity = await getActivity(db, activityId);
    expect(activity?.status).toBe('completed');
    expect(activity?.distanceMeters).toBeGreaterThan(680);
    expect(activity?.distanceMeters).toBeLessThan(720);
    // Total distance is exactly the sum of the accepted segments that were stored.
    expect(await sumAcceptedDistance(db, activityId)).toBeCloseTo(activity?.distanceMeters ?? -1, 6);
    // Durations come from the native monotonic accounting; paused time is not active time.
    expect(activity?.activeDurationSeconds).toBeCloseTo(activeMsBeforeFinish / 1000, 6);
    expect((activity?.elapsedDurationSeconds ?? 0) - (activity?.activeDurationSeconds ?? 0)).toBeCloseTo(600, 6);
    expect(activity?.averagePaceSecondsPerKm).toBeGreaterThan(600);
    expect(activity?.gpsQualitySummary?.rating).toBe('good');

    const points = await getRoutePoints(db, activityId);
    expect(points).toHaveLength(first.fixes.length + second.fixes.length);
    expect(points.map((p) => p.sequenceNumber)).toEqual(points.map((_, i) => i));
    const firstAfterResume = points[first.fixes.length];
    expect(firstAfterResume.segmentIndex).toBe(1);
    expect(firstAfterResume.startsNewLine).toBe(true);
    expect(firstAfterResume.segmentDistanceMeters).toBe(0);

    // Session state is cleaned up everywhere.
    expect(await getTrackingState(db, activityId)).toBeNull();
    expect(native.session).toBeNull();
    expect(native.journal).toHaveLength(0);
    expect(engine.getSnapshot().phase).toBe('idle');
    expect(engine.getSnapshot().lastCompleted?.activityId).toBe(activityId);

    const achievements = (await listAchievements(db)).map((a) => a.type);
    expect(achievements).toEqual(expect.arrayContaining(['first_activity']));
  });

  it('prevents a second concurrent workout', async () => {
    const engine = newEngine();
    await engine.initialize();
    await engine.start('run');
    await expect(engine.start('walk')).rejects.toMatchObject({ code: 'ERR_ALREADY_TRACKING' });
    const [firstTap, secondTap] = await Promise.allSettled([engine.pause(), engine.pause()]);
    expect(firstTap.status).toBe('fulfilled');
    expect(secondTap).toMatchObject({ status: 'rejected', reason: { code: 'ERR_BUSY' } });
    expect((await listUnfinishedActivities(db)).length).toBe(1);
  });

  it('removes the activity again if the tracking service cannot start', async () => {
    const engine = newEngine();
    await engine.initialize();
    native.startTrackingAsync = async () => {
      throw new Error('ERR_FOREGROUND_SERVICE');
    };
    await expect(engine.start('walk')).rejects.toThrow('ERR_FOREGROUND_SERVICE');
    expect(await listUnfinishedActivities(db)).toHaveLength(0);
    expect(engine.getSnapshot().phase).toBe('idle');
  });

  it('discards an unfinished workout completely', async () => {
    const engine = newEngine();
    await engine.initialize();
    const activityId = await engine.start('walk');
    feed(routeTrace([{ bearing: 0, meters: 100 }], 1.4, { seed: 3 }).fixes);
    await engine.syncNow();
    await engine.discard();
    expect(await getActivity(db, activityId)).toBeNull();
    expect((await countRoutePoints(db, activityId)).total).toBe(0);
    expect(native.session).toBeNull();
  });
});

describe('journal processing and recovery', () => {
  it('processes every fix exactly once even if the app dies between commit and acknowledgement', async () => {
    const engine = newEngine();
    await engine.initialize();
    const activityId = await engine.start('walk');
    const trace = routeTrace([{ bearing: 45, meters: 300 }], 1.4, { seed: 4 });
    feed(trace.fixes.slice(0, 100));
    native.failAcknowledgements = 1;
    await expect(engine.syncNow()).rejects.toThrow('simulated crash');
    // The fixes are still in the journal, but already committed to the database.
    expect(native.journal.length).toBe(100);

    // "Restart" the JS side and continue.
    const restarted = newEngine();
    await restarted.initialize();
    feed(trace.fixes.slice(100));
    await restarted.syncNow();
    expect((await countRoutePoints(db, activityId)).total).toBe(trace.fixes.length);
    expect(native.journal).toHaveLength(0);

    await restarted.finish();
    const activity = await getActivity(db, activityId);
    expect(activity?.distanceMeters).toBeCloseTo(await sumAcceptedDistance(db, activityId), 6);
    expect(Math.abs((activity?.distanceMeters ?? 0) - trace.trueDistance) / trace.trueDistance).toBeLessThan(0.03);
  });

  it('recovers a live session after the JS runtime restarts, including fixes recorded while it was gone', async () => {
    const first = newEngine();
    await first.initialize();
    const activityId = await first.start('run');
    const trace = routeTrace([{ bearing: 10, meters: 600 }], 3, { seed: 5 });
    feed(trace.fixes.slice(0, 80));
    await first.syncNow();
    const distanceBefore = first.getSnapshot().distanceMeters;
    first.dispose();

    // The service kept recording while the UI was gone.
    feed(trace.fixes.slice(80));

    const second = newEngine();
    await second.initialize();
    const snapshot = second.getSnapshot();
    expect(snapshot.phase).toBe('recording');
    expect(snapshot.activityId).toBe(activityId);
    expect(snapshot.distanceMeters).toBeGreaterThan(distanceBefore);
    expect(snapshot.geometry.lines.flat().length).toBeGreaterThan(80);

    await second.finish();
    expect((await countRoutePoints(db, activityId)).total).toBe(trace.fixes.length);
  });

  it('offers resume or save after the process was killed, and keeps recorded data', async () => {
    const first = newEngine();
    await first.initialize();
    const activityId = await first.start('walk');
    const trace = routeTrace([{ bearing: 90, meters: 250 }], 1.4, { seed: 6 });
    feed(trace.fixes);
    await first.syncNow();
    native.interrupt('process_terminated');
    first.dispose();

    const second = newEngine();
    await second.initialize();
    const snapshot = second.getSnapshot();
    expect(snapshot.phase).toBe('recovering');
    expect(snapshot.recovery).toEqual({ reason: 'process_terminated', canResume: true });
    expect((await getActivity(db, activityId))?.status).toBe('recovering');

    await second.resume();
    expect(second.getSnapshot().phase).toBe('recording');
    expect(native.session?.segmentIndex).toBe(1);
    await second.finish();
    const saved = await getActivity(db, activityId);
    expect(saved?.status).toBe('completed');
    expect(saved?.distanceMeters).toBeGreaterThan(240);
  });

  it('keeps recording after resuming a workout that a reboot interrupted', async () => {
    const first = newEngine();
    await first.initialize();
    const activityId = await first.start('walk');
    const before = routeTrace([{ bearing: 90, meters: 250 }], 1.4, { seed: 8 });
    feed(before.fixes);
    await first.syncNow();
    native.interrupt('device_rebooted');
    first.dispose();

    const second = newEngine();
    await second.initialize();
    expect(second.getSnapshot().recovery).toEqual({ reason: 'device_rebooted', canResume: true });
    await second.resume();
    // After the reboot the monotonic clock starts again near zero.
    const after = routeTrace([{ bearing: 0, meters: 250 }], 1.4, {
      seed: 9,
      start: destinationPoint(before.end, 40, 0),
      startSecond: before.endSecond + 900,
    }).fixes.map((measurement, index) => ({ ...measurement, elapsedRealtimeMs: 45_000 + index * 1000 }));
    feed(after);
    await second.finish();

    const saved = await getActivity(db, activityId);
    expect(saved?.distanceMeters).toBeGreaterThan(480);
    expect(saved?.distanceMeters).toBeLessThan(520);
    expect(saved?.gpsQualitySummary?.rejectionCounts.out_of_order ?? 0).toBe(0);
  });

  it('finishes saving automatically if the app died right after the user pressed Finish', async () => {
    const first = newEngine();
    await first.initialize();
    const activityId = await first.start('walk');
    feed(routeTrace([{ bearing: 0, meters: 200 }], 1.4, { seed: 7 }).fixes);
    await native.finishTrackingAsync(); // native side finished; JS never got to save
    first.dispose();

    const second = newEngine();
    await second.initialize();
    expect((await getActivity(db, activityId))?.status).toBe('completed');
    expect(native.session).toBeNull();
    expect(second.getSnapshot().phase).toBe('idle');
  });

  it('keeps an orphaned activity (native session lost) for saving, and drops empty ones', async () => {
    const first = newEngine();
    await first.initialize();
    const activityId = await first.start('walk');
    feed(routeTrace([{ bearing: 0, meters: 150 }], 1.4, { seed: 8 }).fixes);
    await first.syncNow();
    native.session = null; // e.g. app data partially cleared
    native.journal = [];
    first.dispose();

    const second = newEngine();
    await second.initialize();
    expect(second.getSnapshot().phase).toBe('recovering');
    expect(second.getSnapshot().recovery?.canResume).toBe(false);
    await expect(second.resume()).rejects.toMatchObject({ code: 'ERR_CANNOT_RESUME' });
    await second.finish();
    expect((await getActivity(db, activityId))?.status).toBe('completed');
  });

  it('offers every interrupted workout in turn, then allows a new one', async () => {
    const first = await createActivity(db, { type: 'walk', startedAt: T0 });
    const second = await createActivity(db, { type: 'run', startedAt: T0 + 3_600_000 });
    await updateLiveProgress(db, first, { distanceMeters: 500, walkDistanceMeters: 500, runDistanceMeters: 0, elapsedSeconds: 400, activeSeconds: 380 });
    await updateLiveProgress(db, second, { distanceMeters: 900, walkDistanceMeters: 0, runDistanceMeters: 900, elapsedSeconds: 300, activeSeconds: 290 });

    const engine = newEngine();
    await engine.initialize();
    expect(engine.getSnapshot()).toMatchObject({ phase: 'recovering', activityId: first });
    await engine.finish();
    expect(engine.getSnapshot()).toMatchObject({ phase: 'recovering', activityId: second });
    expect(engine.getSnapshot().lastCompleted?.activityId).toBe(first);
    await engine.discard();
    expect(engine.getSnapshot().phase).toBe('idle');
    expect((await getActivity(db, first))?.status).toBe('completed');
    expect(await getActivity(db, second)).toBeNull();
    await expect(engine.start('walk')).resolves.toBeGreaterThan(second);
  });

  it('sends distance updates to the notification as it grows', async () => {
    const engine = newEngine();
    await engine.initialize();
    await engine.start('walk');
    feed(routeTrace([{ bearing: 0, meters: 200 }], 1.4, { seed: 9 }).fixes);
    await engine.syncNow();
    expect(native.notifications.at(-1)).toBeGreaterThan(190);
  });
});

describe('route replay from stored measurements', () => {
  it('builds a timeline from the saved accepted points with the active duration', async () => {
    const engine = newEngine();
    await engine.initialize();
    const activityId = await engine.start('walk');
    const trace = routeTrace([{ bearing: 0, meters: 140 }], 1.4, { seed: 10 });
    feed(trace.fixes);
    await engine.finish();

    const accepted = await getRoutePoints(db, activityId, { acceptedOnly: true });
    const timeline = buildReplayTimeline(
      accepted.map((p) => ({
        latitude: p.latitude,
        longitude: p.longitude,
        timeMs: p.elapsedRealtimeMs ?? p.recordedAt,
        segmentIndex: p.segmentIndex,
        startsNewLine: p.startsNewLine,
        gapBeforeSeconds: p.gapBeforeSeconds,
        segmentDistanceMeters: p.segmentDistanceMeters,
      })),
    );
    expect(timeline.keyframes).toHaveLength(accepted.length);
    expect(timeline.totalDistanceMeters).toBeCloseTo((await getActivity(db, activityId))?.distanceMeters ?? -1, 6);
    expect(timeline.durationSeconds).toBeGreaterThan(90);
    expect(timeline.keyframes[0]).toMatchObject({ latitude: accepted[0].latitude, longitude: accepted[0].longitude });
  });
});

describe('walk/run parts, auto-pause and intervals', () => {
  const settle = () => new Promise((resolve) => setTimeout(resolve, 0));

  it('splits distance and active time between walking and running, and saves the main type', async () => {
    const engine = newEngine();
    await engine.initialize();
    const activityId = await engine.start('walk');
    const walk = routeTrace([{ bearing: 90, meters: 300 }], 1.4, { seed: 11 });
    feed(walk.fixes);
    await engine.syncNow();

    await engine.switchType('run');
    expect(engine.getSnapshot().activityType).toBe('run');
    // The live row follows the current part (the saved workout gets its main type).
    expect((await getActivity(db, activityId))?.type).toBe('run');
    const run = routeTrace([{ bearing: 90, meters: 600 }], 3, { seed: 12, start: walk.end, startSecond: walk.endSecond + 1 });
    feed(run.fixes);
    await engine.syncNow();
    const live = engine.getSnapshot();
    expect(live.walkDistanceMeters).toBeGreaterThan(270);
    expect(live.runDistanceMeters).toBeGreaterThan(540);
    expect(live.geometry.lineTypes).toEqual(['walk', 'run']);

    await engine.finish();
    const activity = await getActivity(db, activityId);
    if (!activity) throw new Error('activity missing');
    expect(activity.type).toBe('run');
    expect(activity.walkDistanceMeters).toBeGreaterThan(270);
    expect(activity.walkDistanceMeters).toBeLessThan(330);
    expect(activity.runDistanceMeters).toBeGreaterThan(540);
    expect(activity.walkDistanceMeters + activity.runDistanceMeters).toBeCloseTo(activity.distanceMeters, 6);
    expect(activity.runActiveSeconds).toBeGreaterThan(190);
    expect(activity.walkActiveSeconds).toBeGreaterThan(200);
    expect(activity.walkActiveSeconds + activity.runActiveSeconds).toBeCloseTo(activity.activeDurationSeconds ?? -1, 3);
    const points = await getRoutePoints(db, activityId);
    expect(new Set(points.map((point) => point.activityType))).toEqual(new Set(['walk', 'run']));
  });

  it('restores the parts after the JS runtime restarts', async () => {
    const first = newEngine();
    await first.initialize();
    await first.start('run');
    const run = routeTrace([{ bearing: 0, meters: 200 }], 3, { seed: 13 });
    feed(run.fixes);
    await first.syncNow();
    await first.switchType('walk');
    feed(routeTrace([{ bearing: 0, meters: 100 }], 1.4, { seed: 14, start: run.end, startSecond: run.endSecond + 1 }).fixes);
    await first.syncNow();
    const before = first.getSnapshot();
    first.dispose();

    const second = newEngine();
    await second.initialize();
    const after = second.getSnapshot();
    expect(after.activityType).toBe('walk');
    expect(after.walkDistanceMeters).toBeCloseTo(before.walkDistanceMeters, 6);
    expect(after.runDistanceMeters).toBeCloseTo(before.runDistanceMeters, 6);
    expect(after.geometry.lineTypes).toEqual(['run', 'walk']);
  });

  it('stops the active clock while auto-paused and can be turned off mid-workout', async () => {
    const engine = newEngine();
    await engine.initialize();
    await engine.start('run', { autoPause: true });
    expect(engine.getSnapshot().autoPauseEnabled).toBe(true);
    native.advance(30_000);

    native.setAutoPaused(true);
    await settle();
    expect(engine.getSnapshot()).toMatchObject({ phase: 'recording', autoPaused: true, durationsTicking: false, elapsedTicking: true });
    native.advance(60_000);
    expect(native.session?.activeMs).toBe(30_000);

    native.setAutoPaused(false);
    await settle();
    expect(engine.getSnapshot()).toMatchObject({ autoPaused: false, durationsTicking: true });

    await engine.setAutoPause(false);
    expect(engine.getSnapshot().autoPauseEnabled).toBe(false);
    native.setAutoPaused(true); // ignored once auto-pause is off
    await settle();
    expect(engine.getSnapshot().autoPaused).toBe(false);
  });

  it('follows run/walk intervals, counting every phase for its part', async () => {
    const engine = newEngine();
    await engine.initialize();
    const activityId = await engine.start('walk', { intervals: { runSeconds: 60, walkSeconds: 60, repeats: 2 } });
    expect(engine.getSnapshot()).toMatchObject({ activityType: 'run', intervals: { runSeconds: 60, walkSeconds: 60, repeats: 2 } });

    feed(routeTrace([{ bearing: 0, meters: 480 }], 2, { seed: 15 }).fixes);
    await settle();
    await engine.finish();
    const activity = await getActivity(db, activityId);
    if (!activity) throw new Error('activity missing');
    expect(activity.runActiveSeconds).toBeCloseTo(120, 0);
    expect(activity.walkActiveSeconds).toBeCloseTo(121, 0);
    expect(activity.runDistanceMeters).toBeGreaterThan(200);
    expect(activity.walkDistanceMeters).toBeGreaterThan(200);
    expect(activity.type).toBe(activity.runDistanceMeters > activity.walkDistanceMeters ? 'run' : 'walk');
    const types = (await getRoutePoints(db, activityId, { acceptedOnly: true })).map((point) => point.activityType);
    // run, walk, run, walk: three switches.
    expect(types.filter((type, index) => index > 0 && type !== types[index - 1])).toHaveLength(3);
  });

  it('reports which goals a finished workout reached', async () => {
    await upsertGoal(db, { periodType: 'weekly', targetDistanceMeters: 500, startDate: '2020-01-01', enabled: true });
    const engine = newEngine();
    await engine.initialize();
    await engine.start('walk');
    feed(routeTrace([{ bearing: 90, meters: 600 }], 1.4, { seed: 16 }).fixes);
    const result = await engine.finish();
    expect(result.goalsReached).toEqual(['weekly']);
    expect(engine.getSnapshot().lastCompleted?.goalsReached).toEqual(['weekly']);
  });

  it("gives the widget today's saved distance and the daily goal", async () => {
    await upsertGoal(db, { periodType: 'daily', targetDistanceMeters: 4000, startDate: '2020-01-01', enabled: true });
    const engine = newEngine();
    await engine.initialize();
    await engine.start('walk');
    feed(routeTrace([{ bearing: 90, meters: 300 }], 1.4, { seed: 17 }).fixes);
    const { activityId } = await engine.finish();
    const saved = (await getActivity(db, activityId))?.distanceMeters ?? -1;

    const summary = await widgetSummary(db, T0 + 3_600_000, 'stride');
    expect(summary).toMatchObject({ todayMeters: saved, goalMeters: 4000, scheme: 'stride' });
    expect(summary.dayKey).toBe(localDayKey(T0 + 3_600_000));
    expect((await widgetSummary(db, T0 + 3 * 86_400_000, 'stride')).todayMeters).toBe(0);
  });
});
