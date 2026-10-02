import { http } from '@/lib/http'

export interface IceServer {
  urls: string | string[]
  username?: string
  credential?: string
}

/**
 * Pas de serveur STUN public de repli (il verrait l'adresse IP des utilisateurs) : uniquement les
 * serveurs STUN/TURN fournis par NOTRE serveur. Sans eux, l'appel est refusé avec ce message.
 */
export const ICE_UNAVAILABLE =
  'Appels indisponibles : le serveur ne fournit aucun serveur STUN/TURN. Préviens l’administrateur.'

/** Liste ICE utilisable, ou erreur claire si le serveur n'en fournit aucune. */
export function usableIceServers(list: unknown): IceServer[] {
  if (!Array.isArray(list) || list.length === 0) throw new Error(ICE_UNAVAILABLE)
  return list as IceServer[]
}

let cache: { at: number; servers: IceServer[] } | null = null

export const voiceApi = {
  /** Config ICE (STUN + TURN) — mise en cache 10 min (les identifiants TURN peuvent tourner). */
  async iceServers(): Promise<IceServer[]> {
    if (cache && Date.now() - cache.at < 10 * 60_000) return cache.servers
    let list: unknown
    try {
      list = (await http.get<{ ice_servers?: IceServer[] }>('/voice/ice-config')).ice_servers
    } catch {
      throw new Error(ICE_UNAVAILABLE)
    }
    const servers = usableIceServers(list)
    cache = { at: Date.now(), servers }
    return servers
  },
}
