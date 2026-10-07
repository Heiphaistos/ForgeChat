// Vocal natif de l'application Linux.
//
// La WebKitGTK des distributions n'a pas WebRTC : le son et la vidéo passent par
// le processus Rust (SDK LiveKit natif, `desktop/src-tauri/src/native_voice`).
// Ici, seulement le pilotage : commandes `nv_*` et événements `nv:*`.
// La vidéo reçue arrive sous forme d'URL vidéo locale, affichée par un <img>.
import { webrtcMissing } from './webrtcSupport'

const isTauri = typeof window !== 'undefined' && '__TAURI_INTERNALS__' in window

/** Vrai dans l'application Linux : les appels doivent passer par le natif. */
export const isNativeVoice = () => isTauri && webrtcMissing()

export interface NativeTrackEvent {
  identity: string
  source: 'camera' | 'screen' | 'microphone' | 'screen_audio'
  active: boolean
  url: string | null
}

export interface NativeStateEvent {
  status: 'connecting' | 'connected' | 'reconnecting' | 'disconnected' | 'failed'
  quality: 'excellent' | 'good' | 'poor' | 'lost' | null
  reason: string | null
}

export interface NativeHandlers {
  onTrack: (e: NativeTrackEvent) => void
  onSpeakers: (identities: string[]) => void
  onState: (e: NativeStateEvent) => void
  /** Partage d'écran arrêté par le système (portail fermé). */
  onLocalEnded?: (source: string) => void
  /** La session native est reprise par l'autre usage (salon vocal / appel privé). */
  onEvicted: () => void
}

/** Le processus natif n'a qu'UNE session : salon vocal OU appel privé. */
export type NativeOwner = 'voice' | 'call'

let _unlisten: Array<() => void> = []
let _owner: NativeOwner | null = null
let _onEvicted: (() => void) | null = null

async function tauriInvoke<T>(cmd: string, args?: Record<string, unknown>): Promise<T> {
  const { invoke } = await import('@tauri-apps/api/core')
  return invoke<T>(cmd, args)
}

/** Clé de média de bout en bout (e2e/media.ts) : chaîne donnée à LiveKit et index dans l'anneau. */
export interface NativeMediaKey { key: string; index: number }

export async function nativeConnect(
  owner: NativeOwner, url: string, token: string, ice: RTCIceServer[], mic: boolean, micOpen: boolean, h: NativeHandlers,
  e2ee: NativeMediaKey | null = null,
): Promise<void> {
  // L'autre usage perd sa session (le natif la ferme en se connectant) : il nettoie
  // son état sans fermer la nôtre — avant, quitter le salon vocal coupait l'appel.
  if (_owner && _owner !== owner) {
    const evicted = _onEvicted
    _owner = null
    evicted?.()
  }
  _owner = owner
  _onEvicted = h.onEvicted
  const { listen } = await import('@tauri-apps/api/event')
  _unlisten.forEach(u => u())
  _unlisten = await Promise.all([
    listen<NativeTrackEvent>('nv:track', e => h.onTrack(e.payload)),
    listen<string[]>('nv:speakers', e => h.onSpeakers(e.payload)),
    listen<NativeStateEvent>('nv:state', e => h.onState(e.payload)),
    listen<string>('nv:local_ended', e => h.onLocalEnded?.(e.payload)),
  ])
  // Une panne dans le processus natif (panique d'un thread) laisse la commande sans
  // réponse : au bout de 30 s on le dit, au lieu d'afficher « Connexion… » à vie.
  await Promise.race([
    tauriInvoke('nv_connect', { url, token, ice, mic, micOpen, e2ee }),
    new Promise((_, reject) => setTimeout(() => reject(new Error('le module audio/vidéo ne répond pas')), 30_000)),
  ])
}

export async function nativeDisconnect(owner: NativeOwner): Promise<void> {
  if (_owner !== owner) return // session déjà reprise par l'autre usage
  _owner = null
  _onEvicted = null
  _unlisten.forEach(u => u())
  _unlisten = []
  await tauriInvoke('nv_disconnect').catch(e => console.warn('[voice] déconnexion native', e))
}

/** Nouvelle époque pendant l'appel : nouvelle clé de média. */
export const nativeSetKey = (k: NativeMediaKey) => tauriInvoke('nv_set_key', { key: k.key, index: k.index })
export const nativeSetMic = (open: boolean) => tauriInvoke('nv_set_mic', { open })
export const nativeSetDeafen = (deafened: boolean) => tauriInvoke('nv_set_deafen', { deafened })
export const nativeSetPeerAudio = (identity: string, enabled: boolean) => tauriInvoke('nv_set_peer_audio', { identity, enabled })
/** URL de l'aperçu local, ou null quand la caméra s'arrête. */
export const nativeSetCamera = (on: boolean) => tauriInvoke<string | null>('nv_set_camera', { on })
/** URL de l'aperçu local, ou null quand le partage s'arrête. */
export const nativeSetScreen = (on: boolean) => tauriInvoke<string | null>('nv_set_screen', { on })
/** Fenêtre détachée native pour un flux vidéo local. */
export const nativePopOut = (url: string, title: string) => tauriInvoke('nv_popout', { url, title })
