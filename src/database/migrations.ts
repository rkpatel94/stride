import type { SqlDatabase } from './types';

/**
 * Versioned schema. Each migration runs once, inside a transaction, and bumps
 * PRAGMA user_version. Never edit a shipped migration; append a new one.
 *
 * Conventions: timestamps are epoch milliseconds (UTC), distances meters, durations seconds.
 */
export const MIGRATIONS: { version: number; sql: string }[] = [
  {
    version: 1,
    sql: `
      CREATE TABLE activities (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        type TEXT NOT NULL CHECK (type IN ('walk', 'run')),
        status TEXT NOT NULL CHECK (status IN ('recording', 'paused', 'recovering', 'completed')),
        started_at INTEGER NOT NULL,
        ended_at INTEGER,
        elapsed_duration_seconds REAL,
        active_duration_seconds REAL,
        distance_meters REAL NOT NULL DEFAULT 0 CHECK (distance_meters >= 0),
        average_pace_seconds_per_km REAL,
        average_speed_mps REAL,
        gps_quality_summary TEXT,
        route_preview TEXT,
        notes TEXT,
        created_at INTEGER NOT NULL,
        updated_at INTEGER NOT NULL
      );
      CREATE INDEX idx_activities_started_at ON activities (started_at);
      CREATE INDEX idx_activities_status ON activities (status);

      CREATE TABLE route_points (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        activity_id INTEGER NOT NULL REFERENCES activities (id) ON DELETE CASCADE,
        sequence_number INTEGER NOT NULL,
        segment_index INTEGER NOT NULL DEFAULT 0,
        latitude REAL NOT NULL,
        longitude REAL NOT NULL,
        recorded_at INTEGER NOT NULL,
        elapsed_realtime_ms INTEGER,
        accuracy_meters REAL,
        altitude_meters REAL,
        provider_speed_mps REAL,
        bearing_degrees REAL,
        segment_distance_meters REAL NOT NULL DEFAULT 0,
        segment_valid INTEGER NOT NULL DEFAULT 0,
        rejection_reason TEXT,
        starts_new_line INTEGER NOT NULL DEFAULT 0,
        gap_before_seconds REAL
      );
      CREATE UNIQUE INDEX idx_route_points_activity_sequence ON route_points (activity_id, sequence_number);

      CREATE TABLE goals (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        period_type TEXT NOT NULL CHECK (period_type IN ('daily', 'weekly', 'monthly')),
        target_distance_meters REAL NOT NULL CHECK (target_distance_meters > 0),
        start_date TEXT NOT NULL,
        enabled INTEGER NOT NULL DEFAULT 1,
        created_at INTEGER NOT NULL,
        updated_at INTEGER NOT NULL,
        UNIQUE (period_type, start_date)
      );

      CREATE TABLE achievements (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        achievement_type TEXT NOT NULL UNIQUE,
        unlocked_at INTEGER NOT NULL,
        activity_id INTEGER REFERENCES activities (id) ON DELETE SET NULL,
        metadata_json TEXT
      );

      -- One row per live session (normally zero or one). Mirrors what the JS engine needs to
      -- resume processing the native journal exactly where it left off.
      CREATE TABLE tracking_state (
        activity_id INTEGER PRIMARY KEY REFERENCES activities (id) ON DELETE CASCADE,
        state TEXT NOT NULL,
        last_journal_sequence INTEGER NOT NULL DEFAULT 0,
        next_sequence_number INTEGER NOT NULL DEFAULT 0,
        last_accepted_sequence_number INTEGER,
        distance_meters REAL NOT NULL DEFAULT 0,
        active_duration_ms REAL NOT NULL DEFAULT 0,
        elapsed_duration_ms REAL NOT NULL DEFAULT 0,
        filter_state TEXT NOT NULL,
        recovery_json TEXT,
        updated_at INTEGER NOT NULL
      );

      CREATE TABLE preferences (
        key TEXT PRIMARY KEY,
        value TEXT NOT NULL
      );
    `,
  },
];

export const LATEST_SCHEMA_VERSION = MIGRATIONS[MIGRATIONS.length - 1].version;

export async function migrate(db: SqlDatabase): Promise<number> {
  const row = await db.getFirstAsync<{ user_version: number }>('PRAGMA user_version', []);
  let version = row?.user_version ?? 0;
  if (version > LATEST_SCHEMA_VERSION) {
    throw new Error(
      `The database was created by a newer version of the app (schema ${version}). Update the app to open it.`,
    );
  }
  for (const migration of MIGRATIONS) {
    if (migration.version <= version) continue;
    await db.withTransactionAsync(async () => {
      await db.execAsync(migration.sql);
      // PRAGMA does not accept bound parameters; the value is a trusted integer.
      await db.execAsync(`PRAGMA user_version = ${migration.version}`);
    });
    version = migration.version;
  }
  return version;
}
