package com.forgechat.callservice

import android.content.Intent
import android.util.Log
import androidx.core.content.ContextCompat
import expo.modules.kotlin.modules.Module
import expo.modules.kotlin.modules.ModuleDefinition

/** Démarre / arrête le service au premier plan des appels et salons vocaux (src/services/livekit.ts). */
class CallServiceModule : Module() {
  override fun definition() = ModuleDefinition {
    Name("ForgeCallService")

    Function("start") { title: String ->
      val ctx = appContext.reactContext ?: return@Function
      try {
        ContextCompat.startForegroundService(ctx, Intent(ctx, CallForegroundService::class.java).putExtra("title", title))
      } catch (e: Exception) {
        // Android 12+ : interdit depuis l'arrière-plan. L'appel continue tant que l'app est visible.
        Log.w("ForgeCallService", "service au premier plan refusé", e)
      }
    }

    Function("stop") {
      val ctx = appContext.reactContext ?: return@Function
      ctx.stopService(Intent(ctx, CallForegroundService::class.java))
    }
  }
}
