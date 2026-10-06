// Salon AFK (comme Discord) : un membre resté silencieux dans un salon vocal au-delà du délai
// réglé par le serveur est déplacé vers le salon AFK. La détection se fait chez le client, qui
// est le seul à savoir s'il parle (indicateur de parole LiveKit).
import toast from 'react-hot-toast'
import api from '../api/client'
import { useAuth } from './auth'
import { useVoice } from './voice'

interface AfkInfo { channelId: string | null; timeoutMs: number; at: number }
const cache = new Map<string, AfkInfo>()
const CACHE_MS = 5 * 60_000

/** Délai en ms. Colonne historiquement en minutes (défaut 5), le réglage web envoie des secondes (≥ 60). */
export function afkTimeoutMs(v: unknown): number {
  const n = Number(v)
  if (!Number.isFinite(n) || n <= 0) return 5 * 60_000
  return (n < 60 ? n * 60 : n) * 1000
}

async function afkInfo(serverId: string): Promise<AfkInfo> {
  const hit = cache.get(serverId)
  if (hit && Date.now() - hit.at < CACHE_MS) return hit
  const { data } = await api.get(`/servers/${serverId}`)
  const s = data?.server ?? data
  const info = { channelId: typeof s?.afk_channel_id === 'string' ? s.afk_channel_id : null, timeoutMs: afkTimeoutMs(s?.afk_timeout_minutes), at: Date.now() }
  cache.set(serverId, info)
  return info
}

let lastActive = Date.now()
let lastChannel: string | null = null
let started = false

export function startAfkWatch() {
  if (started || typeof window === 'undefined') return
  started = true
  useVoice.subscribe(s => {
    if (s.channelId !== lastChannel) { lastChannel = s.channelId; lastActive = Date.now() }
    const me = useAuth.getState().user?.id
    if (me && s.sfuSpeakers.includes(me)) lastActive = Date.now()
  })
  setInterval(() => {
    const s = useVoice.getState()
    if (!s.joined || !s.channelId || !s.serverId) return
    const { channelId, serverId } = s
    afkInfo(serverId).then(info => {
      const cur = useVoice.getState()
      if (!info.channelId || cur.channelId !== channelId || channelId === info.channelId) return
      if (Date.now() - lastActive < info.timeoutMs) return
      toast('Inactif : déplacé dans le salon AFK', { icon: '💤' })
      void cur.join(info.channelId, serverId)
    }).catch(() => { /* réseau : on réessaie au prochain passage */ })
  }, 30_000)
}
