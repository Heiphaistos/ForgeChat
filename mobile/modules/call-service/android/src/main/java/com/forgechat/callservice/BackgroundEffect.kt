package com.forgechat.callservice

import android.graphics.Bitmap
import android.graphics.BitmapFactory
import android.util.Log
import com.oney.WebRTCModule.videoEffects.ProcessorProvider
import com.oney.WebRTCModule.videoEffects.VideoFrameProcessor
import livekit.org.webrtc.JavaI420Buffer
import livekit.org.webrtc.SurfaceTextureHelper
import livekit.org.webrtc.VideoFrame
import java.nio.ByteBuffer
import kotlin.math.max
import kotlin.math.min
import kotlin.math.sqrt

/**
 * Fond virtuel de la caméra du mobile (réglage Voix et vidéo), sans dépendance : processeur de
 * trames de @livekit/react-native-webrtc (« forgechat-background », posé sur la piste caméra par
 * src/services/voiceFx.ts), donc avant l'encodage et le chiffrement de bout en bout.
 *
 * Pas de détourage de la personne (il faudrait un modèle de segmentation : ML Kit ou MediaPipe,
 * plusieurs Mo et, pour ML Kit, des statistiques envoyées à Google) : une ellipse centrée
 * (tête et épaules d'un appel en selfie) reste nette, le reste est flouté ou remplacé par l'image
 * choisie, avec un bord fondu. Calcul sur les plans YUV, masques et image préparés une fois par
 * taille et orientation.
 *
 * Toute erreur renvoie null : la trame d'origine part telle quelle (la caméra marche toujours).
 */
class BackgroundEffect : VideoFrameProcessor {
  private var key = ""
  private var maskY = ByteArray(0)
  private var maskC = ByteArray(0)
  private var imgY: ByteArray? = null
  private var imgU: ByteArray? = null
  private var imgV: ByteArray? = null
  private var imageVersion = -1

  override fun process(frame: VideoFrame, textureHelper: SurfaceTextureHelper?): VideoFrame? {
    val mode = BackgroundConfig.mode
    if (mode == MODE_NONE) return null
    val src = frame.buffer.toI420() ?: return null
    try {
      val w = src.width
      val h = src.height
      if (w < 16 || h < 16) return null
      val cw = (w + 1) / 2
      val ch = (h + 1) / 2
      prepare(w, h, cw, ch, frame.rotation, mode)
      val y = plane(src.dataY, src.strideY, w, h)
      val u = plane(src.dataU, src.strideU, cw, ch)
      val v = plane(src.dataV, src.strideV, cw, ch)
      val image = mode == MODE_IMAGE && imgY != null
      blend(y, w, h, maskY, if (image) imgY else null, 16)
      blend(u, cw, ch, maskC, if (image) imgU else null, 8)
      blend(v, cw, ch, maskC, if (image) imgV else null, 8)
      val out = JavaI420Buffer.allocate(w, h)
      write(out.dataY, out.strideY, y, w, h)
      write(out.dataU, out.strideU, u, cw, ch)
      write(out.dataV, out.strideV, v, cw, ch)
      return VideoFrame(out, frame.rotation, frame.timestampNs)
    } catch (e: Throwable) {
      if (!warned) {
        warned = true
        Log.w(TAG, "fond virtuel indisponible, caméra sans effet", e)
      }
      return null
    } finally {
      src.release()
    }
  }

  /** Masque de l'ellipse (255 = net) et image aux dimensions de la trame, recalculés si besoin. */
  private fun prepare(w: Int, h: Int, cw: Int, ch: Int, rotation: Int, mode: Int) {
    val k = "$w:$h:$rotation"
    if (k != key) {
      key = k
      maskY = ellipseMask(w, h, rotation)
      maskC = ellipseMask(cw, ch, rotation)
      imageVersion = -1
    }
    if (mode == MODE_IMAGE && imageVersion != BackgroundConfig.imageVersion) {
      imageVersion = BackgroundConfig.imageVersion
      loadImage(w, h, cw, ch, rotation)
    }
  }

  private fun loadImage(w: Int, h: Int, cw: Int, ch: Int, rotation: Int) {
    imgY = null; imgU = null; imgV = null
    val path = BackgroundConfig.imagePath ?: return
    val bmp = BitmapFactory.decodeFile(path) ?: return
    try {
      val rot = rotation % 180 != 0
      val dw = if (rot) h else w
      val dh = if (rot) w else h
      // Mode « couvrir » : remplit le cadre affiché sans déformation.
      val s = max(dw.toFloat() / bmp.width, dh.toFloat() / bmp.height)
      val sw = max(dw, (bmp.width * s).toInt())
      val sh = max(dh, (bmp.height * s).toInt())
      val scaled = Bitmap.createScaledBitmap(bmp, sw, sh, true)
      val px = IntArray(dw * dh)
      scaled.getPixels(px, 0, dw, (sw - dw) / 2, (sh - dh) / 2, dw, dh)
      if (scaled !== bmp) scaled.recycle()
      val yy = ByteArray(w * h)
      val uu = ByteArray(cw * ch)
      val vv = ByteArray(cw * ch)
      for (by in 0 until h) for (bx in 0 until w) {
        val (dx, dy) = toDisplay(bx, by, w, h, rotation)
        val c = px[dy * dw + dx]
        val r = (c shr 16) and 0xff
        val g = (c shr 8) and 0xff
        val b = c and 0xff
        yy[by * w + bx] = (((66 * r + 129 * g + 25 * b + 128) shr 8) + 16).toByte()
        if (bx % 2 == 0 && by % 2 == 0) {
          val i = (by / 2) * cw + bx / 2
          uu[i] = (((-38 * r - 74 * g + 112 * b + 128) shr 8) + 128).toByte()
          vv[i] = (((112 * r - 94 * g - 18 * b + 128) shr 8) + 128).toByte()
        }
      }
      imgY = yy; imgU = uu; imgV = vv
    } finally {
      bmp.recycle()
    }
  }

  companion object {
    const val NAME = "forgechat-background"
    const val MODE_NONE = 0
    const val MODE_BLUR = 1
    const val MODE_IMAGE = 2
    private const val TAG = "ForgeBackground"
    @Volatile private var warned = false

    private var registered = false

    /** Déclare le processeur auprès de WebRTC (une fois par processus). */
    @Synchronized fun register() {
      if (registered) return
      ProcessorProvider.addProcessor(NAME) { BackgroundEffect() }
      registered = true
    }

    fun configure(mode: Int, imagePath: String?) {
      BackgroundConfig.imagePath = imagePath
      BackgroundConfig.imageVersion++
      BackgroundConfig.mode = mode
    }

    /** Coordonnées affichées (trame tournée de `rotation` degrés dans le sens horaire). */
    private fun toDisplay(bx: Int, by: Int, w: Int, h: Int, rotation: Int): Pair<Int, Int> = when ((rotation % 360 + 360) % 360) {
      90 -> Pair(h - 1 - by, bx)
      180 -> Pair(w - 1 - bx, h - 1 - by)
      270 -> Pair(by, w - 1 - bx)
      else -> Pair(bx, by)
    }

    /**
     * Ellipse « tête et épaules » dans l'image affichée : centrée en largeur, descendant jusqu'en
     * bas, bord fondu sur 15 % du rayon. Calculée dans les coordonnées du plan (luminance ou chrominance).
     */
    fun ellipseMask(w: Int, h: Int, rotation: Int): ByteArray {
      val rot = rotation % 180 != 0
      val dw = (if (rot) h else w).toFloat()
      val dh = (if (rot) w else h).toFloat()
      val cx = dw / 2f
      val cy = dh * 0.62f
      val rx = 0.40f * min(dw, dh)
      val ry = dh * 0.58f
      val feather = 0.15f
      val out = ByteArray(w * h)
      for (by in 0 until h) for (bx in 0 until w) {
        val (dx, dy) = toDisplay(bx, by, w, h, rotation)
        val nx = (dx - cx) / rx
        val ny = (dy - cy) / ry
        val d = sqrt(nx * nx + ny * ny)
        val a = when {
          d <= 1f - feather -> 255
          d >= 1f -> 0
          else -> ((1f - d) / feather * 255f).toInt()
        }
        out[by * w + bx] = a.toByte()
      }
      return out
    }

    private fun plane(buf: ByteBuffer, stride: Int, w: Int, h: Int): ByteArray {
      val out = ByteArray(w * h)
      val b = buf.duplicate()
      for (row in 0 until h) {
        b.position(row * stride)
        b.get(out, row * w, w)
      }
      return out
    }

    private fun write(buf: ByteBuffer, stride: Int, data: ByteArray, w: Int, h: Int) {
      val b = buf.duplicate()
      for (row in 0 until h) {
        b.position(row * stride)
        b.put(data, row * w, w)
      }
    }

    /**
     * Mélange le plan avec son fond : l'image (si fournie) ou le plan flouté (moyenne par blocs de
     * `block` pixels, puis interpolation bilinéaire). Seuls les pixels hors de l'ellipse sont calculés.
     */
    fun blend(p: ByteArray, w: Int, h: Int, mask: ByteArray, image: ByteArray?, block: Int) {
      val sw = (w + block - 1) / block
      val sh = (h + block - 1) / block
      val small = if (image == null) downsample(p, w, h, block, sw, sh) else FloatArray(0)
      for (y in 0 until h) {
        val row = y * w
        for (x in 0 until w) {
          val a = mask[row + x].toInt() and 0xff
          if (a == 255) continue
          val bg = if (image != null) (image[row + x].toInt() and 0xff).toFloat()
          else bilinear(small, sw, sh, (x + 0.5f) / block - 0.5f, (y + 0.5f) / block - 0.5f)
          val fg = (p[row + x].toInt() and 0xff).toFloat()
          p[row + x] = ((fg * a + bg * (255 - a)) / 255f).toInt().coerceIn(0, 255).toByte()
        }
      }
    }

    private fun downsample(p: ByteArray, w: Int, h: Int, block: Int, sw: Int, sh: Int): FloatArray {
      val sum = FloatArray(sw * sh)
      val cnt = IntArray(sw * sh)
      for (y in 0 until h) {
        val sy = (y / block) * sw
        val row = y * w
        for (x in 0 until w) {
          val i = sy + x / block
          sum[i] += (p[row + x].toInt() and 0xff).toFloat()
          cnt[i]++
        }
      }
      for (i in sum.indices) if (cnt[i] > 0) sum[i] /= cnt[i]
      return sum
    }

    private fun bilinear(s: FloatArray, sw: Int, sh: Int, fx: Float, fy: Float): Float {
      val x = fx.coerceIn(0f, (sw - 1).toFloat())
      val y = fy.coerceIn(0f, (sh - 1).toFloat())
      val x0 = x.toInt()
      val y0 = y.toInt()
      val x1 = min(x0 + 1, sw - 1)
      val y1 = min(y0 + 1, sh - 1)
      val tx = x - x0
      val ty = y - y0
      val top = s[y0 * sw + x0] * (1 - tx) + s[y0 * sw + x1] * tx
      val bottom = s[y1 * sw + x0] * (1 - tx) + s[y1 * sw + x1] * tx
      return top * (1 - ty) + bottom * ty
    }
  }
}

/** Réglage courant du fond virtuel, lu à chaque trame (fil de la caméra) ; écrit depuis le module. */
internal object BackgroundConfig {
  @Volatile var mode = BackgroundEffect.MODE_NONE
  @Volatile var imagePath: String? = null
  @Volatile var imageVersion = 0
}
