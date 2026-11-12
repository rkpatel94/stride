import { DEFAULT_INTERVAL_PLAN, normalizePlan, type IntervalPlan } from '@/features/tracking/intervals';
import { DEFAULT_WEEK_START, type WeekStart } from '@/utils/dates';

import type { SqlDatabase } from './types';

export type Preferences = {
  weekStartsOn: WeekStart;
  keepScreenOnWhileTracking: boolean;
  lastActivityType: 'walk' | 'run';
  notificationPermissionAsked: boolean;
  /** Stop the active clock while standing still (traffic lights, a chat). */
  autoPause: boolean;
  /** Start workouts with run/walk intervals. */
  intervalsEnabled: boolean;
  intervalPlan: IntervalPlan;
};

export const DEFAULT_PREFERENCES: Preferences = {
  weekStartsOn: DEFAULT_WEEK_START,
  keepScreenOnWhileTracking: false,
  lastActivityType: 'walk',
  notificationPermissionAsked: false,
  autoPause: false,
  intervalsEnabled: false,
  intervalPlan: DEFAULT_INTERVAL_PLAN,
};

export async function getPreferences(db: SqlDatabase): Promise<Preferences> {
  const rows = await db.getAllAsync<{ key: string; value: string }>('SELECT key, value FROM preferences', []);
  const stored: Record<string, unknown> = {};
  for (const row of rows) {
    try {
      stored[row.key] = JSON.parse(row.value);
    } catch {
      // Ignore a corrupt value and fall back to the default for that key.
    }
  }
  const weekStartsOn = stored.weekStartsOn;
  return {
    weekStartsOn:
      typeof weekStartsOn === 'number' && Number.isInteger(weekStartsOn) && weekStartsOn >= 0 && weekStartsOn <= 6
        ? (weekStartsOn as WeekStart)
        : DEFAULT_PREFERENCES.weekStartsOn,
    keepScreenOnWhileTracking:
      typeof stored.keepScreenOnWhileTracking === 'boolean'
        ? stored.keepScreenOnWhileTracking
        : DEFAULT_PREFERENCES.keepScreenOnWhileTracking,
    lastActivityType: stored.lastActivityType === 'run' ? 'run' : 'walk',
    notificationPermissionAsked: stored.notificationPermissionAsked === true,
    autoPause: stored.autoPause === true,
    intervalsEnabled: stored.intervalsEnabled === true,
    intervalPlan: normalizePlan(
      stored.intervalPlan && typeof stored.intervalPlan === 'object' ? (stored.intervalPlan as Partial<Record<keyof IntervalPlan, unknown>>) : null,
    ),
  };
}

export async function setPreference<K extends keyof Preferences>(
  db: SqlDatabase,
  key: K,
  value: Preferences[K],
): Promise<void> {
  await db.runAsync('INSERT OR REPLACE INTO preferences (key, value) VALUES (?, ?)', [key, JSON.stringify(value)]);
}
