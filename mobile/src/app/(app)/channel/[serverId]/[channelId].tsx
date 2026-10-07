import { Stack } from 'expo-router'
import { ErrorState } from '@/components/ui'
import { ChannelActions, ChannelBody, ChannelTitle, useChannelInfo } from '@/features/servers/ChannelChat'
import { useT } from '@/i18n'
import { useRouteParams } from '@/lib/params'

/** Salon ouvert par un lien, une notification ou une recherche (l'accueil utilise ServerChatPanel). */
export default function ChannelScreen() {
  const t = useT()
  const { valid, ids, text } = useRouteParams(['serverId', 'channelId'] as const, ['name'])
  const info = useChannelInfo(ids.serverId ?? '', ids.channelId ?? '', text.name, valid)
  if (!valid) return <ErrorState message={t('conv.invalidChannel')} />

  return (
    <>
      <Stack.Screen
        options={{
          headerTitle: () => <ChannelTitle name={info.name} topic={info.channel?.topic} />,
          headerRight: () => (
            <ChannelActions serverId={ids.serverId} channelId={ids.channelId} name={info.name} isAnnouncement={info.isAnnouncement} />
          ),
        }}
      />
      <ChannelBody serverId={ids.serverId} channelId={ids.channelId} name={info.name} nsfw={!!info.channel?.is_nsfw} publishable={info.publishable} autoThreads={!!info.channel?.auto_threads} />
    </>
  )
}
