import { useFocusEffect } from 'expo-router';
import { useCallback, useEffect, useEffectEvent, useState, useSyncExternalStore } from 'react';

import { getDatabase } from '@/database/database';
import { getDataVersion, subscribeDataChanged } from '@/database/dataEvents';
import type { SqlDatabase } from '@/database/types';

type QueryState<T> = {
  data: T | null;
  error: string | null;
  loading: boolean;
  reload: () => void;
};

type Result<T> = { key: string; data: T | null; error: string | null };

/**
 * Runs `query` against the app database and re-runs it whenever data changes, the screen regains
 * focus, or `deps` change — so every displayed number comes straight from SQLite.
 */
export function useDatabaseQuery<T>(query: (db: SqlDatabase) => Promise<T>, deps: unknown[]): QueryState<T> {
  const version = useSyncExternalStore(subscribeDataChanged, getDataVersion);
  const [focusTick, setFocusTick] = useState(0);
  const [result, setResult] = useState<Result<T>>({ key: '', data: null, error: null });
  const key = `${version}:${focusTick}:${JSON.stringify(deps)}`;
  const runQuery = useEffectEvent((db: SqlDatabase) => query(db));

  useFocusEffect(
    useCallback(() => {
      setFocusTick((tick) => tick + 1);
    }, []),
  );

  useEffect(() => {
    let cancelled = false;
    getDatabase()
      .then((db) => runQuery(db))
      .then((data) => {
        if (!cancelled) setResult({ key, data, error: null });
      })
      .catch((error: unknown) => {
        if (!cancelled) {
          setResult((previous) => ({ key, data: previous.data, error: error instanceof Error ? error.message : String(error) }));
        }
      });
    return () => {
      cancelled = true;
    };
  }, [key]);

  const reload = useCallback(() => setFocusTick((tick) => tick + 1), []);
  // Keep showing the previous data while a refresh is in flight.
  return { data: result.data, error: result.error, loading: result.key !== key, reload };
}
