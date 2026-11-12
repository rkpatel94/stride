import { getDatabase } from '@/database/database';
import { countGoals, upsertGoal } from '@/database/goalRepository';
import { serializeWrite } from '@/database/writeQueue';
import { DEFAULT_DAILY_GOAL_METERS } from '@/features/goals/goals';
import { trackingEngine } from '@/features/tracking/engineInstance';
import { startWidgetSync } from '@/features/widget/widgetSync';
import { localDayKey } from '@/utils/dates';

/**
 * App start: open and migrate the database, create the default daily goal on first launch,
 * then let the tracking engine reconcile with any session the native service still holds.
 */
export async function bootstrapApp(): Promise<void> {
  const db = await getDatabase();
  if ((await countGoals(db)) === 0) {
    await serializeWrite(() =>
      upsertGoal(db, {
        periodType: 'daily',
        targetDistanceMeters: DEFAULT_DAILY_GOAL_METERS,
        startDate: localDayKey(Date.now()),
        enabled: true,
      }),
    );
  }
  try {
    await trackingEngine.initialize();
  } catch (error) {
    // The app stays usable (history, statistics); the engine surfaces the error on its snapshot.
    console.warn('Tracking engine failed to initialise', error);
  }
  startWidgetSync();
}
