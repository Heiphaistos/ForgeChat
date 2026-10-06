import { useQuery } from '@tanstack/react-query'
import { Stack, router } from 'expo-router'
import { useState } from 'react'
import { Alert, FlatList, View } from 'react-native'
import { eventsApi, type Rsvp, type ServerEvent } from '@/api/events'
import { Button, EmptyState, ErrorState, IconButton, Loading, T } from '@/components/ui'
import { EVENT_TYPES, formatEventDate } from '@/features/servers/events'
import { useServerPerms } from '@/features/servers/menus'
import { PERM } from '@/features/servers/perms'
import { errorMessage } from '@/lib/http'
import { useRouteParams } from '@/lib/params'
import { colors, radius, spacing } from '@/theme'

const RSVPS: { value: Rsvp; label: string }[] = [
  { value: 'going', label: 'J’y vais' },
  { value: 'interested', label: 'Intéressé' },
  { value: 'not_going', label: 'Pas dispo' },
]

/** Événements du serveur : à venir ou passés, participation, création (tout membre), suppression (créateur ou MANAGE_SERVER). */
export default function EventsScreen() {
  const { valid, ids } = useRouteParams(['serverId'] as const)
  const sid = ids.serverId ?? ''
  const [filter, setFilter] = useState<'upcoming' | 'past'>('upcoming')
  const q = useQuery({ queryKey: ['events', sid, filter], queryFn: () => eventsApi.list(sid, filter), enabled: valid })
  const perms = useServerPerms(sid, valid)
  if (!valid) return <ErrorState message="Serveur invalide." />

  const fail = (e: unknown) => Alert.alert('Action impossible', errorMessage(e))
  const attend = (e: ServerEvent, status: Rsvp) => void eventsApi.attend(e.id, status).then(() => q.refetch(), fail)
  const remove = (e: ServerEvent) =>
    Alert.alert(`Supprimer « ${e.name} » ?`, undefined, [
      { text: 'Annuler', style: 'cancel' },
      { text: 'Supprimer', style: 'destructive', onPress: () => void eventsApi.remove(sid, e.id).then(() => q.refetch(), fail) },
    ])

  return (
    <View style={{ flex: 1, backgroundColor: colors.bg }}>
      <Stack.Screen options={{ title: 'Événements' }} />
      <View style={{ flexDirection: 'row', gap: spacing.sm, padding: spacing.md }} accessibilityRole="tablist">
        {(['upcoming', 'past'] as const).map((f) => (
          <Button
            key={f}
            title={f === 'upcoming' ? 'À venir' : 'Passés'}
            variant={filter === f ? 'primary' : 'secondary'}
            onPress={() => setFilter(f)}
            accessibilityRole="tab"
            accessibilityState={{ selected: filter === f }}
            style={{ flex: 1 }}
          />
        ))}
        <IconButton icon="add" label="Créer un événement" onPress={() => router.push({ pathname: '/server/[serverId]/events/new', params: { serverId: sid } })} />
      </View>
      {q.isLoading ? (
        <Loading />
      ) : q.error ? (
        <ErrorState message={errorMessage(q.error)} onRetry={() => void q.refetch()} />
      ) : (
        <FlatList
          data={q.data ?? []}
          keyExtractor={(e) => e.id}
          contentContainerStyle={{ padding: spacing.md, gap: spacing.md }}
          ListEmptyComponent={<EmptyState icon="calendar-outline" title={filter === 'upcoming' ? 'Aucun événement prévu' : 'Aucun événement passé'} />}
          renderItem={({ item: e }) => (
            <View style={{ backgroundColor: colors.bgAlt, borderRadius: radius.lg, padding: spacing.lg, gap: spacing.sm }}>
              <View style={{ flexDirection: 'row', alignItems: 'flex-start', gap: spacing.sm }}>
                <View style={{ flex: 1 }}>
                  <T variant="label">
                    {EVENT_TYPES.find((t) => t.value === e.event_type)?.label ?? e.event_type} · {formatEventDate(e.start_time)}
                  </T>
                  <T variant="subtitle">{e.name}</T>
                </View>
                {e.creator_id === perms.meId || perms.has(PERM.MANAGE_SERVER) ? (
                  <IconButton icon="trash-outline" label={`Supprimer ${e.name}`} color={colors.danger} onPress={() => remove(e)} />
                ) : null}
              </View>
              {e.description ? <T>{e.description}</T> : null}
              <T variant="muted">
                {e.attendee_count ?? 0} participant{(e.attendee_count ?? 0) > 1 ? 's' : ''}
                {e.max_attendees ? ` sur ${e.max_attendees}` : ''}
              </T>
              {filter === 'upcoming' ? (
                <View style={{ flexDirection: 'row', gap: spacing.sm }} accessibilityRole="radiogroup" accessibilityLabel="Ma participation">
                  {RSVPS.map((r) => (
                    <Button
                      key={r.value}
                      title={r.label}
                      variant={e.user_rsvp === r.value ? 'primary' : 'secondary'}
                      onPress={() => attend(e, r.value)}
                      accessibilityRole="radio"
                      accessibilityState={{ selected: e.user_rsvp === r.value }}
                      style={{ flex: 1, paddingHorizontal: spacing.xs }}
                    />
                  ))}
                </View>
              ) : null}
            </View>
          )}
        />
      )}
    </View>
  )
}
