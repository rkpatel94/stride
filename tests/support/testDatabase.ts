import { migrate, MIGRATIONS } from '@/database/migrations';
import type { SqlDatabase, SqlValue } from '@/database/types';

type Statement = {
  run(...params: SqlValue[]): { changes: number | bigint; lastInsertRowid: number | bigint };
  get(...params: SqlValue[]): Record<string, unknown> | undefined;
  all(...params: SqlValue[]): Record<string, unknown>[];
};

type NodeSqlite = {
  DatabaseSync: new (path: string) => { exec(sql: string): void; prepare(sql: string): Statement; close(): void };
};

export type TestDatabase = SqlDatabase & { close(): void };

/**
 * The app's SqlDatabase interface backed by Node's built-in SQLite, so repositories, migrations
 * and the tracking engine run against a real SQLite engine in tests (same SQL, same constraints).
 * Loaded through process.getBuiltinModule so Jest's module resolver is bypassed.
 */
/** A migrated in-memory database; `schemaVersion` stops at an older schema (for upgrade tests). */
export async function createTestDatabase(options: { schemaVersion?: number } = {}): Promise<TestDatabase> {
  const sqlite = process.getBuiltinModule('node:sqlite') as unknown as NodeSqlite;
  const raw = new sqlite.DatabaseSync(':memory:');
  raw.exec('PRAGMA foreign_keys = ON;');
  const plain = <T>(row: Record<string, unknown>) => ({ ...row }) as T;

  const db: TestDatabase = {
    async execAsync(source) {
      raw.exec(source);
    },
    async runAsync(source, params) {
      const result = raw.prepare(source).run(...params);
      return { changes: Number(result.changes), lastInsertRowId: Number(result.lastInsertRowid) };
    },
    async getFirstAsync<T>(source: string, params: SqlValue[]) {
      const row = raw.prepare(source).get(...params);
      return row ? plain<T>(row) : null;
    },
    async getAllAsync<T>(source: string, params: SqlValue[]) {
      return raw.prepare(source).all(...params).map((row) => plain<T>(row));
    },
    async withTransactionAsync(task) {
      raw.exec('BEGIN');
      try {
        await task();
        raw.exec('COMMIT');
      } catch (error) {
        raw.exec('ROLLBACK');
        throw error;
      }
    },
    close() {
      raw.close();
    },
  };
  if (options.schemaVersion === undefined) {
    await migrate(db);
  } else {
    for (const migration of MIGRATIONS.filter((entry) => entry.version <= (options.schemaVersion ?? 0))) {
      raw.exec(migration.sql);
      raw.exec(`PRAGMA user_version = ${migration.version}`);
    }
  }
  return db;
}
