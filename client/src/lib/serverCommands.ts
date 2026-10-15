// Commandes slash d'un serveur (natives ForgeBot + bots) : liste calculée par le serveur,
// `allowed` = ce que MOI je peux lancer. Le serveur revérifie à chaque exécution.
import { useQuery } from '@tanstack/react-query'
import api from '../api/client'
import type { ServerCommand } from './commandTypes'

export { commandUsage } from './commandTypes'
export type { CommandOption, ServerCommand } from './commandTypes'

export const serverCommandsKey = (serverId: string | undefined) => ['server_commands', serverId] as const

export function useServerCommands(serverId: string | undefined) {
  return useQuery<ServerCommand[]>({
    queryKey: serverCommandsKey(serverId),
    queryFn: () => api.get(`/servers/${serverId}/commands`).then(r => r.data),
    enabled: !!serverId,
    staleTime: 60_000,
  })
}
