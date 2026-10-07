import { useQuery } from '@tanstack/react-query'
import { Alert } from 'react-native'
import { announcementsApi, type Follow } from '@/api/announcements'
import { IconButton, Row, Section } from '@/components/ui'
import { errorMessage } from '@/lib/http'
import { colors } from '@/theme'

/** Réglages du salon : serveurs abonnés (salon d'annonces) et annonces suivies (web : ChannelFollowsSection.tsx). */
export function ChannelFollows({ channelId, isAnnouncement }: { channelId: string; isAnnouncement: boolean }) {
  const q = useQuery({ queryKey: ['channel-follows', channelId], queryFn: () => announcementsApi.follows(channelId) })
  const remove = (f: Follow) =>
    void announcementsApi
      .unfollow(f.id)
      .then(() => q.refetch())
      .catch((e) => Alert.alert('Suppression impossible', errorMessage(e)))
  const rows = (items: Follow[], empty: string, action: string) =>
    items.length === 0 ? (
      <Row title={empty} />
    ) : (
      items.map((f) => (
        <Row
          key={f.id}
          icon="megaphone-outline"
          title={f.server_name}
          subtitle={`# ${f.channel_name}`}
          right={<IconButton icon="trash-outline" label={`${action} ${f.server_name} #${f.channel_name}`} color={colors.danger} onPress={() => remove(f)} />}
        />
      ))
    )
  return (
    <>
      {isAnnouncement ? (
        <Section title="Serveurs abonnés" footer="« Publier » sur un message l’envoie à ces salons.">
          {rows(q.data?.followers ?? [], 'Aucun abonné', 'Retirer l’abonnement de')}
        </Section>
      ) : null}
      <Section title="Annonces suivies">{rows(q.data?.following ?? [], 'Aucune', 'Ne plus suivre')}</Section>
    </>
  )
}
