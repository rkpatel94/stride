import type { StartTrackingOptions } from '@/modules/android-location';

import type { Measurement } from '@/features/tracking/gpsFilter';
import type { TrackingNativeApi } from '@/features/tracking/trackingEngine';

type State = 'recording' | 'paused' | 'interrupted' | 'finished';

type Session = {
  activityId: number;
  activityType: 'walk' | 'run';
  state: State;
  segmentIndex: number;
  activeMs: number;
  elapsedMs: number;
  startedAtWallMs: number;
  finishedAtWallMs: number | null;
  interruptionReason: string | null;
};

type JournalEntry = {
  sequence: number;
  activityId: number;
  segmentIndex: number;
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
 * finish, and a session that survives JS "restarts" (a new engine on the same instance).
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
    this.session = {
      activityId: options.activityId,
      activityType: options.activityType,
      state: 'recording',
      segmentIndex: 0,
      activeMs: 0,
      elapsedMs: 0,
      startedAtWallMs: this.clock.now,
      finishedAtWallMs: null,
      interruptionReason: null,
    };
    this.serviceRunning = true;
    return this.status();
  }

  async pauseTrackingAsync() {
    if (!this.session) throw new Error('ERR_NO_SESSION');
    if (this.session.state === 'recording') this.session.state = 'paused';
    return this.status();
  }

  async resumeTrackingAsync() {
    if (!this.session) throw new Error('ERR_NO_SESSION');
    if (this.session.state === 'paused' || this.session.state === 'interrupted') {
      this.session.state = 'recording';
      this.session.segmentIndex += 1;
      this.session.interruptionReason = null;
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

  /** Advances the session clock the way SystemClock would. */
  advance(ms: number) {
    this.clock.now += ms;
    const session = this.session;
    if (!session || session.state === 'finished' || session.state === 'interrupted') return;
    session.elapsedMs += ms;
    if (session.state === 'recording') session.activeMs += ms;
  }

  /** The process died: the service is gone and the session is marked interrupted. */
  interrupt(reason = 'process_terminated') {
    if (!this.session) return;
    this.session.state = 'interrupted';
    this.session.interruptionReason = reason;
    this.serviceRunning = false;
  }

  emitStatus() {
    for (const listener of this.listeners.onStatusChanged) listener(this.status());
  }
}
