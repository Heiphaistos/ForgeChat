package com.forgechat.callservice

import android.app.Activity
import android.app.PictureInPictureParams
import android.content.pm.ActivityInfo
import android.content.pm.PackageManager
import android.os.Build
import android.util.Log
import android.util.Rational
import androidx.annotation.RequiresApi
import androidx.core.app.OnPictureInPictureModeChangedProvider
import androidx.core.view.WindowCompat
import androidx.core.view.WindowInsetsCompat
import androidx.core.view.WindowInsetsControllerCompat
import java.lang.ref.WeakReference

/**
 * Fenêtre des appels vidéo (src/services/callWindow.ts) : plein écran immersif avec rotation suivie,
 * et image dans l'image (PiP) quand on quitte l'app pendant un appel vidéo. Tout passe sur le fil UI
 * de l'activité ; rien ne bloque le JavaScript.
 */
object CallWindow {
  /** Orientation d'avant le plein écran (portrait imposé par le manifeste), rétablie à la sortie. */
  private var savedOrientation: Int? = null
  private var watched: WeakReference<Activity>? = null

  fun setImmersive(activity: Activity, on: Boolean) {
    activity.runOnUiThread {
      val controller = WindowCompat.getInsetsController(activity.window, activity.window.decorView)
      if (on) {
        controller.systemBarsBehavior = WindowInsetsControllerCompat.BEHAVIOR_SHOW_TRANSIENT_BARS_BY_SWIPE
        controller.hide(WindowInsetsCompat.Type.systemBars())
        if (savedOrientation == null) savedOrientation = activity.requestedOrientation
        // Suit le capteur dans les 4 sens, comme un lecteur vidéo plein écran.
        activity.requestedOrientation = ActivityInfo.SCREEN_ORIENTATION_FULL_SENSOR
      } else {
        controller.show(WindowInsetsCompat.Type.systemBars())
        savedOrientation?.let { activity.requestedOrientation = it }
        savedOrientation = null
      }
    }
  }

  fun pipSupported(activity: Activity?): Boolean =
    Build.VERSION.SDK_INT >= Build.VERSION_CODES.O &&
      activity?.packageManager?.hasSystemFeature(PackageManager.FEATURE_PICTURE_IN_PICTURE) == true

  /**
   * Paramètres de l'image dans l'image : ratio de la vidéo principale et, Android 12+, entrée
   * automatique quand on quitte l'app (`enabled` : appel vidéo en cours, jamais en audio seul).
   */
  fun setPip(activity: Activity, enabled: Boolean, width: Int, height: Int, onChange: (Boolean) -> Unit) {
    if (Build.VERSION.SDK_INT < Build.VERSION_CODES.O || !pipSupported(activity)) return
    activity.runOnUiThread {
      try {
        activity.setPictureInPictureParams(params(enabled, width, height))
      } catch (e: Exception) {
        Log.w("ForgeCallWindow", "paramètres PiP refusés", e)
      }
      watch(activity, onChange)
    }
  }

  /** Entrée immédiate (bouton) : Android 8 à 11 n'ont pas l'entrée automatique. */
  fun enterPip(activity: Activity, width: Int, height: Int, onChange: (Boolean) -> Unit) {
    if (Build.VERSION.SDK_INT < Build.VERSION_CODES.O || !pipSupported(activity)) return
    activity.runOnUiThread {
      try {
        watch(activity, onChange)
        activity.enterPictureInPictureMode(params(true, width, height))
      } catch (e: Exception) {
        Log.w("ForgeCallWindow", "image dans l'image refusée", e)
      }
    }
  }

  @RequiresApi(Build.VERSION_CODES.O)
  private fun params(enabled: Boolean, width: Int, height: Int): PictureInPictureParams {
    val builder = PictureInPictureParams.Builder()
    if (width > 0 && height > 0) {
      // Android refuse un ratio hors de [1/2,39 ; 2,39].
      val ratio = (width.toDouble() / height).coerceIn(0.42, 2.38)
      builder.setAspectRatio(Rational((ratio * 1000).toInt(), 1000))
    }
    if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.S) {
      builder.setAutoEnterEnabled(enabled)
      builder.setSeamlessResizeEnabled(false) // vidéo : pas de fondu d'interface au redimensionnement
    }
    return builder.build()
  }

  /** Signale au JavaScript l'entrée et la sortie du mode PiP (une seule écoute par activité). */
  private fun watch(activity: Activity, onChange: (Boolean) -> Unit) {
    if (watched?.get() === activity) return
    val provider = activity as? OnPictureInPictureModeChangedProvider ?: return
    provider.addOnPictureInPictureModeChangedListener { info -> onChange(info.isInPictureInPictureMode) }
    watched = WeakReference(activity)
  }
}
