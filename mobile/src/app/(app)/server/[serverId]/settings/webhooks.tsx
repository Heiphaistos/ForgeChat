import { useQuery } from '@tanstack/react-query'
import * as Clipboard from 'expo-clipboard'
import { Stack } from 'expo-router'
import { useState } from 'react'
import { Alert, ScrollView, View } from 'react-native'
import { moderationApi } from '@/api/moderation'
import { Button, ErrorState, IconButton, Loading, Row, Section, T, TextField } from '@/components/ui'
import { apiBase } from '@/config/env'
import { ChoiceRow } from '@/features/servers/ChoiceRow'
import { useServerDetail } from '@/features/servers/menus'
import { formatShort } from '@/lib/format'
import { errorMessage } from '@/lib/http'
import { useRouteParams } from '@/lib/params'
import { colors, spacing } from '@/theme'

const webhookUrl = (id: string, token: string) => `${apiBase()}/webhook/${id}/${token}`

/** Webhooks (MANAGE_SERVER). Le jeton n'est montré qu'à la création : l'URL se copie à ce moment-là. */
export default function WebhooksScreen() {
  const { valid, ids } = useRouteParams(['serverId'] as const)
  const sid = ids.serverId ?? ''
  const q = useQuery({ queryKey: ['webhooks', sid], queryFn: () => moderationApi.webhooks(sid), enabled: valid })
  const detail = useServerDetail(sid, valid)
  const [name, setName] = useState('')
  const [channelId, setChannelId] = useState<string | null>(null)
  const [created, setCreated] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  if (!valid) return <ErrorState message="Serveur invalide." />
  if (q.isLoading || detail.isLoading) return <Loading />
  if (q.error) return <ErrorState message={errorMessage(q.error)} onRetry={() => void q.refetch()} />

  const channels = (detail.data?.channels ?? []).filter((c) => c.type === 'text' || c.type === 'announcement')
  const channelName = (id: string) => channels.find((c) => c.id === id)?.name ?? 'salon inconnu'
  const copy = (url: string) =>
    void Clipboard.setStringAsync(url).then(
      () => Alert.alert('URL copiée', 'Garde-la secrète : elle permet de poster dans le salon.'),
      () => Alert.alert('Copie impossible'),
    )

  const create = async () => {
    if (!name.trim() || !channelId) return Alert.alert('Incomplet', 'Donne un nom et choisis un salon.')
    setBusy(true)
    try {
      const w = await moderationApi.createWebhook(sid, name, channelId)
      setName('')
      if (w.token) setCreated(webhookUrl(w.id, w.token))
      await q.refetch()
    } catch (e) {
      Alert.alert('Création impossible', errorMessage(e))
    } finally {
      setBusy(false)
    }
  }

  const remove = (id: string, label: string) =>
    Alert.alert(`Supprimer le webhook « ${label} » ?`, 'Son URL cessera de fonctionner.', [
      { text: 'Annuler', style: 'cancel' },
      {
        text: 'Supprimer',
        style: 'destructive',
        onPress: () =>
          void moderationApi
            .deleteWebhook(sid, id)
            .then(() => q.refetch())
            .catch((e) => Alert.alert('Suppression impossible', errorMessage(e))),
      },
    ])

  return (
    <ScrollView style={{ backgroundColor: colors.bg }} contentContainerStyle={{ padding: spacing.lg, gap: spacing.lg }} keyboardShouldPersistTaps="handled">
      <Stack.Screen options={{ title: 'Webhooks' }} />
      {created ? (
        <View style={{ gap: spacing.sm }}>
          <T variant="label">Nouveau webhook</T>
          <T selectable variant="muted">
            {created}
          </T>
          <Button title="Copier l’URL" icon="copy-outline" onPress={() => copy(created)} />
          <T variant="small">Elle ne sera plus affichée ensuite.</T>
        </View>
      ) : null}
      <Section title="Créer un webhook">
        <TextField value={name} onChangeText={setName} placeholder="Nom (ex. GitHub)" accessibilityLabel="Nom du webhook" maxLength={100} style={{ borderRadius: 0 }} />
        <ChoiceRow
          icon="chatbubble-outline"
          title="Salon"
          value={channelId}
          options={[{ value: null, label: 'Choisir…' }, ...channels.map((c) => ({ value: c.id as string | null, label: `# ${c.name}` }))]}
          onChange={setChannelId}
        />
      </Section>
      <Button title="Créer" icon="add" onPress={create} loading={busy} />
      <Section title={`Webhooks (${q.data?.length ?? 0})`}>
        {q.data?.length ? null : <Row title="Aucun webhook" />}
        {(q.data ?? []).map((w) => (
          <Row
            key={w.id}
            icon="git-network-outline"
            title={w.name}
            subtitle={`# ${channelName(w.channel_id)} · ${w.token_preview} · ${formatShort(w.created_at)}`}
            right={<IconButton icon="trash-outline" label={`Supprimer ${w.name}`} color={colors.danger} onPress={() => remove(w.id, w.name)} />}
          />
        ))}
      </Section>
    </ScrollView>
  )
}
