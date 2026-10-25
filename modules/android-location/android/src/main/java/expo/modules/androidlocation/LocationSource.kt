package expo.modules.androidlocation

import android.annotation.SuppressLint
import android.content.Context
import android.location.Location
import android.location.LocationListener
import android.location.LocationManager
import android.os.Bundle
import android.os.Looper
import android.util.Log
import com.google.android.gms.location.Granularity
import com.google.android.gms.location.LocationAvailability
import com.google.android.gms.location.LocationCallback
import com.google.android.gms.location.LocationRequest
import com.google.android.gms.location.LocationResult
import com.google.android.gms.location.LocationServices
import com.google.android.gms.location.Priority

/** Continuous location updates from one provider. Callbacks arrive on the given looper. */
interface LocationSource {
  val name: String

  fun start(
    intervalMs: Long,
    looper: Looper,
    onLocation: (Location) -> Unit,
    onAvailability: (Boolean) -> Unit,
    onError: (Exception) -> Unit
  )

  fun stop()
}

fun createLocationSource(context: Context): LocationSource =
  if (DeviceStatus.isPlayServicesAvailable(context)) {
    FusedLocationSource(context)
  } else {
    PlatformGpsLocationSource(context)
  }

/** Google Play services Fused Location Provider, high accuracy, no batching. */
class FusedLocationSource(context: Context) : LocationSource {
  override val name = "fused"
  private val client = LocationServices.getFusedLocationProviderClient(context.applicationContext)
  private var callback: LocationCallback? = null

  @SuppressLint("MissingPermission") // Callers verify the permission first; SecurityException is reported via onError.
  override fun start(
    intervalMs: Long,
    looper: Looper,
    onLocation: (Location) -> Unit,
    onAvailability: (Boolean) -> Unit,
    onError: (Exception) -> Unit
  ) {
    stop()
    val request = LocationRequest.Builder(Priority.PRIORITY_HIGH_ACCURACY, intervalMs)
      .setMinUpdateIntervalMillis(intervalMs)
      .setMinUpdateDistanceMeters(0f)
      .setGranularity(Granularity.GRANULARITY_FINE)
      .setWaitForAccurateLocation(false)
      .setMaxUpdateDelayMillis(0L)
      .build()
    val newCallback = object : LocationCallback() {
      override fun onLocationResult(result: LocationResult) {
        result.locations.forEach(onLocation)
      }

      override fun onLocationAvailability(availability: LocationAvailability) {
        onAvailability(availability.isLocationAvailable)
      }
    }
    callback = newCallback
    try {
      client.requestLocationUpdates(request, newCallback, looper)
        .addOnFailureListener { error -> onError(error) }
    } catch (error: SecurityException) {
      callback = null
      onError(error)
    }
  }

  override fun stop() {
    callback?.let { client.removeLocationUpdates(it) }
    callback = null
  }
}

/** Fallback for devices without Google Play services: raw GNSS from the platform. */
class PlatformGpsLocationSource(context: Context) : LocationSource {
  override val name = "gps"
  private val manager = context.applicationContext.getSystemService(Context.LOCATION_SERVICE) as LocationManager
  private var listener: LocationListener? = null

  @SuppressLint("MissingPermission")
  override fun start(
    intervalMs: Long,
    looper: Looper,
    onLocation: (Location) -> Unit,
    onAvailability: (Boolean) -> Unit,
    onError: (Exception) -> Unit
  ) {
    stop()
    // All three callbacks are implemented explicitly: before API 30 they are abstract.
    val newListener = object : LocationListener {
      override fun onLocationChanged(location: Location) = onLocation(location)
      override fun onProviderEnabled(provider: String) = onAvailability(true)
      override fun onProviderDisabled(provider: String) = onAvailability(false)

      @Deprecated("Deprecated in Java")
      override fun onStatusChanged(provider: String?, status: Int, extras: Bundle?) = Unit
    }
    listener = newListener
    try {
      manager.requestLocationUpdates(LocationManager.GPS_PROVIDER, intervalMs, 0f, newListener, looper)
    } catch (error: Exception) {
      Log.w(TAG, "GPS provider unavailable", error)
      listener = null
      onError(error)
    }
  }

  override fun stop() {
    listener?.let { manager.removeUpdates(it) }
    listener = null
  }

  private companion object {
    const val TAG = "StrideLocation"
  }
}
