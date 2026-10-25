package expo.modules.androidlocation

import android.content.Context
import android.content.SharedPreferences
import kotlin.math.max

enum class SessionState(val value: String) {
  RECORDING("recording"),
  PAUSED("paused"),
  INTERRUPTED("interrupted"),
  FINISHED("finished");

  companion object {
    fun from(value: String?): SessionState? = entries.firstOrNull { it.value == value }
  }
}

/**
 * Durable description of the workout that the foreground service is recording.
 *
 * All durations use SystemClock.elapsedRealtime() (monotonic, keeps counting in deep sleep), so
 * changing the device clock never changes workout timing. Wall-clock values are kept only for
 * calendar placement. Differences between two elapsed values are only meaningful within one boot,
 * which is why [bootCount] is stored alongside them.
 */
data class TrackingSession(
  val activityId: Long,
  val activityType: String,
  val state: SessionState,
  val startedAtWallMs: Long,
  val startedElapsedMs: Long,
  val bootCount: Int,
  /** Active time of all closed recording intervals. */
  val accumulatedActiveMs: Long,
  /** Start of the currently open recording interval; null unless state == RECORDING. */
  val runStartedElapsedMs: Long?,
  /** Incremented on every resume/recovery so the route is never joined across a pause. */
  val segmentIndex: Int,
  val lastHeartbeatElapsedMs: Long,
  val lastHeartbeatWallMs: Long,
  val lastFixElapsedMs: Long?,
  val interruptionReason: String?,
  val stateBeforeInterruption: SessionState?,
  val finishedElapsedMs: Long?,
  val finishedAtWallMs: Long?,
  /** Last distance reported by the JS engine; used only for the notification text. */
  val distanceMeters: Double,
  val intervalMs: Long,
  val openUri: String?,
  val finishUri: String?
) {
  val isActive: Boolean
    get() = state == SessionState.RECORDING || state == SessionState.PAUSED

  fun activeMs(nowElapsedMs: Long): Long {
    val open = if (state == SessionState.RECORDING && runStartedElapsedMs != null) {
      max(0L, nowElapsedMs - runStartedElapsedMs)
    } else {
      0L
    }
    return accumulatedActiveMs + open
  }

  fun elapsedMs(nowElapsedMs: Long): Long {
    val end = when (state) {
      SessionState.FINISHED -> finishedElapsedMs ?: nowElapsedMs
      // Frozen at the last sign of life until the user resumes or finishes.
      SessionState.INTERRUPTED -> lastHeartbeatElapsedMs
      else -> nowElapsedMs
    }
    return max(0L, end - startedElapsedMs)
  }
}

/** SharedPreferences persistence. State transitions use commit() so they survive a process kill. */
class SessionStore(context: Context) {
  private val prefs: SharedPreferences =
    context.applicationContext.getSharedPreferences(PREFS_NAME, Context.MODE_PRIVATE)

  fun load(): TrackingSession? {
    if (!prefs.contains(KEY_ACTIVITY_ID)) return null
    val state = SessionState.from(prefs.getString(KEY_STATE, null)) ?: return null
    return TrackingSession(
      activityId = prefs.getLong(KEY_ACTIVITY_ID, 0L),
      activityType = prefs.getString(KEY_ACTIVITY_TYPE, "walk") ?: "walk",
      state = state,
      startedAtWallMs = prefs.getLong(KEY_STARTED_WALL, 0L),
      startedElapsedMs = prefs.getLong(KEY_STARTED_ELAPSED, 0L),
      bootCount = prefs.getInt(KEY_BOOT_COUNT, -1),
      accumulatedActiveMs = prefs.getLong(KEY_ACCUMULATED_ACTIVE, 0L),
      runStartedElapsedMs = prefs.optLong(KEY_RUN_STARTED),
      segmentIndex = prefs.getInt(KEY_SEGMENT_INDEX, 0),
      lastHeartbeatElapsedMs = prefs.getLong(KEY_HEARTBEAT_ELAPSED, 0L),
      lastHeartbeatWallMs = prefs.getLong(KEY_HEARTBEAT_WALL, 0L),
      lastFixElapsedMs = prefs.optLong(KEY_LAST_FIX),
      interruptionReason = prefs.getString(KEY_INTERRUPTION_REASON, null),
      stateBeforeInterruption = SessionState.from(prefs.getString(KEY_STATE_BEFORE_INTERRUPTION, null)),
      finishedElapsedMs = prefs.optLong(KEY_FINISHED_ELAPSED),
      finishedAtWallMs = prefs.optLong(KEY_FINISHED_WALL),
      distanceMeters = java.lang.Double.longBitsToDouble(prefs.getLong(KEY_DISTANCE_BITS, 0L)),
      intervalMs = prefs.getLong(KEY_INTERVAL, 1000L),
      openUri = prefs.getString(KEY_OPEN_URI, null),
      finishUri = prefs.getString(KEY_FINISH_URI, null)
    )
  }

  /** Synchronous write; returns false if the disk write failed. */
  fun save(session: TrackingSession): Boolean = write(session).commit()

  /** Asynchronous write for high-frequency bookkeeping (heartbeats). */
  fun saveLazily(session: TrackingSession) = write(session).apply()

  fun clear(): Boolean = prefs.edit().clear().commit()

  private fun write(session: TrackingSession): SharedPreferences.Editor =
    prefs.edit()
      .putLong(KEY_ACTIVITY_ID, session.activityId)
      .putString(KEY_ACTIVITY_TYPE, session.activityType)
      .putString(KEY_STATE, session.state.value)
      .putLong(KEY_STARTED_WALL, session.startedAtWallMs)
      .putLong(KEY_STARTED_ELAPSED, session.startedElapsedMs)
      .putInt(KEY_BOOT_COUNT, session.bootCount)
      .putLong(KEY_ACCUMULATED_ACTIVE, session.accumulatedActiveMs)
      .putOptLong(KEY_RUN_STARTED, session.runStartedElapsedMs)
      .putInt(KEY_SEGMENT_INDEX, session.segmentIndex)
      .putLong(KEY_HEARTBEAT_ELAPSED, session.lastHeartbeatElapsedMs)
      .putLong(KEY_HEARTBEAT_WALL, session.lastHeartbeatWallMs)
      .putOptLong(KEY_LAST_FIX, session.lastFixElapsedMs)
      .putString(KEY_INTERRUPTION_REASON, session.interruptionReason)
      .putString(KEY_STATE_BEFORE_INTERRUPTION, session.stateBeforeInterruption?.value)
      .putOptLong(KEY_FINISHED_ELAPSED, session.finishedElapsedMs)
      .putOptLong(KEY_FINISHED_WALL, session.finishedAtWallMs)
      .putLong(KEY_DISTANCE_BITS, java.lang.Double.doubleToRawLongBits(session.distanceMeters))
      .putLong(KEY_INTERVAL, session.intervalMs)
      .putString(KEY_OPEN_URI, session.openUri)
      .putString(KEY_FINISH_URI, session.finishUri)

  private fun SharedPreferences.optLong(key: String): Long? = if (contains(key)) getLong(key, 0L) else null

  private fun SharedPreferences.Editor.putOptLong(key: String, value: Long?): SharedPreferences.Editor =
    if (value == null) remove(key) else putLong(key, value)

  private companion object {
    const val PREFS_NAME = "stride_tracking_session"
    const val KEY_ACTIVITY_ID = "activityId"
    const val KEY_ACTIVITY_TYPE = "activityType"
    const val KEY_STATE = "state"
    const val KEY_STARTED_WALL = "startedAtWallMs"
    const val KEY_STARTED_ELAPSED = "startedElapsedMs"
    const val KEY_BOOT_COUNT = "bootCount"
    const val KEY_ACCUMULATED_ACTIVE = "accumulatedActiveMs"
    const val KEY_RUN_STARTED = "runStartedElapsedMs"
    const val KEY_SEGMENT_INDEX = "segmentIndex"
    const val KEY_HEARTBEAT_ELAPSED = "lastHeartbeatElapsedMs"
    const val KEY_HEARTBEAT_WALL = "lastHeartbeatWallMs"
    const val KEY_LAST_FIX = "lastFixElapsedMs"
    const val KEY_INTERRUPTION_REASON = "interruptionReason"
    const val KEY_STATE_BEFORE_INTERRUPTION = "stateBeforeInterruption"
    const val KEY_FINISHED_ELAPSED = "finishedElapsedMs"
    const val KEY_FINISHED_WALL = "finishedAtWallMs"
    const val KEY_DISTANCE_BITS = "distanceMetersBits"
    const val KEY_INTERVAL = "intervalMs"
    const val KEY_OPEN_URI = "openUri"
    const val KEY_FINISH_URI = "finishUri"
  }
}
