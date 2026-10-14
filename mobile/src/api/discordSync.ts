import { normalizeConfig, type SyncConfig } from '@/features/servers/discordSync'
import type { SyncTree } from '@/features/servers/discordSyncTree'
import { http, path } from '@/lib/http'

/** Synchro Discord d'un serveur (handlers/discord_import/sync.rs) : tout exige MANAGE_SERVER ; délier = propriétaire. */
export const discordSyncApi = {
  async get(serverId: string): Promise<SyncConfig> {
    return normalizeConfig(await http.get<unknown>(path`/servers/${serverId}/discord-sync`))
  },
  async put(serverId: string, body: object): Promise<SyncConfig> {
    return normalizeConfig(await http.put<unknown>(path`/servers/${serverId}/discord-sync`, body))
  },
  remove: (serverId: string) => http.delete(path`/servers/${serverId}/discord-sync`),
  run: (serverId: string) => http.post<unknown>(path`/servers/${serverId}/discord-sync/run`),
  tree: (serverId: string) => http.get<SyncTree>(path`/servers/${serverId}/discord-sync/tree`),
}
