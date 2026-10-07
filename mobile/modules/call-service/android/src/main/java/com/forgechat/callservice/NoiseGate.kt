package com.forgechat.callservice

import android.util.Log
import com.livekit.reactnative.LiveKitReactNative
import com.livekit.reactnative.audio.processing.AudioProcessorInterface
import java.nio.ByteBuffer
import java.nio.ByteOrder
import kotlin.math.abs
import kotlin.math.log10
import kotlin.math.sqrt

/**
 * Suppression de bruit « forte » du mobile (réglage Voix et vidéo) : porte de bruit posée APRÈS le
 * traitement WebRTC (suppression de bruit, annulation d'écho, gain auto), sur le micro, avant
 * l'encodage et le chiffrement. Entre deux phrases, le bruit résiduel est atténué de 30 dB ;
 * la voix rouvre la porte en 10 ms et la garde ouverte 250 ms après la dernière syllabe.
 *
 * Branchée sur le point d'insertion « capture post processing » de LiveKit React Native
 * (LiveKitReactNative.audioProcessingController), créé au démarrage par le plugin Expo de LiveKit.
 *
 * Format : trames de 10 ms en flottants (échelle ±32768 de WebRTC, ou ±1). Toute trame illisible
 * (NaN, valeurs hors échelle) désactive la porte pour la session : jamais de son abîmé.
 */
class NoiseGate : AudioProcessorInterface {
  @Volatile private var broken = false
  private var gain = 1f
  private var hold = 0
  private var scale = 1f

  override fun isEnabled() = !broken
  override fun getName() = "forgechat-noise-gate"

  override fun initializeAudioProcessing(sampleRateHz: Int, numChannels: Int) {
    gain = 1f
    hold = 0
  }

  override fun resetAudioProcessing(newRate: Int) {
    hold = 0
  }

  override fun processAudio(numBands: Int, numFrames: Int, buffer: ByteBuffer) {
    if (broken || numFrames <= 0) return
    val fb = buffer.duplicate().order(ByteOrder.nativeOrder()).also { it.position(0) }.asFloatBuffer()
    val n = minOf(fb.capacity(), maxOf(1, numBands) * numFrames)
    var sum = 0.0
    var peak = 0f
    for (i in 0 until n) {
      val v = fb.get(i)
      if (v.isNaN() || abs(v) > 40000f) {
        broken = true
        Log.w("ForgeNoiseGate", "format audio inattendu : porte désactivée")
        return
      }
      sum += (v * v).toDouble()
      if (abs(v) > peak) peak = abs(v)
    }
    if (peak > 2f) scale = 32768f
    val rms = sqrt(sum / n).toFloat() / scale
    val db = if (rms > 1e-9f) 20f * log10(rms) else -180f
    if (db > OPEN_DB) hold = HOLD_FRAMES else if (hold > 0) hold--
    val target = if (hold > 0) 1f else FLOOR
    val start = gain
    gain += (target - gain) * (if (target > gain) ATTACK else RELEASE)
    if (start >= 0.999f && gain >= 0.999f) return
    // Rampe linéaire sur la trame (par bande) : pas de clic quand la porte bouge.
    for (i in 0 until n) {
      val k = (i % numFrames).toFloat() / numFrames
      fb.put(i, fb.get(i) * (start + (gain - start) * k))
    }
  }

  companion object {
    private const val OPEN_DB = -48f
    private const val FLOOR = 0.03f // -30 dB
    private const val HOLD_FRAMES = 25 // 250 ms
    private const val ATTACK = 0.7f
    private const val RELEASE = 0.12f

    private val gate = NoiseGate()

    /** Active ou retire la porte ; false si LiveKit n'a pas encore créé son point d'insertion. */
    fun set(on: Boolean): Boolean = try {
      LiveKitReactNative.audioProcessingController.capturePostProcessor = if (on) gate else null
      true
    } catch (e: Exception) {
      Log.w("ForgeNoiseGate", "traitement audio LiveKit indisponible", e)
      false
    }
  }
}
