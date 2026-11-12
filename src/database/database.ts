import AppDatabase from '@/modules/app-database';

import { migrate } from './migrations';
import { splitSqlStatements } from './splitStatements';
import type { SqlDatabase, SqlValue } from './types';

export const DATABASE_NAME = 'stride.db';

let databasePromise: Promise<SqlDatabase> | null = null;

/**
 * Opens (once) and migrates the app database: Android's built-in SQLite through the app's own
 * native module (modules/app-database), in the same file expo-sqlite used before.
 *  - One connection with synchronous=FULL: every committed transaction is on disk before the call
 *    returns, which matters more here than write throughput (about one small transaction a second).
 *  - Foreign keys are enforced.
 */
export function getDatabase(): Promise<SqlDatabase> {
  if (!databasePromise) {
    databasePromise = openDatabase().catch((error: unknown) => {
      databasePromise = null;
      throw error;
    });
  }
  return databasePromise;
}

async function openDatabase(): Promise<SqlDatabase> {
  const native = AppDatabase;
  if (!native) {
    throw new Error('This build does not include the database module. Rebuild the app with npx expo run:android.');
  }
  await native.openAsync(DATABASE_NAME);
  const db: SqlDatabase = {
    async execAsync(source) {
      await native.execAsync(splitSqlStatements(source));
    },
    runAsync(source, params) {
      return native.runAsync(source, params);
    },
    async getFirstAsync<T>(source: string, params: SqlValue[]) {
      const rows = await native.getAllAsync(source, params);
      return rows.length > 0 ? (rows[0] as T) : null;
    },
    async getAllAsync<T>(source: string, params: SqlValue[]) {
      return (await native.getAllAsync(source, params)) as T[];
    },
    async withTransactionAsync(task) {
      await native.beginTransactionAsync();
      try {
        await task();
      } catch (error) {
        await native.rollbackTransactionAsync().catch(() => undefined);
        throw error;
      }
      await native.commitTransactionAsync();
    },
  };
  await migrate(db);
  return db;
}

/** PRAGMA quick_check; returns "ok" when the file is structurally sound. */
export async function checkDatabaseIntegrity(): Promise<string> {
  const db = await getDatabase();
  const rows = await db.getAllAsync<{ quick_check: string }>('PRAGMA quick_check', []);
  return rows.map((row) => row.quick_check).join('; ') || 'unknown';
}
