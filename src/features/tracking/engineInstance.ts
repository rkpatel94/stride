import Constants from 'expo-constants';
import { AppState } from 'react-native';

import AndroidLocation from '@/modules/android-location';

import { getDatabase } from '@/database/database';

import { TrackingEngine, type TrackingNativeApi } from './trackingEngine';

const configuredScheme = Constants.expoConfig?.scheme;
const scheme = (Array.isArray(configuredScheme) ? configuredScheme[0] : configuredScheme) ?? 'stride';

/** The app-wide engine. Null native module means Expo Go or a build without the tracking module. */
export const trackingEngine = new TrackingEngine({
  native: AndroidLocation as unknown as TrackingNativeApi | null,
  getDatabase,
  deepLinks: {
    openUri: `${scheme}://track`,
    finishUri: `${scheme}://track?confirmFinish=1`,
  },
});

// Returning to the foreground: catch up with fixes recorded while the UI was not running and
// re-read durations from the service (JS timers may have been throttled in the background).
AppState.addEventListener('change', (state) => {
  if (state !== 'active') return;
  void trackingEngine.refreshStatus().catch(() => undefined);
  void trackingEngine.syncNow().catch(() => undefined);
});
