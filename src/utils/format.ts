/** Display formatting. Values are stored in meters/seconds and only converted here. */

import { startOfLocalDay } from './dates';

const PLACEHOLDER = '--';

export function formatDistance(meters: number | null | undefined, options: { alwaysKm?: boolean } = {}): string {
  if (meters === null || meters === undefined || !Number.isFinite(meters)) return PLACEHOLDER;
  const safe = Math.max(0, meters);
  if (!options.alwaysKm && safe < 1000) return `${Math.round(safe)} m`;
  return `${formatKilometers(safe)} km`;
}

/** Kilometers with precision that suits the magnitude: 0.42, 3.42, 12.4, 142. */
export function formatKilometers(meters: number): string {
  const km = Math.max(0, meters) / 1000;
  if (km < 10) return km.toFixed(2);
  if (km < 100) return km.toFixed(1);
  return Math.round(km).toString();
}

export function formatDuration(seconds: number | null | undefined): string {
  if (seconds === null || seconds === undefined || !Number.isFinite(seconds)) return PLACEHOLDER;
  const total = Math.max(0, Math.floor(seconds));
  const hours = Math.floor(total / 3600);
  const minutes = Math.floor((total % 3600) / 60);
  const secs = total % 60;
  const mm = hours > 0 ? String(minutes).padStart(2, '0') : String(minutes);
  return hours > 0 ? `${hours}:${mm}:${String(secs).padStart(2, '0')}` : `${mm}:${String(secs).padStart(2, '0')}`;
}

/** Compact duration for summaries: "1 h 05 min", "42 min", "35 s". */
export function formatDurationShort(seconds: number | null | undefined): string {
  if (seconds === null || seconds === undefined || !Number.isFinite(seconds)) return PLACEHOLDER;
  const total = Math.max(0, Math.round(seconds));
  if (total < 60) return `${total} s`;
  const hours = Math.floor(total / 3600);
  const minutes = Math.floor((total % 3600) / 60);
  if (hours === 0) return `${minutes} min`;
  return `${hours} h ${String(minutes).padStart(2, '0')} min`;
}

export function formatPace(secondsPerKm: number | null | undefined): string {
  if (secondsPerKm === null || secondsPerKm === undefined || !Number.isFinite(secondsPerKm) || secondsPerKm <= 0) {
    return '--:--';
  }
  // Paces slower than 60 min/km are not meaningful for walking or running.
  if (secondsPerKm >= 3600) return '--:--';
  const rounded = Math.round(secondsPerKm);
  return `${Math.floor(rounded / 60)}:${String(rounded % 60).padStart(2, '0')}`;
}

export function formatSpeed(metersPerSecond: number | null | undefined): string {
  if (metersPerSecond === null || metersPerSecond === undefined || !Number.isFinite(metersPerSecond)) {
    return PLACEHOLDER;
  }
  return (Math.max(0, metersPerSecond) * 3.6).toFixed(1);
}

export function formatAccuracy(meters: number | null | undefined): string {
  if (meters === null || meters === undefined || !Number.isFinite(meters)) return PLACEHOLDER;
  return `±${Math.round(meters)} m`;
}

export function formatDate(ms: number): string {
  return new Date(ms).toLocaleDateString(undefined, { weekday: 'short', day: 'numeric', month: 'short', year: 'numeric' });
}

export function formatShortDate(ms: number): string {
  return new Date(ms).toLocaleDateString(undefined, { day: 'numeric', month: 'short' });
}

/** "Today", "Yesterday", a weekday within the past week ("Thu"), otherwise "12 Oct". */
export function formatRelativeDay(ms: number, nowMs = Date.now()): string {
  const days = Math.round((startOfLocalDay(nowMs) - startOfLocalDay(ms)) / 86_400_000);
  if (days === 0) return 'Today';
  if (days === 1) return 'Yesterday';
  if (days > 1 && days < 7) return new Date(ms).toLocaleDateString(undefined, { weekday: 'short' });
  return formatShortDate(ms);
}

export function formatTime(ms: number): string {
  return new Date(ms).toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit' });
}

export function formatPercent(fraction: number | null | undefined): string {
  if (fraction === null || fraction === undefined || !Number.isFinite(fraction)) return PLACEHOLDER;
  return `${Math.round(Math.max(0, fraction) * 100)}%`;
}
