import { useEffect, useEffectEvent, useRef } from 'react';

/**
 * Handles a one-shot request passed in a route param, such as `/track?start=walk` from Home or
 * `?confirmFinish=1` from the notification's Finish action: `onRequest` runs once when the param
 * appears (it should also clear the param from the route).
 *
 * The handled value is remembered only until the param is gone. Tab screens stay mounted, so the
 * same request can legitimately arrive again (the next "Start walk", Finish on the next workout);
 * while it is still in the route, re-renders and Strict Mode's repeated effects must not repeat it.
 */
export function useRouteRequest(value: string | undefined, onRequest: (value: string) => void): void {
  const handled = useRef<string | undefined>(undefined);
  const handle = useEffectEvent(onRequest);
  useEffect(() => {
    if (!value) {
      handled.current = undefined;
      return;
    }
    if (handled.current === value) return;
    handled.current = value;
    handle(value);
  }, [value]);
}
