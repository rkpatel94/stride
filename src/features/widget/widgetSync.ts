import Constants from 'expo-constants';
import { AppState } from 'react-native';

import AndroidLocation, { type WidgetSummary } from '@/modules/android-location';

import { sumCompletedDistance } from '@/database/activityRepository';
import { getDatabase } from '@/database/database';
import { subscribeDataChanged } from '@/database/dataEvents';
import { listGoals } from '@/database/goalRepository';
import type { SqlDatabase } from '@/database/types';
import { goalInEffect, periodRange } from '@/features/goals/goals';
import { localDayKey } from '@/utils/dates';

const configuredScheme = Constants.expoConfig?.scheme;
const scheme = (Array.isArray(configuredScheme) ? configuredScheme[0] : configuredScheme) ?? 'stride';

/** What the widget shows for today besides a workout in progress (that part it reads natively). */
export async function widgetSummary(db: SqlDatabase, nowMs: number, appScheme = scheme): Promise<WidgetSummary> {
  const dayKey = localDayKey(nowMs);
  const today = periodRange('daily', nowMs);
  const [todayMeters, goals] = await Promise.all([sumCompletedDistance(db, today.startMs, today.endMs), listGoals(db)]);
  return { dayKey, todayMeters, goalMeters: goalInEffect(goals, dayKey)?.targetDistanceMeters ?? 0, scheme: appScheme };
}

export async function updateWidget(nowMs = Date.now()): Promise<void> {
  const module = AndroidLocation;
  if (!module) return;
  await module.updateWidgetAsync(await widgetSummary(await getDatabase(), nowMs));
}

let started = false;

/**
 * Keeps the home-screen widget in step with the database: after every data change (a saved or
 * deleted workout, a new goal) and whenever the app comes to the foreground (a new day).
 */
export function startWidgetSync(): void {
  if (started || !AndroidLocation) return;
  started = true;
  let timer: ReturnType<typeof setTimeout> | null = null;
  const schedule = () => {
    if (timer) clearTimeout(timer);
    timer = setTimeout(() => {
      timer = null;
      void updateWidget().catch((error: unknown) => console.warn('Could not update the widget', error));
    }, 400);
  };
  subscribeDataChanged(schedule);
  AppState.addEventListener('change', (state) => {
    if (state === 'active') schedule();
  });
  schedule();
}
