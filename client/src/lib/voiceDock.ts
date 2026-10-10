// Panneau vocal du bas à gauche (carte de stream, minuteur) : fonctions pures, testées
// par scripts/voiceDock.test.mjs.

/** Hauteurs proposées pour le partage ; « source » = taille native de l'écran ou de la fenêtre. */
export const SCREEN_HEIGHTS = ['720', '1080', '1440', 'source'] as const
export const SCREEN_FPS = ['15', '30', '60'] as const

/** Contraintes vidéo du partage d'écran (fc_screen_height, fc_screen_fps). */
export function screenCaptureConstraints(height: string | null, fps: number): MediaTrackConstraints {
  const h = Number(height ?? 1080)
  const frameRate = { ideal: fps }
  // Sans largeur ni hauteur, applyConstraints rend la taille native : c'est l'option « source ».
  return h > 0 ? { width: { ideal: Math.round((h * 16) / 9) }, height: { ideal: h }, frameRate } : { frameRate }
}

/** Libellés techniques de Chrome (« window:1234:0 », onglet) : aucun nom lisible. */
const TECHNICAL_LABEL = /^(screen|window|web-contents-media-stream):/i

/**
 * Nom de la source partagée tiré du libellé de la piste : titre de fenêtre (Firefox), sinon
 * numéro d'écran (« screen:0:0 » de Chrome = écran 1). null : le navigateur ne dit rien.
 */
export function sourceFromLabel(label: string): { name: string } | { screen: number } | null {
  const l = label.trim()
  const screen = /^screen:(\d+):/i.exec(l)
  if (screen) return { screen: Number(screen[1]) + 1 }
  return l && !TECHNICAL_LABEL.test(l) ? { name: l } : null
}

/** « 1440p 30 FPS » à partir de getSettings() de la piste. */
export function streamSummary(s: { height?: number; frameRate?: number }): string {
  const parts: string[] = []
  if (s.height) parts.push(`${Math.round(s.height)}p`)
  if (s.frameRate) parts.push(`${Math.round(s.frameRate)} FPS`)
  return parts.join(' ')
}

/** Durée d'appel : m:ss, puis h:mm:ss au-delà d'une heure. */
export function formatDuration(totalSeconds: number): string {
  const s = Math.max(0, Math.floor(totalSeconds))
  const pad = (n: number) => String(n).padStart(2, '0')
  return s >= 3600
    ? `${Math.floor(s / 3600)}:${pad(Math.floor((s % 3600) / 60))}:${pad(s % 60)}`
    : `${Math.floor(s / 60)}:${pad(s % 60)}`
}

/** Son du partage d'écran voulu (coché par défaut) ; appliqué à chaud et aux partages suivants. */
export const SCREEN_AUDIO_KEY = 'fc_screen_audio'
export const screenAudioWanted = () => localStorage.getItem(SCREEN_AUDIO_KEY) !== 'false'
