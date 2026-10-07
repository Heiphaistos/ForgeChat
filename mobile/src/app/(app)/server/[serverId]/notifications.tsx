import { Ionicons } from '@expo/vector-icons'
import { useQuery } from '@tanstack/react-query'
import { Stack, router } from 'expo-router'
import { useState } from 'react'
import { Alert, ScrollView } from 'react-native'
import { serversApi, type NotifLevel, type NotifOverride } from '@/api/servers'
import { Button, ErrorState, Loading, Row, Section, SwitchRow } from '@/components/ui'
import { formatTime } from '@/lib/format'
import { errorMessage } from '@/lib/http'
import { isUuid, useRouteParams } from '@/lib/params'
import { colors, spacing } from '@/theme'

const LEVELS: { value: NotifLevel; label: string }[] = [
  { value: 'inherit', label: 'Par défaut' },
  { value: 'all', label: 'Tous les messages' },
  { value: 'mentions', label: 'Mentions seulement' },
  { value: 'nothing', label: 'Rien' },
]

// Mêmes choix que client/src/components/modals/muteOptions.tsx ; `keep` conserve la sourdine en cours.
type Mute = 'off' | 'keep' | '15' | '60' | '480' | '1440' | '0'
const MUTES: { value: Mute; label: string }[] = [
  { value: 'off', label: 'Notifications actives' },
  { value: '15', label: 'Couper 15 minutes' },
  { value: '60', label: 'Couper 1 heure' },
  { value: '480', label: 'Couper 8 heures' },
  { value: '1440', label: 'Couper 24 heures' },
  { value: '0', label: "Couper jusqu'à réactivation" },
]

const untilLabel = (iso: string | null) =>
  iso ? `Coupé jusqu'à ${formatTime(iso)}` : "Coupé jusqu'à réactivation"

/** Réglages de notification d'un serveur, ou d'un de ses salons si `channelId` est fourni (comme Discord). */
export default function NotificationsScreen() {
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
  if (!valid) return <ErrorState message="Serveur invalide." />
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
      Alert.alert('Enregistrement impossible', errorMessage(e))
    } finally {
      setSaving(false)
    }
  }

  const wasMuted = !!initial?.muted
  const mutes = wasMuted ? [MUTES[0]!, { value: 'keep' as const, label: untilLabel(initial?.muted_until ?? null) }, ...MUTES.slice(1)] : MUTES

  return (
    <ScrollView style={{ backgroundColor: colors.bg }} contentContainerStyle={{ padding: spacing.lg }}>
      <Stack.Screen options={{ title: channelId ? `Notifications · #${name ?? 'salon'}` : 'Notifications du serveur' }} />
      <Section title="Sourdine">
        {mutes.map((m) => (
          <Row key={m.value} title={m.label} selected={mute === m.value} onPress={() => setMute(m.value)} right={mute === m.value ? <Check /> : null} />
        ))}
      </Section>
      <Section title="Notifications" footer={channelId ? 'Par défaut : le réglage du serveur.' : 'Par défaut : le réglage choisi par le serveur.'}>
        {LEVELS.map((l) => (
          <Row key={l.value} title={l.label} selected={level === l.value} onPress={() => setLevel(l.value)} right={level === l.value ? <Check /> : null} />
        ))}
      </Section>
      {channelId ? null : (
        <Section>
          <SwitchRow title="Ignorer @everyone et @here" value={suppress} onValueChange={setSuppress} />
        </Section>
      )}
      <Button title="Enregistrer" onPress={save} loading={saving} />
    </ScrollView>
  )
}

const Check = () => <Ionicons name="checkmark" size={20} color={colors.primary} />
