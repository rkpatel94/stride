package expo.modules.androidlocation

import android.content.Context
import android.media.AudioAttributes
import android.media.AudioFocusRequest
import android.media.AudioManager
import android.os.Build
import android.os.VibrationEffect
import android.os.Vibrator
import android.os.VibratorManager
import android.speech.tts.TextToSpeech
import android.speech.tts.UtteranceProgressListener
import android.util.Log
import java.util.Locale

/**
 * Spoken and vibration cues for run/walk intervals. Speech uses Android's built-in text-to-speech
 * (no network, no extra library) and briefly lowers other audio (music, podcasts) while it talks.
 * Use from the main thread (text-to-speech reports that it is ready there too).
 */
class WorkoutCues(context: Context) {
  enum class Pattern(val timings: LongArray) {
    RUN(longArrayOf(0, 350, 150, 350)),
    WALK(longArrayOf(0, 700)),
    DONE(longArrayOf(0, 200, 120, 200, 120, 200))
  }

  private val appContext = context.applicationContext
  private val audioManager = appContext.getSystemService(Context.AUDIO_SERVICE) as AudioManager
  private val speechAttributes = AudioAttributes.Builder()
    .setUsage(AudioAttributes.USAGE_ASSISTANCE_NAVIGATION_GUIDANCE)
    .setContentType(AudioAttributes.CONTENT_TYPE_SPEECH)
    .build()
  private var focusRequest: AudioFocusRequest? = null
  private var tts: TextToSpeech? = null
  private var ready = false
  private var pending: String? = null

  /** Speaks [text] (replacing anything still being said) and vibrates with [pattern]. */
  fun cue(text: String, pattern: Pattern) {
    vibrate(pattern)
    speak(text)
  }

  private fun speak(text: String) {
    if (tts == null) {
      // The engine starts asynchronously; the first cue is spoken once it is ready.
      pending = text
      tts = TextToSpeech(appContext) { status -> onReady(status) }
      return
    }
    if (ready) say(text) else pending = text
  }

  private fun onReady(status: Int) {
    val engine = tts
    ready = status == TextToSpeech.SUCCESS && engine != null
    if (!ready || engine == null) {
      Log.w(TAG, "Text-to-speech is unavailable (status $status)")
      return
    }
    configure(engine)
    pending?.let { say(it) }
    pending = null
  }

  private fun configure(engine: TextToSpeech) {
    if (engine.isLanguageAvailable(Locale.US) >= TextToSpeech.LANG_AVAILABLE) engine.language = Locale.US
    engine.setAudioAttributes(speechAttributes)
    engine.setOnUtteranceProgressListener(object : UtteranceProgressListener() {
      override fun onStart(utteranceId: String?) = Unit
      override fun onDone(utteranceId: String?) = abandonFocus()
      @Deprecated("Deprecated in Java")
      override fun onError(utteranceId: String?) = abandonFocus()
    })
  }

  private fun say(text: String) {
    requestFocus()
    tts?.speak(text, TextToSpeech.QUEUE_FLUSH, null, "stride-cue-${System.nanoTime()}")
  }

  private fun requestFocus() {
    if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
      val request = AudioFocusRequest.Builder(AudioManager.AUDIOFOCUS_GAIN_TRANSIENT_MAY_DUCK)
        .setAudioAttributes(speechAttributes)
        .build()
      focusRequest = request
      audioManager.requestAudioFocus(request)
    } else {
      @Suppress("DEPRECATION")
      audioManager.requestAudioFocus(null, AudioManager.STREAM_MUSIC, AudioManager.AUDIOFOCUS_GAIN_TRANSIENT_MAY_DUCK)
    }
  }

  private fun abandonFocus() {
    if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
      focusRequest?.let { audioManager.abandonAudioFocusRequest(it) }
      focusRequest = null
    } else {
      @Suppress("DEPRECATION")
      audioManager.abandonAudioFocus(null)
    }
  }

  private fun vibrate(pattern: Pattern) {
    try {
      val vibrator: Vibrator? = if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.S) {
        (appContext.getSystemService(Context.VIBRATOR_MANAGER_SERVICE) as? VibratorManager)?.defaultVibrator
      } else {
        @Suppress("DEPRECATION")
        appContext.getSystemService(Context.VIBRATOR_SERVICE) as? Vibrator
      }
      if (vibrator == null || !vibrator.hasVibrator()) return
      if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
        vibrator.vibrate(VibrationEffect.createWaveform(pattern.timings, -1))
      } else {
        @Suppress("DEPRECATION")
        vibrator.vibrate(pattern.timings, -1)
      }
    } catch (error: SecurityException) {
      Log.w(TAG, "Vibration is not allowed", error)
    }
  }

  fun shutdown() {
    abandonFocus()
    tts?.shutdown()
    tts = null
    ready = false
    pending = null
  }

  companion object {
    private const val TAG = "StrideCues"

    /** "1 minute", "90 seconds" -> "1 minute 30 seconds", "2 minutes". */
    fun spokenDuration(ms: Long): String {
      val totalSeconds = ((ms + 500) / 1000).toInt()
      val minutes = totalSeconds / 60
      val seconds = totalSeconds % 60
      val parts = mutableListOf<String>()
      if (minutes > 0) parts.add(if (minutes == 1) "1 minute" else "$minutes minutes")
      if (seconds > 0 || minutes == 0) parts.add(if (seconds == 1) "1 second" else "$seconds seconds")
      return parts.joinToString(" ")
    }
  }
}
