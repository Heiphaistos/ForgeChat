/**
 * Partage d'écran — logique pure (testée), partagée par les stores d'appel et de vocal.
 *
 * Protocole du client web (client/src/store/voice.ts), reproduit à l'identique en vocal :
 *  - la piste écran part dans un MediaStream distinct (msid ≠ micro/caméra), ajoutée par
 *    addTrack puis renégociation ; retirée par removeTrack puis renégociation ;
 *  - VOICE_STATE { screen: true|false } → le serveur diffuse VOICE_STATE_UPDATE et
 *    STREAM_START / STREAM_END ;
 *  - à la réception, le 1er flux vu d'un pair est le groupe micro+caméra ; toute piste vidéo
 *    d'un flux d'id différent est l'écran partagé.
 * Appel 1:1 : le web n'a pas de partage d'écran et n'affiche la vidéo distante qu'en appel
 * vidéo. On remplace donc la piste caméra envoyée (replaceTrack, sans renégociation) : le
 * correspondant, web ou mobile, voit l'écran à la place de la caméra.
 */

export const SCREEN_SHARE_WARNING =
  'Tout ce qui s’affiche sur ton écran sera visible, y compris les notifications.'

/** Résultat du tri d'une piste reçue : écran partagé ou groupe micro+caméra. */
export function classifyIncomingTrack(
  camStreamId: string | undefined,
  streamId: string,
  kind: string,
): { isScreen: boolean; camStreamId: string } {
  const isScreen = kind === 'video' && camStreamId !== undefined && streamId !== camStreamId
  // Le 1er flux vu (piste audio ou 1re vidéo) devient la référence micro+caméra.
  return { isScreen, camStreamId: camStreamId ?? streamId }
}

/** Partage possible en appel 1:1 : appel vidéo établi (le web n'affiche rien en appel vocal). */
export const canShareInCall = (phase: string, callType: string) => phase === 'connected' && callType === 'video'

/** Raison affichée quand le bouton de partage est indisponible en appel 1:1, sinon null. */
export function callShareUnavailableReason(phase: string, callType: string): string | null {
  if (phase !== 'connected') return 'Attends que l’appel soit établi.'
  if (callType !== 'video') return 'Le partage d’écran n’est disponible qu’en appel vidéo.'
  return null
}

/**
 * Refus ou fermeture du dialogue système : react-native-webrtc rejette avec le message
 * « NotAllowedError » (refus) ou « AbortError ». C'est un choix de l'utilisateur, pas une erreur
 * à afficher.
 */
export function isScreenShareCancel(e: unknown): boolean {
  // react-native-webrtc rejette avec un MediaStreamError { name, message } qui n'hérite pas d'Error.
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
