import { NativeModule, requireOptionalNativeModule } from 'expo';

export type AppDatabaseParam = string | number | null;

export type AppDatabaseRunResult = {
  lastInsertRowId: number;
  changes: number;
};

declare class AppDatabaseNativeModule extends NativeModule {
  /** Opens (once per process) the database file in the app's files/SQLite directory. */
  openAsync(name: string): Promise<null>;
  /** Runs statements one after another; each must be a single statement. */
  execAsync(statements: string[]): Promise<null>;
  runAsync(sql: string, params: AppDatabaseParam[]): Promise<AppDatabaseRunResult>;
  getAllAsync(sql: string, params: AppDatabaseParam[]): Promise<Record<string, unknown>[]>;
  beginTransactionAsync(): Promise<null>;
  commitTransactionAsync(): Promise<null>;
  rollbackTransactionAsync(): Promise<null>;
}

/**
 * Android's built-in SQLite (modules/app-database). Null when the native code is not part of the
 * running binary (Expo Go or a stale development build).
 */
export default requireOptionalNativeModule<AppDatabaseNativeModule>('AppDatabase');
