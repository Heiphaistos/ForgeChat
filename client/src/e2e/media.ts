// Vocal, appels, caméra et partage d'écran chiffrés de bout en bout (docs/CHIFFREMENT-E2E.md §5).
//
// LiveKit E2EE (trames chiffrées dans un worker, AES-GCM) avec une clé fournie par
// nous : clé de média = HKDF(clé de conversation de l'époque courante), donnée à
// LiveKit sous forme de chaîne (dérivation PBKDF2, commune au web, au mobile et
// au vocal natif Linux), index de clé = époque modulo l'anneau. Nouvelle époque
// pendant l'appel (départ d'un membre) : nouvelle clé, nouvel index.
//
// Le serveur dit si la salle exige le chiffrement (`livekit.e2ee`) ; chaque appli
// annonce le sien (`e2ee: true` dans VOICE_JOIN / GROUP_CALL_JOIN / DM_CALL_*),
// que le serveur reporte dans l'attribut LiveKit `e2ee = "1"` de son jeton.
import { RoomEvent, isE2EESupported, type Room, type RoomOptions } from 'livekit-client'
import { isNativeVoice, nativeSetKey, type NativeMediaKey } from '../lib/nativeVoice'
import { useWs } from '../store/ws'
import { currentKey, forgetConv, type ConvKind } from './conversations'
import * as c from './crypto'
import { MediaKeyProvider } from './mediaKeyProvider'

/** Conversation dont la clé chiffre les médias : `dm`, `group` ou `channel` (salon vocal). */
export type MediaKind = ConvKind | 'channel'

/** Ce navigateur sait chiffrer les médias (insertable streams ou RTCRtpScriptTransform). */
export const mediaE2EESupported = () => isE2EESupported()

/**
 * Champ à joindre aux messages d'entrée (VOICE_JOIN, GROUP_CALL_JOIN, DM_CALL_INIT/ACCEPT).
 * Application Linux : le vocal natif (SDK LiveKit Rust) chiffre lui-même.
 */
export const e2eeClaim = () => (mediaE2EESupported() || isNativeVoice() ? { e2ee: true } : {})

export interface MediaE2EE {
  /** À passer dans les options de la Room. */
  encryption: NonNullable<RoomOptions['encryption']>
  /** Écoute des nouvelles époques et worker : à arrêter en quittant la salle. */
  stop: () => void
}

/**
 * Suit la clé de média de la conversation : `apply(clé, index)` reçoit la clé de
 * l'époque courante, puis celle de chaque nouvelle époque (E2E_KEYS). Lève
 * `E2E_LOCKED` ou `E2E_WAITING` : l'appelant ne doit PAS se connecter en clair.
 * Rend la fonction d'arrêt du suivi.
 */
export async function followMediaKey(
  kind: MediaKind, id: string, apply: (key: string, index: number) => Promise<unknown>,
): Promise<() => void> {
  // `channel` : même API que dm/group côté serveur (docs §4.1) ; le type suit conversations.ts.
  const k = kind as ConvKind
  const conv = `${kind}:${id}`
  forgetConv(k, id) // époque courante relue : une rotation a pu avoir lieu
  const first = await currentKey(k, id)
  let epoch = first.epoch
  await apply(await c.mediaKey(first.key, conv, epoch), c.mediaKeyIndex(epoch))
  let stopped = false
  const off = useWs.getState().on('E2E_KEYS', (raw) => {
    const d = raw as { conv_kind?: string; conv_id?: string }
    if (d.conv_kind !== kind || d.conv_id !== id) return
    void (async () => {
      forgetConv(k, id)
      const next = await currentKey(k, id).catch(() => null)
      if (stopped || !next || next.epoch === epoch) return
      epoch = next.epoch
      await apply(await c.mediaKey(next.key, conv, epoch), c.mediaKeyIndex(epoch)).catch(() => {})
    })()
  })
  return () => { stopped = true; off() }
}

/** Chiffrement des médias d'une Room web (worker LiveKit + notre fournisseur de clé). */
export async function openMediaE2EE(kind: MediaKind, id: string): Promise<MediaE2EE> {
  if (!mediaE2EESupported()) throw new Error('E2E_UNSUPPORTED')
  const keyProvider = new MediaKeyProvider()
  const stopKeys = await followMediaKey(kind, id, (key, index) => keyProvider.setMediaKey(key, index))
  const worker = new Worker(new URL('livekit-client/e2ee-worker', import.meta.url), { type: 'module' })
  let stopped = false
  return {
    encryption: { keyProvider, worker },
    stop: () => {
      if (stopped) return
      stopped = true
      stopKeys()
      worker.terminate()
    },
  }
}

/** Vocal natif Linux : première clé pour `nv_connect`, les suivantes par `nv_set_key`. */
export async function nativeMediaKey(kind: MediaKind, id: string): Promise<{ first: NativeMediaKey; stop: () => void }> {
  const box: { first?: NativeMediaKey } = {}
  const stop = await followMediaKey(kind, id, async (key, index) => {
    if (box.first) await nativeSetKey({ key, index })
    else box.first = { key, index }
  })
  return { first: box.first!, stop }
}

/**
 * Active le chiffrement avant la connexion ; le libère à la déconnexion.
 * ponytail: une connexion qui échoue avant d'aboutir garde son worker jusqu'au
 * rechargement ; appeler `stop()` dans chaque chemin d'échec si cela pèse.
 */
export async function enableMediaE2EE(room: Room, e2ee: MediaE2EE) {
  room.once(RoomEvent.Disconnected, e2ee.stop)
  await room.setE2EEEnabled(true)
}

/**
 * Participants dont l'appli ne chiffre pas (attribut `e2ee` absent) : ils
 * n'entendent que du bruit chiffré. `cb` reçoit leurs identités à chaque changement.
 */
export function watchOutdated(room: Room, cb: (identities: string[]) => void) {
  const check = () => cb([...room.remoteParticipants.values()]
    .filter(p => p.attributes?.e2ee !== '1').map(p => p.identity))
  room
    .on(RoomEvent.ParticipantConnected, check)
    .on(RoomEvent.ParticipantDisconnected, check)
    .on(RoomEvent.ParticipantAttributesChanged, check)
    .on(RoomEvent.Connected, check)
  check()
}

/** Message lisible d'un échec de préparation du chiffrement. */
export function mediaE2EEError(e: unknown): 'e2e.call.unsupported' | 'e2e.send.locked' | 'e2e.send.waiting' | 'e2e.call.failed' {
  const m = e instanceof Error ? e.message : ''
  if (m === 'E2E_UNSUPPORTED') return 'e2e.call.unsupported'
  if (m === 'E2E_LOCKED') return 'e2e.send.locked'
  if (m === 'E2E_WAITING') return 'e2e.send.waiting'
  return 'e2e.call.failed'
}
