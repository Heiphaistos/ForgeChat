import toast from 'react-hot-toast'
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
    if (flags.serverDeafened) toast('Un modérateur vous a mis en sourdine sur ce serveur.')
    else if (flags.serverMuted) toast('Un modérateur vous a rendu muet sur ce serveur.')
    else toast('Votre micro a été rétabli par un modérateur.')
  })

  const offMove = ws.on('VOICE_MOVE', (d: any) => {
    const s = get()
    if (!s.joined || !d.channel_id || !d.server_id) return
    const listenOnly = s.listenOnly
    s.leave()
    void get().join(d.channel_id, d.server_id, false, undefined, d.channel_name ?? undefined, listenOnly)
    toast(`Un modérateur vous a déplacé vers « ${d.channel_name ?? 'un autre salon'} ».`)
  })

  const offDisconnect = ws.on('VOICE_FORCE_DISCONNECT', (d: any) => {
    const s = get()
    if (!s.joined || (d.channel_id && d.channel_id !== s.channelId)) return
    s.leave()
    toast('Un modérateur vous a déconnecté du salon vocal.')
  })

  return () => { offState(); offMove(); offDisconnect() }
}
