/**
 * The subset of expo-sqlite's SQLiteDatabase that repositories use. Keeping repositories on
 * this interface lets the integration tests run them against Node's built-in SQLite.
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
