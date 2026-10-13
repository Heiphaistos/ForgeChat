import { router } from 'expo-router'
import { serversApi } from '@/api/servers'
import { qk, queryClient } from '@/lib/queryClient'
import type { Channel } from '@/types/models'
import { cleanVoiceStatus } from '@/features/servers/discordFeatures'

/** Pose (ou efface : '' / null) le statut d'un salon vocal, puis l'applique tout de suite à la liste
 *  des salons (CHANNEL_UPDATE suit et relit la liste). */
export async function saveVoiceStatus(serverId: string, channelId: string, status: string | null) {
  const clean = status === null ? '' : cleanVoiceStatus(status)
  const r = await serversApi.setVoiceStatus(serverId, channelId, clean || null)
  queryClient.setQueryData<Channel[]>(qk.channels(serverId), (old) =>
    old?.map((c) => (c.id === channelId ? { ...c, voice_status: typeof r?.voice_status === 'string' ? r.voice_status : null } : c)),
  )
}

/** Écran de saisie du statut (Alert.prompt n'existe pas sur Android). */
export const openVoiceStatus = (serverId: string, channelId: string) =>
  router.push({ pathname: '/server/[serverId]/voice-status', params: { serverId, channelId } })
