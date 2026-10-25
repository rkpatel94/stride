package expo.modules.androidlocation

import android.location.Location
import android.util.Log

/**
 * Bridge from the service to whichever JS module instance is alive. When the React runtime is
 * gone the sink is null and events are simply dropped; the journal still holds every fix.
 */
object TrackingEvents {
  const val LOCATION_RECORDED = "onLocationRecorded"
  const val STATUS_CHANGED = "onStatusChanged"
  const val PREVIEW_LOCATION = "onPreviewLocation"

  @Volatile
  var sink: ((String, Map<String, Any?>) -> Unit)? = null

  fun emit(name: String, payload: Map<String, Any?>) {
    try {
      sink?.invoke(name, payload)
    } catch (error: Throwable) {
      Log.w("StrideTracking", "Could not deliver $name to JS", error)
    }
  }

  fun locationPayload(location: Location): Map<String, Any?> = mapOf(
    "latitude" to location.latitude,
    "longitude" to location.longitude,
    "wallTimeMs" to location.time.toDouble(),
    "elapsedRealtimeMs" to (location.elapsedRealtimeNanos / 1_000_000L).toDouble(),
    "accuracyMeters" to if (location.hasAccuracy()) location.accuracy.toDouble() else null,
    "altitudeMeters" to if (location.hasAltitude()) location.altitude else null,
    "speedMps" to if (location.hasSpeed()) location.speed.toDouble() else null,
    "bearingDegrees" to if (location.hasBearing()) location.bearing.toDouble() else null,
    "provider" to location.provider,
    "isMock" to TrackingJournal.isMock(location)
  )
}
