import * as SQLite from 'expo-sqlite';

import { migrate } from './migrations';
import type { SqlDatabase } from './types';

export const DATABASE_NAME = 'stride.db';

let databasePromise: Promise<SqlDatabase> | null = null;

/**
 * Opens (once) and migrates the app database.
 *  - WAL keeps readers and the single writer from blocking each other and survives crashes.
 *  - synchronous=FULL: every committed transaction is on disk before the call returns, which
 *    matters more here than write throughput (about one small transaction per second).
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
  const db = await SQLite.openDatabaseAsync(DATABASE_NAME);
  await db.execAsync(
    'PRAGMA journal_mode = WAL; PRAGMA foreign_keys = ON; PRAGMA synchronous = FULL; PRAGMA busy_timeout = 5000;',
  );
  await migrate(db);
  return db;
}

/** PRAGMA quick_check; returns "ok" when the file is structurally sound. */
export async function checkDatabaseIntegrity(): Promise<string> {
  const db = await getDatabase();
  const rows = await db.getAllAsync<{ quick_check: string }>('PRAGMA quick_check', []);
  return rows.map((row) => row.quick_check).join('; ') || 'unknown';
}
