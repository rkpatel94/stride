package expo.modules.androidlocation

import android.app.Service
import android.content.BroadcastReceiver
import android.content.Context
import android.content.Intent
import android.content.IntentFilter
import android.content.pm.ServiceInfo
import android.location.Location
import android.location.LocationManager
import android.os.Build
import android.os.Handler
import android.os.HandlerThread
import android.os.IBinder
import android.os.Looper
import android.os.SystemClock
import android.util.Log
import androidx.core.app.NotificationCompat
import androidx.core.app.ServiceCompat
import androidx.core.content.ContextCompat

/**
 * Foreground service (type "location") that owns GPS collection for an active workout.
 *
 * Lifecycle:
 *  - Started by the JS module from a user action while the app is visible (required for
 *    while-in-use location access on Android 11+ and FGS start rules on Android 12+).
 *  - Each fix is appended to [TrackingJournal] on a dedicated worker thread before anything else.
 *  - Pause stops location requests but keeps the service (and notification) alive so the user can
 *    resume from the notification. Finish/discard stop the service.
 *  - Auto-pause (if enabled) stops the active clock while the phone stands still; location updates
 *    keep running so movement can restart it.
 *  - Run/walk intervals switch the walk/run part and play cues at each phase change.
 *  - If the system kills and restarts the service (START_STICKY), recording only continues when
 *    Android allows location access from the background; otherwise the session is marked
 *    interrupted and the user is told to reopen the app.
 */
class TrackingService : Service() {
  private lateinit var worker: HandlerThread
  private lateinit var workerHandler: Handler
  private val mainHandler = Handler(Looper.getMainLooper())

  private var locationSource: LocationSource? = null
  private var collecting = false
  private var stopping = false
  private var receiversRegistered = false

  // Main thread only.
  private var cues: WorkoutCues? = null

  // Worker thread only: auto-pause detection and the last interval phase announced.
  private var stillSinceElapsed: Long? = null
  private var movingSinceElapsed: Long? = null
  private var movingFixes = 0
  private var announcedPhase: Int? = null
  private var lastWidgetRefreshElapsed = 0L

  // Live signal state, read by the module for status snapshots.
  @Volatile var signalLost = false
    private set
  @Volatile var gpsAvailable: Boolean? = null
    private set
  @Volatile var locationEnabled = true
    private set
  @Volatile var lowBattery = false
    private set
  @Volatile var lastAccuracyMeters: Float? = null
    private set
  val sourceName: String?
    get() = locationSource?.name

  private var lastNotifiedText: String? = null
  private var lastNotificationAtElapsed = 0L

  private val systemReceiver = object : BroadcastReceiver() {
    override fun onReceive(context: Context, intent: Intent) {
      when (intent.action) {
        LocationManager.PROVIDERS_CHANGED_ACTION -> workerHandler.post { checkHealth(force = true) }
        Intent.ACTION_BATTERY_LOW -> {
          lowBattery = true
          emitStatus()
        }
        Intent.ACTION_BATTERY_OKAY -> {
          lowBattery = false
          emitStatus()
        }
      }
    }
  }

  private val ticker = object : Runnable {
    override fun run() {
      checkHealth(force = false)
      workerHandler.postDelayed(this, TICK_INTERVAL_MS)
    }
  }

  private val intervalTicker = Runnable { scheduleIntervals() }

  override fun onBind(intent: Intent?): IBinder? = null

  override fun onCreate() {
    super.onCreate()
    isRunning = true
    instance = this
    worker = HandlerThread("StrideTrackingWorker").apply { start() }
    workerHandler = Handler(worker.looper)
    TrackingNotifications.ensureChannels(this)
    registerSystemReceivers()
  }

  override fun onStartCommand(intent: Intent?, flags: Int, startId: Int): Int {
    when (intent?.action) {
      ACTION_START -> handleStart()
      ACTION_PAUSE -> {
        TrackingController.pause(this)
        applySession()
      }
      ACTION_RESUME -> {
        TrackingController.resume(this)
        applySession()
      }
      ACTION_STOP -> stopEverything()
      ACTION_APPLY -> applySession()
      null -> handleSystemRestart()
      else -> Log.w(TAG, "Unknown action ${intent.action}")
    }
    return START_STICKY
  }

  private fun handleStart() {
    val session = TrackingController.session(this)
    if (session == null || !session.isActive) {
      reportStartResult("ERR_NO_SESSION", "There is no workout to record.")
      stopEverything()
      return
    }
    if (!promoteToForeground(session)) return
    TrackingNotifications.cancelInterrupted(this)
    applySession()
    reportStartResult(null, null)
  }

  /** Restart by the system after the process was killed while a workout was active. */
  private fun handleSystemRestart() {
    val session = TrackingController.session(this)
    if (session == null || !session.isActive) {
      stopEverything()
      return
    }
    TrackingController.markInterrupted(this, "process_terminated")
    // Android 11+ only grants location to a service started in the background when the user
    // granted "Allow all the time", which this app deliberately does not request.
    val mayRecordFromBackground = Build.VERSION.SDK_INT < Build.VERSION_CODES.R ||
      DeviceStatus.hasBackgroundLocation(this)
    if (!mayRecordFromBackground || !DeviceStatus.hasAnyLocationPermission(this)) {
      TrackingController.session(this)?.let { TrackingNotifications.showInterrupted(this, it) }
      emitStatus()
      StrideWidget.refresh(this)
      stopEverything()
      return
    }
    val recovered = TrackingController.recover(this, resumeRecording = session.state == SessionState.RECORDING)
      ?: return stopEverything()
    if (!promoteToForeground(recovered)) return
    applySession()
  }

  private fun promoteToForeground(session: TrackingSession): Boolean {
    return try {
      val notification = TrackingNotifications.build(this, session, liveSignal(), SystemClock.elapsedRealtime())
      val type = if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.Q) {
        ServiceInfo.FOREGROUND_SERVICE_TYPE_LOCATION
      } else {
        0
      }
      ServiceCompat.startForeground(this, TrackingNotifications.TRACKING_NOTIFICATION_ID, notification, type)
      true
    } catch (error: Exception) {
      // ForegroundServiceStartNotAllowedException (12+) or SecurityException (14+ without
      // while-in-use location eligibility).
      Log.e(TAG, "Could not start the location foreground service", error)
      val interrupted = TrackingController.markInterrupted(this, "foreground_service_start_failed")
      interrupted?.let { TrackingNotifications.showInterrupted(this, it) }
      reportStartResult("ERR_FOREGROUND_SERVICE", error.message ?: error.javaClass.simpleName)
      emitStatus()
      stopEverything()
      false
    }
  }

  /** Brings location collection, intervals and the notification in line with the persisted session. */
  fun applySession() {
    if (Looper.myLooper() != Looper.getMainLooper()) {
      mainHandler.post { applySession() }
      return
    }
    val session = TrackingController.session(this)
    if (session == null || !session.isActive) {
      if (!stopping) stopEverything()
      return
    }
    if (session.state == SessionState.RECORDING) startCollecting(session) else stopCollecting()
    // The heartbeat also runs while paused so an interruption is dated accurately.
    workerHandler.removeCallbacks(ticker)
    workerHandler.postDelayed(ticker, TICK_INTERVAL_MS)
    workerHandler.post {
      resetMotionDetection()
      scheduleIntervals()
    }
    refreshNotification(force = true)
    emitStatus()
    StrideWidget.refresh(this)
  }

  private fun startCollecting(session: TrackingSession) {
    if (collecting) return
    if (!DeviceStatus.hasAnyLocationPermission(this)) {
      TrackingController.markInterrupted(this, "permission_revoked")
      TrackingController.session(this)?.let { TrackingNotifications.showInterrupted(this, it) }
      emitStatus()
      stopEverything()
      return
    }
    val source = locationSource ?: createLocationSource(this).also { locationSource = it }
    signalLost = false
    collecting = true
    source.start(
      session.intervalMs,
      worker.looper,
      onLocation = ::onLocation,
      onAvailability = { available ->
        gpsAvailable = available
        emitStatus()
      },
      onError = { error ->
        Log.e(TAG, "Location updates failed", error)
        TrackingEvents.emit(
          TrackingEvents.STATUS_CHANGED,
          statusSnapshot(this) + mapOf("error" to (error.message ?: "Location updates failed"))
        )
      }
    )
  }

  private fun stopCollecting() {
    locationSource?.stop()
    collecting = false
    signalLost = false
  }

  /** Runs on the worker thread. The journal write happens before anything that could fail. */
  private fun onLocation(location: Location) {
    val session = TrackingController.session(this) ?: return
    if (session.state != SessionState.RECORDING) return
    val sequence = try {
      TrackingJournal.get(this).append(session.activityId, session.segmentIndex, session.activityType, location)
    } catch (error: Exception) {
      Log.e(TAG, "Could not write location to the journal", error)
      TrackingEvents.emit(
        TrackingEvents.STATUS_CHANGED,
        statusSnapshot(this) + mapOf("error" to "Could not save a GPS point: ${error.message}")
      )
      return
    }
    val fixElapsed = location.elapsedRealtimeNanos / 1_000_000L
    TrackingController.recordHeartbeat(this, fixElapsed)
    lastAccuracyMeters = if (location.hasAccuracy()) location.accuracy else null
    val wasLost = signalLost
    signalLost = false
    TrackingEvents.emit(
      TrackingEvents.LOCATION_RECORDED,
      TrackingEvents.locationPayload(location) + mapOf(
        "sequence" to sequence.toDouble(),
        "activityId" to session.activityId.toDouble(),
        "segmentIndex" to session.segmentIndex,
        "activityType" to session.activityType
      )
    )
    val changed = detectAutoPause(session, location, fixElapsed)
    // Interval phases follow the active clock; checking on every fix keeps them on time even if
    // the timer is delayed while the phone sleeps between fixes.
    scheduleIntervals()
    if (wasLost || changed) emitStatus()
    refreshNotification(force = wasLost || changed)
    refreshWidgetThrottled()
  }

  /**
   * Worker thread. Stops the active clock after [STOP_AFTER_MS] below walking speed, dated from
   * when the phone stopped; restarts it after [MOVE_CONFIRMATIONS] fixes at walking speed, dated
   * from the first of them. Returns true when the state changed.
   */
  private fun detectAutoPause(session: TrackingSession, location: Location, fixElapsed: Long): Boolean {
    if (!session.autoPauseEnabled || !location.hasSpeed()) return false
    val speed = location.speed
    if (!session.autoPaused) {
      movingFixes = 0
      if (speed >= STOP_SPEED_MPS) {
        stillSinceElapsed = null
        return false
      }
      val since = stillSinceElapsed ?: fixElapsed.also { stillSinceElapsed = it }
      if (fixElapsed - since < STOP_AFTER_MS) return false
      stillSinceElapsed = null
      TrackingController.setAutoPaused(this, true, since)
      return true
    }
    stillSinceElapsed = null
    if (speed < MOVE_SPEED_MPS) {
      movingFixes = 0
      return false
    }
    if (movingFixes == 0) movingSinceElapsed = fixElapsed
    movingFixes += 1
    if (movingFixes < MOVE_CONFIRMATIONS) return false
    movingFixes = 0
    TrackingController.setAutoPaused(this, false, movingSinceElapsed ?: fixElapsed)
    return true
  }

  private fun resetMotionDetection() {
    stillSinceElapsed = null
    movingSinceElapsed = null
    movingFixes = 0
  }

  /**
   * Worker thread. Announces the current interval phase when it changed (switching the walk/run
   * part to match) and waits for the next change. The interval clock is the active clock, so it
   * stands still while paused or auto-paused.
   */
  private fun scheduleIntervals() {
    workerHandler.removeCallbacks(intervalTicker)
    val session = TrackingController.session(this) ?: return
    val plan = session.intervals ?: return
    if (!session.isActive) return
    val active = session.activeMs(SystemClock.elapsedRealtime())
    val phase = plan.phaseAt(active)
    if (announcedPhase != phase) announcePhase(session, plan, phase)
    if (session.state != SessionState.RECORDING || session.autoPaused) return
    val wait = plan.msToNextPhase(active) ?: return
    workerHandler.postDelayed(intervalTicker, wait + PHASE_MARGIN_MS)
  }

  private fun announcePhase(session: TrackingSession, plan: IntervalPlan, phase: Int) {
    announcedPhase = phase
    val done = phase >= plan.repeats * 2
    val running = phase % 2 == 0
    val round = phase / 2 + 1
    if (!done) {
      val type = if (running) "run" else "walk"
      if (session.activityType != type) TrackingController.switchType(this, type)
    }
    val text = when {
      done -> "Intervals done. Keep going, or finish when you're ready."
      running -> "Run for ${WorkoutCues.spokenDuration(plan.runMs)}. Round $round of ${plan.repeats}."
      round == plan.repeats -> "Last walk, ${WorkoutCues.spokenDuration(plan.walkMs)}."
      else -> "Walk for ${WorkoutCues.spokenDuration(plan.walkMs)}."
    }
    val pattern = when {
      done -> WorkoutCues.Pattern.DONE
      running -> WorkoutCues.Pattern.RUN
      else -> WorkoutCues.Pattern.WALK
    }
    mainHandler.post { (cues ?: WorkoutCues(this).also { cues = it }).cue(text, pattern) }
    emitStatus()
    refreshNotification(force = true)
    StrideWidget.refresh(this)
  }

  /** Periodic heartbeat plus detection of GPS loss and location services being switched off. */
  private fun checkHealth(force: Boolean) {
    val session = TrackingController.session(this) ?: return
    if (!session.isActive) return
    TrackingController.recordHeartbeat(this, null)
    val now = SystemClock.elapsedRealtime()
    val enabled = DeviceStatus.isLocationEnabled(this)
    // Measured from the later of the last fix and the (re)start of recording, so a fix from
    // before a pause doesn't make a fresh resume look like signal loss.
    val reference = maxOf(session.lastFixElapsedMs ?: 0L, session.runStartedElapsedMs ?: 0L)
    val lost = session.state == SessionState.RECORDING && reference > 0L &&
      now - reference > SIGNAL_LOST_AFTER_MS
    val changed = enabled != locationEnabled || lost != signalLost
    locationEnabled = enabled
    signalLost = lost
    if (changed || force) {
      emitStatus()
      refreshNotification(force = true)
    } else {
      refreshNotification(force = false)
    }
  }

  /** Called when JS reports a new distance; rate-limited inside [refreshNotification]. */
  fun requestNotificationRefresh() {
    mainHandler.post { refreshNotification(force = false) }
  }

  private fun refreshNotification(force: Boolean) {
    val session = TrackingController.session(this) ?: return
    if (!session.isActive) return
    val now = SystemClock.elapsedRealtime()
    val notification = TrackingNotifications.build(this, session, liveSignal(), now)
    val text = notification.extras?.getCharSequence(NotificationCompat.EXTRA_TEXT)?.toString()
    // Re-post only when the text changed, and at most every few seconds; the chronometer ticks itself.
    val due = now - lastNotificationAtElapsed >= MIN_NOTIFICATION_INTERVAL_MS
    if (force || (text != lastNotifiedText && due)) {
      TrackingNotifications.notify(this, notification)
      lastNotifiedText = text
      lastNotificationAtElapsed = now
    }
  }

  private fun refreshWidgetThrottled() {
    val now = SystemClock.elapsedRealtime()
    if (now - lastWidgetRefreshElapsed < WIDGET_REFRESH_INTERVAL_MS) return
    lastWidgetRefreshElapsed = now
    StrideWidget.refresh(this)
  }

  private fun liveSignal() = LiveSignal(
    locationEnabled = locationEnabled,
    signalLost = signalLost,
    lastAccuracyMeters = lastAccuracyMeters
  )

  private fun emitStatus() {
    TrackingEvents.emit(TrackingEvents.STATUS_CHANGED, statusSnapshot(this))
  }

  private fun stopEverything() {
    stopping = true
    stopCollecting()
    if (::workerHandler.isInitialized) workerHandler.removeCallbacksAndMessages(null)
    ServiceCompat.stopForeground(this, ServiceCompat.STOP_FOREGROUND_REMOVE)
    stopSelf()
  }

  private fun registerSystemReceivers() {
    val filter = IntentFilter().apply {
      addAction(LocationManager.PROVIDERS_CHANGED_ACTION)
      addAction(Intent.ACTION_BATTERY_LOW)
      addAction(Intent.ACTION_BATTERY_OKAY)
    }
    ContextCompat.registerReceiver(this, systemReceiver, filter, ContextCompat.RECEIVER_NOT_EXPORTED)
    receiversRegistered = true
  }

  override fun onDestroy() {
    stopCollecting()
    if (receiversRegistered) {
      unregisterReceiver(systemReceiver)
      receiversRegistered = false
    }
    workerHandler.removeCallbacksAndMessages(null)
    worker.quitSafely()
    cues?.shutdown()
    cues = null
    isRunning = false
    instance = null
    // Destroyed while the workout is still active and nobody asked us to stop: the system took
    // the service away. Persist that so the app can offer recovery.
    val session = TrackingController.session(this)
    if (session != null && session.isActive && !stopping) {
      TrackingController.markInterrupted(this, "service_stopped")
    }
    emitStatus()
    StrideWidget.refresh(this)
    super.onDestroy()
  }

  private fun reportStartResult(errorCode: String?, message: String?) {
    TrackingController.startPending = false
    val listener = startResultListener
    startResultListener = null
    listener?.invoke(errorCode, message)
  }

  companion object {
    const val ACTION_START = "expo.modules.androidlocation.action.START"
    const val ACTION_PAUSE = "expo.modules.androidlocation.action.PAUSE"
    const val ACTION_RESUME = "expo.modules.androidlocation.action.RESUME"
    const val ACTION_STOP = "expo.modules.androidlocation.action.STOP"
    const val ACTION_APPLY = "expo.modules.androidlocation.action.APPLY"

    private const val TAG = "StrideTracking"
    private const val TICK_INTERVAL_MS = 5_000L
    private const val SIGNAL_LOST_AFTER_MS = 10_000L
    private const val MIN_NOTIFICATION_INTERVAL_MS = 5_000L
    private const val WIDGET_REFRESH_INTERVAL_MS = 15_000L

    // Auto-pause: below STOP_SPEED for STOP_AFTER_MS stops the clock; MOVE_CONFIRMATIONS fixes at
    // MOVE_SPEED or more restart it. The gap between the two speeds keeps GPS jitter from flapping.
    private const val STOP_SPEED_MPS = 0.35f
    private const val STOP_AFTER_MS = 8_000L
    private const val MOVE_SPEED_MPS = 0.7f
    private const val MOVE_CONFIRMATIONS = 2

    private const val PHASE_MARGIN_MS = 25L

    @Volatile
    var isRunning = false
      private set

    @Volatile
    var instance: TrackingService? = null
      private set

    /** One-shot callback used by startTrackingAsync to learn whether promotion succeeded. */
    @Volatile
    var startResultListener: ((errorCode: String?, message: String?) -> Unit)? = null

    fun intent(context: Context, action: String): Intent =
      Intent(context, TrackingService::class.java).setAction(action)

    fun statusSnapshot(context: Context): Map<String, Any?> {
      val session = TrackingController.session(context)
      val now = SystemClock.elapsedRealtime()
      val service = instance
      val pending = session?.let {
        try {
          TrackingJournal.get(context).pendingCount(it.activityId)
        } catch (_: Exception) {
          null
        }
      }
      return mapOf(
        "hasSession" to (session != null),
        "serviceRunning" to isRunning,
        "activityId" to session?.activityId?.toDouble(),
        "activityType" to session?.activityType,
        "state" to (session?.state?.value ?: "idle"),
        "elapsedMs" to session?.elapsedMs(now)?.toDouble(),
        "activeMs" to session?.activeMs(now)?.toDouble(),
        "runActiveMs" to session?.runActiveMs(now)?.toDouble(),
        "autoPaused" to (session?.autoPaused ?: false),
        "autoPauseEnabled" to (session?.autoPauseEnabled ?: false),
        "intervalRunMs" to session?.intervals?.runMs?.toDouble(),
        "intervalWalkMs" to session?.intervals?.walkMs?.toDouble(),
        "intervalRepeats" to session?.intervals?.repeats,
        "startedAtWallMs" to session?.startedAtWallMs?.toDouble(),
        "finishedAtWallMs" to session?.finishedAtWallMs?.toDouble(),
        "segmentIndex" to session?.segmentIndex,
        "lastFixAgeMs" to session?.lastFixElapsedMs?.let { (now - it).toDouble() },
        "interruptionReason" to session?.interruptionReason,
        "stateBeforeInterruption" to session?.stateBeforeInterruption?.value,
        "pendingJournalPoints" to pending,
        "gpsAvailable" to service?.gpsAvailable,
        "signalLost" to (service?.signalLost ?: false),
        "locationServicesEnabled" to DeviceStatus.isLocationEnabled(context),
        "lowBattery" to (service?.lowBattery ?: false),
        "locationSource" to service?.sourceName
      )
    }
  }
}
