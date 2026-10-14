import { useQuery } from '@tanstack/react-query'
import { router } from 'expo-router'
import { useState } from 'react'
import { ScrollView } from 'react-native'
import { serversApi } from '@/api/servers'
import { Button, ErrorState, Loading, T, TextField } from '@/components/ui'
import { saveVoiceStatus } from '@/features/voice/voiceStatus'
import { useT } from '@/i18n'
import { errorMessage } from '@/lib/http'
import { useRouteParams } from '@/lib/params'
import { qk } from '@/lib/queryClient'
import { colors, spacing } from '@/theme'

/** Statut d'un salon vocal (comme Discord) : une ligne visible sous le salon dans la liste. Le serveur
 *  vérifie le droit (connecté au salon, ou modifier les salons) et ne l'efface pas quand le salon se vide. */
export default function VoiceStatusScreen() {
  const t = useT()
  const { valid, ids } = useRouteParams(['serverId', 'channelId'] as const)
  const channels = useQuery({ queryKey: qk.channels(ids.serverId ?? ''), queryFn: () => serversApi.channels(ids.serverId), enabled: valid })
  if (!valid) return <ErrorState message={t('conv.invalidChannel')} />
  if (channels.isLoading) return <Loading />
  const ch = channels.data?.find((c) => c.id === ids.channelId)
  if (!ch) return <ErrorState message={t('conv.invalidChannel')} />
  // Monté une fois le salon chargé : le champ part du statut actuel.
  return <VoiceStatusForm serverId={ids.serverId} channelId={ch.id} name={ch.name} current={ch.voice_status ?? ''} />
}

function VoiceStatusForm({ serverId, channelId, name, current }: { serverId: string; channelId: string; name: string; current: string }) {
  const t = useT()
  const [value, setValue] = useState(current)
  const [busy, setBusy] = useState<'save' | 'clear' | null>(null)
  const [error, setError] = useState<string | null>(null)
  const run = (kind: 'save' | 'clear') => {
    setBusy(kind)
    setError(null)
    saveVoiceStatus(serverId, channelId, kind === 'clear' ? null : value)
      .then(() => router.back())
      .catch((e) => setError(errorMessage(e)))
      .finally(() => setBusy(null))
  }
  return (
    <ScrollView style={{ backgroundColor: colors.bg }} contentContainerStyle={{ padding: spacing.xl, gap: spacing.lg }} keyboardShouldPersistTaps="handled">
      <T variant="muted">{t('df.voice.intro', { name })}</T>
      <TextField
        label={t('df.voice.label')}
        value={value}
        onChangeText={setValue}
        maxLength={500}
        placeholder={t('df.voice.placeholder')}
        returnKeyType="done"
        onSubmitEditing={() => run('save')}
        autoFocus
      />
      {error ? <T variant="error">{error}</T> : null}
      <Button title={t('df.voice.save')} icon="checkmark" loading={busy === 'save'} disabled={busy !== null} onPress={() => run('save')} />
      {current ? <Button title={t('df.voice.clear')} icon="close-circle-outline" variant="ghost" loading={busy === 'clear'} disabled={busy !== null} onPress={() => run('clear')} /> : null}
    </ScrollView>
  )
}
