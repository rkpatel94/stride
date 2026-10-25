package expo.modules.androidlocation

import android.app.Notification
import android.app.NotificationChannel
import android.app.NotificationManager
import android.app.PendingIntent
import android.content.Context
import android.content.Intent
import android.net.Uri
import android.os.Build
import androidx.core.app.NotificationCompat
import androidx.core.app.NotificationManagerCompat
import java.util.Locale
import kotlin.math.roundToInt

/** What the tracking notification needs to know besides the persisted session. */
data class LiveSignal(
  val locationEnabled: Boolean,
  val signalLost: Boolean,
  val lastAccuracyMeters: Float?
)

object TrackingNotifications {
  const val TRACKING_CHANNEL_ID = "stride_tracking"
  private const val ALERT_CHANNEL_ID = "stride_alerts"
  const val TRACKING_NOTIFICATION_ID = 41001
  private const val INTERRUPTED_NOTIFICATION_ID = 41002

  fun ensureChannels(context: Context) {
    if (Build.VERSION.SDK_INT < Build.VERSION_CODES.O) return
    val manager = context.getSystemService(NotificationManager::class.java) ?: return
    manager.createNotificationChannel(
      NotificationChannel(TRACKING_CHANNEL_ID, "Workout tracking", NotificationManager.IMPORTANCE_LOW).apply {
        description = "Shown while a walk or run is being recorded."
        setShowBadge(false)
      }
    )
    manager.createNotificationChannel(
      NotificationChannel(ALERT_CHANNEL_ID, "Tracking alerts", NotificationManager.IMPORTANCE_DEFAULT).apply {
        description = "Tells you when recording stopped unexpectedly."
      }
    )
  }

  fun build(context: Context, session: TrackingSession, signal: LiveSignal, nowElapsedMs: Long): Notification {
    val activityName = if (session.activityType == "run") "Running" else "Walking"
    val activeMs = session.activeMs(nowElapsedMs)
    val distance = formatDistance(session.distanceMeters)
    val title = when (session.state) {
      SessionState.PAUSED -> "$activityName · paused"
      else -> activityName
    }
    val text = when {
      !signal.locationEnabled -> "Location is turned off. Distance is not being recorded."
      session.state == SessionState.PAUSED -> "$distance · ${formatDuration(activeMs)} active"
      signal.signalLost -> "$distance · waiting for GPS signal…"
      signal.lastAccuracyMeters != null -> "$distance · GPS ±${signal.lastAccuracyMeters.roundToInt()} m"
      else -> "$distance · acquiring GPS…"
    }

    val builder = NotificationCompat.Builder(context, TRACKING_CHANNEL_ID)
      .setSmallIcon(R.drawable.stride_ic_tracking)
      .setContentTitle(title)
      .setContentText(text)
      .setOngoing(true)
      .setOnlyAlertOnce(true)
      .setSilent(true)
      .setCategory(NotificationCompat.CATEGORY_WORKOUT)
      .setPriority(NotificationCompat.PRIORITY_LOW)
      .setVisibility(NotificationCompat.VISIBILITY_PUBLIC)
      .setForegroundServiceBehavior(NotificationCompat.FOREGROUND_SERVICE_IMMEDIATE)
      .setContentIntent(openAppIntent(context, session.openUri, REQUEST_OPEN))

    if (session.state == SessionState.RECORDING) {
      // The system chronometer ticks the active time without us re-posting every second.
      builder.setUsesChronometer(true)
        .setShowWhen(true)
        .setWhen(System.currentTimeMillis() - activeMs)
      builder.addAction(0, "Pause", serviceIntent(context, TrackingService.ACTION_PAUSE, REQUEST_PAUSE))
    } else {
      builder.setUsesChronometer(false).setShowWhen(false)
      builder.addAction(0, "Resume", serviceIntent(context, TrackingService.ACTION_RESUME, REQUEST_RESUME))
    }
    // Finishing opens the app and asks for confirmation, so a pocket tap can't end a workout.
    builder.addAction(0, "Finish", openAppIntent(context, session.finishUri ?: session.openUri, REQUEST_FINISH))
    return builder.build()
  }

  fun notify(context: Context, notification: Notification) {
    if (!NotificationManagerCompat.from(context).areNotificationsEnabled()) return
    try {
      NotificationManagerCompat.from(context).notify(TRACKING_NOTIFICATION_ID, notification)
    } catch (_: SecurityException) {
      // POST_NOTIFICATIONS revoked; the foreground service keeps running regardless.
    }
  }

  fun showInterrupted(context: Context, session: TrackingSession) {
    ensureChannels(context)
    if (!NotificationManagerCompat.from(context).areNotificationsEnabled()) return
    val activityName = if (session.activityType == "run") "run" else "walk"
    val notification = NotificationCompat.Builder(context, ALERT_CHANNEL_ID)
      .setSmallIcon(R.drawable.stride_ic_tracking)
      .setContentTitle("Recording stopped")
      .setContentText("Your $activityName was interrupted. Open the app to resume or save it.")
      .setAutoCancel(true)
      .setCategory(NotificationCompat.CATEGORY_STATUS)
      .setContentIntent(openAppIntent(context, session.openUri, REQUEST_OPEN))
      .build()
    try {
      NotificationManagerCompat.from(context).notify(INTERRUPTED_NOTIFICATION_ID, notification)
    } catch (_: SecurityException) {
    }
  }

  fun cancelInterrupted(context: Context) {
    NotificationManagerCompat.from(context).cancel(INTERRUPTED_NOTIFICATION_ID)
  }

  private fun openAppIntent(context: Context, uri: String?, requestCode: Int): PendingIntent {
    val intent = if (uri != null) {
      Intent(Intent.ACTION_VIEW, Uri.parse(uri)).setPackage(context.packageName)
    } else {
      context.packageManager.getLaunchIntentForPackage(context.packageName) ?: Intent()
    }
    intent.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK or Intent.FLAG_ACTIVITY_SINGLE_TOP)
    return PendingIntent.getActivity(
      context,
      requestCode,
      intent,
      PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_IMMUTABLE
    )
  }

  private fun serviceIntent(context: Context, action: String, requestCode: Int): PendingIntent =
    PendingIntent.getService(
      context,
      requestCode,
      TrackingService.intent(context, action),
      PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_IMMUTABLE
    )

  private fun formatDistance(meters: Double): String =
    if (meters < 1000) {
      "${meters.roundToInt()} m"
    } else {
      String.format(Locale.US, "%.2f km", meters / 1000.0)
    }

  private fun formatDuration(ms: Long): String {
    val totalSeconds = ms / 1000
    val hours = totalSeconds / 3600
    val minutes = (totalSeconds % 3600) / 60
    val seconds = totalSeconds % 60
    return if (hours > 0) {
      String.format(Locale.US, "%d:%02d:%02d", hours, minutes, seconds)
    } else {
      String.format(Locale.US, "%d:%02d", minutes, seconds)
    }
  }

  private const val REQUEST_OPEN = 1
  private const val REQUEST_PAUSE = 2
  private const val REQUEST_RESUME = 3
  private const val REQUEST_FINISH = 4
}
