// Vocal, appels, caméra et partage d'écran chiffrés de bout en bout (docs/CHIFFREMENT-E2E.md §5).
//
// Même schéma que le web (client/src/e2e/media.ts) : clé de média = HKDF(clé de
// conversation de l'époque courante), donnée à LiveKit sous forme de chaîne
// (dérivation PBKDF2 du chiffreur natif de @livekit/react-native-webrtc, identique
// au worker du web), index = époque modulo l'anneau. Chiffrement natif des trames
// (RNE2EEManager + RNKeyProvider), aucune configuration native supplémentaire :
// le module WebRTC de LiveKit déjà installé embarque le FrameCryptor.
import { RNE2EEManager, RNKeyProvider } from '@livekit/react-native'
import { RoomEvent, type Room } from 'livekit-client'
import type { Key } from '@/i18n'
import { realtime } from '@/lib/realtime'
import { useAccountKey } from './accountKey'
import { currentKey, forgetConv, type ConvKind } from './conversations'
import * as c from './crypto'

/** Conversation dont la clé chiffre les médias : `dm`, `group` ou `channel` (salon vocal). */
export type MediaKind = ConvKind | 'channel'

/** Champ à joindre aux messages d'entrée (VOICE_JOIN, GROUP_CALL_JOIN, DM_CALL_INIT/ACCEPT). */
export const E2EE_CLAIM = { e2ee: true } as const

/**
 * Clé partagée, sans ratchet automatique (comme le web). RNKeyProvider ne suit
 * l'index d'émission qu'en mode « une clé par participant » : on le fournit nous-mêmes.
 */
class MediaKeyProvider extends RNKeyProvider {
  private mediaIndex = 0
  constructor() {
    super({ sharedKey: true, ratchetWindowSize: 0, failureTolerance: -1, keyringSize: c.MEDIA_KEYRING })
  }
  override getLatestKeyIndex(): number {
    return this.mediaIndex
  }
  async setMediaKey(key: string, index: number) {
    await this.setSharedKey(key, index)
    this.mediaIndex = index
  }
}

/**
 * Les chiffreurs d'émission déjà créés gardent leur index : on leur donne celui de
 * la nouvelle époque. Le SDK ne l'expose pas (champ privé), d'où l'accès direct.
 */
function syncSenders(manager: RNE2EEManager, room: Room, index: number) {
  const cryptors = (manager as unknown as { frameCryptors?: Map<string, { setKeyIndex(i: number): Promise<boolean> }> }).frameCryptors
  for (const sid of room.localParticipant.trackPublications.keys()) void cryptors?.get(sid)?.setKeyIndex(index).catch(() => false)
}

export interface MediaE2EE {
  /** À passer dans les options de la Room (`encryption`). */
  encryption: { e2eeManager: RNE2EEManager }
  /** Arrête le suivi des époques et libère le fournisseur natif. */
  stop: () => void
  bind: (room: Room) => void
}

/**
 * Prépare le chiffrement des médias de la conversation : clé de l'époque courante,
 * puis celle de chaque nouvelle époque (E2E_KEYS). Lève `E2E_LOCKED` ou `E2E_WAITING` :
 * l'appelant ne doit PAS se connecter en clair.
 */
export async function openMediaE2EE(kind: MediaKind, id: string): Promise<MediaE2EE> {
  // `channel` : même API que dm/group côté serveur (docs §4.1) ; le type suit conversations.ts.
  const k = kind as ConvKind
  const conv = `${kind}:${id}`
  forgetConv(k, id) // époque courante relue : une rotation a pu avoir lieu
  const first = await currentKey(k, id)
  const keyProvider = new MediaKeyProvider()
  const manager = new RNE2EEManager(keyProvider, true)
  let epoch = first.epoch
  let room: Room | null = null
  let stopped = false
  const apply = async (key: Uint8Array) => {
    const index = c.mediaKeyIndex(epoch)
    await keyProvider.setMediaKey(await c.mediaKey(key, conv, epoch), index)
    if (room) syncSenders(manager, room, index)
  }
  try {
    await apply(first.key)
  } catch (e) {
    keyProvider.dispose()
    throw e
  }
  const off = realtime.on('E2E_KEYS', (d) => {
    if (d.conv_kind !== kind || d.conv_id !== id) return
    void (async () => {
      forgetConv(k, id)
      const next = await currentKey(k, id).catch(() => null)
      if (stopped || !next || next.epoch === epoch) return
      epoch = next.epoch
      await apply(next.key).catch(() => undefined)
    })()
  })
  return {
    encryption: { e2eeManager: manager },
    bind: (r) => { room = r },
    stop: () => {
      if (stopped) return
      stopped = true
      off()
      keyProvider.dispose()
    },
  }
}

/** Active le chiffrement avant la connexion ; le libère à la déconnexion. */
export async function enableMediaE2EE(room: Room, e2ee: MediaE2EE) {
  e2ee.bind(room)
  room.once(RoomEvent.Disconnected, e2ee.stop)
  await room.setE2EEEnabled(true)
}

/** Participants dont l'appli ne chiffre pas (attribut `e2ee` absent) : ils n'entendent que du bruit. */
export function watchOutdated(room: Room, cb: (identities: string[]) => void) {
  const check = () => cb([...room.remoteParticipants.values()].filter((p) => p.attributes?.e2ee !== '1').map((p) => p.identity))
  room
    .on(RoomEvent.ParticipantConnected, check)
    .on(RoomEvent.ParticipantDisconnected, check)
    .on(RoomEvent.ParticipantAttributesChanged, check)
    .on(RoomEvent.Connected, check)
  check()
}

/**
 * Clé de média pas encore disponible (`E2E_LOCKED` : clé de compte pas encore ouverte ;
 * `E2E_WAITING` : enveloppe de l'époque pas encore reçue) : `retry` dès qu'elle peut
 * l'être, sinon le salon restait muet pour de bon. Rend l'annulation, ou null si l'erreur
 * ne se résout pas seule. Même logique que le web (client/src/e2e/media.ts).
 */
export function retryWhenKeyReady(e: unknown, kind: MediaKind, id: string, retry: () => void): (() => void) | null {
  const m = e instanceof Error ? e.message : ''
  if (m !== 'E2E_LOCKED' && m !== 'E2E_WAITING') return null
  let done = false
  const fire = () => {
    if (done) return
    stop()
    retry()
  }
  const offKeys = realtime.on('E2E_KEYS', (d) => { if (d.conv_kind === kind && d.conv_id === id) fire() })
  const offAccount = useAccountKey.subscribe((s, prev) => { if (s.status === 'ready' && prev.status !== 'ready') fire() })
  const stop = () => { done = true; offKeys(); offAccount() }
  return stop
}

/** Message lisible d'un échec de préparation du chiffrement. */
export function mediaE2EEError(e: unknown): Key {
  const m = e instanceof Error ? e.message : ''
  if (m === 'E2E_LOCKED') return 'e2e.send.locked'
  if (m === 'E2E_WAITING') return 'e2e.send.waiting'
  return 'e2e.call.failed'
}
