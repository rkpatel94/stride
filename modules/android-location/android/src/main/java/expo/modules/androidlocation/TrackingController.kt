package expo.modules.androidlocation

import android.content.Context
import android.os.SystemClock
import kotlin.math.max

class TrackingStateException(val code: String, message: String) : IllegalStateException(message)

/**
 * The only place that mutates [TrackingSession]. Both the JS module and the foreground service
 * (notification actions, system restarts) go through these synchronized transitions, so the
 * persisted state can never be updated from two places at once.
 */
object TrackingController {
  /**
   * True between "session written" and "service promoted to foreground". While set, a missing
   * service is expected and must not be treated as an interruption.
   */
  @Volatile
  var startPending = false

  @Synchronized
  fun session(context: Context): TrackingSession? = SessionStore(context).load()

  @Synchronized
  fun begin(
    context: Context,
    activityId: Long,
    activityType: String,
    intervalMs: Long,
    openUri: String?,
    finishUri: String?
  ): TrackingSession {
    val store = SessionStore(context)
    val existing = store.load()
    if (existing != null && existing.state != SessionState.FINISHED) {
      throw TrackingStateException(
        "ERR_ALREADY_TRACKING",
        "Activity ${existing.activityId} is still ${existing.state.value}. Finish or discard it first."
      )
    }
    if (existing != null) {
      // A finished session whose data was never collected by JS would be lost here.
      throw TrackingStateException(
        "ERR_UNCOLLECTED_SESSION",
        "The previous activity ${existing.activityId} has not been saved yet."
      )
    }
    val nowElapsed = SystemClock.elapsedRealtime()
    val nowWall = System.currentTimeMillis()
    val session = TrackingSession(
      activityId = activityId,
      activityType = activityType,
      state = SessionState.RECORDING,
      startedAtWallMs = nowWall,
      startedElapsedMs = nowElapsed,
      bootCount = DeviceStatus.bootCount(context),
      accumulatedActiveMs = 0L,
      runStartedElapsedMs = nowElapsed,
      segmentIndex = 0,
      lastHeartbeatElapsedMs = nowElapsed,
      lastHeartbeatWallMs = nowWall,
      lastFixElapsedMs = null,
      interruptionReason = null,
      stateBeforeInterruption = null,
      finishedElapsedMs = null,
      finishedAtWallMs = null,
      distanceMeters = 0.0,
      intervalMs = intervalMs,
      openUri = openUri,
      finishUri = finishUri
    )
    persist(store, session)
    startPending = true
    return session
  }

  @Synchronized
  fun pause(context: Context): TrackingSession? {
    val store = SessionStore(context)
    val session = store.load() ?: return null
    if (session.state != SessionState.RECORDING) return session
    val now = SystemClock.elapsedRealtime()
    return persist(
      store,
      session.copy(
        state = SessionState.PAUSED,
        accumulatedActiveMs = session.activeMs(now),
        runStartedElapsedMs = null,
        lastHeartbeatElapsedMs = now,
        lastHeartbeatWallMs = System.currentTimeMillis()
      )
    )
  }

  /** Resumes a paused session whose service is still alive. */
  @Synchronized
  fun resume(context: Context): TrackingSession? {
    val store = SessionStore(context)
    val session = store.load() ?: return null
    if (session.state != SessionState.PAUSED) return session
    val now = SystemClock.elapsedRealtime()
    return persist(
      store,
      session.copy(
        state = SessionState.RECORDING,
        runStartedElapsedMs = now,
        segmentIndex = session.segmentIndex + 1,
        lastHeartbeatElapsedMs = now,
        lastHeartbeatWallMs = System.currentTimeMillis()
      )
    )
  }

  /**
   * Continues an interrupted session (process killed, service stopped, device rebooted).
   * The time the app was dead is not counted as active time and the route starts a new segment.
   */
  @Synchronized
  fun recover(context: Context, resumeRecording: Boolean): TrackingSession? {
    val store = SessionStore(context)
    val session = store.load() ?: return null
    if (session.state != SessionState.INTERRUPTED) return session
    val now = SystemClock.elapsedRealtime()
    val currentBoot = DeviceStatus.bootCount(context)
    val rebooted = session.bootCount != currentBoot || now < session.lastHeartbeatElapsedMs
    // After a reboot the old elapsedRealtime timebase is gone: re-base the start so the elapsed
    // time recorded before the reboot is preserved (the reboot downtime itself is excluded).
    val startedElapsed = if (rebooted) now - session.elapsedMs(now) else session.startedElapsedMs
    return persist(
      store,
      session.copy(
        state = if (resumeRecording) SessionState.RECORDING else SessionState.PAUSED,
        startedElapsedMs = startedElapsed,
        bootCount = currentBoot,
        runStartedElapsedMs = if (resumeRecording) now else null,
        segmentIndex = session.segmentIndex + 1,
        lastHeartbeatElapsedMs = now,
        lastHeartbeatWallMs = System.currentTimeMillis(),
        lastFixElapsedMs = null,
        interruptionReason = null,
        stateBeforeInterruption = null
      )
    )
  }

  /** Closes the open recording interval at the last heartbeat; nothing after it is counted. */
  @Synchronized
  fun markInterrupted(context: Context, reason: String): TrackingSession? {
    val store = SessionStore(context)
    val session = store.load() ?: return null
    if (!session.isActive) return session
    val runClosedAt = session.lastHeartbeatElapsedMs
    val active = if (session.state == SessionState.RECORDING && session.runStartedElapsedMs != null) {
      session.accumulatedActiveMs + max(0L, runClosedAt - session.runStartedElapsedMs)
    } else {
      session.accumulatedActiveMs
    }
    return persist(
      store,
      session.copy(
        state = SessionState.INTERRUPTED,
        accumulatedActiveMs = active,
        runStartedElapsedMs = null,
        interruptionReason = reason,
        stateBeforeInterruption = session.state
      )
    )
  }

  /** Freezes the final durations. The session stays stored until JS has saved the activity. */
  @Synchronized
  fun finish(context: Context): TrackingSession? {
    val store = SessionStore(context)
    val session = store.load() ?: return null
    if (session.state == SessionState.FINISHED) return session
    val interrupted = session.state == SessionState.INTERRUPTED
    val now = SystemClock.elapsedRealtime()
    return persist(
      store,
      session.copy(
        state = SessionState.FINISHED,
        accumulatedActiveMs = session.activeMs(now),
        runStartedElapsedMs = null,
        finishedElapsedMs = if (interrupted) session.lastHeartbeatElapsedMs else now,
        finishedAtWallMs = if (interrupted) session.lastHeartbeatWallMs else System.currentTimeMillis()
      )
    )
  }

  @Synchronized
  fun clear(context: Context, activityId: Long?): Boolean {
    val store = SessionStore(context)
    val session = store.load()
    if (session != null && (activityId == null || session.activityId == activityId)) {
      store.clear()
    }
    TrackingJournal.get(context).clear(activityId)
    startPending = false
    return true
  }

  @Synchronized
  fun recordHeartbeat(context: Context, fixElapsedMs: Long?) {
    val store = SessionStore(context)
    val session = store.load() ?: return
    if (!session.isActive) return
    store.saveLazily(
      session.copy(
        lastHeartbeatElapsedMs = SystemClock.elapsedRealtime(),
        lastHeartbeatWallMs = System.currentTimeMillis(),
        lastFixElapsedMs = fixElapsedMs ?: session.lastFixElapsedMs
      )
    )
  }

  @Synchronized
  fun setDistance(context: Context, distanceMeters: Double): TrackingSession? {
    val store = SessionStore(context)
    val session = store.load() ?: return null
    if (!distanceMeters.isFinite() || distanceMeters < 0) return session
    val updated = session.copy(distanceMeters = distanceMeters)
    store.saveLazily(updated)
    return updated
  }

  /**
   * Called when the JS runtime starts. A session that claims to be recording while the
   * service is not running in this process was cut off (force-stop, OEM task killer, crash,
   * reboot or permission revocation).
   */
  @Synchronized
  fun detectInterruption(context: Context): TrackingSession? {
    val session = SessionStore(context).load() ?: return null
    if (!session.isActive || TrackingService.isRunning || startPending) return session
    val rebooted = session.bootCount != DeviceStatus.bootCount(context) ||
      SystemClock.elapsedRealtime() < session.lastHeartbeatElapsedMs
    val reason = when {
      rebooted -> "device_rebooted"
      !DeviceStatus.hasAnyLocationPermission(context) -> "permission_revoked"
      else -> "process_terminated"
    }
    return markInterrupted(context, reason)
  }

  private fun persist(store: SessionStore, session: TrackingSession): TrackingSession {
    if (!store.save(session)) {
      throw TrackingStateException("ERR_SESSION_WRITE", "Could not persist the tracking session to storage.")
    }
    return session
  }
}
