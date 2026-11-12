import { useEffect, useState, useSyncExternalStore } from 'react';

import AndroidLocation, { parsePreviewEvent, type RawLocation } from '@/modules/android-location';

import { trackingEngine } from '@/features/tracking/engineInstance';
import { TRACKING_CONFIG } from '@/features/tracking/trackingConfig';
import type { LiveSnapshot } from '@/features/tracking/trackingEngine';

export function useTrackingSnapshot(): LiveSnapshot {
  return useSyncExternalStore(trackingEngine.subscribe, trackingEngine.getSnapshot);
}

const monotonicNow = () => globalThis.performance?.now?.() ?? Date.now();

/** Re-renders every `intervalMs` while enabled; returns the monotonic time of the tick. */
export function useTicker(enabled: boolean, intervalMs = 1000): number {
  const [now, setNow] = useState(monotonicNow);
  useEffect(() => {
    if (!enabled) return;
    const timer = setInterval(() => setNow(monotonicNow()), intervalMs);
    return () => clearInterval(timer);
  }, [enabled, intervalMs]);
  return now;
}

/** Durations extrapolated from the last native status using the monotonic JS clock. */
export function liveDurations(snapshot: LiveSnapshot, now: number) {
  const since = Math.max(0, now - snapshot.durationsCapturedAt);
  const active = snapshot.durationsTicking ? since : 0;
  const activeMs = snapshot.activeMs + active;
  const runActiveMs = Math.min(activeMs, snapshot.runActiveMs + (snapshot.activityType === 'run' ? active : 0));
  return {
    activeSeconds: activeMs / 1000,
    elapsedSeconds: (snapshot.elapsedMs + (snapshot.elapsedTicking ? since : 0)) / 1000,
    runActiveSeconds: runActiveMs / 1000,
    walkActiveSeconds: (activeMs - runActiveMs) / 1000,
  };
}

export type PreviewFix = RawLocation & { receivedAt: number };

/**
 * Foreground-only location updates used before a workout starts, to acquire a first fix and
 * show its accuracy. Stops automatically when disabled or unmounted.
 */
export function useLocationPreview(enabled: boolean) {
  const [fix, setFix] = useState<PreviewFix | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!enabled || !AndroidLocation) return;
    const module = AndroidLocation;
    const subscription = module.addListener('onPreviewLocation', (payload: unknown) => {
      const event = parsePreviewEvent(payload);
      if (!event) return;
      if (event.kind === 'location') {
        const { kind: _kind, ...location } = event;
        setFix({ ...location, receivedAt: monotonicNow() });
        setError(null);
      } else if (event.kind === 'error') {
        setError(event.message);
      }
    });
    module.startPreviewAsync(TRACKING_CONFIG.desiredIntervalMs).catch((reason: unknown) => {
      setError(reason instanceof Error ? reason.message : String(reason));
    });
    return () => {
      subscription.remove();
      void module.stopPreviewAsync().catch(() => undefined);
    };
  }, [enabled]);

  return { fix, error };
}
