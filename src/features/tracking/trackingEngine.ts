import {
  parseJournalPoint,
  parseRawLocation,
  parseStatus,
  type JournalPoint,
  type NativeTrackingStatus,
  type RawLocation,
  type StartTrackingOptions,
} from '@/modules/android-location';

import {
  completeActivity,
  createActivity,
  deleteActivity,
  getActivity,
  listActivitySummaries,
  listUnfinishedActivities,
  updateActivityStatus,
  updateLiveProgress,
} from '@/database/activityRepository';
import { notifyDataChanged } from '@/database/dataEvents';
import { listGoals } from '@/database/goalRepository';
import { setPreference } from '@/database/preferencesRepository';
import { getRoutePoints, insertRoutePoints, type NewRoutePoint } from '@/database/routePointRepository';
import {
  deleteTrackingState,
  getTrackingState,
  newTrackingState,
  saveTrackingState,
  type TrackingStateRecord,
} from '@/database/trackingStateRepository';
import type { SqlDatabase } from '@/database/types';
import { serializeWrite, writeTransaction } from '@/database/writeQueue';
import { recomputeAchievements } from '@/features/achievements/achievementService';
import type { AchievementType } from '@/features/achievements/achievements';
import { appendVertex, buildRoutePreview, buildRouteGeometry, emptyGeometry, type RouteGeometry } from '@/features/activities/routeGeometry';
import type { Activity, ActivityStatus, ActivityType } from '@/features/activities/types';
import { goalInEffect } from '@/features/goals/goals';
import { localDayKey } from '@/utils/dates';
import { averagePaceSecondsPerKm, averageSpeedMps, currentSpeedMps, type PaceSample } from '@/utils/pace';

import { processMeasurement, type FilterDecision, type Measurement } from './gpsFilter';
import { summarizeQuality } from './gpsQuality';
import { filterConfigFor, TRACKING_CONFIG } from './trackingConfig';

/**
 * Bridges the native foreground service and the app database.
 *
 * The native service appends every raw fix to its journal. This engine drains the journal,
 * runs each fix through the GPS filter, commits route points + running totals + filter state
 * in one transaction, and only then acknowledges the journal rows. A crash at any point either
 * leaves the rows in the journal (re-processed next time) or committed (skipped next time),
 * so every fix is processed exactly once.
 */

export interface TrackingNativeApi {
  getStatusAsync(): Promise<unknown>;
  startTrackingAsync(options: StartTrackingOptions): Promise<unknown>;
  pauseTrackingAsync(): Promise<unknown>;
  resumeTrackingAsync(): Promise<unknown>;
  finishTrackingAsync(): Promise<unknown>;
  discardTrackingAsync(): Promise<unknown>;
  clearSessionAsync(activityId: number): Promise<boolean>;
  readJournalAsync(activityId: number, afterSequence: number, limit: number): Promise<unknown[]>;
  acknowledgeJournalAsync(activityId: number, upToSequence: number): Promise<number>;
  updateNotificationAsync(distanceMeters: number): Promise<boolean>;
  addListener(eventName: 'onLocationRecorded' | 'onStatusChanged', listener: (payload: unknown) => void): { remove(): void };
}

export type EnginePhase =
  | 'initializing'
  | 'unavailable'
  | 'idle'
  | 'starting'
  | 'recording'
  | 'paused'
  | 'recovering'
  | 'finishing';

export type RecoveryInfo = {
  reason: string | null;
  /** False when the native session is gone and only "finish" or "discard" make sense. */
  canResume: boolean;
};

export type CompletedInfo = {
  activityId: number;
  unlockedAchievements: AchievementType[];
  goalReached: boolean;
};

export type LiveSnapshot = {
  phase: EnginePhase;
  busy: boolean;
  activityId: number | null;
  activityType: ActivityType | null;
  startedAt: number | null;
  distanceMeters: number;
  /** Durations as of `durationsCapturedAt` (monotonic JS clock); extrapolate while ticking. */
  activeMs: number;
  elapsedMs: number;
  durationsCapturedAt: number;
  durationsTicking: boolean;
  lastFix: RawLocation | null;
  lastFixReceivedAt: number | null;
  signalLost: boolean;
  locationServicesEnabled: boolean;
  lowBattery: boolean;
  geometry: RouteGeometry;
  currentSpeedMps: number | null;
  acceptedPoints: number;
  rejectedPoints: number;
  pendingJournalPoints: number;
  recovery: RecoveryInfo | null;
  error: string | null;
  lastCompleted: CompletedInfo | null;
};

export type EngineDependencies = {
  native: TrackingNativeApi | null;
  getDatabase: () => Promise<SqlDatabase>;
  now?: () => number;
  monotonicNow?: () => number;
  deepLinks?: { openUri: string; finishUri: string };
};

const JOURNAL_BATCH_SIZE = 250;
const MAX_BATCHES_PER_SYNC = 40;
const MIN_SYNC_INTERVAL_MS = 1500;
const NOTIFICATION_DISTANCE_STEP_METERS = 10;
const PACE_HISTORY_MS = 3 * 60 * 1000;

export class EngineError extends Error {
  constructor(
    public readonly code: string,
    message: string,
  ) {
    super(message);
    this.name = 'EngineError';
  }
}

function initialSnapshot(phase: EnginePhase): LiveSnapshot {
  return {
    phase,
    busy: false,
    activityId: null,
    activityType: null,
    startedAt: null,
    distanceMeters: 0,
    activeMs: 0,
    elapsedMs: 0,
    durationsCapturedAt: 0,
    durationsTicking: false,
    lastFix: null,
    lastFixReceivedAt: null,
    signalLost: false,
    locationServicesEnabled: true,
    lowBattery: false,
    geometry: emptyGeometry(),
    currentSpeedMps: null,
    acceptedPoints: 0,
    rejectedPoints: 0,
    pendingJournalPoints: 0,
    recovery: null,
    error: null,
    lastCompleted: null,
  };
}

const errorMessage = (error: unknown) => (error instanceof Error ? error.message : String(error));

function toMeasurement(point: JournalPoint): Measurement {
  return {
    sequence: point.sequence,
    segmentIndex: point.segmentIndex,
    latitude: point.latitude,
    longitude: point.longitude,
    wallTimeMs: point.wallTimeMs,
    elapsedRealtimeMs: point.elapsedRealtimeMs,
    accuracyMeters: point.accuracyMeters,
    speedMps: point.speedMps,
    isMock: point.isMock,
  };
}

function toRouteRow(activityId: number, sequenceNumber: number, point: JournalPoint, decision: FilterDecision): NewRoutePoint {
  return {
    activityId,
    sequenceNumber,
    segmentIndex: point.segmentIndex,
    latitude: point.latitude,
    longitude: point.longitude,
    recordedAt: point.wallTimeMs,
    elapsedRealtimeMs: point.elapsedRealtimeMs,
    accuracyMeters: point.accuracyMeters,
    altitudeMeters: point.altitudeMeters,
    providerSpeedMps: point.speedMps,
    bearingDegrees: point.bearingDegrees,
    segmentDistanceMeters: decision.segmentDistanceMeters,
    segmentValid: decision.accepted,
    rejectionReason: decision.rejectionReason,
    startsNewLine: decision.startsNewLine,
    gapBeforeSeconds: decision.gapBeforeSeconds,
  };
}

const STATUS_FOR_NATIVE_STATE: Partial<Record<NativeTrackingStatus['state'], ActivityStatus>> = {
  recording: 'recording',
  paused: 'paused',
  interrupted: 'recovering',
};

export class TrackingEngine {
  private snapshot: LiveSnapshot;
  private readonly listeners = new Set<() => void>();
  private readonly native: TrackingNativeApi | null;
  private readonly getDb: () => Promise<SqlDatabase>;
  private readonly now: () => number;
  private readonly monotonicNow: () => number;
  private readonly deepLinks?: { openUri: string; finishUri: string };

  private initializePromise: Promise<void> | null = null;
  private subscriptions: { remove(): void }[] = [];
  private actionInFlight = false;
  private syncPromise: Promise<void> | null = null;
  private syncRequested = false;
  private syncTimer: ReturnType<typeof setTimeout> | null = null;
  private lastSyncAt = 0;
  private lastNotifiedDistance = -Infinity;
  private paceSamples: PaceSample[] = [];
  private paceSegment: number | null = null;
  private latestFixTimeMs: number | null = null;
  private nativeState: NativeTrackingStatus['state'] = 'idle';
  private writtenStatus: { activityId: number; status: ActivityStatus } | null = null;

  constructor(dependencies: EngineDependencies) {
    this.native = dependencies.native;
    this.getDb = dependencies.getDatabase;
    this.now = dependencies.now ?? Date.now;
    this.monotonicNow = dependencies.monotonicNow ?? (() => globalThis.performance?.now?.() ?? Date.now());
    this.deepLinks = dependencies.deepLinks;
    this.snapshot = initialSnapshot(dependencies.native ? 'initializing' : 'unavailable');
  }

  // ---------------------------------------------------------------------------------------------
  // Observable state (for useSyncExternalStore)

  getSnapshot = (): LiveSnapshot => this.snapshot;

  subscribe = (listener: () => void): (() => void) => {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  };

  private update(patch: Partial<LiveSnapshot>) {
    this.snapshot = { ...this.snapshot, ...patch };
    for (const listener of this.listeners) listener();
  }

  // ---------------------------------------------------------------------------------------------
  // Lifecycle

  initialize(): Promise<void> {
    if (!this.initializePromise) {
      this.initializePromise = this.doInitialize().catch((error: unknown) => {
        this.initializePromise = null;
        this.update({ phase: this.native ? 'idle' : 'unavailable', error: `Could not restore tracking: ${errorMessage(error)}` });
        throw error;
      });
    }
    return this.initializePromise;
  }

  private async doInitialize() {
    const native = this.native;
    if (!native) {
      this.update({ phase: 'unavailable' });
      return;
    }
    if (this.subscriptions.length === 0) {
      this.subscriptions.push(
        native.addListener('onLocationRecorded', (payload) => this.handleLocationEvent(payload)),
        native.addListener('onStatusChanged', (payload) => this.handleStatusEvent(payload)),
      );
    }
    await this.reconcile();
  }

  dispose() {
    for (const subscription of this.subscriptions) subscription.remove();
    this.subscriptions = [];
    if (this.syncTimer) clearTimeout(this.syncTimer);
    this.syncTimer = null;
    this.initializePromise = null;
  }

  /**
   * Brings the engine in line with what the native session and the database say. Handles every
   * restart case: a live session, an interrupted one, one that finished but was never saved,
   * and database activities whose native session no longer exists.
   */
  private async reconcile() {
    const native = this.native as TrackingNativeApi;
    const db = await this.getDb();
    const status = parseStatus(await native.getStatusAsync());
    this.nativeState = status.state;
    const unfinished = await listUnfinishedActivities(db);

    if (status.hasSession && status.activityId !== null) {
      const activity = await getActivity(db, status.activityId);
      if (!activity) {
        // The database no longer knows this workout (e.g. data was cleared); drop the session.
        await native.discardTrackingAsync();
      } else if (activity.status === 'completed') {
        // Saved, but the app died before the native session was cleared.
        await native.clearSessionAsync(activity.id);
      } else {
        await this.attach(db, activity, status);
        if (status.state === 'finished') {
          // The user pressed Finish but the app died before saving: complete it now.
          await this.completeFinish(db, activity.id, status);
          return;
        }
      }
    }

    // Unfinished activities without a native session cannot record any more. Keep the ones
    // that captured data so the user can save or discard them; drop empty ones.
    for (const activity of unfinished) {
      if (activity.id === this.snapshot.activityId) continue;
      const record = await getTrackingState(db, activity.id);
      const hasData = (record?.nextSequenceNumber ?? 0) > 0 || activity.distanceMeters > 0;
      if (!hasData) {
        await writeTransaction(db, () => deleteActivity(db, activity.id));
        continue;
      }
      if (this.snapshot.activityId === null) {
        await writeTransaction(db, () => updateActivityStatus(db, activity.id, 'recovering'));
        await this.attach(db, { ...activity, status: 'recovering' }, null);
        this.update({ recovery: { reason: 'session_lost', canResume: false } });
      }
    }

    if (this.snapshot.activityId === null) this.update({ phase: 'idle', recovery: null });
  }

  /** Loads a live or interrupted activity into the snapshot, including its route so far. */
  private async attach(db: SqlDatabase, activity: Activity, status: NativeTrackingStatus | null) {
    const record = (await getTrackingState(db, activity.id)) ?? newTrackingState(activity.id);
    const accepted = await getRoutePoints(db, activity.id, { acceptedOnly: true });
    const geometry = buildRouteGeometry(accepted);

    this.paceSamples = [];
    this.paceSegment = null;
    let cumulative = 0;
    for (const point of accepted) {
      cumulative += point.segmentDistanceMeters;
      this.pushPaceSample(point.segmentIndex, point.elapsedRealtimeMs ?? point.recordedAt, cumulative);
    }

    this.update({
      activityId: activity.id,
      activityType: activity.type,
      startedAt: activity.startedAt,
      distanceMeters: record.filterState.totalDistanceMeters,
      activeMs: record.activeDurationMs,
      elapsedMs: record.elapsedDurationMs,
      durationsCapturedAt: this.monotonicNow(),
      durationsTicking: false,
      geometry,
      acceptedPoints: record.filterState.quality.accepted,
      rejectedPoints: record.filterState.quality.rejected,
      lastCompleted: null,
      error: null,
    });
    if (status) await this.applyStatus(status);
    else this.update({ phase: 'recovering' });
    if (status && status.state !== 'idle') await this.syncNow();
  }

  // ---------------------------------------------------------------------------------------------
  // Native events

  private handleLocationEvent(payload: unknown) {
    const location = parseRawLocation(payload);
    if (location) {
      this.update({ lastFix: location, lastFixReceivedAt: this.monotonicNow(), signalLost: false });
      this.latestFixTimeMs = location.elapsedRealtimeMs ?? location.wallTimeMs;
    }
    this.requestSync();
  }

  private handleStatusEvent(payload: unknown) {
    const status = parseStatus(payload);
    if (status.activityId !== null && status.activityId !== this.snapshot.activityId) return;
    void this.applyStatus(status).catch((error: unknown) => this.update({ error: errorMessage(error) }));
  }

  /** Mirrors the native status into the snapshot and the activity's status column. */
  private async applyStatus(status: NativeTrackingStatus) {
    this.nativeState = status.state;
    const patch: Partial<LiveSnapshot> = {
      signalLost: status.signalLost,
      locationServicesEnabled: status.locationServicesEnabled,
      lowBattery: status.lowBattery,
      pendingJournalPoints: status.pendingJournalPoints ?? 0,
    };
    if (status.activeMs !== null) {
      patch.activeMs = status.activeMs;
      patch.elapsedMs = status.elapsedMs ?? this.snapshot.elapsedMs;
      patch.durationsCapturedAt = this.monotonicNow();
    }
    patch.durationsTicking = status.state === 'recording';
    if (status.error) patch.error = status.error;

    if (!this.snapshot.busy || status.state === 'interrupted') {
      if (status.state === 'recording') patch.phase = 'recording';
      else if (status.state === 'paused') patch.phase = 'paused';
      else if (status.state === 'interrupted') {
        patch.phase = 'recovering';
        patch.recovery = { reason: status.interruptionReason, canResume: true };
      }
    }
    if (status.state === 'recording' || status.state === 'paused') patch.recovery = null;
    this.update(patch);

    const activityId = this.snapshot.activityId;
    const target = STATUS_FOR_NATIVE_STATE[status.state];
    const written = this.writtenStatus;
    if (activityId !== null && target && (written?.activityId !== activityId || written.status !== target)) {
      const db = await this.getDb();
      await writeTransaction(db, () => updateActivityStatus(db, activityId, target));
      this.writtenStatus = { activityId, status: target };
    }
  }

  // ---------------------------------------------------------------------------------------------
  // Journal processing

  /** Throttled trigger used by location events. Never runs two syncs at once. */
  requestSync() {
    if (this.syncPromise) {
      this.syncRequested = true;
      return;
    }
    const wait = MIN_SYNC_INTERVAL_MS - (this.monotonicNow() - this.lastSyncAt);
    if (wait > 0) {
      this.syncRequested = true;
      if (!this.syncTimer) {
        this.syncTimer = setTimeout(() => {
          this.syncTimer = null;
          this.requestSync();
        }, wait);
      }
      return;
    }
    void this.syncNow().catch(() => undefined);
  }

  /** Drains the journal now. Concurrent callers share the in-flight run. */
  syncNow(): Promise<void> {
    if (this.syncPromise) {
      this.syncRequested = true;
      return this.syncPromise;
    }
    this.syncRequested = false;
    const run = this.drainJournal()
      .then(() => {
        if (this.snapshot.error?.startsWith('Could not save GPS points')) this.update({ error: null });
      })
      .catch((error: unknown) => {
        // The fixes stay in the native journal and are retried on the next sync.
        this.update({ error: `Could not save GPS points: ${errorMessage(error)}` });
        throw error;
      })
      .finally(() => {
        this.syncPromise = null;
        this.lastSyncAt = this.monotonicNow();
        if (this.syncRequested) this.requestSync();
      });
    this.syncPromise = run;
    return run;
  }

  private async drainJournal() {
    const native = this.native;
    const activityId = this.snapshot.activityId;
    const activityType = this.snapshot.activityType ?? 'walk';
    if (!native || activityId === null) return;
    const db = await this.getDb();
    let record: TrackingStateRecord = (await getTrackingState(db, activityId)) ?? newTrackingState(activityId);
    const config = filterConfigFor(activityType);

    for (let batch = 0; batch < MAX_BATCHES_PER_SYNC; batch += 1) {
      const raw = await native.readJournalAsync(activityId, record.lastJournalSequence, JOURNAL_BATCH_SIZE);
      if (!Array.isArray(raw) || raw.length === 0) break;

      let filterState = record.filterState;
      let sequenceNumber = record.nextSequenceNumber;
      let lastJournalSequence = record.lastJournalSequence;
      let lastAcceptedSequenceNumber = record.lastAcceptedSequenceNumber;
      const rows: NewRoutePoint[] = [];
      const accepted: { point: JournalPoint; decision: FilterDecision; cumulative: number }[] = [];

      for (const entry of raw) {
        const sequence = (entry as { sequence?: unknown } | null)?.sequence;
        if (typeof sequence === 'number' && Number.isFinite(sequence)) {
          lastJournalSequence = Math.max(lastJournalSequence, sequence);
        }
        const point = parseJournalPoint(entry);
        if (!point || point.activityId !== activityId || point.sequence <= record.lastJournalSequence) continue;
        const result = processMeasurement(filterState, toMeasurement(point), config);
        filterState = result.state;
        rows.push(toRouteRow(activityId, sequenceNumber, point, result.decision));
        if (result.decision.accepted) {
          lastAcceptedSequenceNumber = sequenceNumber;
          accepted.push({ point, decision: result.decision, cumulative: filterState.totalDistanceMeters });
        }
        sequenceNumber += 1;
      }

      const nextRecord: TrackingStateRecord = {
        ...record,
        state: this.nativeState,
        lastJournalSequence,
        nextSequenceNumber: sequenceNumber,
        lastAcceptedSequenceNumber,
        distanceMeters: filterState.totalDistanceMeters,
        activeDurationMs: this.currentActiveMs(),
        elapsedDurationMs: this.currentElapsedMs(),
        filterState,
        updatedAt: this.now(),
      };
      await writeTransaction(db, async () => {
        await insertRoutePoints(db, rows);
        await saveTrackingState(db, nextRecord);
        await updateLiveProgress(db, activityId, {
          distanceMeters: nextRecord.distanceMeters,
          elapsedSeconds: nextRecord.elapsedDurationMs / 1000,
          activeSeconds: nextRecord.activeDurationMs / 1000,
        });
      });
      record = nextRecord;
      // Only after the commit may the native side forget these fixes.
      await native.acknowledgeJournalAsync(activityId, lastJournalSequence);

      this.applyAccepted(accepted, filterState.totalDistanceMeters, filterState.quality.accepted, filterState.quality.rejected);
      if (raw.length < JOURNAL_BATCH_SIZE) break;
    }

    const distance = record.filterState.totalDistanceMeters;
    if (Math.abs(distance - this.lastNotifiedDistance) >= NOTIFICATION_DISTANCE_STEP_METERS) {
      this.lastNotifiedDistance = distance;
      await native.updateNotificationAsync(distance).catch(() => undefined);
    }
  }

  private applyAccepted(
    accepted: { point: JournalPoint; decision: FilterDecision; cumulative: number }[],
    distanceMeters: number,
    acceptedCount: number,
    rejectedCount: number,
  ) {
    let geometry = this.snapshot.geometry;
    for (const { point, decision, cumulative } of accepted) {
      geometry = appendVertex(geometry, {
        latitude: point.latitude,
        longitude: point.longitude,
        startsNewLine: decision.startsNewLine,
        gapBeforeSeconds: decision.gapBeforeSeconds,
      });
      this.pushPaceSample(point.segmentIndex, point.elapsedRealtimeMs ?? point.wallTimeMs, cumulative);
    }
    this.update({
      geometry,
      distanceMeters,
      acceptedPoints: acceptedCount,
      rejectedPoints: rejectedCount,
      currentSpeedMps: currentSpeedMps(this.paceSamples, this.latestFixTimeMs, TRACKING_CONFIG.currentPaceWindowSeconds),
    });
  }

  private pushPaceSample(segmentIndex: number, timeMs: number, cumulativeDistanceMeters: number) {
    // Current pace never spans a pause.
    if (this.paceSegment !== segmentIndex) {
      this.paceSamples = [];
      this.paceSegment = segmentIndex;
    }
    this.paceSamples.push({ timeMs, cumulativeDistanceMeters });
    const cutoff = timeMs - PACE_HISTORY_MS;
    while (this.paceSamples.length > 2 && this.paceSamples[0].timeMs < cutoff) this.paceSamples.shift();
  }

  /** Current speed recomputed against the latest fix time (falls to 0 when standing still). */
  liveSpeedMps(): number | null {
    if (this.snapshot.phase !== 'recording') return null;
    return currentSpeedMps(this.paceSamples, this.latestFixTimeMs, TRACKING_CONFIG.currentPaceWindowSeconds);
  }

  private currentActiveMs() {
    const s = this.snapshot;
    return s.activeMs + (s.durationsTicking ? Math.max(0, this.monotonicNow() - s.durationsCapturedAt) : 0);
  }

  private currentElapsedMs() {
    const s = this.snapshot;
    return s.elapsedMs + (s.durationsTicking ? Math.max(0, this.monotonicNow() - s.durationsCapturedAt) : 0);
  }

  // ---------------------------------------------------------------------------------------------
  // Controls. Only one runs at a time; repeated taps while busy are rejected.

  private async exclusive<T>(action: () => Promise<T>): Promise<T> {
    if (this.actionInFlight) throw new EngineError('ERR_BUSY', 'Please wait — the previous action is still running.');
    this.actionInFlight = true;
    this.update({ busy: true, error: null });
    try {
      return await action();
    } finally {
      this.actionInFlight = false;
      this.update({ busy: false });
    }
  }

  private requireNative(): TrackingNativeApi {
    if (!this.native) {
      throw new EngineError('ERR_UNAVAILABLE', 'GPS tracking is not available in this build. Install the development build.');
    }
    return this.native;
  }

  async refreshStatus(): Promise<void> {
    if (!this.native || this.snapshot.activityId === null) return;
    await this.applyStatus(parseStatus(await this.native.getStatusAsync()));
  }

  start(activityType: ActivityType): Promise<number> {
    return this.exclusive(async () => {
      const native = this.requireNative();
      await this.initialize();
      if (this.snapshot.activityId !== null) {
        throw new EngineError('ERR_ALREADY_TRACKING', 'A workout is already in progress.');
      }
      const status = parseStatus(await native.getStatusAsync());
      if (status.hasSession) {
        throw new EngineError('ERR_ALREADY_TRACKING', 'A workout is already being recorded.');
      }
      const db = await this.getDb();
      if ((await listUnfinishedActivities(db)).length > 0) {
        throw new EngineError('ERR_UNFINISHED', 'Save or discard the interrupted workout first.');
      }

      this.update({ ...initialSnapshot('starting'), busy: true });
      const startedAt = this.now();
      let activityId = 0;
      await writeTransaction(db, async () => {
        activityId = await createActivity(db, { type: activityType, startedAt });
        await saveTrackingState(db, newTrackingState(activityId));
      });

      try {
        const started = parseStatus(
          await native.startTrackingAsync({
            activityId,
            activityType,
            intervalMs: TRACKING_CONFIG.desiredIntervalMs,
            openUri: this.deepLinks?.openUri,
            finishUri: this.deepLinks?.finishUri,
          }),
        );
        this.paceSamples = [];
        this.paceSegment = null;
        this.latestFixTimeMs = null;
        this.lastNotifiedDistance = -Infinity;
        this.update({ activityId, activityType, startedAt, phase: 'recording' });
        await this.applyStatus(started);
        await serializeWrite(() => setPreference(db, 'lastActivityType', activityType));
        notifyDataChanged();
        return activityId;
      } catch (error) {
        await native.discardTrackingAsync().catch(() => undefined);
        await writeTransaction(db, () => deleteActivity(db, activityId));
        this.update({ ...initialSnapshot('idle'), error: errorMessage(error) });
        throw error;
      }
    });
  }

  pause(): Promise<void> {
    return this.exclusive(async () => {
      const native = this.requireNative();
      if (this.snapshot.phase !== 'recording') return;
      const status = parseStatus(await native.pauseTrackingAsync());
      this.update({ phase: 'paused' });
      await this.applyStatus(status);
      await this.syncNow().catch(() => undefined);
    });
  }

  /** Resumes a paused workout, or restarts recording for an interrupted one. */
  resume(): Promise<void> {
    return this.exclusive(async () => {
      const native = this.requireNative();
      const { phase, recovery } = this.snapshot;
      if (phase !== 'paused' && phase !== 'recovering') return;
      if (phase === 'recovering' && recovery && !recovery.canResume) {
        throw new EngineError('ERR_CANNOT_RESUME', 'This workout can no longer record. Save or discard it.');
      }
      // Make sure everything recorded before the interruption is committed first.
      await this.syncNow().catch(() => undefined);
      const status = parseStatus(await native.resumeTrackingAsync());
      this.update({ phase: 'recording', recovery: null });
      await this.applyStatus(status);
    });
  }

  finish(): Promise<CompletedInfo> {
    return this.exclusive(async () => {
      const activityId = this.snapshot.activityId;
      if (activityId === null) throw new EngineError('ERR_NO_ACTIVITY', 'There is no workout to finish.');
      this.update({ phase: 'finishing' });
      let status: NativeTrackingStatus | null = null;
      if (this.native && this.nativeState !== 'idle') {
        status = parseStatus(await this.native.finishTrackingAsync());
      }
      const db = await this.getDb();
      return this.completeFinish(db, activityId, status);
    });
  }

  /** Drains the journal and writes the final activity. Safe to repeat after a crash. */
  private async completeFinish(db: SqlDatabase, activityId: number, status: NativeTrackingStatus | null): Promise<CompletedInfo> {
    this.update({ phase: 'finishing', durationsTicking: false });
    await this.syncNow();

    const activity = await getActivity(db, activityId);
    if (!activity) throw new EngineError('ERR_NO_ACTIVITY', 'The workout could not be found.');
    const record = (await getTrackingState(db, activityId)) ?? newTrackingState(activityId);
    const activeMs = status?.activeMs ?? record.activeDurationMs;
    const elapsedMs = Math.max(status?.elapsedMs ?? record.elapsedDurationMs, activeMs);
    const distance = record.filterState.totalDistanceMeters;
    const accepted = await getRoutePoints(db, activityId, { acceptedOnly: true });
    const endedAt = status?.finishedAtWallMs ?? activity.startedAt + elapsedMs;

    const before = await listActivitySummaries(db);
    let unlocked: AchievementType[] = [];
    await writeTransaction(db, async () => {
      await completeActivity(db, activityId, {
        endedAt,
        elapsedDurationSeconds: elapsedMs / 1000,
        activeDurationSeconds: activeMs / 1000,
        distanceMeters: distance,
        averagePaceSecondsPerKm: averagePaceSecondsPerKm(activeMs / 1000, distance),
        averageSpeedMps: averageSpeedMps(distance, activeMs / 1000),
        gpsQualitySummary: summarizeQuality(record.filterState.quality),
        routePreview: buildRoutePreview(buildRouteGeometry(accepted).lines),
      });
      await deleteTrackingState(db, activityId);
      unlocked = await recomputeAchievements(db);
    });

    if (this.native) {
      await this.native.clearSessionAsync(activityId).catch(() => undefined);
    }
    const goals = await listGoals(db);
    const goalReached = didReachDailyGoal(before, goals, activity.startedAt, distance);
    const completed: CompletedInfo = { activityId, unlockedAchievements: unlocked, goalReached };
    this.nativeState = 'idle';
    this.update({ ...initialSnapshot('idle'), lastCompleted: completed });
    notifyDataChanged();
    await this.reconcileRemaining();
    return completed;
  }

  /** After a workout is saved or discarded, surface any other interrupted one that is left. */
  private async reconcileRemaining() {
    if (!this.native) return;
    const lastCompleted = this.snapshot.lastCompleted;
    await this.reconcile().catch((error: unknown) => this.update({ error: errorMessage(error) }));
    if (lastCompleted && !this.snapshot.lastCompleted) this.update({ lastCompleted });
  }

  discard(): Promise<void> {
    return this.exclusive(async () => {
      const activityId = this.snapshot.activityId;
      if (this.native) await this.native.discardTrackingAsync();
      if (activityId !== null) {
        const db = await this.getDb();
        await writeTransaction(db, () => deleteActivity(db, activityId));
      }
      this.nativeState = 'idle';
      this.update(initialSnapshot('idle'));
      notifyDataChanged();
      await this.reconcileRemaining();
    });
  }

  clearLastCompleted() {
    if (this.snapshot.lastCompleted) this.update({ lastCompleted: null });
  }
}

/** True when the just-finished activity took that day's total across the goal in effect. */
function didReachDailyGoal(
  completedBefore: { startedAt: number; distanceMeters: number; status: string }[],
  goals: Awaited<ReturnType<typeof listGoals>>,
  startedAt: number,
  distanceMeters: number,
): boolean {
  const day = localDayKey(startedAt);
  const goal = goalInEffect(goals, day);
  if (!goal) return false;
  const before = completedBefore
    .filter((activity) => activity.status === 'completed' && localDayKey(activity.startedAt) === day)
    .reduce((sum, activity) => sum + activity.distanceMeters, 0);
  return before < goal.targetDistanceMeters && before + distanceMeters >= goal.targetDistanceMeters;
}

