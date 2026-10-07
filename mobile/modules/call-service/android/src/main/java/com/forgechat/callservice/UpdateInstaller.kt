package com.forgechat.callservice

import android.app.DownloadManager
import android.content.ContentValues
import android.content.Context
import android.content.Intent
import android.net.Uri
import android.os.Build
import android.provider.MediaStore
import java.io.File
import java.io.FileOutputStream
import java.io.IOException
import java.net.URL
import java.security.MessageDigest
import javax.net.ssl.HttpsURLConnection

/**
 * Mise à jour de l'APK depuis le serveur ForgeChat (src/features/updates) : téléchargement dans le cache
 * de l'app avec calcul du SHA-256 ; l'APK n'est remis à l'utilisateur que si l'empreinte est celle
 * annoncée par le manifeste (Android refuse en plus tout APK signé avec une autre clé).
 *
 * Pas de permission REQUEST_INSTALL_PACKAGES : HyperOS 3 (Android 17) refuse la PREMIÈRE
 * installation d'une app qui la demande (« Application non installée », Xiaomi 15T Pro, 2026-10-07).
 * L'APK vérifié est donc déposé dans Téléchargements et c'est le gestionnaire de fichiers, qui a
 * déjà ce droit, qui l'installe en un appui.
 */
object UpdateInstaller {
  private const val MAX_BYTES = 400L * 1024 * 1024

  /** Empreinte vérifiée du fichier présent dans le cache (null : rien d'installable). */
  @Volatile private var verifiedSha: String? = null

  private fun apk(ctx: Context): File = File(File(ctx.cacheDir, "updates").apply { mkdirs() }, "forgechat-update.apk")

  private const val PUBLIC_NAME = "ForgeChat-mise-a-jour.apk"

  /** Adresse du dernier APK téléchargé : repli navigateur avant Android 10. */
  @Volatile private var lastUrl: String? = null

  private fun hex(bytes: ByteArray) = bytes.joinToString("") { (it.toInt() and 0xff).toString(16).padStart(2, '0') }

  /**
   * Télécharge l'APK (HTTPS seulement) et renvoie son SHA-256 (hexadécimal minuscule). Fichier
   * gardé seulement si l'empreinte vaut `expectedSha`. Bloquant : à appeler hors du thread UI.
   */
  fun download(ctx: Context, url: String, expectedSha: String, onProgress: (Long, Long) -> Unit): String {
    val target = apk(ctx)
    verifiedSha = null
    lastUrl = url
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

  /**
   * Remet l'APK vérifié à l'utilisateur : copie dans Téléchargements (MediaStore, sans permission)
   * puis ouverture de la liste des téléchargements. Bloquant (copie) : hors du thread UI.
   * false si aucun fichier vérifié n'est prêt (cache vidé par Android : retélécharger).
   */
  fun install(ctx: Context): Boolean {
    val file = apk(ctx)
    if (verifiedSha == null || !file.exists()) return false
    if (Build.VERSION.SDK_INT < Build.VERSION_CODES.Q) {
      // Android 7 à 9 : écrire dans Téléchargements demanderait une permission de stockage.
      val url = lastUrl ?: return false
      ctx.startActivity(Intent(Intent.ACTION_VIEW, Uri.parse(url)).addFlags(Intent.FLAG_ACTIVITY_NEW_TASK))
      return true
    }
    val resolver = ctx.contentResolver
    val downloads = MediaStore.Downloads.EXTERNAL_CONTENT_URI
    // Nos copies précédentes (une app ne peut supprimer que ses propres entrées).
    resolver.delete(downloads, "${MediaStore.MediaColumns.DISPLAY_NAME} LIKE ?", arrayOf("ForgeChat-mise-a-jour%"))
    val values = ContentValues().apply {
      put(MediaStore.MediaColumns.DISPLAY_NAME, PUBLIC_NAME)
      put(MediaStore.MediaColumns.MIME_TYPE, "application/vnd.android.package-archive")
      put(MediaStore.MediaColumns.IS_PENDING, 1)
    }
    val uri = resolver.insert(downloads, values) ?: throw IOException("Téléchargements inaccessible")
    try {
      (resolver.openOutputStream(uri) ?: throw IOException("Téléchargements inaccessible")).use { out ->
        file.inputStream().use { it.copyTo(out, 64 * 1024) }
      }
      resolver.update(uri, ContentValues().apply { put(MediaStore.MediaColumns.IS_PENDING, 0) }, null, null)
    } catch (e: Exception) {
      resolver.delete(uri, null, null)
      throw e
    }
    file.delete()
    ctx.startActivity(Intent(DownloadManager.ACTION_VIEW_DOWNLOADS).addFlags(Intent.FLAG_ACTIVITY_NEW_TASK))
    return true
  }

  /** Supprime l'APK du cache (mise à jour installée ou abandonnée). */
  fun discard(ctx: Context) {
    verifiedSha = null
    apk(ctx).delete()
  }
}
