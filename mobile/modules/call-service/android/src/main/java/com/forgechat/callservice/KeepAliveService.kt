package com.forgechat.callservice

import android.app.NotificationChannel
import android.app.NotificationManager
import android.app.PendingIntent
import android.content.Intent
import android.content.pm.ServiceInfo
import android.os.Build
import android.util.Log
import androidx.core.app.NotificationCompat
import com.facebook.react.HeadlessJsTaskService
import com.facebook.react.bridge.Arguments
import com.facebook.react.jstasks.HeadlessJsTaskConfig

/**
 * Mode « Notifications sans Google » (src/services/keepAlive.ts) : sans Firebase, rien ne réveille
 * l'app en arrière-plan. Ce service au premier plan (type « remoteMessaging ») garde le processus et
 * le WebSocket en vie ; les messages reçus deviennent des notifications locales côté JS.
 *
 * Comme CallForegroundService, c'est un service de tâche JS « headless » : la tâche
 * « ForgeChatNotifKeepAlive » garde les minuteurs JS actifs (battement, reconnexion du WebSocket).
 * Notification discrète (canal MIN) : pendant un appel, celle du service d'appel reste au premier plan.
 */
class KeepAliveService : HeadlessJsTaskService() {
  override fun getTaskConfig(intent: Intent?): HeadlessJsTaskConfig =
    HeadlessJsTaskConfig("ForgeChatNotifKeepAlive", Arguments.createMap(), 0, true)

  override fun onStartCommand(intent: Intent?, flags: Int, startId: Int): Int {
    // Déjà au premier plan (relance après un appel, voir CallServiceModule) : seule la tâche JS repart.
    if (!running) {
      try {
        val notification = buildNotification()
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.UPSIDE_DOWN_CAKE) {
          startForeground(ID, notification, ServiceInfo.FOREGROUND_SERVICE_TYPE_REMOTE_MESSAGING)
        } else {
          startForeground(ID, notification)
        }
        running = true
      } catch (e: Exception) {
        Log.w("ForgeKeepAlive", "startForeground refusé", e)
        stopSelf()
        return START_NOT_STICKY
      }
    }
    // Tâche headless : minuteurs JS actifs (voir l'en-tête).
    try {
      super.onStartCommand(intent, flags, startId)
    } catch (e: Exception) {
      Log.w("ForgeKeepAlive", "tâche JS de maintien non démarrée", e)
    }
    // Pas de redémarrage par le système : sans l'interface, le JS ne restaure pas la session.
    return START_NOT_STICKY
  }

  override fun onDestroy() {
    running = false
    super.onDestroy()
  }

  private fun buildNotification(): android.app.Notification {
    if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
      val channel = NotificationChannel(CHANNEL, "Connexion en arrière-plan", NotificationManager.IMPORTANCE_MIN)
      channel.setShowBadge(false)
      getSystemService(NotificationManager::class.java).createNotificationChannel(channel)
    }
    val launch = packageManager.getLaunchIntentForPackage(packageName)
    val tap = launch?.let { PendingIntent.getActivity(this, 1, it, PendingIntent.FLAG_IMMUTABLE or PendingIntent.FLAG_UPDATE_CURRENT) }
    val icon = resources.getIdentifier("notification_icon", "drawable", packageName).takeIf { it != 0 } ?: applicationInfo.icon
    return NotificationCompat.Builder(this, CHANNEL)
      .setSmallIcon(icon)
      .setContentTitle("ForgeChat reste connecté pour tes notifications")
      .setContentText("Désactivable dans Réglages > Notifications")
      .setPriority(NotificationCompat.PRIORITY_MIN)
      .setOngoing(true)
      .setShowWhen(false)
      .setCategory(NotificationCompat.CATEGORY_SERVICE)
      .setContentIntent(tap)
      .build()
  }

  companion object {
    /** Service au premier plan en cours : une relance passe par startService (voir CallServiceModule). */
    @Volatile
    var running = false
      private set

    private const val CHANNEL = "background_connection"
    private const val ID = 4208
  }
}
