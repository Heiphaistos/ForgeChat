/**
 * Partage d'écran — logique pure (testée), partagée par les stores d'appel et de vocal.
 *
 * Média par LiveKit : l'écran est une piste de source ScreenShare, distincte du micro et de la
 * caméra ; en vocal, VOICE_STATE { screen: true|false } annonce le partage (le serveur diffuse
 * VOICE_STATE_UPDATE et STREAM_START / STREAM_END). En appel 1:1, le correspondant ne voit qu'une
 * vidéo : l'écran remplace la caméra le temps du partage.
 */
import { t } from '@/i18n'

/** Avertissement avant partage (traduit à l'affichage). */
export const SCREEN_SHARE_WARNING = () => t('store.screen.warning')

/** Partage possible en appel 1:1 : appel vidéo établi (le web n'affiche rien en appel vocal). */
export const canShareInCall = (phase: string, callType: string) => phase === 'connected' && callType === 'video'

/** Raison affichée quand le bouton de partage est indisponible en appel 1:1, sinon null. */
export function callShareUnavailableReason(phase: string, callType: string): string | null {
  if (phase !== 'connected') return t('store.screen.waitConnected')
  if (callType !== 'video') return t('store.screen.videoOnly')
  return null
}

/**
 * Refus ou fermeture du dialogue système : la capture (WebRTC) rejette avec le message
 * « NotAllowedError » (refus) ou « AbortError ». C'est un choix de l'utilisateur, pas une erreur
 * à afficher.
 */
export function isScreenShareCancel(e: unknown): boolean {
  // La pile WebRTC rejette avec un MediaStreamError { name, message } qui n'hérite pas d'Error.
  const o = (typeof e === 'object' && e !== null ? e : {}) as { name?: unknown; message?: unknown; code?: unknown }
  const text = typeof e === 'string' ? e : `${String(o.name ?? '')} ${String(o.message ?? '')} ${String(o.code ?? '')}`
  return /NotAllowedError|AbortError/.test(text)
}

// ─── Visionneuse : zoom au pincement ────────────────────────────────────────

export const ZOOM_MIN = 1
export const ZOOM_MAX = 5

export function clampZoom(scale: number): number {
  'worklet'
  if (!Number.isFinite(scale)) return ZOOM_MIN
  return Math.min(Math.max(scale, ZOOM_MIN), ZOOM_MAX)
}

/**
 * Décalage borné pour qu'une vue agrandie de `scale` fois `size` couvre toujours le cadre :
 * entre -(scale-1)*size et 0.
 */
export function clampOffset(offset: number, scale: number, size: number): number {
  'worklet'
  const min = -(scale - 1) * size
  return Math.min(Math.max(offset, min), 0) + 0 // + 0 : pas de -0 quand scale = 1
}
