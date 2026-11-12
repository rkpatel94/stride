import type { StartTrackingOptions } from '@/modules/android-location';

import type { Measurement } from '@/features/tracking/gpsFilter';
import type { TrackingNativeApi } from '@/features/tracking/trackingEngine';

type State = 'recording' | 'paused' | 'interrupted' | 'finished';
type ActivityType = 'walk' | 'run';

type Session = {
  activityId: number;
  activityType: ActivityType;
  state: State;
  segmentIndex: number;
  activeMs: number;
  runActiveMs: number;
  elapsedMs: number;
  startedAtWallMs: number;
  finishedAtWallMs: number | null;
  interruptionReason: string | null;
  autoPauseEnabled: boolean;
  autoPaused: boolean;
  intervals: { runMs: number; walkMs: number; repeats: number } | null;
};

type JournalEntry = {
  sequence: number;
  activityId: number;
  segmentIndex: number;
  activityType: ActivityType;
  latitude: number;
  longitude: number;
  wallTimeMs: number;
  elapsedRealtimeMs: number | null;
  accuracyMeters: number | null;
  altitudeMeters: number | null;
  speedMps: number | null;
  bearingDegrees: number | null;
  provider: string;
  isMock: boolean;
};

type Listener = (payload: unknown) => void;

/**
 * In-memory stand-in for the Kotlin module with the same session semantics: a journal that only
 * accepts fixes while recording, a segment index that increments on resume, frozen durations on
 * finish, a session that survives JS "restarts" (a new engine on the same instance), walk/run
 * parts with separate run time, auto-pause, and interval phases that switch the part.
 */
export class FakeNative implements TrackingNativeApi {
  session: Session | null = null;
  journal: JournalEntry[] = [];
  serviceRunning = false;
  notifications: number[] = [];
  /** Number of upcoming acknowledge calls that should fail (simulates a crash after commit). */
  failAcknowledgements = 0;
  private nextSequence = 1;
  private listeners: Record<string, Set<Listener>> = { onLocationRecorded: new Set(), onStatusChanged: new Set() };

  constructor(private readonly clock: { now: number }) {}

  status() {
    const s = this.session;
    return {
      hasSession: s !== null,
      serviceRunning: this.serviceRunning,
      activityId: s?.activityId ?? null,
      activityType: s?.activityType ?? null,
      state: s?.state ?? 'idle',
      elapsedMs: s?.elapsedMs ?? null,
      activeMs: s?.activeMs ?? null,
      runActiveMs: s?.runActiveMs ?? null,
      autoPaused: s?.autoPaused ?? false,
      autoPauseEnabled: s?.autoPauseEnabled ?? false,
      intervalRunMs: s?.intervals?.runMs ?? null,
      intervalWalkMs: s?.intervals?.walkMs ?? null,
      intervalRepeats: s?.intervals?.repeats ?? null,
      startedAtWallMs: s?.startedAtWallMs ?? null,
      finishedAtWallMs: s?.finishedAtWallMs ?? null,
      segmentIndex: s?.segmentIndex ?? null,
      lastFixAgeMs: null,
      interruptionReason: s?.interruptionReason ?? null,
      stateBeforeInterruption: null,
      pendingJournalPoints: s ? this.journal.filter((p) => p.activityId === s.activityId).length : null,
      gpsAvailable: true,
      signalLost: false,
      locationServicesEnabled: true,
      lowBattery: false,
      locationSource: 'fake',
    };
  }

  async getStatusAsync() {
    return this.status();
  }

  async startTrackingAsync(options: StartTrackingOptions) {
    if (this.session && this.session.state !== 'finished') throw new Error('ERR_ALREADY_TRACKING');
    const run = options.intervalRunSeconds ?? 0;
    const walk = options.intervalWalkSeconds ?? 0;
    const repeats = options.intervalRepeats ?? 0;
    const intervals = run > 0 && walk > 0 && repeats > 0 ? { runMs: run * 1000, walkMs: walk * 1000, repeats } : null;
    this.session = {
      activityId: options.activityId,
      activityType: intervals ? 'run' : options.activityType,
      state: 'recording',
      segmentIndex: 0,
      activeMs: 0,
      runActiveMs: 0,
      elapsedMs: 0,
      startedAtWallMs: this.clock.now,
      finishedAtWallMs: null,
      interruptionReason: null,
      autoPauseEnabled: options.autoPause === true,
      autoPaused: false,
      intervals,
    };
    this.serviceRunning = true;
    return this.status();
  }

  async pauseTrackingAsync() {
    if (!this.session) throw new Error('ERR_NO_SESSION');
    if (this.session.state === 'recording') {
      this.session.state = 'paused';
      this.session.autoPaused = false;
    }
    return this.status();
  }

  async resumeTrackingAsync() {
    if (!this.session) throw new Error('ERR_NO_SESSION');
    if (this.session.state === 'paused' || this.session.state === 'interrupted') {
      this.session.state = 'recording';
      this.session.segmentIndex += 1;
      this.session.interruptionReason = null;
      this.session.autoPaused = false;
      this.serviceRunning = true;
    }
    return this.status();
  }

  async finishTrackingAsync() {
    if (!this.session) throw new Error('ERR_NO_SESSION');
    this.session.state = 'finished';
    this.session.finishedAtWallMs = this.clock.now;
    this.serviceRunning = false;
    return this.status();
  }

  async switchActivityTypeAsync(activityType: ActivityType) {
    if (!this.session) throw new Error('ERR_NO_SESSION');
    if (this.session.state === 'recording' || this.session.state === 'paused') this.session.activityType = activityType;
    return this.status();
  }

  async setAutoPauseAsync(enabled: boolean) {
    if (!this.session) throw new Error('ERR_NO_SESSION');
    this.session.autoPauseEnabled = enabled;
    if (!enabled) this.session.autoPaused = false;
    return this.status();
  }

  async discardTrackingAsync() {
    this.session = null;
    this.journal = [];
    this.serviceRunning = false;
    return this.status();
  }

  async clearSessionAsync(activityId: number) {
    if (this.session?.activityId === activityId) this.session = null;
    this.journal = this.journal.filter((point) => point.activityId !== activityId);
    return true;
  }

  async readJournalAsync(activityId: number, afterSequence: number, limit: number) {
    return this.journal.filter((p) => p.activityId === activityId && p.sequence > afterSequence).slice(0, limit);
  }

  async acknowledgeJournalAsync(activityId: number, upToSequence: number) {
    if (this.failAcknowledgements > 0) {
      this.failAcknowledgements -= 1;
      throw new Error('simulated crash before acknowledgement');
    }
    const before = this.journal.length;
    this.journal = this.journal.filter((p) => !(p.activityId === activityId && p.sequence <= upToSequence));
    return before - this.journal.length;
  }

  async updateNotificationAsync(distanceMeters: number) {
    this.notifications.push(distanceMeters);
    return true;
  }

  addListener(eventName: 'onLocationRecorded' | 'onStatusChanged', listener: Listener) {
    this.listeners[eventName].add(listener);
    return { remove: () => this.listeners[eventName].delete(listener) };
  }

  // --- test helpers -------------------------------------------------------------------------

  /** Delivers a fix like the service would: journal first, then the JS event (if recording). */
  record(measurement: Measurement, options: { emit?: boolean } = {}) {
    const session = this.session;
    if (!session || session.state !== 'recording') return null;
    const entry: JournalEntry = {
      sequence: this.nextSequence++,
      activityId: session.activityId,
      segmentIndex: session.segmentIndex,
      activityType: session.activityType,
      latitude: measurement.latitude,
      longitude: measurement.longitude,
      wallTimeMs: measurement.wallTimeMs,
      elapsedRealtimeMs: measurement.elapsedRealtimeMs,
      accuracyMeters: measurement.accuracyMeters,
      altitudeMeters: null,
      speedMps: measurement.speedMps,
      bearingDegrees: null,
      provider: 'fused',
      isMock: false,
    };
    this.journal.push(entry);
    if (options.emit !== false) for (const listener of this.listeners.onLocationRecorded) listener(entry);
    return entry;
  }

  /**
   * Advances the session clock the way SystemClock would. Interval phases switch the part at
   * their boundaries (advance in steps no longer than a phase to see each switch).
   */
  advance(ms: number) {
    this.clock.now += ms;
    const session = this.session;
    if (!session || session.state === 'finished' || session.state === 'interrupted') return;
    session.elapsedMs += ms;
    if (session.state !== 'recording' || session.autoPaused) return;
    session.activeMs += ms;
    if (session.activityType === 'run') session.runActiveMs += ms;
    const plan = session.intervals;
    if (plan) {
      const cycle = plan.runMs + plan.walkMs;
      if (session.activeMs < cycle * plan.repeats) {
        const type = session.activeMs % cycle < plan.runMs ? 'run' : 'walk';
        if (type !== session.activityType) {
          session.activityType = type;
          this.emitStatus();
        }
      }
    }
  }

  /** What the service does when it detects standing still (or moving again). */
  setAutoPaused(paused: boolean) {
    if (!this.session || this.session.state !== 'recording' || !this.session.autoPauseEnabled) return;
    this.session.autoPaused = paused;
    this.emitStatus();
  }

  /** The process died: the service is gone and the session is marked interrupted. */
  interrupt(reason = 'process_terminated') {
    if (!this.session) return;
    this.session.state = 'interrupted';
    this.session.interruptionReason = reason;
    this.session.autoPaused = false;
    this.serviceRunning = false;
  }

  emitStatus() {
    for (const listener of this.listeners.onStatusChanged) listener(this.status());
  }
}
