import { PermissionsAndroid, Platform } from 'react-native';

import AndroidLocation, { parseDeviceStatus, type DeviceLocationStatus } from '@/modules/android-location';

export type LocationAccess = 'precise' | 'approximate' | 'denied' | 'blocked';

const FINE = PermissionsAndroid.PERMISSIONS.ACCESS_FINE_LOCATION;
const COARSE = PermissionsAndroid.PERMISSIONS.ACCESS_COARSE_LOCATION;

export async function getLocationAccess(): Promise<LocationAccess> {
  if (await PermissionsAndroid.check(FINE)) return 'precise';
  if (await PermissionsAndroid.check(COARSE)) return 'approximate';
  return 'denied';
}

/**
 * Requests foreground location. Background ("Allow all the time") location is never requested:
 * recording runs in a location foreground service started while the app is visible, which keeps
 * while-in-use access when the screen is locked.
 */
export async function requestLocationAccess(): Promise<LocationAccess> {
  const result = await PermissionsAndroid.requestMultiple([FINE, COARSE]);
  if (result[FINE] === PermissionsAndroid.RESULTS.GRANTED) return 'precise';
  if (result[COARSE] === PermissionsAndroid.RESULTS.GRANTED) return 'approximate';
  if (result[FINE] === PermissionsAndroid.RESULTS.NEVER_ASK_AGAIN) return 'blocked';
  return 'denied';
}

export function needsNotificationPermission(): boolean {
  return Platform.OS === 'android' && Number(Platform.Version) >= 33;
}

/** Android 13+: the tracking notification needs POST_NOTIFICATIONS. Tracking works without it. */
export async function requestNotificationPermission(): Promise<boolean> {
  if (!needsNotificationPermission()) return true;
  const permission = PermissionsAndroid.PERMISSIONS.POST_NOTIFICATIONS;
  if (await PermissionsAndroid.check(permission)) return true;
  return (await PermissionsAndroid.request(permission)) === PermissionsAndroid.RESULTS.GRANTED;
}

export async function getDeviceStatus(): Promise<DeviceLocationStatus | null> {
  if (!AndroidLocation) return null;
  return parseDeviceStatus(await AndroidLocation.getDeviceStatusAsync());
}

/** Shows Google's "turn on location" dialog when possible; resolves whether location is on. */
export async function requestLocationServices(): Promise<boolean> {
  if (!AndroidLocation) return false;
  const enabled = await AndroidLocation.requestLocationSettingsAsync();
  if (enabled) return true;
  const status = await getDeviceStatus();
  return status?.locationEnabled ?? false;
}

export const openAppSettings = () => AndroidLocation?.openAppSettingsAsync();
export const openLocationSettings = () => AndroidLocation?.openLocationSettingsAsync();
export const openBatteryOptimizationSettings = () => AndroidLocation?.openBatteryOptimizationSettingsAsync();
export const openNotificationSettings = () => AndroidLocation?.openNotificationSettingsAsync();

/** User-facing explanation of why a session was interrupted. */
export function describeInterruption(reason: string | null): string {
  switch (reason) {
    case 'process_terminated':
      return 'Android closed the app while recording (often battery optimisation). Fixes recorded up to that point are saved.';
    case 'device_rebooted':
      return 'The phone restarted while recording. Fixes recorded before the restart are saved.';
    case 'permission_revoked':
      return 'Location permission was turned off while recording.';
    case 'foreground_service_start_failed':
      return 'Android did not allow the tracking service to start. Open the app and try again.';
    case 'service_stopped':
      return 'The tracking service was stopped by the system.';
    case 'session_lost':
      return 'The recording session could not be restored. You can save what was recorded or discard it.';
    default:
      return 'Recording was interrupted.';
  }
}
