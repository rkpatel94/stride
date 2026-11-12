import { NativeModule, requireOptionalNativeModule } from 'expo';

import type { ActivityType, AndroidLocationEvents, StartTrackingOptions, WidgetSummary } from './AndroidLocation.types';

declare class AndroidLocationNativeModule extends NativeModule<AndroidLocationEvents> {
  getStatusAsync(): Promise<unknown>;
  getDeviceStatusAsync(): Promise<unknown>;
  startTrackingAsync(options: StartTrackingOptions): Promise<unknown>;
  pauseTrackingAsync(): Promise<unknown>;
  resumeTrackingAsync(): Promise<unknown>;
  finishTrackingAsync(): Promise<unknown>;
  /** Starts a walking or running part of the current workout. */
  switchActivityTypeAsync(activityType: ActivityType): Promise<unknown>;
  setAutoPauseAsync(enabled: boolean): Promise<unknown>;
  updateWidgetAsync(summary: WidgetSummary): Promise<boolean>;
  discardTrackingAsync(): Promise<unknown>;
  clearSessionAsync(activityId: number): Promise<boolean>;
  readJournalAsync(activityId: number, afterSequence: number, limit: number): Promise<unknown[]>;
  acknowledgeJournalAsync(activityId: number, upToSequence: number): Promise<number>;
  updateNotificationAsync(distanceMeters: number): Promise<boolean>;
  startPreviewAsync(intervalMs: number): Promise<boolean>;
  stopPreviewAsync(): Promise<boolean>;
  requestLocationSettingsAsync(): Promise<boolean>;
  openAppSettingsAsync(): Promise<boolean>;
  openLocationSettingsAsync(): Promise<boolean>;
  openBatteryOptimizationSettingsAsync(): Promise<boolean>;
  openNotificationSettingsAsync(): Promise<boolean>;
}

/**
 * Null when the native code is not part of the running binary (Expo Go, web, or a stale
 * development build). Callers surface that instead of crashing at import time.
 */
export default requireOptionalNativeModule<AndroidLocationNativeModule>('AndroidLocation');

export type { AndroidLocationNativeModule };
