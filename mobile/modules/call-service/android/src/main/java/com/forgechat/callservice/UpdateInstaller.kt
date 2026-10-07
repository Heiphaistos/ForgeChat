package com.forgechat.callservice

import android.content.Context
import android.content.Intent
import android.net.Uri
import android.os.Build
import android.provider.Settings
import androidx.core.content.FileProvider
import java.io.File
import java.io.FileOutputStream
import java.io.IOException
import java.net.URL
import java.security.MessageDigest
import javax.net.ssl.HttpsURLConnection

/** FileProvider propre au module : deux bibliothèques ne peuvent pas déclarer la même classe de fournisseur. */
class UpdateFileProvider : FileProvider()

/**
 * Mise à jour de l'APK depuis le serveur ForgeChat (src/features/updates) : téléchargement dans le cache
 * de l'app avec calcul du SHA-256, puis installeur Android. L'installation n'est lancée que si
 * l'empreinte du fichier téléchargé est celle annoncée par le manifeste ; Android refuse en plus
 * tout APK signé avec une autre clé que l'app installée.
 */
object UpdateInstaller {
  private const val MAX_BYTES = 400L * 1024 * 1024

  /** Empreinte vérifiée du fichier présent dans le cache (null : rien d'installable). */
  @Volatile private var verifiedSha: String? = null

  private fun apk(ctx: Context): File = File(File(ctx.cacheDir, "updates").apply { mkdirs() }, "forgechat-update.apk")

  private fun authority(ctx: Context) = "${ctx.packageName}.forgechat.updates"

  private fun hex(bytes: ByteArray) = bytes.joinToString("") { (it.toInt() and 0xff).toString(16).padStart(2, '0') }

  /**
   * Télécharge l'APK (HTTPS seulement) et renvoie son SHA-256 (hexadécimal minuscule). Fichier
   * gardé seulement si l'empreinte vaut `expectedSha`. Bloquant : à appeler hors du thread UI.
   */
  fun download(ctx: Context, url: String, expectedSha: String, onProgress: (Long, Long) -> Unit): String {
    val target = apk(ctx)
    verifiedSha = null
    target.delete()
    val source = URL(url)
    if (source.protocol != "https") throw IOException("HTTPS obligatoire")
    val part = File(target.parentFile, "${target.name}.part")
    // HttpsURLConnection ne suit jamais une redirection vers http://.
    val conn = source.openConnection() as HttpsURLConnection
    conn.connectTimeout = 15_000
    conn.readTimeout = 30_000
    try {
      if (conn.responseCode != 200) throw IOException("HTTP ${conn.responseCode}")
      val total = conn.contentLengthLong
      if (total > MAX_BYTES) throw IOException("fichier trop volumineux")
      val digest = MessageDigest.getInstance("SHA-256")
      var received = 0L
      var lastStep = -1L
      conn.inputStream.use { input ->
        FileOutputStream(part).use { out ->
          val buf = ByteArray(64 * 1024)
          while (true) {
            val n = input.read(buf)
            if (n < 0) break
            received += n
            if (received > MAX_BYTES) throw IOException("fichier trop volumineux")
            digest.update(buf, 0, n)
            out.write(buf, 0, n)
            // Un événement par pour-cent (par Mo si la taille est inconnue) : pas d'inondation du pont JS.
            val step = if (total > 0) received * 100 / total else received / (1024 * 1024)
            if (step != lastStep) {
              lastStep = step
              onProgress(received, total)
            }
          }
        }
      }
      val sha = hex(digest.digest())
      if (sha.equals(expectedSha, ignoreCase = true) && part.renameTo(target)) verifiedSha = sha
      return sha
    } finally {
      part.delete()
      conn.disconnect()
    }
  }

  /** Android 8+ : l'utilisateur doit autoriser ForgeChat à installer des applications. */
  fun canInstall(ctx: Context): Boolean = Build.VERSION.SDK_INT < Build.VERSION_CODES.O || ctx.packageManager.canRequestPackageInstalls()

  fun openInstallSettings(ctx: Context) {
    if (Build.VERSION.SDK_INT < Build.VERSION_CODES.O) return
    ctx.startActivity(
      Intent(Settings.ACTION_MANAGE_UNKNOWN_APP_SOURCES, Uri.parse("package:${ctx.packageName}")).addFlags(Intent.FLAG_ACTIVITY_NEW_TASK),
    )
  }

  /** Lance l'installeur Android sur l'APK vérifié ; false si aucun fichier vérifié n'est prêt. */
  fun install(ctx: Context): Boolean {
    val file = apk(ctx)
    if (verifiedSha == null || !file.exists()) return false
    val uri = FileProvider.getUriForFile(ctx, authority(ctx), file)
    ctx.startActivity(
      Intent(Intent.ACTION_VIEW)
        .setDataAndType(uri, "application/vnd.android.package-archive")
        .addFlags(Intent.FLAG_GRANT_READ_URI_PERMISSION or Intent.FLAG_ACTIVITY_NEW_TASK),
    )
    return true
  }

  /** Supprime l'APK du cache (mise à jour installée ou abandonnée). */
  fun discard(ctx: Context) {
    verifiedSha = null
    apk(ctx).delete()
  }
}
