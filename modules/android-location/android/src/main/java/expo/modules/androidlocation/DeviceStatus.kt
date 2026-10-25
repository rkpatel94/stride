package expo.modules.androidlocation

import android.Manifest
import android.content.Context
import android.content.pm.PackageManager
import android.location.LocationManager
import android.os.BatteryManager
import android.os.Build
import android.os.PowerManager
import android.provider.Settings
import androidx.core.app.NotificationManagerCompat
import androidx.core.content.ContextCompat
import androidx.core.location.LocationManagerCompat
import com.google.android.gms.common.ConnectionResult
import com.google.android.gms.common.GoogleApiAvailability

/** Read-only checks of permissions, location settings and power state. */
object DeviceStatus {
  fun hasPermission(context: Context, permission: String): Boolean =
    ContextCompat.checkSelfPermission(context, permission) == PackageManager.PERMISSION_GRANTED

  fun hasFineLocation(context: Context) = hasPermission(context, Manifest.permission.ACCESS_FINE_LOCATION)

  fun hasCoarseLocation(context: Context) = hasPermission(context, Manifest.permission.ACCESS_COARSE_LOCATION)

  fun hasAnyLocationPermission(context: Context) = hasFineLocation(context) || hasCoarseLocation(context)

  fun hasBackgroundLocation(context: Context): Boolean =
    if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.Q) {
      hasPermission(context, Manifest.permission.ACCESS_BACKGROUND_LOCATION)
    } else {
      hasAnyLocationPermission(context)
    }

  fun notificationsEnabled(context: Context): Boolean =
    NotificationManagerCompat.from(context).areNotificationsEnabled()

  private fun locationManager(context: Context) =
    context.getSystemService(Context.LOCATION_SERVICE) as LocationManager

  fun isLocationEnabled(context: Context): Boolean =
    LocationManagerCompat.isLocationEnabled(locationManager(context))

  private fun isProviderEnabled(context: Context, provider: String): Boolean =
    try {
      locationManager(context).isProviderEnabled(provider)
    } catch (_: Exception) {
      false
    }

  fun isPlayServicesAvailable(context: Context): Boolean =
    try {
      GoogleApiAvailability.getInstance().isGooglePlayServicesAvailable(context) == ConnectionResult.SUCCESS
    } catch (_: Exception) {
      false
    }

  private fun powerManager(context: Context) = context.getSystemService(Context.POWER_SERVICE) as PowerManager

  fun isPowerSaveMode(context: Context): Boolean = powerManager(context).isPowerSaveMode

  /** PowerManager.LOCATION_MODE_* while battery saver is on; 0 (no change) otherwise. */
  fun locationPowerSaveMode(context: Context): Int =
    if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.P && isPowerSaveMode(context)) {
      powerManager(context).locationPowerSaveMode
    } else {
      0
    }

  fun isIgnoringBatteryOptimizations(context: Context): Boolean =
    powerManager(context).isIgnoringBatteryOptimizations(context.packageName)

  fun batteryPercent(context: Context): Int? {
    val manager = context.getSystemService(Context.BATTERY_SERVICE) as? BatteryManager ?: return null
    val value = manager.getIntProperty(BatteryManager.BATTERY_PROPERTY_CAPACITY)
    return if (value in 0..100) value else null
  }

  fun bootCount(context: Context): Int =
    try {
      Settings.Global.getInt(context.contentResolver, Settings.Global.BOOT_COUNT)
    } catch (_: Exception) {
      -1
    }

  fun snapshot(context: Context): Map<String, Any?> = mapOf(
    "sdkInt" to Build.VERSION.SDK_INT,
    "hasFineLocation" to hasFineLocation(context),
    "hasCoarseLocation" to hasCoarseLocation(context),
    "hasBackgroundLocation" to hasBackgroundLocation(context),
    "notificationsEnabled" to notificationsEnabled(context),
    "locationEnabled" to isLocationEnabled(context),
    "gpsProviderEnabled" to isProviderEnabled(context, LocationManager.GPS_PROVIDER),
    "networkProviderEnabled" to isProviderEnabled(context, LocationManager.NETWORK_PROVIDER),
    "playServicesAvailable" to isPlayServicesAvailable(context),
    "powerSaveMode" to isPowerSaveMode(context),
    "locationPowerSaveMode" to locationPowerSaveMode(context),
    "ignoringBatteryOptimizations" to isIgnoringBatteryOptimizations(context),
    "batteryPercent" to batteryPercent(context)
  )
}
