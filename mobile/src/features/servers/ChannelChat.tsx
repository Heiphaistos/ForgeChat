import { useQuery } from '@tanstack/react-query'
import { router } from 'expo-router'
import { useEffect } from 'react'
import { Text, View } from 'react-native'
import { serversApi } from '@/api/servers'
import { IconButton } from '@/components/ui'
import { ChannelLock } from '@/e2e/ChannelLock'
import { ChatView } from '@/features/chat/ChatView'
import { HeaderMenu } from '@/features/chat/HeaderMenu'
import { pinsParams } from '@/features/chat/pins'
import { useT } from '@/i18n'
import { qk } from '@/lib/queryClient'
import { useLastChannel } from '@/stores/lastChannel'
import { rememberConvName } from '@/e2e/searchIndex'
import type { Channel } from '@/types/models'
import { colors, font } from '@/theme'
import { useServerPerms } from './menus'
import { NsfwGate } from './NsfwGate'
import { OnboardingGate } from './Onboarding'
import { PERM } from './perms'
import { VerificationGate } from './VerificationGate'
import { LookBackdrop } from './LookBackdrop'
import { cleanLook } from './serverLook'

/**
 * Conversation d'un salon texte / annonces : partagée par l'écran /channel/[serverId]/[channelId]
 * (liens, notifications) et le panneau glissant de l'accueil (ServerChatPanel).
 */
export function useChannelInfo(serverId: string, channelId: string, nameHint?: string, enabled = true) {
  const t = useT()
  const channels = useQuery({ queryKey: qk.channels(serverId), queryFn: () => serversApi.channels(serverId), enabled })
  const perms = useServerPerms(serverId, enabled)
  const channel: Channel | undefined = channels.data?.find((c) => c.id === channelId)
  const name = channel?.name ?? nameHint ?? t('conv.channelFallback')
  const isAnnouncement = channel?.type === 'announcement'
  return { channel, name, isAnnouncement, publishable: isAnnouncement && perms.has(PERM.MANAGE_MESSAGES) }
}

export function ChannelTitle({ name, topic }: { name: string; topic?: string | null }) {
  return (
    <View style={{ flexShrink: 1 }}>
      <Text style={{ color: colors.text, fontWeight: '700', fontSize: font.lg }} numberOfLines={1}>
        # {name}
      </Text>
      {topic ? (
        <Text style={{ color: colors.textMuted, fontSize: font.xs }} numberOfLines={1}>
          {topic}
        </Text>
      ) : null}
    </View>
  )
}

export function ChannelActions({ serverId, channelId, name, isAnnouncement }: { serverId: string; channelId: string; name: string; isAnnouncement: boolean }) {
  const t = useT()
  const ref = pinsParams({ kind: 'channel', serverId, channelId })
  return (
    <View style={{ flexDirection: 'row' }}>
      <ChannelLock serverId={serverId} channelId={channelId} />
      <IconButton icon="people-outline" label={t('conv.members')} onPress={() => router.push(`/server/${serverId}/members`)} />
      <HeaderMenu
        title={`# ${name}`}
        disappearing={{ kind: 'channel', id: channelId, serverId }}
        actions={[
          { label: t('conv.search'), icon: 'search-outline', onPress: () => router.push({ pathname: '/search', params: ref }) },
          { label: t('conv.pins'), icon: 'pin-outline', onPress: () => router.push({ pathname: '/pins', params: ref }) },
          ...(isAnnouncement
            ? [{ label: t('conv.follow'), icon: 'megaphone-outline' as const, onPress: () => router.push({ pathname: '/server/[serverId]/follow', params: { serverId, channelId, name } }) }]
            : []),
        ]}
      />
    </View>
  )
}

export function ChannelBody({
  serverId,
  channelId,
  name,
  nsfw,
  publishable,
  autoThreads,
}: {
  serverId: string
  channelId: string
  name: string
  nsfw: boolean
  publishable: boolean
  /** Fils automatiques : répondre ouvre le fil du message. */
  autoThreads?: boolean
}) {
  const t = useT()
  // Dernier salon consulté de ce serveur : rouvert au prochain appui sur le serveur dans le rail.
  useEffect(() => {
    useLastChannel.getState().remember(serverId, channelId)
  }, [serverId, channelId])
  // Nom du salon pour le filtre dans: de la recherche locale.
  useEffect(() => rememberConvName(channelId, name, serverId), [channelId, name, serverId])
  // Fond de la zone des messages choisi dans l'apparence du serveur (même requête que menus.tsx).
  const detail = useQuery({ queryKey: qk.server(serverId), queryFn: () => serversApi.detail(serverId), staleTime: 60_000 })
  const messageBg = cleanLook(detail.data?.server.look)?.message_bg
  return (
    <VerificationGate serverId={serverId}>
      <OnboardingGate serverId={serverId}>
        <NsfwGate channelId={channelId} name={name} nsfw={nsfw}>
          <ChatView
            publishable={publishable}
            autoThreads={autoThreads}
            conversation={{ kind: 'channel', serverId, channelId }}
            backdrop={messageBg ? <LookBackdrop bg={messageBg} /> : undefined}
            placeholder={t('conv.channelPlaceholder', { name })}
            header={
              <View style={{ padding: 16 }}>
                <Text style={{ color: colors.text, fontSize: font.xl, fontWeight: '800' }}>{t('conv.channelWelcome', { name })}</Text>
                <Text style={{ color: colors.textMuted }}>{t('conv.channelStart')}</Text>
              </View>
            }
          />
        </NsfwGate>
      </OnboardingGate>
    </VerificationGate>
  )
}
