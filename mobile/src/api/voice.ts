import { http } from '@/lib/http'

export interface IceServer {
  urls: string | string[]
  username?: string
  credential?: string
}

/**
 * Relais TURN du serveur (/voice/ice-config), passés à LiveKit pour les réseaux qui filtrent
 * l'UDP direct. Uniquement les URL turn:/turns: : avec un SFU LiveKit, le client n'a pas besoin
 * de STUN, et un STUN public (ex. Google) verrait l'adresse IP de chaque participant.
 */
export function relayOnly(list: unknown): IceServer[] {
  if (!Array.isArray(list)) return []
  const out: IceServer[] = []
  for (const s of list as IceServer[]) {
    const urls = (Array.isArray(s?.urls) ? s.urls : [s?.urls]).filter(
      (u): u is string => typeof u === 'string' && /^turns?:/i.test(u),
    )
    if (urls.length) out.push({ urls, ...(s.username ? { username: s.username } : {}), ...(s.credential ? { credential: s.credential } : {}) })
  }
  return out
}

let cache: { at: number; servers: IceServer[] } | null = null

export const voiceApi = {
  /** Relais TURN (mis en cache 10 min : identifiants éphémères). Liste vide si indisponible. */
  async turnServers(): Promise<IceServer[]> {
    if (cache && Date.now() - cache.at < 10 * 60_000) return cache.servers
    try {
      const res = await http.get<{ ice_servers?: IceServer[] }>('/voice/ice-config')
      const servers = relayOnly(res.ice_servers)
      cache = { at: Date.now(), servers }
      return servers
    } catch {
      return []
    }
  },
}
