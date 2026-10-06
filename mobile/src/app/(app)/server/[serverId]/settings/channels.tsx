import { useQuery } from '@tanstack/react-query'
import { router } from 'expo-router'
import { Alert, ScrollView, View } from 'react-native'
import { channelsApi } from '@/api/channels'
import { serversApi } from '@/api/servers'
import { Button, ErrorState, IconButton, Loading, Row, Section } from '@/components/ui'
import { channelIcon } from '@/features/servers/ChannelList'
import { channelSections } from '@/features/servers/channels'
import { useServerPerms } from '@/features/servers/menus'
import { reorderChannelIds } from '@/features/servers/reorder'
import { errorMessage } from '@/lib/http'
import { useRouteParams } from '@/lib/params'
import { qk, queryClient } from '@/lib/queryClient'
import type { Category } from '@/types/models'
import { colors, spacing } from '@/theme'

/** Salons et catégories : toucher un salon pour le modifier ; flèches pour le déplacer ; corbeille sur une catégorie. */
export default function ChannelsSettingsScreen() {
  const { valid, ids } = useRouteParams(['serverId'] as const)
  const sid = ids.serverId ?? ''
  const channels = useQuery({ queryKey: qk.channels(sid), queryFn: () => serversApi.channels(sid), enabled: valid })
  const categories = useQuery({ queryKey: qk.categories(sid), queryFn: () => serversApi.categories(sid), enabled: valid })
  const perms = useServerPerms(sid, valid)
  if (!valid) return <ErrorState message="Serveur invalide." />
  if (channels.isLoading || categories.isLoading) return <Loading />
  if (channels.error) return <ErrorState message={errorMessage(channels.error)} onRetry={() => void channels.refetch()} />

  const deleteCategory = (cat: Category) =>
    Alert.alert(`Supprimer « ${cat.name} » ?`, 'Ses salons sont conservés et sortent de la catégorie.', [
      { text: 'Annuler', style: 'cancel' },
      {
        text: 'Supprimer',
        style: 'destructive',
        onPress: () =>
          void serversApi
            .deleteCategory(sid, cat.id)
            .then(() => Promise.all([qk.categories(sid), qk.channels(sid)].map((queryKey) => queryClient.invalidateQueries({ queryKey }))))
            .catch((e) => Alert.alert('Suppression impossible', errorMessage(e))),
      },
    ])

  const move = (channelId: string, delta: -1 | 1) => {
    const order = reorderChannelIds(channels.data ?? [], categories.data ?? [], channelId, delta)
    if (!order) return
    void channelsApi
      .reorder(sid, order)
      .then(() => Promise.all([qk.channels(sid), qk.server(sid)].map((queryKey) => queryClient.invalidateQueries({ queryKey }))))
      .catch((e) => Alert.alert('Déplacement impossible', errorMessage(e)))
  }

  // Archivés et masqués compris : on les gère aussi ici.
  const all = (channels.data ?? []).map((c) => ({ ...c, hidden: false, archived: false, state: c.archived ? 'Archivé' : c.hidden ? 'Masqué pour toi' : null }))
  return (
    <ScrollView style={{ backgroundColor: colors.bg }} contentContainerStyle={{ padding: spacing.lg }}>
      {perms.canCreateChannels ? (
        <Button
          title="Créer un salon ou une catégorie"
          icon="add"
          variant="secondary"
          onPress={() => router.push(`/server/${sid}/channel-create`)}
          style={{ marginBottom: spacing.lg }}
        />
      ) : null}
      {channelSections(all, categories.data ?? []).map((section) => (
        <Section key={section.category?.id ?? 'none'} title={section.title ?? 'Sans catégorie'}>
          {section.category && perms.canDeleteChannel(section.category.created_by) ? (
            <Row
              icon="folder-open-outline"
              title={section.category.name}
              subtitle="Catégorie"
              right={<IconButton icon="trash-outline" label={`Supprimer la catégorie ${section.category.name}`} color={colors.danger} onPress={() => deleteCategory(section.category!)} />}
            />
          ) : null}
          {section.data.map((c, i) => (
            <Row
              key={c.id}
              icon={channelIcon(c.type)}
              title={c.name}
              subtitle={[c.state, c.topic].filter(Boolean).join(' · ')}
              onPress={() => router.push({ pathname: '/server/[serverId]/settings/channel/[channelId]', params: { serverId: sid, channelId: c.id } })}
              right={
                perms.canEditChannels ? (
                  <View style={{ flexDirection: 'row' }}>
                    <IconButton icon="chevron-up" label={`Monter ${c.name}`} disabled={i === 0} onPress={() => move(c.id, -1)} />
                    <IconButton icon="chevron-down" label={`Descendre ${c.name}`} disabled={i === section.data.length - 1} onPress={() => move(c.id, 1)} />
                  </View>
                ) : null
              }
            />
          ))}
          {section.data.length ? null : <Row title="Aucun salon" />}
        </Section>
      ))}
    </ScrollView>
  )
}
