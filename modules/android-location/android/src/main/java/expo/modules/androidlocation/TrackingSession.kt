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

/** Run/walk intervals: runMs of running, then walkMs of walking, `repeats` times, on active time. */
data class IntervalPlan(val runMs: Long, val walkMs: Long, val repeats: Int) {
  val cycleMs: Long get() = runMs + walkMs
  val totalMs: Long get() = cycleMs * repeats

  /** Phase at the given active time: 2 × round + (0 run, 1 walk); `repeats × 2` when finished. */
  fun phaseAt(activeMs: Long): Int {
    if (activeMs >= totalMs) return repeats * 2
    val round = (activeMs / cycleMs).toInt()
    val within = activeMs % cycleMs
    return round * 2 + if (within < runMs) 0 else 1
  }

  /** Active ms left until the next phase change, or null when the plan is finished. */
  fun msToNextPhase(activeMs: Long): Long? {
    if (activeMs >= totalMs) return null
    val within = activeMs % cycleMs
    return if (within < runMs) runMs - within else cycleMs - within
  }

  fun isValid(): Boolean = runMs > 0 && walkMs > 0 && repeats > 0
}

/**
 * Durable description of the workout that the foreground service is recording.
 *
 * All durations use SystemClock.elapsedRealtime() (monotonic, keeps counting in deep sleep), so
 * changing the device clock never changes workout timing. Wall-clock values are kept only for
 * calendar placement. Differences between two elapsed values are only meaningful within one boot,
 * which is why [bootCount] is stored alongside them.
 *
 * A workout can switch between walking and running: [activityType] is the current part, and the
 * active time of running parts is counted separately ([runActiveMs]).
 */
data class TrackingSession(
  val activityId: Long,
  /** The current part: "walk" or "run". */
  val activityType: String,
  val state: SessionState,
  val startedAtWallMs: Long,
  val startedElapsedMs: Long,
  val bootCount: Int,
  /** Active time of all closed recording intervals. */
  val accumulatedActiveMs: Long,
  /** The part of [accumulatedActiveMs] spent running. */
  val accumulatedRunActiveMs: Long,
  /** Start of the currently open recording interval; null unless recording and not auto-paused. */
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
  /** Last distance reported by the JS engine; used for the notification and the widget. */
  val distanceMeters: Double,
  val intervalMs: Long,
  val openUri: String?,
  val finishUri: String?,
  /** Stop counting active time while standing still (location updates keep running). */
  val autoPauseEnabled: Boolean,
  /** Recording, but standing still: the active clock is stopped until movement resumes. */
  val autoPaused: Boolean,
  val intervals: IntervalPlan?
) {
  val isActive: Boolean
    get() = state == SessionState.RECORDING || state == SessionState.PAUSED

  fun activeMs(nowElapsedMs: Long): Long = accumulatedActiveMs + openMs(nowElapsedMs)

  fun runActiveMs(nowElapsedMs: Long): Long =
    accumulatedRunActiveMs + if (activityType == "run") openMs(nowElapsedMs) else 0L

  private fun openMs(nowElapsedMs: Long): Long =
    if (state == SessionState.RECORDING && runStartedElapsedMs != null) max(0L, nowElapsedMs - runStartedElapsedMs) else 0L

  fun elapsedMs(nowElapsedMs: Long): Long {
    val end = when (state) {
      SessionState.FINISHED -> finishedElapsedMs ?: nowElapsedMs
      // Frozen at the last sign of life until the user resumes or finishes.
      SessionState.INTERRUPTED -> lastHeartbeatElapsedMs
      else -> nowElapsedMs
    }
    return max(0L, end - startedElapsedMs)
  }

  /** Closes the open recording interval at [endElapsedMs], crediting it to the current part. */
  fun closedAt(endElapsedMs: Long): TrackingSession {
    val start = runStartedElapsedMs ?: return this
    val open = max(0L, endElapsedMs - start)
    return copy(
      accumulatedActiveMs = accumulatedActiveMs + open,
      accumulatedRunActiveMs = accumulatedRunActiveMs + if (activityType == "run") open else 0L,
      runStartedElapsedMs = null
    )
  }
}

/** SharedPreferences persistence. State transitions use commit() so they survive a process kill. */
class SessionStore(context: Context) {
  private val prefs: SharedPreferences =
    context.applicationContext.getSharedPreferences(PREFS_NAME, Context.MODE_PRIVATE)

  fun load(): TrackingSession? {
    if (!prefs.contains(KEY_ACTIVITY_ID)) return null
    val state = SessionState.from(prefs.getString(KEY_STATE, null)) ?: return null
    val repeats = prefs.getInt(KEY_INTERVAL_REPEATS, 0)
    val intervals = IntervalPlan(prefs.getLong(KEY_INTERVAL_RUN_MS, 0L), prefs.getLong(KEY_INTERVAL_WALK_MS, 0L), repeats)
    val activityType = prefs.getString(KEY_ACTIVITY_TYPE, "walk") ?: "walk"
    val accumulatedActive = prefs.getLong(KEY_ACCUMULATED_ACTIVE, 0L)
    // A session saved before walk/run parts existed was one type throughout.
    val accumulatedRunActive = when {
      prefs.contains(KEY_ACCUMULATED_RUN_ACTIVE) -> prefs.getLong(KEY_ACCUMULATED_RUN_ACTIVE, 0L)
      activityType == "run" -> accumulatedActive
      else -> 0L
    }
    return TrackingSession(
      activityId = prefs.getLong(KEY_ACTIVITY_ID, 0L),
      activityType = activityType,
      state = state,
      startedAtWallMs = prefs.getLong(KEY_STARTED_WALL, 0L),
      startedElapsedMs = prefs.getLong(KEY_STARTED_ELAPSED, 0L),
      bootCount = prefs.getInt(KEY_BOOT_COUNT, -1),
      accumulatedActiveMs = accumulatedActive,
      accumulatedRunActiveMs = accumulatedRunActive,
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
      finishUri = prefs.getString(KEY_FINISH_URI, null),
      autoPauseEnabled = prefs.getBoolean(KEY_AUTO_PAUSE_ENABLED, false),
      autoPaused = prefs.getBoolean(KEY_AUTO_PAUSED, false),
      intervals = if (intervals.isValid()) intervals else null
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
      .putLong(KEY_ACCUMULATED_RUN_ACTIVE, session.accumulatedRunActiveMs)
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
      .putBoolean(KEY_AUTO_PAUSE_ENABLED, session.autoPauseEnabled)
      .putBoolean(KEY_AUTO_PAUSED, session.autoPaused)
      .putLong(KEY_INTERVAL_RUN_MS, session.intervals?.runMs ?: 0L)
      .putLong(KEY_INTERVAL_WALK_MS, session.intervals?.walkMs ?: 0L)
      .putInt(KEY_INTERVAL_REPEATS, session.intervals?.repeats ?: 0)

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
    const val KEY_ACCUMULATED_RUN_ACTIVE = "accumulatedRunActiveMs"
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
    const val KEY_AUTO_PAUSE_ENABLED = "autoPauseEnabled"
    const val KEY_AUTO_PAUSED = "autoPaused"
    const val KEY_INTERVAL_RUN_MS = "intervalRunMs"
    const val KEY_INTERVAL_WALK_MS = "intervalWalkMs"
    const val KEY_INTERVAL_REPEATS = "intervalRepeats"
  }
}
