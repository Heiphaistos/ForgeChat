import { useQuery } from '@tanstack/react-query'
import { useCallback, useEffect } from 'react'
import { View } from 'react-native'
import { Gesture, GestureDetector } from 'react-native-gesture-handler'
import { SafeAreaView } from 'react-native-safe-area-context'
import { scheduleOnRN } from 'react-native-worklets'
import { serversApi } from '@/api/servers'
import { ErrorState, Loading } from '@/components/ui'
import { ConversationList } from '@/features/dms/ConversationList'
import { ChannelList, openChannel } from '@/features/servers/ChannelList'
import { isTextChannel, pickChannel } from '@/features/servers/channels'
import { ServerChatPanel } from '@/features/servers/ServerChatPanel'
import { ServerRail } from '@/features/servers/ServerRail'
import { errorMessage } from '@/lib/http'
import { qk, queryClient } from '@/lib/queryClient'
import { useLastChannel } from '@/stores/lastChannel'
import { useUi } from '@/stores/ui'
import type { Channel, Server } from '@/types/models'
import { colors } from '@/theme'

/**
 * Accueil, comme Discord mobile : rail (messages privés + serveurs) et liste des salons du serveur ;
 * le salon texte choisi glisse par-dessus (ServerChatPanel). Toucher un serveur rouvre son dernier
 * salon texte consulté (aucun pour un serveur jamais ouvert : la liste reste visible).
 */
export default function HomeScreen() {
  const servers = useQuery({ queryKey: qk.servers, queryFn: serversApi.list })
  const selected = useUi((s) => s.selectedServerId)
  const select = useUi((s) => s.selectServer)
  const chatOpen = useUi((s) => s.chatOpen)
  const lastId = useLastChannel((s) => (selected ? s.byServer[selected] : undefined))
  const channels = useQuery({
    queryKey: qk.channels(selected ?? ''),
    queryFn: () => serversApi.channels(selected ?? ''),
    enabled: !!selected,
  })
  // Le dernier salon n'est rouvert que s'il existe encore et reste un salon texte lisible.
  const chatChannel = channels.data?.find((c) => c.id === lastId && isTextChannel(c) && !c.archived)?.id ?? null

  // Serveur quitté / supprimé : retour aux messages privés.
  useEffect(() => {
    if (selected && servers.data && !servers.data.some((s) => s.id === selected)) select(null)
  }, [servers.data, selected, select])

  const current = selected ? servers.data?.find((s) => s.id === selected) : undefined

  const enter = async (server: Server) => {
    select(server.id)
    try {
      const [list, categories] = await Promise.all([
        queryClient.fetchQuery({ queryKey: qk.channels(server.id), queryFn: () => serversApi.channels(server.id) }),
        queryClient.fetchQuery({ queryKey: qk.categories(server.id), queryFn: () => serversApi.categories(server.id) }),
      ])
      if (useUi.getState().selectedServerId !== server.id) return // un autre serveur a été touché entre-temps
      const last = useLastChannel.getState().byServer[server.id]
      // Comme Discord : le dernier salon consulté revient ; un serveur jamais ouvert montre ses salons.
      const channel = last ? pickChannel(list, categories, last) : null
      if (channel) {
        useLastChannel.getState().remember(server.id, channel.id)
        useUi.getState().setChatOpen(true)
      }
    } catch {
      /* la liste des salons affiche l'erreur et propose de réessayer */
    }
  }

  const onSelect = (id: string | null) => {
    const server = id && id !== selected ? servers.data?.find((s) => s.id === id) : undefined
    if (server) void enter(server)
    else if (id === selected && id) useUi.getState().setChatOpen(false) // re-toucher le serveur : ses salons
    else select(id)
  }

  const onOpen = (server: Server, ch: Channel) => {
    if (!isTextChannel(ch)) return openChannel(server, ch)
    useLastChannel.getState().remember(server.id, ch.id)
    useUi.getState().setChatOpen(true)
  }

  const close = useCallback(() => useUi.getState().setChatOpen(false), [])
  const reopen = useCallback(() => {
    if (chatChannel) useUi.getState().setChatOpen(true)
  }, [chatChannel])
  // Glisser vers la gauche sur la liste : revient au salon (comme Discord).
  const swipeBack = Gesture.Pan()
    .enabled(!!chatChannel && !chatOpen)
    .activeOffsetX(-20)
    .failOffsetY([-15, 15])
    .onEnd((e) => {
      if (e.translationX < -60 || e.velocityX < -800) scheduleOnRN(reopen)
    })

  return (
    <SafeAreaView edges={['top']} style={{ flex: 1, backgroundColor: colors.bgDeep }}>
      <View style={{ flex: 1 }}>
        <GestureDetector gesture={swipeBack}>
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
                <ChannelList server={current} activeChannelId={chatChannel} onOpen={(ch) => onOpen(current, ch)} />
              ) : servers.error ? (
                <ErrorState message={errorMessage(servers.error)} onRetry={() => void servers.refetch()} />
              ) : (
                <Loading />
              )}
            </View>
          </View>
        </GestureDetector>
        {selected ? <ServerChatPanel serverId={selected} channelId={chatChannel} open={chatOpen && !!chatChannel} onClose={close} /> : null}
      </View>
    </SafeAreaView>
  )
}
