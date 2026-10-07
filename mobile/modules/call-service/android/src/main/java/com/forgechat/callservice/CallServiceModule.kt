package com.forgechat.callservice

import android.content.Intent
import android.util.Base64
import android.util.Log
import androidx.core.content.ContextCompat
import expo.modules.kotlin.Promise
import expo.modules.kotlin.modules.Module
import expo.modules.kotlin.modules.ModuleDefinition
import javax.crypto.Mac
import javax.crypto.spec.SecretKeySpec

/**
 * Démarre / arrête le service au premier plan des appels et salons vocaux (src/services/livekit.ts),
 * celui du mode « Notifications sans Google » (src/services/keepAlive.ts),
 * redémarre l'app (changement de thème, src/theme : les couleurs sont lues au lancement)
 * installe les mises à jour publiées par le serveur (UpdateInstaller, src/features/updates)
 * et pilote la fenêtre des appels vidéo : plein écran immersif, image dans l'image (CallWindow).
 */
class CallServiceModule : Module() {
  override fun definition() = ModuleDefinition {
    Name("ForgeCallService")

    // Fond virtuel de la caméra (BackgroundEffect.kt) : processeur déclaré une fois auprès de WebRTC.
    OnCreate { BackgroundEffect.register() }

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

    // PBKDF2-HMAC-SHA256 natif (chiffrement de bout en bout, src/e2e/crypto.ts) : 600 000
    // itérations prennent plusieurs minutes en JavaScript pur, environ une seconde ici. Calcul sur
    // les octets bruts (base64 standard en entrée et en sortie) : mêmes octets que WebCrypto.
    AsyncFunction("pbkdf2") { secretB64: String, saltB64: String, iterations: Int, length: Int ->
      require(iterations in 1..10_000_000 && length in 1..64) { "paramètres PBKDF2 invalides" }
      val secret = Base64.decode(secretB64, Base64.NO_WRAP)
      val salt = Base64.decode(saltB64, Base64.NO_WRAP)
      val mac = Mac.getInstance("HmacSHA256")
      // Clé HMAC vide = octets nuls (complétée par des zéros) : un octet nul est équivalent.
      mac.init(SecretKeySpec(if (secret.isEmpty()) ByteArray(1) else secret, "HmacSHA256"))
      val out = ByteArray(length)
      var block = 1
      var offset = 0
      while (offset < length) {
        mac.update(salt)
        mac.update(byteArrayOf((block ushr 24).toByte(), (block ushr 16).toByte(), (block ushr 8).toByte(), block.toByte()))
        var u = mac.doFinal()
        val t = u.copyOf()
        for (i in 1 until iterations) {
          u = mac.doFinal(u)
          for (j in t.indices) t[j] = (t[j].toInt() xor u[j].toInt()).toByte()
        }
        val n = minOf(t.size, length - offset)
        System.arraycopy(t, 0, out, offset, n)
        offset += n
        block++
      }
      Base64.encodeToString(out, Base64.NO_WRAP)
    }

    // ── Mise à jour de l'APK (UpdateInstaller, src/features/updates/installer.ts) ──
    Events("onUpdateProgress", "onPipChange", "onVolumeKey")

    // Téléchargement sur un fil dédié : la file des AsyncFunction est partagée par tous les modules Expo.
    AsyncFunction("downloadUpdate") { url: String, expectedSha: String, promise: Promise ->
      val ctx = appContext.reactContext
      if (ctx == null) {
        promise.reject("ERR_UPDATE", "contexte indisponible", null)
      } else {
        Thread {
          try {
            val sha = UpdateInstaller.download(ctx, url, expectedSha) { received, total ->
              sendEvent("onUpdateProgress", mapOf("received" to received.toDouble(), "total" to total.toDouble()))
            }
            promise.resolve(sha)
          } catch (e: Exception) {
            Log.w("ForgeUpdate", "téléchargement impossible", e)
            promise.reject("ERR_UPDATE", e.message ?: "téléchargement impossible", e)
          }
        }.start()
      }
    }

    // Copie de l'APK dans Téléchargements sur un fil dédié (plusieurs dizaines de Mo).
    AsyncFunction("installUpdate") { promise: Promise ->
      val ctx = appContext.currentActivity ?: appContext.reactContext
      if (ctx == null) {
        promise.reject("ERR_UPDATE", "contexte indisponible", null)
      } else {
        Thread {
          try {
            promise.resolve(UpdateInstaller.install(ctx))
          } catch (e: Exception) {
            Log.w("ForgeUpdate", "remise de l'APK impossible", e)
            promise.reject("ERR_UPDATE", e.message ?: "remise de l'APK impossible", e)
          }
        }.start()
      }
    }

    Function("discardUpdate") {
      val ctx = appContext.reactContext ?: return@Function null
      UpdateInstaller.discard(ctx)
      null
    }

    // Fichiers chiffrés de bout en bout (src/e2e/files.ts, FileCrypto.java) : chiffrés / déchiffrés
    // en flux sur le disque, jamais entiers en mémoire, AES-GCM matériel (le JavaScript pur
    // est ~100 fois plus lent). `src` : file:// ou content:// ; `dest` : file:// du cache.
    AsyncFunction("encryptFile") { src: String, dest: String, keyB64: String, fileId: String ->
      val ctx = appContext.reactContext ?: throw IllegalStateException("contexte indisponible")
      val out = java.io.File(android.net.Uri.parse(dest).path ?: throw IllegalArgumentException("destination invalide"))
      try {
        val input = ctx.contentResolver.openInputStream(android.net.Uri.parse(src)) ?: throw java.io.FileNotFoundException(src)
        input.buffered().use { i -> java.io.FileOutputStream(out).buffered().use { o -> FileCrypto.encrypt(i, o, Base64.decode(keyB64, Base64.NO_WRAP), fileId).toDouble() } }
      } catch (e: Exception) {
        out.delete()
        throw e
      }
    }

    AsyncFunction("decryptFile") { src: String, dest: String, keyB64: String, fileId: String, size: Double ->
      val inFile = java.io.File(android.net.Uri.parse(src).path ?: throw IllegalArgumentException("source invalide"))
      val out = java.io.File(android.net.Uri.parse(dest).path ?: throw IllegalArgumentException("destination invalide"))
      try {
        // BufferedOutputStream.close vide le tampon puis ferme le fichier.
        java.io.FileInputStream(inFile).buffered().use { i ->
          java.io.FileOutputStream(out).buffered().use { o -> FileCrypto.decrypt(i, o, Base64.decode(keyB64, Base64.NO_WRAP), fileId, size.toLong()) }
        }
        null
      } catch (e: Exception) {
        // Jamais de fichier partiel (ou non authentifié) laissé dans le cache.
        out.delete()
        throw e
      }
    }

    // ── Fenêtre des appels vidéo (CallWindow.kt, src/services/callWindow.ts) ──
    Function("setImmersive") { on: Boolean ->
      val activity = appContext.currentActivity ?: return@Function null
      CallWindow.setImmersive(activity, on)
      null
    }

    Function("pipSupported") {
      CallWindow.pipSupported(appContext.currentActivity)
    }

    Function("setPip") { enabled: Boolean, width: Int, height: Int ->
      val activity = appContext.currentActivity ?: return@Function null
      CallWindow.setPip(activity, enabled, width, height) { sendEvent("onPipChange", mapOf("active" to it)) }
      null
    }

    Function("enterPip") { width: Int, height: Int ->
      val activity = appContext.currentActivity ?: return@Function null
      CallWindow.enterPip(activity, width, height) { sendEvent("onPipChange", mapOf("active" to it)) }
      null
    }

    // ── Voix et vidéo (src/services/voiceFx.ts) ──
    // Suppression de bruit forte : porte de bruit après le traitement WebRTC (NoiseGate.kt).
    Function("setNoiseGate") { on: Boolean -> NoiseGate.set(on) }

    // Fond virtuel : 0 aucun, 1 flou, 2 image (chemin rendu par importBackground).
    Function("setVideoBackground") { mode: Int, imagePath: String? ->
      BackgroundEffect.configure(mode.coerceIn(0, 2), imagePath?.takeIf { it.isNotEmpty() })
      null
    }

    // Image de fond choisie (file:// ou content://) : réduite à 1280 px et copiée dans les fichiers
    // de l'app (jamais envoyée) ; renvoie son chemin.
    AsyncFunction("importBackground") { uri: String ->
      val ctx = appContext.reactContext ?: throw IllegalStateException("contexte indisponible")
      val u = android.net.Uri.parse(uri)
      val bounds = android.graphics.BitmapFactory.Options().apply { inJustDecodeBounds = true }
      ctx.contentResolver.openInputStream(u)?.use { android.graphics.BitmapFactory.decodeStream(it, null, bounds) }
      var sample = 1
      while (bounds.outWidth / (sample * 2) >= 1280 || bounds.outHeight / (sample * 2) >= 1280) sample *= 2
      val opts = android.graphics.BitmapFactory.Options().apply { inSampleSize = sample }
      val bmp = ctx.contentResolver.openInputStream(u)?.use { android.graphics.BitmapFactory.decodeStream(it, null, opts) }
        ?: throw IllegalArgumentException("image illisible")
      val out = java.io.File(ctx.filesDir, "forgechat-background.jpg")
      try {
        java.io.FileOutputStream(out).use { bmp.compress(android.graphics.Bitmap.CompressFormat.JPEG, 88, it) }
      } finally {
        bmp.recycle()
      }
      out.absolutePath
    }

    // Appuyer pour parler avec la touche volume bas (VolumeKeys.kt) ; événement onVolumeKey { down }.
    Function("setVolumeKeys") { on: Boolean ->
      val activity = appContext.currentActivity ?: return@Function false
      activity.runOnUiThread {
        VolumeKeys.set(activity, on) { down -> sendEvent("onVolumeKey", mapOf("down" to down)) }
      }
      true
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
