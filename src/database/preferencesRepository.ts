import { DEFAULT_WEEK_START, type WeekStart } from '@/utils/dates';

import type { SqlDatabase } from './types';

export type Preferences = {
  weekStartsOn: WeekStart;
  keepScreenOnWhileTracking: boolean;
  lastActivityType: 'walk' | 'run';
  notificationPermissionAsked: boolean;
};

export const DEFAULT_PREFERENCES: Preferences = {
  weekStartsOn: DEFAULT_WEEK_START,
  keepScreenOnWhileTracking: false,
  lastActivityType: 'walk',
  notificationPermissionAsked: false,
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
  };
}

export async function setPreference<K extends keyof Preferences>(
  db: SqlDatabase,
  key: K,
  value: Preferences[K],
): Promise<void> {
  await db.runAsync(
    'INSERT INTO preferences (key, value) VALUES (?, ?) ON CONFLICT (key) DO UPDATE SET value = excluded.value',
    [key, JSON.stringify(value)],
  );
}
