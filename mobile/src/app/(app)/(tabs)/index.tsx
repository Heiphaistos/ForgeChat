import { useQuery } from '@tanstack/react-query'
import { useEffect } from 'react'
import { View } from 'react-native'
import { SafeAreaView } from 'react-native-safe-area-context'
import { serversApi } from '@/api/servers'
import { ErrorState, Loading } from '@/components/ui'
import { ConversationList } from '@/features/dms/ConversationList'
import { ChannelList } from '@/features/servers/ChannelList'
import { ServerRail } from '@/features/servers/ServerRail'
import { errorMessage } from '@/lib/http'
import { qk } from '@/lib/queryClient'
import { useUi } from '@/stores/ui'
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

  return (
    <SafeAreaView edges={['top']} style={{ flex: 1, backgroundColor: colors.bgDeep }}>
      <View style={{ flex: 1, flexDirection: 'row' }}>
        <ServerRail
          servers={servers.data ?? []}
          selected={selected}
          onSelect={select}
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
