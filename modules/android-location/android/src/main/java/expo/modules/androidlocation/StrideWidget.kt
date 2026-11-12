package expo.modules.androidlocation

import android.app.PendingIntent
import android.appwidget.AppWidgetManager
import android.appwidget.AppWidgetProvider
import android.content.ComponentName
import android.content.Context
import android.content.Intent
import android.net.Uri
import android.view.View
import android.widget.RemoteViews
import java.text.SimpleDateFormat
import java.util.Date
import java.util.Locale
import kotlin.math.roundToInt

/** The home-screen widget; Android sends it update broadcasts (every 30 min and when added). */
class StrideWidgetProvider : AppWidgetProvider() {
  override fun onUpdate(context: Context, appWidgetManager: AppWidgetManager, appWidgetIds: IntArray) {
    StrideWidget.refresh(context)
  }
}

/**
 * Today's distance, the daily goal and quick start buttons. The app pushes today's completed
 * distance and goal (JS reads them from its database) with [save]; a workout in progress comes
 * from the tracking session, so the widget stays live while recording.
 */
object StrideWidget {
  private const val PREFS = "stride_widget"
  private const val DEFAULT_SCHEME = "stride"

  private const val REQUEST_OPEN = 101
  private const val REQUEST_WALK = 102
  private const val REQUEST_RUN = 103
  private const val REQUEST_WORKOUT = 104

  fun save(context: Context, summary: Map<String, Any?>) {
    context.getSharedPreferences(PREFS, Context.MODE_PRIVATE).edit()
      .putString("dayKey", summary["dayKey"] as? String)
      .putLong("todayMetersBits", java.lang.Double.doubleToRawLongBits((summary["todayMeters"] as? Number)?.toDouble() ?: 0.0))
      .putLong("goalMetersBits", java.lang.Double.doubleToRawLongBits((summary["goalMeters"] as? Number)?.toDouble() ?: 0.0))
      .putString("scheme", summary["scheme"] as? String)
      .apply()
  }

  fun refresh(context: Context) {
    val manager = AppWidgetManager.getInstance(context) ?: return
    val ids = manager.getAppWidgetIds(ComponentName(context, StrideWidgetProvider::class.java))
    if (ids.isEmpty()) return
    manager.updateAppWidget(ids, build(context))
  }

  private fun build(context: Context): RemoteViews {
    val prefs = context.getSharedPreferences(PREFS, Context.MODE_PRIVATE)
    val today = SimpleDateFormat("yyyy-MM-dd", Locale.US).format(Date())
    val known = prefs.getString("dayKey", null)
    // The saved total is for the day it was written; after midnight it no longer counts.
    val completedToday = if (known == today) java.lang.Double.longBitsToDouble(prefs.getLong("todayMetersBits", 0L)) else 0.0
    val goal = java.lang.Double.longBitsToDouble(prefs.getLong("goalMetersBits", 0L))
    val scheme = prefs.getString("scheme", null) ?: DEFAULT_SCHEME

    val session = TrackingController.session(context)
    val live = session?.takeIf { it.isActive || it.state == SessionState.INTERRUPTED }
    val liveToday = if (live != null && SimpleDateFormat("yyyy-MM-dd", Locale.US).format(Date(live.startedAtWallMs)) == today) {
      live.distanceMeters
    } else {
      0.0
    }
    val total = completedToday + liveToday

    val views = RemoteViews(context.packageName, R.layout.stride_widget)
    views.setTextViewText(R.id.stride_widget_distance, formatKm(total))
    if (goal > 0) {
      val fraction = (total / goal).coerceIn(0.0, 1.0)
      views.setViewVisibility(R.id.stride_widget_progress, View.VISIBLE)
      views.setProgressBar(R.id.stride_widget_progress, 1000, (fraction * 1000).roundToInt(), false)
      views.setTextViewText(
        R.id.stride_widget_goal,
        if (total >= goal) "Daily goal reached · ${formatKm(goal)}" else "${(fraction * 100).roundToInt()}% of ${formatKm(goal)} daily goal"
      )
    } else {
      views.setViewVisibility(R.id.stride_widget_progress, View.GONE)
      views.setTextViewText(R.id.stride_widget_goal, if (known == null) "Open Stride to see today's distance" else "No daily goal set")
    }

    views.setOnClickPendingIntent(R.id.stride_widget_root, open(context, "$scheme://", REQUEST_OPEN))
    if (live != null) {
      val name = if (live.activityType == "run") "Running" else "Walking"
      val line = when {
        live.state == SessionState.INTERRUPTED -> "Workout interrupted · tap to resume or save"
        live.state == SessionState.PAUSED -> "$name · paused · ${formatKm(live.distanceMeters)}"
        live.autoPaused -> "$name · auto-paused · ${formatKm(live.distanceMeters)}"
        else -> "$name · ${formatKm(live.distanceMeters)}"
      }
      views.setViewVisibility(R.id.stride_widget_session, View.VISIBLE)
      views.setTextViewText(R.id.stride_widget_session, line)
      views.setViewVisibility(R.id.stride_widget_buttons, View.GONE)
      views.setViewVisibility(R.id.stride_widget_open, View.VISIBLE)
      views.setOnClickPendingIntent(R.id.stride_widget_open, open(context, "$scheme://track", REQUEST_WORKOUT))
    } else {
      views.setViewVisibility(R.id.stride_widget_session, View.GONE)
      views.setViewVisibility(R.id.stride_widget_buttons, View.VISIBLE)
      views.setViewVisibility(R.id.stride_widget_open, View.GONE)
      // Starting a workout needs the app on screen (location while in use), so the buttons open
      // the Track screen, which starts as soon as GPS is accurate enough.
      views.setOnClickPendingIntent(R.id.stride_widget_walk, open(context, "$scheme://track?start=walk", REQUEST_WALK))
      views.setOnClickPendingIntent(R.id.stride_widget_run, open(context, "$scheme://track?start=run", REQUEST_RUN))
    }
    return views
  }

  private fun open(context: Context, uri: String, requestCode: Int): PendingIntent {
    val intent = Intent(Intent.ACTION_VIEW, Uri.parse(uri))
      .setPackage(context.packageName)
      .addFlags(Intent.FLAG_ACTIVITY_NEW_TASK or Intent.FLAG_ACTIVITY_SINGLE_TOP)
    return PendingIntent.getActivity(context, requestCode, intent, PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_IMMUTABLE)
  }

  private fun formatKm(meters: Double): String {
    val km = meters.coerceAtLeast(0.0) / 1000.0
    return when {
      km < 10 -> String.format(Locale.US, "%.2f km", km)
      km < 100 -> String.format(Locale.US, "%.1f km", km)
      else -> "${km.roundToInt()} km"
    }
  }
}
