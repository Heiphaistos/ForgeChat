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
import { useT } from '@/i18n'
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
  const t = useT()
  if (!valid) return <ErrorState message={t('serverSettings.invalidServer')} />
  if (q.isLoading || detail.isLoading) return <Loading />
  if (q.error) return <ErrorState message={errorMessage(q.error)} onRetry={() => void q.refetch()} />

  const channels = (detail.data?.channels ?? []).filter((c) => c.type === 'text' || c.type === 'announcement')
  const channelName = (id: string) => channels.find((c) => c.id === id)?.name ?? t('serverSettings.webhooks.unknownChannel')
  const copy = (url: string) =>
    void Clipboard.setStringAsync(url).then(
      () => Alert.alert(t('serverSettings.webhooks.copied'), t('serverSettings.webhooks.copiedBody')),
      () => Alert.alert(t('serverSettings.webhooks.copyFailed')),
    )

  const create = async () => {
    if (!name.trim() || !channelId) return Alert.alert(t('serverSettings.webhooks.incomplete'), t('serverSettings.webhooks.incompleteBody'))
    setBusy(true)
    try {
      const w = await moderationApi.createWebhook(sid, name, channelId)
      setName('')
      if (w.token) setCreated(webhookUrl(w.id, w.token))
      await q.refetch()
    } catch (e) {
      Alert.alert(t('serverSettings.createFailed'), errorMessage(e))
    } finally {
      setBusy(false)
    }
  }

  const remove = (id: string, label: string) =>
    Alert.alert(t('serverSettings.webhooks.deleteTitle', { name: label }), t('serverSettings.webhooks.deleteBody'), [
      { text: t('common.cancel'), style: 'cancel' },
      {
        text: t('common.delete'),
        style: 'destructive',
        onPress: () =>
          void moderationApi
            .deleteWebhook(sid, id)
            .then(() => q.refetch())
            .catch((e) => Alert.alert(t('serverSettings.deleteFailed'), errorMessage(e))),
      },
    ])

  return (
    <ScrollView style={{ backgroundColor: colors.bg }} contentContainerStyle={{ padding: spacing.lg, gap: spacing.lg }} keyboardShouldPersistTaps="handled">
      <Stack.Screen options={{ title: t('serverSettings.title.webhooks') }} />
      {created ? (
        <View style={{ gap: spacing.sm }}>
          <T variant="label">{t('serverSettings.webhooks.new')}</T>
          <T selectable variant="muted">
            {created}
          </T>
          <Button title={t('serverSettings.webhooks.copyUrl')} icon="copy-outline" onPress={() => copy(created)} />
          <T variant="small">{t('serverSettings.webhooks.notShownAgain')}</T>
        </View>
      ) : null}
      <Section title={t('serverSettings.webhooks.createSection')}>
        <TextField value={name} onChangeText={setName} placeholder={t('serverSettings.webhooks.namePlaceholder')} accessibilityLabel={t('serverSettings.webhooks.nameA11y')} maxLength={100} style={{ borderRadius: 0 }} />
        <ChoiceRow
          icon="chatbubble-outline"
          title={t('serverSettings.webhooks.channel')}
          value={channelId}
          options={[{ value: null, label: t('serverSettings.webhooks.choose') }, ...channels.map((c) => ({ value: c.id as string | null, label: `# ${c.name}` }))]}
          onChange={setChannelId}
        />
      </Section>
      <Button title={t('serverSettings.webhooks.create')} icon="add" onPress={create} loading={busy} />
      <Section title={t('serverSettings.webhooks.count', { n: q.data?.length ?? 0 })}>
        {q.data?.length ? null : <Row title={t('serverSettings.webhooks.empty')} />}
        {(q.data ?? []).map((w) => (
          <Row
            key={w.id}
            icon="git-network-outline"
            title={w.name}
            subtitle={`# ${channelName(w.channel_id)} · ${w.token_preview} · ${formatShort(w.created_at)}`}
            right={<IconButton icon="trash-outline" label={t('serverSettings.deleteLabel', { name: w.name })} color={colors.danger} onPress={() => remove(w.id, w.name)} />}
          />
        ))}
      </Section>
    </ScrollView>
  )
}
