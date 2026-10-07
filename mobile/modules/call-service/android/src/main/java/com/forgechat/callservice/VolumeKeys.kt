package com.forgechat.callservice

import android.app.Activity
import android.view.KeyEvent
import android.view.Window

/**
 * Appuyer pour parler avec la touche volume bas (option du salon vocal, src/services/voiceFx.ts) :
 * tant que l'option est active, la touche ne change plus le volume, elle ouvre le micro pendant
 * l'appui. L'activité doit être au premier plan (Android ne remet pas les touches à une app en
 * arrière-plan ni écran éteint). La touche volume haut garde son rôle.
 */
object VolumeKeys {
  private class Wrapper(val inner: Window.Callback, val emit: (Boolean) -> Unit) : Window.Callback by inner {
    override fun dispatchKeyEvent(event: KeyEvent): Boolean {
      if (event.keyCode != KeyEvent.KEYCODE_VOLUME_DOWN) return inner.dispatchKeyEvent(event)
      when (event.action) {
        KeyEvent.ACTION_DOWN -> if (event.repeatCount == 0) emit(true)
        KeyEvent.ACTION_UP -> emit(false)
      }
      return true
    }
  }

  /** À appeler sur le fil de l'interface. */
  fun set(activity: Activity, on: Boolean, emit: (Boolean) -> Unit) {
    val window = activity.window ?: return
    val current = window.callback ?: return
    if (on && current !is Wrapper) window.callback = Wrapper(current, emit)
    if (!on && current is Wrapper) window.callback = current.inner
  }
}
