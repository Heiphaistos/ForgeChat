/*
 * Favicon animé — cycle la source du <link rel="icon"> plutôt que de compter sur un
 * ICO/APNG animé natif (support navigateur trop inégal, cf. Chrome qui ignore
 * l'animation d'un .ico multi-frame). Frames pré-rendues depuis Logo3D
 * (public/favicon-frames/, générées hors-ligne via Playwright+Pillow).
 * Coupe l'intervalle en onglet masqué -- pas une concession d'accessibilité,
 * juste éviter de mettre à jour un favicon que personne ne regarde.
 */
const FRAME_COUNT = 8
const FRAME_INTERVAL_MS = 225
const FRAMES = Array.from({ length: FRAME_COUNT }, (_, i) => `/favicon-frames/f${i}.png`)

let timer: ReturnType<typeof setInterval> | null = null
let frameIndex = 0

function applyFrame() {
  const link = document.getElementById('dynamic-favicon') as HTMLLinkElement | null
  if (!link) return
  link.href = FRAMES[frameIndex]
  frameIndex = (frameIndex + 1) % FRAME_COUNT
}

function start() {
  if (timer) return
  timer = setInterval(applyFrame, FRAME_INTERVAL_MS)
}

function stop() {
  if (timer) { clearInterval(timer); timer = null }
}

export function initFaviconAnimation() {
  // Précharge les frames pour éviter un favicon manquant/blanc au premier cycle
  FRAMES.forEach(src => { const img = new Image(); img.src = src })

  if (document.visibilityState === 'visible') start()
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'visible') start()
    else stop()
  })
}
