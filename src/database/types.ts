/**
 * The database operations repositories use. The app implements it over Android's built-in SQLite
 * (database.ts); the integration tests implement it over Node's built-in SQLite.
 *
 * SQL must run on the SQLite of Android 7 (3.9): no upsert clauses, window functions or returning
 * clauses. tests/unit/sqlCompatibility.test.ts checks the source for them.
 */
export type SqlValue = string | number | null;

export type RunResult = {
  lastInsertRowId: number;
  changes: number;
};

export interface SqlDatabase {
  execAsync(source: string): Promise<void>;
  runAsync(source: string, params: SqlValue[]): Promise<RunResult>;
  getFirstAsync<T>(source: string, params: SqlValue[]): Promise<T | null>;
  getAllAsync<T>(source: string, params: SqlValue[]): Promise<T[]>;
  withTransactionAsync(task: () => Promise<void>): Promise<void>;
}
