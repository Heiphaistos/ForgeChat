// Fond virtuel de la caméra (gratuit, calcul local) : MediaPipe détoure la personne image par
// image, le décor est flouté (ou remplacé par l'image choisie) sur un canvas dont on diffuse le
// flux. Réglage « fc_cam_blur » (activé) + « fc_cam_bg_image » (image facultative).
import type { ImageSegmenter } from '@mediapipe/tasks-vision'

const BASE = '/mediapipe'
let segmenter: Promise<ImageSegmenter> | null = null

function loadSegmenter(): Promise<ImageSegmenter> {
  segmenter ??= import('@mediapipe/tasks-vision').then(async ({ FilesetResolver, ImageSegmenter }) => {
    const files = await FilesetResolver.forVisionTasks(BASE)
    return ImageSegmenter.createFromOptions(files, {
      baseOptions: { modelAssetPath: `${BASE}/selfie_segmenter.tflite`, delegate: 'GPU' },
      runningMode: 'VIDEO',
      outputCategoryMask: false,
      outputConfidenceMasks: true,
    })
  }).catch(e => {
    segmenter = null
    throw e
  })
  return segmenter
}

export const blurEnabled = () => localStorage.getItem('fc_cam_blur') === 'true'

// Fond virtuel image : choisie par l'utilisateur, gardée sur l'appareil seulement (jamais envoyée
// au serveur), redimensionnée en JPEG ≤ 1280×720. Utilisée à la place du décor flouté si présente.
export const BG_IMAGE_KEY = 'fc_cam_bg_image'

export function backgroundImage(): string | null {
  try { return localStorage.getItem(BG_IMAGE_KEY) } catch { return null }
}

/** Lit une image choisie, la réduit et la garde comme fond virtuel ; renvoie l'URL data. */
export async function saveBackgroundImage(file: File): Promise<string> {
  const bmp = await createImageBitmap(file)
  const scale = Math.min(1, 1280 / bmp.width, 720 / bmp.height)
  const c = document.createElement('canvas')
  c.width = Math.round(bmp.width * scale)
  c.height = Math.round(bmp.height * scale)
  c.getContext('2d')?.drawImage(bmp, 0, 0, c.width, c.height)
  bmp.close()
  const url = c.toDataURL('image/jpeg', 0.85)
  localStorage.setItem(BG_IMAGE_KEY, url)
  return url
}

export const clearBackgroundImage = () => { try { localStorage.removeItem(BG_IMAGE_KEY) } catch { /* rien à effacer */ } }

async function loadImage(url: string | null): Promise<HTMLImageElement | null> {
  if (!url) return null
  const img = new Image()
  img.src = url
  try { await img.decode(); return img } catch { return null }
}

/**
 * Renvoie une piste vidéo au décor flouté si le réglage est actif, sinon la piste d'origine
 * (aussi en cas d'échec du moteur : la caméra marche toujours). Arrêter la piste rendue arrête
 * la caméra d'origine.
 */
export async function maybeBlur(track: MediaStreamTrack): Promise<MediaStreamTrack> {
  if (!blurEnabled()) return track
  try {
    return await blurTrack(track)
  } catch (e) {
    console.warn('[flou] moteur indisponible, caméra sans flou', e)
    return track
  }
}

async function blurTrack(track: MediaStreamTrack): Promise<MediaStreamTrack> {
  const seg = await loadSegmenter()
  const bg = await loadImage(backgroundImage())
  const video = document.createElement('video')
  video.muted = true
  video.playsInline = true
  video.srcObject = new MediaStream([track])
  await video.play()
  const w = video.videoWidth || 640
  const h = video.videoHeight || 480

  const out = document.createElement('canvas')
  out.width = w
  out.height = h
  const ctx = out.getContext('2d')
  const person = document.createElement('canvas')
  person.width = w
  person.height = h
  const pctx = person.getContext('2d')
  const mask = document.createElement('canvas')
  const mctx = mask.getContext('2d')
  if (!ctx || !pctx || !mctx) throw new Error('canvas 2D indisponible')

  const fps = track.getSettings().frameRate ?? 30
  const rendered = out.captureStream(fps).getVideoTracks()[0]
  if (!rendered) throw new Error('captureStream sans piste')

  let running = true
  let last = -1
  const frame = () => {
    if (!running) return
    const now = performance.now()
    if (video.readyState >= 2 && video.currentTime !== last) {
      last = video.currentTime
      seg.segmentForVideo(video, now, r => {
        const m = r.confidenceMasks?.[0]
        if (!m) return
        // Masque de confiance (0..1, personne) -> canal alpha.
        const conf = m.getAsFloat32Array()
        if (mask.width !== m.width || mask.height !== m.height) {
          mask.width = m.width
          mask.height = m.height
        }
        const img = mctx.createImageData(m.width, m.height)
        for (let i = 0; i < conf.length; i++) img.data[i * 4 + 3] = (conf[i] ?? 0) * 255
        mctx.putImageData(img, 0, 0)
        // Personne nette découpée par le masque, posée sur le décor flouté.
        pctx.globalCompositeOperation = 'copy'
        pctx.drawImage(video, 0, 0, w, h)
        pctx.globalCompositeOperation = 'destination-in'
        pctx.drawImage(mask, 0, 0, w, h)
        if (bg) {
          // Image en mode « couvrir » : remplit le cadre sans déformation.
          const k = Math.max(w / bg.width, h / bg.height)
          ctx.drawImage(bg, (w - bg.width * k) / 2, (h - bg.height * k) / 2, bg.width * k, bg.height * k)
        } else {
          ctx.filter = 'blur(14px)'
          ctx.drawImage(video, 0, 0, w, h)
          ctx.filter = 'none'
        }
        ctx.drawImage(person, 0, 0)
      })
    }
    // ponytail: requestAnimationFrame, suspendu onglet caché ; passer par un Worker si ça gêne.
    requestAnimationFrame(frame)
  }
  requestAnimationFrame(frame)

  const stop = rendered.stop.bind(rendered)
  rendered.stop = () => {
    running = false
    stop()
    track.stop()
    video.srcObject = null
  }
  track.addEventListener('ended', () => rendered.stop())
  return rendered
}
