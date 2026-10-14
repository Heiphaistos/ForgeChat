import toast from 'react-hot-toast'
import { t as tr } from '../i18n'
import { useWs } from './ws'
import { useAuth } from './auth'
import type { VoicePeer, VoiceRoomParticipant } from './voice'

/**
 * Modération vocale (P2-2) : événements envoyés par le serveur quand un
 * modérateur rend muet, met en sourdine, déplace ou déconnecte un membre.
 * Le serveur a déjà appliqué l'action au SFU ; ici on aligne l'interface.
 */
interface Store {
  joined: boolean
  channelId: string | null
  listenOnly: boolean
  muted: boolean
  serverMuted: boolean
  serverDeafened: boolean
  peers: VoicePeer[]
  roomParticipants: Record<string, VoiceRoomParticipant[]>
  leave(): void
  join(channelId: string, serverId: string, withVideo?: boolean, password?: string, channelName?: string, listenOnly?: boolean): Promise<void>
}

export function initVoiceModeration(
  get: () => Store,
  set: (fn: (s: Store) => Partial<Store>) => void,
  applyImposed: (muted: boolean, deafened: boolean) => void,
): () => void {
  const ws = useWs.getState()

  const offState = ws.on('VOICE_SERVER_STATE', (d: any) => {
    const flags = { serverMuted: d.server_muted === true, serverDeafened: d.server_deafened === true }
    set(s => ({
      roomParticipants: d.channel_id && s.roomParticipants[d.channel_id]
        ? {
            ...s.roomParticipants,
            [d.channel_id]: s.roomParticipants[d.channel_id].map(p => p.userId === d.user_id
              ? { ...p, ...flags, muted: p.muted || flags.serverMuted || flags.serverDeafened }
              : p),
          }
        : s.roomParticipants,
      peers: s.peers.map(p => p.userId === d.user_id ? { ...p, ...flags } : p),
    }))
    if (d.user_id !== useAuth.getState().user?.id) return
    const inChannel = get().joined && (!d.channel_id || d.channel_id === get().channelId)
    if (inChannel) applyImposed(flags.serverMuted, flags.serverDeafened)
    if (flags.serverDeafened) toast(tr('hc.t.modDeaf'))
    else if (flags.serverMuted) toast(tr('hc.t.modMute'))
    // Le micro reste coupé localement après la levée : le dire, au lieu
    // d'annoncer un micro « rétabli » qui ne transmet rien.
    else if (inChannel && get().muted) toast(tr('hc.t.modUnmuteRe'))
    else toast(tr('hc.t.modUnmute'))
  })

  const offMove = ws.on('VOICE_MOVE', (d: any) => {
    const s = get()
    if (!s.joined || !d.channel_id || !d.server_id) return
    const listenOnly = s.listenOnly
    s.leave()
    void get().join(d.channel_id, d.server_id, false, undefined, d.channel_name ?? undefined, listenOnly)
    toast(tr('hc.t.modMoved', { name: d.channel_name ?? tr('hc.t.anotherChannel') }))
  })

  const offDisconnect = ws.on('VOICE_FORCE_DISCONNECT', (d: any) => {
    const s = get()
    if (!s.joined || (d.channel_id && d.channel_id !== s.channelId)) return
    s.leave()
    // media_lost : retiré par le serveur après 20 s sans connexion au média.
    toast(d.reason === 'media_lost'
      ? tr('sw.v.modDropped')
      : tr('sw.v.modKicked'))
  })

  return () => { offState(); offMove(); offDisconnect() }
}
