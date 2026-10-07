import { create } from 'zustand'
import { http } from '@/lib/http'
import { logger } from '@/lib/logger'
import { realtime, type RealtimeEvent } from '@/lib/realtime'

/**
 * Qui est dans quel salon vocal (liste des salons, comme la barre latérale du web) : état initial
 * GET /voice/state (salons occupés de mes serveurs), puis VOICE_USER_JOINED / VOICE_USER_LEFT /
 * VOICE_STATE_UPDATE. Le serveur n'envoie pas mes propres événements : ma présence vient de stores/voice.
 */
export interface VoiceRoomMember {
  userId: string
  username: string
  avatar: string | null
  muted: boolean
}

export const useVoiceRooms = create<{ rooms: Record<string, VoiceRoomMember[]> }>(() => ({ rooms: {} }))

const str = (v: unknown): string | null => (typeof v === 'string' && v.length > 0 && v.length < 200 ? v : null)

function member(raw: Record<string, unknown>): VoiceRoomMember | null {
  const userId = str(raw.user_id)
  if (!userId) return null
  return {
    userId,
    username: str(raw.username) ?? '…',
    avatar: str(raw.avatar),
    muted: raw.muted === true || raw.server_muted === true,
  }
}

function patchRoom(channelId: string, fn: (list: VoiceRoomMember[]) => VoiceRoomMember[]) {
  useVoiceRooms.setState((s) => ({ rooms: { ...s.rooms, [channelId]: fn(s.rooms[channelId] ?? []) } }))
}

async function bootstrap() {
  try {
    const data = await http.get<{ channels?: { channel_id?: unknown; participants?: unknown }[] }>('/voice/state')
    const rooms: Record<string, VoiceRoomMember[]> = {}
    for (const c of data.channels ?? []) {
      const id = str(c.channel_id)
      if (!id || !Array.isArray(c.participants)) continue
      rooms[id] = (c.participants as Record<string, unknown>[]).flatMap((p) => (p && typeof p === 'object' ? (member(p) ?? []) : []))
    }
    useVoiceRooms.setState({ rooms })
  } catch (e) {
    logger.debug('voix', 'état des salons vocaux', e)
  }
}

/** À chaque (re)connexion du WebSocket : état complet, puis événements. */
export function bindVoiceRooms(): () => void {
  const offs = [
    realtime.onOpen(() => void bootstrap()),
    realtime.on('VOICE_USER_JOINED', (e: RealtimeEvent) => {
      const channelId = str(e.channel_id)
      const m = member(e)
      if (!channelId || !m) return
      // Un utilisateur n'est que dans un salon vocal à la fois.
      useVoiceRooms.setState((s) => {
        const rooms: Record<string, VoiceRoomMember[]> = {}
        for (const [id, list] of Object.entries(s.rooms)) rooms[id] = list.filter((p) => p.userId !== m.userId)
        rooms[channelId] = [...(rooms[channelId] ?? []), m]
        return { rooms }
      })
    }),
    realtime.on('VOICE_USER_LEFT', (e: RealtimeEvent) => {
      const channelId = str(e.channel_id)
      const userId = str(e.user_id)
      if (channelId && userId) patchRoom(channelId, (list) => list.filter((p) => p.userId !== userId))
    }),
    realtime.on('VOICE_STATE_UPDATE', (e: RealtimeEvent) => {
      const channelId = str(e.channel_id)
      const userId = str(e.user_id)
      if (channelId && userId) patchRoom(channelId, (list) => list.map((p) => (p.userId === userId ? { ...p, muted: e.muted === true } : p)))
    }),
  ]
  return () => offs.forEach((off) => off())
}
