import { http } from '@/lib/http'

export interface IceServer {
  urls: string | string[]
  username?: string
  credential?: string
}

const FALLBACK: IceServer[] = [{ urls: ['stun:stun.l.google.com:19302', 'stun:stun1.l.google.com:19302'] }]
let cache: { at: number; servers: IceServer[] } | null = null

export const voiceApi = {
  /** Config ICE (STUN + TURN) — mise en cache 10 min (les identifiants TURN peuvent tourner). */
  async iceServers(): Promise<IceServer[]> {
    if (cache && Date.now() - cache.at < 10 * 60_000) return cache.servers
    try {
      const res = await http.get<{ ice_servers?: IceServer[] }>('/voice/ice-config')
      const servers = Array.isArray(res.ice_servers) && res.ice_servers.length ? res.ice_servers : FALLBACK
      cache = { at: Date.now(), servers }
      return servers
    } catch {
      return FALLBACK
    }
  },
}
