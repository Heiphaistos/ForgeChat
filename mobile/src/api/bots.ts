import { normalizeBots, type ServerBot } from '@/features/servers/bots'
import { http, path } from '@/lib/http'

/** Bots d'un serveur (handlers/bots.rs) : lister = membre ; créer, supprimer, régénérer le jeton = MANAGE_SERVER. */
export const botsApi = {
  async list(serverId: string): Promise<ServerBot[]> {
    return normalizeBots(await http.get<unknown>(path`/servers/${serverId}/bots`))
  },
  create: (serverId: string, name: string) => http.post<unknown>(path`/servers/${serverId}/bots`, { name }),
  remove: (serverId: string, botUserId: string) => http.delete(path`/servers/${serverId}/bots/${botUserId}`),
  regenerate: (serverId: string, botUserId: string) => http.post<unknown>(path`/servers/${serverId}/bots/${botUserId}/token`),
}
