package expo.modules.androidlocation

import android.app.Activity
import android.content.ActivityNotFoundException
import android.content.Context
import android.content.Intent
import android.net.Uri
import android.os.Build
import android.os.Handler
import android.os.Looper
import android.provider.Settings
import androidx.core.content.ContextCompat
import com.google.android.gms.common.api.ResolvableApiException
import com.google.android.gms.location.LocationRequest
import com.google.android.gms.location.LocationServices
import com.google.android.gms.location.LocationSettingsRequest
import com.google.android.gms.location.Priority
import expo.modules.kotlin.Promise
import expo.modules.kotlin.exception.CodedException
import expo.modules.kotlin.exception.Exceptions
import expo.modules.kotlin.functions.Queues
import expo.modules.kotlin.modules.Module
import expo.modules.kotlin.modules.ModuleDefinition
import expo.modules.kotlin.records.Field
import expo.modules.kotlin.records.Record
import java.util.concurrent.atomic.AtomicBoolean

class StartTrackingOptions : Record {
  @Field
  val activityId: Double = 0.0

  @Field
  val activityType: String = "walk"

  @Field
  val intervalMs: Double = 1000.0

  @Field
  val openUri: String? = null

  @Field
  val finishUri: String? = null
}

/**
 * JS entry point. The module never records locations itself during a workout; it starts and
 * controls [TrackingService] and exposes the journal the service writes. The only location
 * updates owned by the module are the short-lived "preview" updates used to acquire a first fix
 * on the tracking screen before the user presses Start.
 */
class AndroidLocationModule : Module() {
  private val context: Context
    get() = appContext.reactContext?.applicationContext ?: throw Exceptions.ReactContextLost()

  private val mainHandler = Handler(Looper.getMainLooper())
  private var eventSink: ((String, Map<String, Any?>) -> Unit)? = null

  private var previewSource: LocationSource? = null
  private var previewRequested = false
  private var previewIntervalMs = 1000L

  private var pendingSettingsPromise: Promise? = null

  override fun definition() = ModuleDefinition {
    Name("AndroidLocation")

    Events(TrackingEvents.LOCATION_RECORDED, TrackingEvents.STATUS_CHANGED, TrackingEvents.PREVIEW_LOCATION)

    OnCreate {
      val sink: (String, Map<String, Any?>) -> Unit = { name, payload -> sendEvent(name, payload) }
      eventSink = sink
      TrackingEvents.sink = sink
      appContext.reactContext?.applicationContext?.let { TrackingController.detectInterruption(it) }
    }

    OnDestroy {
      if (TrackingEvents.sink === eventSink) TrackingEvents.sink = null
      stopPreview(clearRequest = true)
    }

    OnActivityEntersBackground {
      // Preview updates are foreground-only; the workout itself is recorded by the service.
      stopPreview(clearRequest = false)
    }

    OnActivityEntersForeground {
      if (previewRequested) startPreview()
    }

    OnActivityResult { _, payload ->
      if (payload.requestCode == REQUEST_LOCATION_SETTINGS) {
        pendingSettingsPromise?.resolve(payload.resultCode == Activity.RESULT_OK)
        pendingSettingsPromise = null
      }
    }

    AsyncFunction("getStatusAsync") {
      val ctx = context
      TrackingController.detectInterruption(ctx)
      TrackingService.statusSnapshot(ctx)
    }

    AsyncFunction("getDeviceStatusAsync") {
      DeviceStatus.snapshot(context)
    }

    AsyncFunction("startTrackingAsync") { options: StartTrackingOptions, promise: Promise ->
      val ctx = context
      if (!DeviceStatus.hasAnyLocationPermission(ctx)) {
        promise.reject("ERR_PERMISSION", "Location permission has not been granted.", null)
        return@AsyncFunction
      }
      if (!DeviceStatus.isLocationEnabled(ctx)) {
        promise.reject("ERR_LOCATION_DISABLED", "Location services are turned off.", null)
        return@AsyncFunction
      }
      if (options.activityId <= 0) {
        promise.reject("ERR_INVALID_ARGUMENT", "activityId must be a positive integer.", null)
        return@AsyncFunction
      }
      try {
        TrackingController.begin(
          ctx,
          activityId = options.activityId.toLong(),
          activityType = if (options.activityType == "run") "run" else "walk",
          intervalMs = options.intervalMs.toLong().coerceIn(MIN_INTERVAL_MS, MAX_INTERVAL_MS),
          openUri = options.openUri,
          finishUri = options.finishUri
        )
      } catch (error: TrackingStateException) {
        promise.reject(error.code, error.message, error)
        return@AsyncFunction
      }
      launchService(ctx, promise)
    }

    AsyncFunction("pauseTrackingAsync") {
      val ctx = context
      TrackingController.pause(ctx) ?: throw CodedException("ERR_NO_SESSION", "There is no active workout.", null)
      TrackingService.instance?.applySession()
      TrackingService.statusSnapshot(ctx)
    }

    AsyncFunction("resumeTrackingAsync") { promise: Promise ->
      val ctx = context
      val session = TrackingController.session(ctx)
      if (session == null || session.state == SessionState.FINISHED) {
        promise.reject("ERR_NO_SESSION", "There is no workout to resume.", null)
        return@AsyncFunction
      }
      if (TrackingService.isRunning && session.isActive) {
        TrackingController.resume(ctx)
        TrackingService.instance?.applySession()
        promise.resolve(TrackingService.statusSnapshot(ctx))
        return@AsyncFunction
      }
      // The service is gone (interrupted): restart it from this user action.
      if (!DeviceStatus.hasAnyLocationPermission(ctx)) {
        promise.reject("ERR_PERMISSION", "Location permission has not been granted.", null)
        return@AsyncFunction
      }
      if (!DeviceStatus.isLocationEnabled(ctx)) {
        promise.reject("ERR_LOCATION_DISABLED", "Location services are turned off.", null)
        return@AsyncFunction
      }
      try {
        if (session.isActive) TrackingController.markInterrupted(ctx, "service_stopped")
        TrackingController.recover(ctx, resumeRecording = true)
        TrackingController.startPending = true
      } catch (error: TrackingStateException) {
        promise.reject(error.code, error.message, error)
        return@AsyncFunction
      }
      launchService(ctx, promise)
    }

    AsyncFunction("finishTrackingAsync") {
      val ctx = context
      TrackingController.finish(ctx) ?: throw CodedException("ERR_NO_SESSION", "There is no workout to finish.", null)
      ctx.stopService(Intent(ctx, TrackingService::class.java))
      TrackingNotifications.cancelInterrupted(ctx)
      TrackingService.statusSnapshot(ctx)
    }

    AsyncFunction("discardTrackingAsync") {
      val ctx = context
      // Clear first: stopService is asynchronous, and a service destroyed while the session still
      // looks active would record it as "interrupted" just as it is being discarded.
      TrackingController.clear(ctx, null)
      ctx.stopService(Intent(ctx, TrackingService::class.java))
      TrackingNotifications.cancelInterrupted(ctx)
      TrackingService.statusSnapshot(ctx)
    }

    AsyncFunction("clearSessionAsync") { activityId: Double ->
      val ctx = context
      val session = TrackingController.session(ctx)
      if (session != null && session.activityId == activityId.toLong() && session.isActive) {
        throw CodedException("ERR_SESSION_ACTIVE", "Finish the workout before clearing it.", null)
      }
      TrackingController.clear(ctx, activityId.toLong())
      TrackingNotifications.cancelInterrupted(ctx)
      true
    }

    AsyncFunction("readJournalAsync") { activityId: Double, afterSequence: Double, limit: Int ->
      TrackingJournal.get(context).read(activityId.toLong(), afterSequence.toLong(), limit)
    }

    AsyncFunction("acknowledgeJournalAsync") { activityId: Double, upToSequence: Double ->
      TrackingJournal.get(context).acknowledge(activityId.toLong(), upToSequence.toLong())
    }

    AsyncFunction("updateNotificationAsync") { distanceMeters: Double ->
      TrackingController.setDistance(context, distanceMeters)
      TrackingService.instance?.requestNotificationRefresh()
      true
    }

    AsyncFunction("startPreviewAsync") { intervalMs: Double ->
      if (!DeviceStatus.hasAnyLocationPermission(context)) {
        throw CodedException("ERR_PERMISSION", "Location permission has not been granted.", null)
      }
      previewIntervalMs = intervalMs.toLong().coerceIn(MIN_INTERVAL_MS, MAX_INTERVAL_MS)
      previewRequested = true
      startPreview()
      true
    }.runOnQueue(Queues.MAIN)

    AsyncFunction("stopPreviewAsync") {
      stopPreview(clearRequest = true)
      true
    }.runOnQueue(Queues.MAIN)

    AsyncFunction("requestLocationSettingsAsync") { promise: Promise ->
      requestLocationSettings(promise)
    }.runOnQueue(Queues.MAIN)

    AsyncFunction("openAppSettingsAsync") {
      openSettings(Intent(Settings.ACTION_APPLICATION_DETAILS_SETTINGS, Uri.fromParts("package", context.packageName, null)))
    }.runOnQueue(Queues.MAIN)

    AsyncFunction("openLocationSettingsAsync") {
      openSettings(Intent(Settings.ACTION_LOCATION_SOURCE_SETTINGS))
    }.runOnQueue(Queues.MAIN)

    AsyncFunction("openBatteryOptimizationSettingsAsync") {
      openSettings(Intent(Settings.ACTION_IGNORE_BATTERY_OPTIMIZATION_SETTINGS))
    }.runOnQueue(Queues.MAIN)

    AsyncFunction("openNotificationSettingsAsync") {
      val intent = if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
        Intent(Settings.ACTION_APP_NOTIFICATION_SETTINGS).putExtra(Settings.EXTRA_APP_PACKAGE, context.packageName)
      } else {
        Intent(Settings.ACTION_APPLICATION_DETAILS_SETTINGS, Uri.fromParts("package", context.packageName, null))
      }
      openSettings(intent)
    }.runOnQueue(Queues.MAIN)
  }

  private fun launchService(ctx: Context, promise: Promise) {
    val settled = AtomicBoolean(false)
    val timeout = Runnable {
      if (settled.compareAndSet(false, true)) {
        TrackingService.startResultListener = null
        TrackingController.startPending = false
        promise.reject("ERR_SERVICE_TIMEOUT", "The tracking service did not start in time.", null)
      }
    }
    TrackingService.startResultListener = { errorCode, message ->
      if (settled.compareAndSet(false, true)) {
        mainHandler.removeCallbacks(timeout)
        if (errorCode == null) {
          promise.resolve(TrackingService.statusSnapshot(ctx))
        } else {
          promise.reject(errorCode, message, null)
        }
      }
    }
    try {
      ContextCompat.startForegroundService(ctx, TrackingService.intent(ctx, TrackingService.ACTION_START))
      mainHandler.postDelayed(timeout, SERVICE_START_TIMEOUT_MS)
    } catch (error: Exception) {
      // Android 12+ refuses foreground service starts while the app is not visible.
      settled.set(true)
      TrackingService.startResultListener = null
      TrackingController.startPending = false
      TrackingController.markInterrupted(ctx, "foreground_service_start_failed")
      promise.reject("ERR_FOREGROUND_SERVICE", error.message ?: "Could not start the tracking service.", error)
    }
  }

  private fun startPreview() {
    val ctx = appContext.reactContext?.applicationContext ?: return
    if (!DeviceStatus.hasAnyLocationPermission(ctx)) return
    val source = previewSource ?: createLocationSource(ctx).also { previewSource = it }
    source.start(
      previewIntervalMs,
      Looper.getMainLooper(),
      onLocation = { location ->
        sendEvent(TrackingEvents.PREVIEW_LOCATION, TrackingEvents.locationPayload(location) + mapOf("kind" to "location"))
      },
      onAvailability = { available ->
        sendEvent(TrackingEvents.PREVIEW_LOCATION, mapOf("kind" to "availability", "available" to available))
      },
      onError = { error ->
        sendEvent(TrackingEvents.PREVIEW_LOCATION, mapOf("kind" to "error", "message" to (error.message ?: "Location unavailable")))
      }
    )
  }

  private fun stopPreview(clearRequest: Boolean) {
    previewSource?.stop()
    if (clearRequest) previewRequested = false
  }

  private fun requestLocationSettings(promise: Promise) {
    val activity = appContext.currentActivity
    if (activity == null || !DeviceStatus.isPlayServicesAvailable(context)) {
      promise.resolve(DeviceStatus.isLocationEnabled(context))
      return
    }
    val request = LocationSettingsRequest.Builder()
      .addLocationRequest(LocationRequest.Builder(Priority.PRIORITY_HIGH_ACCURACY, 1000L).build())
      .setAlwaysShow(true)
      .build()
    LocationServices.getSettingsClient(activity).checkLocationSettings(request)
      .addOnSuccessListener { promise.resolve(true) }
      .addOnFailureListener { error ->
        if (error is ResolvableApiException) {
          try {
            pendingSettingsPromise?.resolve(false)
            pendingSettingsPromise = promise
            // Shows Google's "turn on location" dialog; the answer arrives in OnActivityResult.
            error.startResolutionForResult(activity, REQUEST_LOCATION_SETTINGS)
          } catch (_: Exception) {
            pendingSettingsPromise = null
            promise.resolve(DeviceStatus.isLocationEnabled(context))
          }
        } else {
          promise.resolve(DeviceStatus.isLocationEnabled(context))
        }
      }
  }

  private fun openSettings(intent: Intent): Boolean {
    intent.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK)
    return try {
      context.startActivity(intent)
      true
    } catch (_: ActivityNotFoundException) {
      false
    }
  }

  private companion object {
    const val REQUEST_LOCATION_SETTINGS = 41_101
    const val SERVICE_START_TIMEOUT_MS = 10_000L
    const val MIN_INTERVAL_MS = 500L
    const val MAX_INTERVAL_MS = 10_000L
  }
}
