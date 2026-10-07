import { Ionicons } from '@expo/vector-icons'
import { useQuery } from '@tanstack/react-query'
import { Stack, router } from 'expo-router'
import { useState } from 'react'
import { Alert, ScrollView } from 'react-native'
import { serversApi, type NotifLevel, type NotifOverride } from '@/api/servers'
import { Button, ErrorState, Loading, Row, Section, SwitchRow } from '@/components/ui'
import { useT, type Key } from '@/i18n'
import { formatTime } from '@/lib/format'
import { errorMessage } from '@/lib/http'
import { isUuid, useRouteParams } from '@/lib/params'
import { colors, spacing } from '@/theme'

const LEVELS: { value: NotifLevel; label: Key }[] = [
  { value: 'inherit', label: 'server.notifications.inherit' },
  { value: 'all', label: 'server.notifications.all' },
  { value: 'mentions', label: 'server.notifications.mentions' },
  { value: 'nothing', label: 'server.notifications.nothing' },
]

// Mêmes choix que client/src/components/modals/muteOptions.tsx ; `keep` conserve la sourdine en cours.
type Mute = 'off' | 'keep' | '15' | '60' | '480' | '1440' | '0'
const MUTES: { value: Mute; label: Key }[] = [
  { value: 'off', label: 'server.notifications.on' },
  { value: '15', label: 'server.notifications.mute15' },
  { value: '60', label: 'server.notifications.mute60' },
  { value: '480', label: 'server.notifications.mute480' },
  { value: '1440', label: 'server.notifications.mute1440' },
  { value: '0', label: 'server.notifications.muteForever' },
]

/** Réglages de notification d'un serveur, ou d'un de ses salons si `channelId` est fourni (comme Discord). */
export default function NotificationsScreen() {
  const t = useT()
  const { valid, ids, text } = useRouteParams(['serverId'] as const, ['channelId', 'name'])
  const channelId = isUuid(text.channelId) ? text.channelId : null
  const current = useQuery({
    queryKey: ['notif', channelId ?? ids.serverId],
    queryFn: async (): Promise<NotifOverride | null> =>
      (channelId
        ? (await serversApi.channelNotif()).find((o) => o.channel_id === channelId)
        : (await serversApi.serverNotif()).find((o) => o.server_id === ids.serverId)) ?? null,
    enabled: valid,
  })
  if (!valid) return <ErrorState message={t('server.invalid')} />
  if (current.isLoading) return <Loading />
  if (current.error) return <ErrorState message={errorMessage(current.error)} onRetry={() => void current.refetch()} />
  return <NotifForm serverId={ids.serverId} channelId={channelId} name={text.name} initial={current.data ?? null} onSaved={() => void current.refetch()} />
}

function NotifForm({
  serverId,
  channelId,
  name,
  initial,
  onSaved,
}: {
  serverId: string
  channelId: string | null
  name?: string
  initial: NotifOverride | null
  onSaved: () => void
}) {
  const t = useT()
  const [level, setLevel] = useState<NotifLevel>(initial?.level ?? 'inherit')
  const [mute, setMute] = useState<Mute>(initial?.muted ? 'keep' : 'off')
  const [suppress, setSuppress] = useState(!!initial?.suppress_everyone)
  const [saving, setSaving] = useState(false)

  const save = async () => {
    setSaving(true)
    const muted = mute !== 'off'
    const minutes = mute === 'off' || mute === 'keep' ? undefined : Number(mute)
    try {
      if (channelId) await serversApi.setChannelNotif(channelId, level, muted, minutes)
      else await serversApi.setServerNotif(serverId, level, muted, minutes, suppress)
      onSaved()
      router.back()
    } catch (e) {
      Alert.alert(t('server.notifications.saveFailed'), errorMessage(e))
    } finally {
      setSaving(false)
    }
  }

  const wasMuted = !!initial?.muted
  const rows = MUTES.map((m) => ({ value: m.value, label: t(m.label) }))
  const until = initial?.muted_until
  const keep = { value: 'keep' as const, label: until ? t('server.notifications.mutedUntil', { time: formatTime(until) }) : t('server.notifications.mutedForever') }
  const mutes = wasMuted ? [rows[0]!, keep, ...rows.slice(1)] : rows

  return (
    <ScrollView style={{ backgroundColor: colors.bg }} contentContainerStyle={{ padding: spacing.lg }}>
      <Stack.Screen options={{ title: channelId ? t('server.notifications.channelTitle', { name: name ?? t('server.notifications.channelFallback') }) : t('menu.serverNotifications') }} />
      <Section title={t('server.notifications.mute')}>
        {mutes.map((m) => (
          <Row key={m.value} title={m.label} selected={mute === m.value} onPress={() => setMute(m.value)} right={mute === m.value ? <Check /> : null} />
        ))}
      </Section>
      <Section title="Notifications" footer={channelId ? t('server.notifications.channelFooter') : t('server.notifications.serverFooter')}>
        {LEVELS.map((l) => (
          <Row key={l.value} title={t(l.label)} selected={level === l.value} onPress={() => setLevel(l.value)} right={level === l.value ? <Check /> : null} />
        ))}
      </Section>
      {channelId ? null : (
        <Section>
          <SwitchRow title={t('server.notifications.suppress')} value={suppress} onValueChange={setSuppress} />
        </Section>
      )}
      <Button title={t('server.save')} onPress={save} loading={saving} />
    </ScrollView>
  )
}

const Check = () => <Ionicons name="checkmark" size={20} color={colors.primary} />
