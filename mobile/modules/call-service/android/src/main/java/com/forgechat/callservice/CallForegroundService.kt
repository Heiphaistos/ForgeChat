package com.forgechat.callservice

import android.Manifest
import android.app.NotificationChannel
import android.app.NotificationManager
import android.app.PendingIntent
import android.content.Intent
import android.content.pm.PackageManager
import android.content.pm.ServiceInfo
import android.os.Build
import android.util.Log
import androidx.core.app.NotificationCompat
import androidx.core.content.ContextCompat
import com.facebook.react.HeadlessJsTaskService
import com.facebook.react.bridge.Arguments
import com.facebook.react.jstasks.HeadlessJsTaskConfig

/**
 * Service au premier plan pendant un appel ou un salon vocal : sans lui, Android coupe le micro
 * (et la caméra) dès que l'app passe en arrière-plan ou que l'écran se verrouille.
 * Type « microphone », plus « camera » si la permission caméra est accordée.
 *
 * C'est aussi un service de tâche JS « headless » : React Native SUSPEND les minuteurs JavaScript
 * (setTimeout) dès que l'app passe en arrière-plan, sauf pendant une tâche headless. Sans elle, une
 * coupure réseau en arrière-plan n'était jamais rattrapée (reconnexions du chat et de LiveKit
 * figées jusqu'au retour au premier plan). La tâche « ForgeChatKeepAlive » (src/services/livekit.ts)
 * dure jusqu'à la fin de l'appel.
 */
class CallForegroundService : HeadlessJsTaskService() {
  override fun getTaskConfig(intent: Intent?): HeadlessJsTaskConfig =
    // Pas de délai maximal (0), et autorisée app au premier plan (l'appel démarre app ouverte).
    HeadlessJsTaskConfig("ForgeChatKeepAlive", Arguments.createMap(), 0, true)

  override fun onStartCommand(intent: Intent?, flags: Int, startId: Int): Int {
    val title = intent?.getStringExtra("title") ?: "Appel en cours"
    if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
      getSystemService(NotificationManager::class.java).createNotificationChannel(
        NotificationChannel(CHANNEL, "Appels en cours", NotificationManager.IMPORTANCE_LOW),
      )
    }
    val launch = packageManager.getLaunchIntentForPackage(packageName)
    val tap = launch?.let { PendingIntent.getActivity(this, 0, it, PendingIntent.FLAG_IMMUTABLE or PendingIntent.FLAG_UPDATE_CURRENT) }
    val icon = resources.getIdentifier("notification_icon", "drawable", packageName).takeIf { it != 0 } ?: applicationInfo.icon
    val notification = NotificationCompat.Builder(this, CHANNEL)
      .setSmallIcon(icon)
      .setContentTitle(title)
      .setContentText("Touche pour revenir dans ForgeChat")
      .setOngoing(true)
      .setCategory(NotificationCompat.CATEGORY_CALL)
      .setContentIntent(tap)
      .build()
    try {
      if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.R) {
        var types = ServiceInfo.FOREGROUND_SERVICE_TYPE_MICROPHONE
        if (granted(Manifest.permission.CAMERA)) types = types or ServiceInfo.FOREGROUND_SERVICE_TYPE_CAMERA
        startForeground(ID, notification, types)
      } else {
        startForeground(ID, notification)
      }
    } catch (e: Exception) {
      Log.w("ForgeCallService", "startForeground refusé", e)
      stopSelf()
      return START_NOT_STICKY
    }
    // Démarre la tâche headless qui garde les minuteurs JS actifs (voir l'en-tête).
    try {
      super.onStartCommand(intent, flags, startId)
    } catch (e: Exception) {
      Log.w("ForgeCallService", "tâche JS de maintien non démarrée", e)
    }
    return START_NOT_STICKY
  }

  // App fermée depuis les apps récentes : pas de notification « appel en cours » orpheline.
  override fun onTaskRemoved(rootIntent: Intent?) {
    stopSelf()
  }

  private fun granted(permission: String) = ContextCompat.checkSelfPermission(this, permission) == PackageManager.PERMISSION_GRANTED

  private companion object {
    const val CHANNEL = "calls_ongoing"
    const val ID = 4207
  }
}
