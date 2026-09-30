import { useQuery } from '@tanstack/react-query'
import { Stack, router } from 'expo-router'
import { Text, View } from 'react-native'
import { serversApi } from '@/api/servers'
import { ErrorState, IconButton } from '@/components/ui'
import { ChatView } from '@/features/chat/ChatView'
import { useRouteParams } from '@/lib/params'
import { qk } from '@/lib/queryClient'
import { colors, font } from '@/theme'

export default function ChannelScreen() {
  const { valid, ids, text } = useRouteParams(['serverId', 'channelId'] as const, ['name'])
  const channels = useQuery({
    queryKey: qk.channels(ids.serverId ?? ''),
    queryFn: () => serversApi.channels(ids.serverId),
    enabled: valid,
  })
  if (!valid) return <ErrorState message="Lien de salon invalide." />
  const channel = channels.data?.find((c) => c.id === ids.channelId)
  const name = channel?.name ?? text.name ?? 'salon'

  return (
    <>
      <Stack.Screen
        options={{
          headerTitle: () => (
            <View>
              <Text style={{ color: colors.text, fontWeight: '700', fontSize: font.lg }} numberOfLines={1}>
                # {name}
              </Text>
              {channel?.topic ? (
                <Text style={{ color: colors.textMuted, fontSize: font.xs }} numberOfLines={1}>
                  {channel.topic}
                </Text>
              ) : null}
            </View>
          ),
          headerRight: () => (
            <IconButton icon="people-outline" label="Membres" onPress={() => router.push(`/server/${ids.serverId}/members`)} />
          ),
        }}
      />
      <ChatView
        conversation={{ kind: 'channel', serverId: ids.serverId, channelId: ids.channelId }}
        placeholder={`Envoyer un message dans #${name}`}
        header={
          <View style={{ padding: 16 }}>
            <Text style={{ color: colors.text, fontSize: font.xl, fontWeight: '800' }}>Bienvenue dans #{name} !</Text>
            <Text style={{ color: colors.textMuted }}>C’est le début du salon.</Text>
          </View>
        }
      />
    </>
  )
}
