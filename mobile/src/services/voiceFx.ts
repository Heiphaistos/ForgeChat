import { requireOptionalNativeModule } from 'expo'
import { RoomEvent, Track, type AudioCaptureOptions, type Room } from 'livekit-client'
import { Platform } from 'react-native'
import { logger } from '@/lib/logger'
import { useVoiceFx, type CameraBackground, type NoiseLevel } from '@/stores/voiceFx'

/**
 * Effets locaux des appels et salons vocaux (réglages « Voix et vidéo »), appliqués SUR
 * L'APPAREIL avant l'encodage et le chiffrement de bout en bout :
 *  - suppression de bruit : options de capture WebRTC natives, plus une porte de bruit native
 *    (modules/call-service NoiseGate.kt) au niveau « fort » ;
 *  - fond virtuel : processeur de trames natif (BackgroundEffect.kt) posé sur la caméra ;
 *  - appuyer pour parler avec la touche volume bas (VolumeKeys.kt).
 * iOS : options de capture seulement (pas de module natif).
 */
interface FxNative {
  setNoiseGate(on: boolean): boolean
  setVideoBackground(mode: number, imagePath: string | null): void
  importBackground(uri: string): Promise<string>
  setVolumeKeys(on: boolean): boolean
  addListener(event: 'onVolumeKey', fn: (e: { down: boolean }) => void): { remove(): void }
}

const mod = Platform.OS === 'android' ? requireOptionalNativeModule<FxNative>('ForgeCallService') : null
/** null : iOS, ou appli sans le module natif à jour. */
const native = mod && typeof mod.setNoiseGate === 'function' ? mod : null

export const fxSupported = { gate: !!native, background: !!native, volumePtt: !!native }

export const BACKGROUND_EFFECT = 'forgechat-background'
const BACKGROUND_MODE: Record<CameraBackground, number> = { none: 0, blur: 1, image: 2 }

/** Options de capture du micro pour un niveau de suppression de bruit (testé). */
export function captureOptionsFor(level: NoiseLevel): AudioCaptureOptions {
  // L'annulation d'écho reste active : sans elle, le haut-parleur repart dans le micro.
  if (level === 'off') return { echoCancellation: true, noiseSuppression: false, autoGainControl: false }
  return { echoCancellation: true, noiseSuppression: true, autoGainControl: true }
}


function safe<T>(what: string, fn: () => T): T | undefined {
  try {
    return fn()
  } catch (e) {
    logger.warn('voicefx', what, e)
    return undefined
  }
}

/** Porte de bruit et fond virtuel natifs alignés sur les réglages. */
function applyNative() {
  if (!native) return
  const { noise, background, backgroundImage } = useVoiceFx.getState()
  safe('porte de bruit', () => native.setNoiseGate(noise === 'strong'))
  const mode = background === 'image' && !backgroundImage ? 'blur' : background
  safe('fond virtuel', () => native.setVideoBackground(BACKGROUND_MODE[mode], mode === 'image' ? backgroundImage : null))
}

/**
 * Options de capture du micro courantes, pour `new Room({ audioCaptureDefaults })`. Réapplique aussi
 * les effets natifs : le point d'insertion audio de LiveKit n'existe qu'une fois WebRTC chargé.
 */
export function audioCaptureDefaults(): AudioCaptureOptions {
  applyNative()
  return captureOptionsFor(useVoiceFx.getState().noise)
}

/** Démarrage de l'appli et changement de réglage : effets natifs appliqués tout de suite. */
export function initVoiceFx() {
  applyNative()
  useVoiceFx.subscribe((s, prev) => {
    if (s.noise !== prev.noise || s.background !== prev.background || s.backgroundImage !== prev.backgroundImage) applyNative()
  })
}

/** Image de fond choisie : copiée et réduite par le module natif ; renvoie son chemin. */
export async function importBackground(uri: string): Promise<string> {
  if (!native) throw new Error('unsupported')
  return native.importBackground(uri)
}

/**
 * Pose le processeur de fond virtuel sur chaque caméra publiée dans `room` (il ne fait rien tant
 * que le réglage vaut « aucun » : changer de réglage s'applique en direct). Le changement de
 * caméra avant/arrière garde la même piste, donc l'effet.
 */
export function watchCameraEffect(room: Room) {
  if (!native) return
  room.on(RoomEvent.LocalTrackPublished, (pub) => {
    if (pub.source !== Track.Source.Camera) return
    const mst = pub.track?.mediaStreamTrack as unknown as { _setVideoEffects?: (names: string[]) => void } | undefined
    safe('effet caméra', () => mst?._setVideoEffects?.([BACKGROUND_EFFECT]))
  })
}

/** Touche volume bas = appuyer pour parler : `onKey(true)` à l'appui, `onKey(false)` au relâché. */
export function startVolumePtt(onKey: (down: boolean) => void): () => void {
  if (!native) return () => undefined
  const sub = native.addListener('onVolumeKey', (e) => onKey(e.down === true))
  safe('touche volume', () => native.setVolumeKeys(true))
  return () => {
    sub.remove()
    safe('touche volume', () => native.setVolumeKeys(false))
  }
}
