import { useQuery } from '@tanstack/react-query'
import { Stack, router } from 'expo-router'
import { useState } from 'react'
import { Alert, FlatList, View } from 'react-native'
import { eventsApi, type Rsvp, type ServerEvent } from '@/api/events'
import { Button, EmptyState, ErrorState, IconButton, Loading, T } from '@/components/ui'
import { EVENT_TYPES, formatEventDate } from '@/features/servers/events'
import { useServerPerms } from '@/features/servers/menus'
import { PERM } from '@/features/servers/perms'
import { useT, type Key } from '@/i18n'
import { errorMessage } from '@/lib/http'
import { useRouteParams } from '@/lib/params'
import { colors, radius, spacing } from '@/theme'
import { EventExtras } from '@/features/community/EventExtras'

const RSVPS: { value: Rsvp; label: Key }[] = [
  { value: 'going', label: 'server.events.going' },
  { value: 'interested', label: 'server.events.interested' },
  { value: 'not_going', label: 'server.events.notGoing' },
]

/** Événements du serveur : à venir ou passés, participation, création (tout membre), suppression (créateur ou MANAGE_SERVER). */
export default function EventsScreen() {
  const t = useT()
  const { valid, ids } = useRouteParams(['serverId'] as const)
  const sid = ids.serverId ?? ''
  const [filter, setFilter] = useState<'upcoming' | 'past'>('upcoming')
  const q = useQuery({ queryKey: ['events', sid, filter], queryFn: () => eventsApi.list(sid, filter), enabled: valid })
  const perms = useServerPerms(sid, valid)
  if (!valid) return <ErrorState message={t('server.invalid')} />

  const attendees = (e: ServerEvent) => {
    const n = e.attendee_count ?? 0
    if (!e.max_attendees) return t(n > 1 ? 'server.events.attendeesMany' : 'server.events.attendeesOne', { n })
    return t(n > 1 ? 'server.events.attendeesOfMany' : 'server.events.attendeesOfOne', { n, max: e.max_attendees })
  }
  const fail = (e: unknown) => Alert.alert(t('common.actionFailed'), errorMessage(e))
  const attend = (e: ServerEvent, status: Rsvp) => void eventsApi.attend(e.id, status).then(() => q.refetch(), fail)
  const remove = (e: ServerEvent) =>
    Alert.alert(t('menu.deleteCategoryConfirm', { name: e.name }), undefined, [
      { text: t('common.cancel'), style: 'cancel' },
      { text: t('common.delete'), style: 'destructive', onPress: () => void eventsApi.remove(sid, e.id).then(() => q.refetch(), fail) },
    ])

  return (
    <View style={{ flex: 1, backgroundColor: colors.bg }}>
      <Stack.Screen options={{ title: t('menu.events') }} />
      <View style={{ flexDirection: 'row', gap: spacing.sm, padding: spacing.md }} accessibilityRole="tablist">
        {(['upcoming', 'past'] as const).map((f) => (
          <Button
            key={f}
            title={f === 'upcoming' ? t('server.events.upcoming') : t('server.events.past')}
            variant={filter === f ? 'primary' : 'secondary'}
            onPress={() => setFilter(f)}
            accessibilityRole="tab"
            accessibilityState={{ selected: filter === f }}
            style={{ flex: 1 }}
          />
        ))}
        <IconButton icon="add" label={t('server.events.create')} onPress={() => router.push({ pathname: '/server/[serverId]/events/new', params: { serverId: sid } })} />
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
          ListEmptyComponent={<EmptyState icon="calendar-outline" title={filter === 'upcoming' ? t('server.events.emptyUpcoming') : t('server.events.emptyPast')} />}
          renderItem={({ item: e }) => (
            <View style={{ backgroundColor: colors.bgAlt, borderRadius: radius.lg, padding: spacing.lg, gap: spacing.sm }}>
              <View style={{ flexDirection: 'row', alignItems: 'flex-start', gap: spacing.sm }}>
                <View style={{ flex: 1 }}>
                  <T variant="label">
                    {(() => { const et = EVENT_TYPES.find((x) => x.value === e.event_type); return et ? t(et.label) : e.event_type })()} · {formatEventDate(e.start_time)}
                  </T>
                  <T variant="subtitle">{e.name}</T>
                </View>
                {e.creator_id === perms.meId || perms.has(PERM.MANAGE_SERVER) ? (
                  <IconButton icon="trash-outline" label={t('server.events.deleteLabel', { name: e.name })} color={colors.danger} onPress={() => remove(e)} />
                ) : null}
              </View>
              {e.description ? <T>{e.description}</T> : null}
              <EventExtras event={e} />
              <T variant="muted">
                {attendees(e)}
              </T>
              {filter === 'upcoming' ? (
                <View style={{ flexDirection: 'row', gap: spacing.sm }} accessibilityRole="radiogroup" accessibilityLabel={t('server.events.myRsvp')}>
                  {RSVPS.map((r) => (
                    <Button
                      key={r.value}
                      title={t(r.label)}
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
