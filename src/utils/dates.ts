/**
 * Calendar helpers. All grouping uses the device's current local time zone, applied to the
 * activity's start timestamp: an activity belongs to the local day, week and month in which it
 * started (so a run from 23:40 to 00:20 counts for the day it started). Weeks start on Monday
 * by default. Arithmetic goes through Date's local setters so DST changes are handled.
 */

export type WeekStart = 0 | 1 | 2 | 3 | 4 | 5 | 6; // 0 = Sunday, 1 = Monday

export const DEFAULT_WEEK_START: WeekStart = 1;

const pad = (value: number) => String(value).padStart(2, '0');

export function localDayKey(ms: number): string {
  const date = new Date(ms);
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
}

export function dayKeyToMs(dayKey: string): number {
  const [year, month, day] = dayKey.split('-').map(Number);
  return new Date(year, month - 1, day).getTime();
}

export function startOfLocalDay(ms: number): number {
  const date = new Date(ms);
  date.setHours(0, 0, 0, 0);
  return date.getTime();
}

export function addLocalDays(ms: number, days: number): number {
  const date = new Date(ms);
  date.setDate(date.getDate() + days);
  return date.getTime();
}

export function startOfLocalWeek(ms: number, weekStartsOn: WeekStart = DEFAULT_WEEK_START): number {
  const date = new Date(startOfLocalDay(ms));
  const offset = (date.getDay() - weekStartsOn + 7) % 7;
  date.setDate(date.getDate() - offset);
  return date.getTime();
}

export function startOfLocalMonth(ms: number): number {
  const date = new Date(ms);
  return new Date(date.getFullYear(), date.getMonth(), 1).getTime();
}

export function addLocalMonths(ms: number, months: number): number {
  const date = new Date(ms);
  return new Date(date.getFullYear(), date.getMonth() + months, 1).getTime();
}

export function daysInLocalMonth(ms: number): number {
  const date = new Date(ms);
  return new Date(date.getFullYear(), date.getMonth() + 1, 0).getDate();
}

/** Whole local days from `fromKey` to `toKey` (positive if `toKey` is later). */
export function daysBetween(fromKey: string, toKey: string): number {
  return Math.round((dayKeyToMs(toKey) - dayKeyToMs(fromKey)) / 86_400_000);
}

export function previousDayKey(dayKey: string): string {
  return localDayKey(addLocalDays(dayKeyToMs(dayKey), -1));
}

export function weekdayLabel(ms: number): string {
  return new Date(ms).toLocaleDateString(undefined, { weekday: 'narrow' });
}
