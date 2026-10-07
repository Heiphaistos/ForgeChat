package com.forgechat.callservice

import android.content.Intent
import android.util.Log
import androidx.core.content.ContextCompat
import expo.modules.kotlin.modules.Module
import expo.modules.kotlin.modules.ModuleDefinition

/**
 * Démarre / arrête le service au premier plan des appels et salons vocaux (src/services/livekit.ts),
 * celui du mode « Notifications sans Google » (src/services/keepAlive.ts),
 * et redémarre l'app (changement de thème, src/theme : les couleurs sont lues au lancement).
 */
class CallServiceModule : Module() {
  override fun definition() = ModuleDefinition {
    Name("ForgeCallService")

    // Retours explicites (null) : un `return@Function` nu (Unit) ne s'accorde pas avec le type
    // déduit du lambda (Kotlin 2 : « Return type mismatch: expected 'Any?', actual 'Unit' »).
    Function("start") { title: String ->
      val ctx = appContext.reactContext ?: return@Function null
      try {
        ContextCompat.startForegroundService(ctx, Intent(ctx, CallForegroundService::class.java).putExtra("title", title))
      } catch (e: Exception) {
        // Android 12+ : interdit depuis l'arrière-plan. L'appel continue tant que l'app est visible.
        Log.w("ForgeCallService", "service au premier plan refusé", e)
      }
      null
    }

    Function("stop") {
      val ctx = appContext.reactContext ?: return@Function null
      ctx.stopService(Intent(ctx, CallForegroundService::class.java))
      null
    }

    // Mode « Notifications sans Google » (KeepAliveService). Appelé app au premier plan ; une relance
    // (après un appel, dont le service a libéré le verrou de veille partagé) passe par startService :
    // permis en arrière-plan tant qu'un service au premier plan tourne, contrairement à startForegroundService.
    Function("startKeepAlive") {
      val ctx = appContext.reactContext ?: return@Function null
      val intent = Intent(ctx, KeepAliveService::class.java)
      try {
        if (KeepAliveService.running) ctx.startService(intent) else ContextCompat.startForegroundService(ctx, intent)
      } catch (e: Exception) {
        Log.w("ForgeKeepAlive", "service de connexion refusé", e)
      }
      null
    }

    Function("stopKeepAlive") {
      val ctx = appContext.reactContext ?: return@Function null
      ctx.stopService(Intent(ctx, KeepAliveService::class.java))
      null
    }

    // Relance l'activité de lancement dans une tâche neuve puis termine le processus : le JS
    // repart de zéro et relit le thème. Le service d'appel est arrêté avant, pour ne pas survivre seul.
    Function("restart") {
      val ctx = appContext.reactContext ?: return@Function null
      val launch = ctx.packageManager.getLaunchIntentForPackage(ctx.packageName) ?: return@Function null
      val component = launch.component ?: return@Function null
      ctx.stopService(Intent(ctx, CallForegroundService::class.java))
      // Depuis l'activité visible si possible (lancements en arrière-plan restreints sur Android 10+).
      (appContext.currentActivity ?: ctx).startActivity(Intent.makeRestartActivityTask(component))
      appContext.currentActivity?.finishAffinity()
      Runtime.getRuntime().exit(0)
      null
    }
  }
}
