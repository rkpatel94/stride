package expo.modules.androidlocation

import android.content.ContentValues
import android.content.Context
import android.database.sqlite.SQLiteDatabase
import android.database.sqlite.SQLiteOpenHelper
import android.location.Location
import android.os.Build

/**
 * Append-only journal of raw location fixes, written by the foreground service the moment a fix
 * arrives. The JS engine reads it, runs the GPS filter, stores route points in the app database
 * and then acknowledges (deletes) the rows it has committed. Because nothing depends on the JS
 * runtime being alive, fixes recorded while the UI is gone are never lost.
 *
 * This is a separate database file on purpose: the app database is owned by expo-sqlite, which
 * bundles its own SQLite library, and two SQLite libraries must never open the same file.
 */
class TrackingJournal private constructor(context: Context) :
  SQLiteOpenHelper(context.applicationContext, DB_NAME, null, DB_VERSION) {

  init {
    setWriteAheadLoggingEnabled(true)
  }

  override fun onCreate(db: SQLiteDatabase) {
    db.execSQL(
      """
      CREATE TABLE journal (
        seq INTEGER PRIMARY KEY AUTOINCREMENT,
        activity_id INTEGER NOT NULL,
        segment_index INTEGER NOT NULL,
        latitude REAL NOT NULL,
        longitude REAL NOT NULL,
        wall_time_ms INTEGER NOT NULL,
        elapsed_realtime_ms INTEGER,
        accuracy_m REAL,
        altitude_m REAL,
        speed_mps REAL,
        bearing_deg REAL,
        provider TEXT,
        is_mock INTEGER NOT NULL DEFAULT 0
      )
      """.trimIndent()
    )
    db.execSQL("CREATE INDEX journal_activity_seq ON journal(activity_id, seq)")
  }

  override fun onUpgrade(db: SQLiteDatabase, oldVersion: Int, newVersion: Int) = Unit

  fun append(activityId: Long, segmentIndex: Int, location: Location): Long {
    val values = ContentValues().apply {
      put("activity_id", activityId)
      put("segment_index", segmentIndex)
      put("latitude", location.latitude)
      put("longitude", location.longitude)
      put("wall_time_ms", location.time)
      put("elapsed_realtime_ms", location.elapsedRealtimeNanos / 1_000_000L)
      if (location.hasAccuracy()) put("accuracy_m", location.accuracy.toDouble())
      if (location.hasAltitude()) put("altitude_m", location.altitude)
      if (location.hasSpeed()) put("speed_mps", location.speed.toDouble())
      if (location.hasBearing()) put("bearing_deg", location.bearing.toDouble())
      put("provider", location.provider)
      put("is_mock", if (isMock(location)) 1 else 0)
    }
    return writableDatabase.insertOrThrow("journal", null, values)
  }

  fun read(activityId: Long, afterSequence: Long, limit: Int): List<Map<String, Any?>> {
    val rows = ArrayList<Map<String, Any?>>()
    readableDatabase.rawQuery(
      "SELECT * FROM journal WHERE activity_id = ? AND seq > ? ORDER BY seq ASC LIMIT ?",
      arrayOf(activityId.toString(), afterSequence.toString(), limit.coerceIn(1, 5000).toString())
    ).use { cursor ->
      fun doubleOrNull(column: String): Double? {
        val index = cursor.getColumnIndexOrThrow(column)
        return if (cursor.isNull(index)) null else cursor.getDouble(index)
      }
      while (cursor.moveToNext()) {
        rows.add(
          mapOf(
            "sequence" to cursor.getLong(cursor.getColumnIndexOrThrow("seq")).toDouble(),
            "activityId" to cursor.getLong(cursor.getColumnIndexOrThrow("activity_id")).toDouble(),
            "segmentIndex" to cursor.getInt(cursor.getColumnIndexOrThrow("segment_index")),
            "latitude" to cursor.getDouble(cursor.getColumnIndexOrThrow("latitude")),
            "longitude" to cursor.getDouble(cursor.getColumnIndexOrThrow("longitude")),
            "wallTimeMs" to cursor.getLong(cursor.getColumnIndexOrThrow("wall_time_ms")).toDouble(),
            "elapsedRealtimeMs" to doubleOrNull("elapsed_realtime_ms"),
            "accuracyMeters" to doubleOrNull("accuracy_m"),
            "altitudeMeters" to doubleOrNull("altitude_m"),
            "speedMps" to doubleOrNull("speed_mps"),
            "bearingDegrees" to doubleOrNull("bearing_deg"),
            "provider" to cursor.getString(cursor.getColumnIndexOrThrow("provider")),
            "isMock" to (cursor.getInt(cursor.getColumnIndexOrThrow("is_mock")) == 1)
          )
        )
      }
    }
    return rows
  }

  fun acknowledge(activityId: Long, upToSequence: Long): Int =
    writableDatabase.delete(
      "journal",
      "activity_id = ? AND seq <= ?",
      arrayOf(activityId.toString(), upToSequence.toString())
    )

  fun clear(activityId: Long?): Int =
    if (activityId == null) {
      writableDatabase.delete("journal", null, null)
    } else {
      writableDatabase.delete("journal", "activity_id = ?", arrayOf(activityId.toString()))
    }

  fun pendingCount(activityId: Long): Int =
    readableDatabase.rawQuery(
      "SELECT COUNT(*) FROM journal WHERE activity_id = ?",
      arrayOf(activityId.toString())
    ).use { cursor -> if (cursor.moveToFirst()) cursor.getInt(0) else 0 }

  companion object {
    private const val DB_NAME = "stride_tracking_journal.db"
    private const val DB_VERSION = 1

    @Volatile
    private var instance: TrackingJournal? = null

    fun get(context: Context): TrackingJournal =
      instance ?: synchronized(this) {
        instance ?: TrackingJournal(context).also { instance = it }
      }

    @Suppress("DEPRECATION")
    fun isMock(location: Location): Boolean =
      if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.S) location.isMock else location.isFromMockProvider
  }
}
