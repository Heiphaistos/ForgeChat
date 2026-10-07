import { useQuery } from '@tanstack/react-query'
import { Alert } from 'react-native'
import { announcementsApi, type Follow } from '@/api/announcements'
import { IconButton, Row, Section } from '@/components/ui'
import { useT, type Key } from '@/i18n'
import { errorMessage } from '@/lib/http'
import { colors } from '@/theme'

/** Réglages du salon : serveurs abonnés (salon d'annonces) et annonces suivies (web : ChannelFollowsSection.tsx). */
export function ChannelFollows({ channelId, isAnnouncement }: { channelId: string; isAnnouncement: boolean }) {
  const t = useT()
  const q = useQuery({ queryKey: ['channel-follows', channelId], queryFn: () => announcementsApi.follows(channelId) })
  const remove = (f: Follow) =>
    void announcementsApi
      .unfollow(f.id)
      .then(() => q.refetch())
      .catch((e) => Alert.alert(t('menu.deleteFailed'), errorMessage(e)))
  const rows = (items: Follow[], empty: string, action: Key) =>
    items.length === 0 ? (
      <Row title={empty} />
    ) : (
      items.map((f) => (
        <Row
          key={f.id}
          icon="megaphone-outline"
          title={f.server_name}
          subtitle={`# ${f.channel_name}`}
          right={<IconButton icon="trash-outline" label={t(action, { server: f.server_name, channel: f.channel_name })} color={colors.danger} onPress={() => remove(f)} />}
        />
      ))
    )
  return (
    <>
      {isAnnouncement ? (
        <Section title={t('server.follows.followers')} footer={t('server.follows.followersFooter')}>
          {rows(q.data?.followers ?? [], t('server.follows.noFollowers'), 'server.follows.removeFollower')}
        </Section>
      ) : null}
      <Section title={t('server.follows.following')}>{rows(q.data?.following ?? [], t('server.follows.none'), 'server.follows.unfollow')}</Section>
    </>
  )
}
