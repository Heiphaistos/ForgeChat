import { useQuery } from '@tanstack/react-query'
import { useEffect } from 'react'
import { View } from 'react-native'
import { SafeAreaView } from 'react-native-safe-area-context'
import { serversApi } from '@/api/servers'
import { ErrorState, Loading } from '@/components/ui'
import { ConversationList } from '@/features/dms/ConversationList'
import { ChannelList, openChannel } from '@/features/servers/ChannelList'
import { pickChannel } from '@/features/servers/channels'
import { ServerRail } from '@/features/servers/ServerRail'
import { errorMessage } from '@/lib/http'
import { qk, queryClient } from '@/lib/queryClient'
import { useLastChannel } from '@/stores/lastChannel'
import { useUi } from '@/stores/ui'
import type { Server } from '@/types/models'
import { colors } from '@/theme'

/** Accueil : rail (messages privés + serveurs) à gauche, contenu de la sélection à droite. */
export default function HomeScreen() {
  const servers = useQuery({ queryKey: qk.servers, queryFn: serversApi.list })
  const selected = useUi((s) => s.selectedServerId)
  const select = useUi((s) => s.selectServer)

  // Serveur quitté / supprimé : retour aux messages privés.
  useEffect(() => {
    if (selected && servers.data && !servers.data.some((s) => s.id === selected)) select(null)
  }, [servers.data, selected, select])

  const current = selected ? servers.data?.find((s) => s.id === selected) : undefined

  /**
   * Comme Discord : toucher un autre serveur ouvre directement son dernier salon texte consulté (sinon le
   * premier) ; le retour arrière ramène à sa liste de salons, restée sélectionnée.
   */
  const enter = async (server: Server) => {
    select(server.id)
    try {
      const [channels, categories] = await Promise.all([
        queryClient.fetchQuery({ queryKey: qk.channels(server.id), queryFn: () => serversApi.channels(server.id) }),
        queryClient.fetchQuery({ queryKey: qk.categories(server.id), queryFn: () => serversApi.categories(server.id) }),
      ])
      if (useUi.getState().selectedServerId !== server.id) return // un autre serveur a été touché entre-temps
      const channel = pickChannel(channels, categories, useLastChannel.getState().byServer[server.id])
      if (channel) openChannel(server, channel)
    } catch {
      /* la liste des salons affiche l'erreur et propose de réessayer */
    }
  }

  const onSelect = (id: string | null) => {
    const server = id && id !== selected ? servers.data?.find((s) => s.id === id) : undefined
    if (server) void enter(server)
    else select(id)
  }

  return (
    <SafeAreaView edges={['top']} style={{ flex: 1, backgroundColor: colors.bgDeep }}>
      <View style={{ flex: 1, flexDirection: 'row' }}>
        <ServerRail
          servers={servers.data ?? []}
          selected={selected}
          onSelect={onSelect}
          onRetry={servers.error ? () => void servers.refetch() : undefined}
        />
        <View style={{ flex: 1, backgroundColor: colors.bgAlt, borderTopLeftRadius: 12, overflow: 'hidden' }}>
          {!selected ? (
            <ConversationList />
          ) : current ? (
            <ChannelList server={current} />
          ) : servers.error ? (
            <ErrorState message={errorMessage(servers.error)} onRetry={() => void servers.refetch()} />
          ) : (
            <Loading />
          )}
        </View>
      </View>
    </SafeAreaView>
  )
}
