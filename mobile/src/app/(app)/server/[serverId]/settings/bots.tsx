import { useQuery } from '@tanstack/react-query'
import * as Clipboard from 'expo-clipboard'
import { Stack } from 'expo-router'
import { useState } from 'react'
import { Alert, ScrollView, View } from 'react-native'
import { botsApi } from '@/api/bots'
import { Button, ErrorState, IconButton, Loading, Row, Section, T, TextField } from '@/components/ui'
import { botName, botToken } from '@/features/servers/bots'
import { useT } from '@/i18n'
import { formatShort } from '@/lib/format'
import { errorMessage } from '@/lib/http'
import { useRouteParams } from '@/lib/params'
import { colors, spacing } from '@/theme'

/** Bots du serveur (MANAGE_SERVER). Le jeton n'est montré qu'à la création ou à la régénération : à copier à ce moment-là. */
export default function BotsScreen() {
  const { valid, ids } = useRouteParams(['serverId'] as const)
  const sid = ids.serverId ?? ''
  const q = useQuery({ queryKey: ['bots', sid], queryFn: () => botsApi.list(sid), enabled: valid })
  const [name, setName] = useState('')
  const [shown, setShown] = useState<{ label: string; token: string } | null>(null)
  const [busy, setBusy] = useState(false)
  const t = useT()
  if (!valid) return <ErrorState message={t('serverSettings.invalidServer')} />
  if (q.isLoading) return <Loading />
  if (q.error) return <ErrorState message={errorMessage(q.error)} onRetry={() => void q.refetch()} />

  const fail = (e: unknown) => Alert.alert(t('bots.failed'), errorMessage(e))
  const okName = botName(name)
  const copy = (token: string) =>
    void Clipboard.setStringAsync(token).then(
      () => Alert.alert(t('bots.copied')),
      () => Alert.alert(t('serverSettings.webhooks.copyFailed')),
    )
  const create = async () => {
    if (!okName) return
    setBusy(true)
    try {
      const token = botToken(await botsApi.create(sid, okName))
      setName('')
      if (token) setShown({ label: okName, token })
      await q.refetch()
    } catch (e) {
      fail(e)
    } finally {
      setBusy(false)
    }
  }
  const regenerate = (id: string, label: string) =>
    Alert.alert(t('bots.regenTitle', { name: label }), t('bots.regenBody'), [
      { text: t('common.cancel'), style: 'cancel' },
      {
        text: t('bots.regen'),
        style: 'destructive',
        onPress: () =>
          void botsApi
            .regenerate(sid, id)
            .then((r) => {
              const token = botToken(r)
              if (token) setShown({ label, token })
            })
            .catch(fail),
      },
    ])
  const remove = (id: string, label: string) =>
    Alert.alert(t('bots.deleteTitle', { name: label }), t('bots.deleteBody'), [
      { text: t('common.cancel'), style: 'cancel' },
      { text: t('common.delete'), style: 'destructive', onPress: () => void botsApi.remove(sid, id).then(() => q.refetch()).catch(fail) },
    ])

  return (
    <ScrollView style={{ backgroundColor: colors.bg }} contentContainerStyle={{ padding: spacing.lg, gap: spacing.lg }} keyboardShouldPersistTaps="handled">
      <Stack.Screen options={{ title: t('bots.title') }} />
      {shown ? (
        <View style={{ gap: spacing.sm }}>
          <T variant="label">{t('bots.token', { name: shown.label })}</T>
          <T selectable variant="muted">
            {shown.token}
          </T>
          <Button title={t('bots.copy')} icon="copy-outline" onPress={() => copy(shown.token)} />
          <T variant="small">{t('bots.notShownAgain')}</T>
        </View>
      ) : null}
      <Section title={t('bots.createSection')}>
        <TextField value={name} onChangeText={setName} placeholder={t('bots.namePh')} accessibilityLabel={t('bots.namePh')} maxLength={32} style={{ borderRadius: 0 }} />
      </Section>
      <Button title={t('bots.create')} icon="add" disabled={!okName} loading={busy} onPress={create} />
      <Section title={t('bots.count', { n: q.data?.length ?? 0 })}>
        {q.data?.length ? null : <Row title={t('bots.empty')} />}
        {(q.data ?? []).map((b) => (
          <Row
            key={b.botUserId}
            icon="hardware-chip-outline"
            title={b.name}
            subtitle={[b.username, b.createdAt ? formatShort(b.createdAt) : null].filter(Boolean).join(' · ')}
            right={
              <View style={{ flexDirection: 'row' }}>
                <IconButton icon="key-outline" label={t('bots.regenTitle', { name: b.name })} onPress={() => regenerate(b.botUserId, b.name)} />
                <IconButton icon="trash-outline" label={t('bots.deleteTitle', { name: b.name })} color={colors.danger} onPress={() => remove(b.botUserId, b.name)} />
              </View>
            }
          />
        ))}
      </Section>
    </ScrollView>
  )
}
