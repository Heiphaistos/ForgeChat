// Flou d'arrière-plan de la caméra (gratuit, calcul local) : MediaPipe détoure la personne image par
// image, le décor est flouté sur un canvas dont on diffuse le flux. Réglage « fc_cam_blur ».
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
        ctx.filter = 'blur(14px)'
        ctx.drawImage(video, 0, 0, w, h)
        ctx.filter = 'none'
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
