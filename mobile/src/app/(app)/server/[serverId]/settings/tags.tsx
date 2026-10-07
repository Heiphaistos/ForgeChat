import { useQuery } from '@tanstack/react-query'
import { Stack } from 'expo-router'
import { useState } from 'react'
import { Alert, Pressable, ScrollView, View } from 'react-native'
import { moderationApi } from '@/api/moderation'
import { Button, ErrorState, IconButton, Loading, Row, Section, T, TextField } from '@/components/ui'
import { roleColorHex } from '@/features/servers/perms'
import { useT } from '@/i18n'
import { errorMessage } from '@/lib/http'
import { useRouteParams } from '@/lib/params'
import { colors, spacing } from '@/theme'

const COLORS = [0x7289da, 0x5865f2, 0x3ba55c, 0xfaa61a, 0xed4245, 0xeb459e, 0x9b59b6, 0x1abc9c]

/** Tags de clan (MANAGE_ROLES) : création, suppression. Attribution depuis la fiche d'un membre. */
export default function ClanTagsScreen() {
  const { valid, ids } = useRouteParams(['serverId'] as const)
  const sid = ids.serverId ?? ''
  const q = useQuery({ queryKey: ['clan-tags', sid], queryFn: () => moderationApi.tags(sid), enabled: valid })
  const [name, setName] = useState('')
  const [color, setColor] = useState(COLORS[0]!)
  const [busy, setBusy] = useState(false)
  const t = useT()
  if (!valid) return <ErrorState message={t('serverSettings.invalidServer')} />
  if (q.isLoading) return <Loading />
  if (q.error) return <ErrorState message={errorMessage(q.error)} onRetry={() => void q.refetch()} />

  const create = async () => {
    if (!name.trim()) return
    setBusy(true)
    try {
      await moderationApi.createTag(sid, name, color)
      setName('')
      await q.refetch()
    } catch (e) {
      Alert.alert(t('serverSettings.createFailed'), errorMessage(e))
    } finally {
      setBusy(false)
    }
  }

  const remove = (id: string, label: string) =>
    Alert.alert(t('serverSettings.tags.deleteTitle', { name: label }), t('serverSettings.tags.deleteBody'), [
      { text: t('common.cancel'), style: 'cancel' },
      {
        text: t('common.delete'),
        style: 'destructive',
        onPress: () =>
          void moderationApi
            .deleteTag(sid, id)
            .then(() => q.refetch())
            .catch((e) => Alert.alert(t('serverSettings.deleteFailed'), errorMessage(e))),
      },
    ])

  return (
    <ScrollView style={{ backgroundColor: colors.bg }} contentContainerStyle={{ padding: spacing.lg, gap: spacing.lg }} keyboardShouldPersistTaps="handled">
      <Stack.Screen options={{ title: t('serverSettings.title.tags') }} />
      <TextField label={t('serverSettings.channel.newTag')} value={name} onChangeText={setName} maxLength={32} placeholder="FORGE" />
      <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: spacing.sm }} accessibilityRole="radiogroup" accessibilityLabel={t('serverSettings.tags.colorA11y')}>
        {COLORS.map((c) => (
          <Pressable
            key={c}
            onPress={() => setColor(c)}
            accessibilityRole="radio"
            accessibilityLabel={roleColorHex(c) ?? ''}
            accessibilityState={{ selected: color === c }}
            style={{ width: 36, height: 36, borderRadius: 18, backgroundColor: roleColorHex(c) ?? colors.bgElevated, borderWidth: 3, borderColor: color === c ? colors.text : 'transparent' }}
          />
        ))}
      </View>
      <Button title={t('serverSettings.tags.create')} icon="add" onPress={create} loading={busy} disabled={!name.trim()} />
      <Section title={t('serverSettings.tags.count', { n: q.data?.length ?? 0 })} footer={t('serverSettings.tags.footer')}>
        {q.data?.length ? null : <Row title={t('serverSettings.tags.empty')} />}
        {(q.data ?? []).map((tag) => (
          <Row
            key={tag.id}
            title={tag.name}
            right={
              <View style={{ flexDirection: 'row', alignItems: 'center', gap: spacing.sm }}>
                <View style={{ width: 14, height: 14, borderRadius: 7, backgroundColor: roleColorHex(tag.color) ?? colors.textMuted }} accessible={false} />
                <IconButton icon="trash-outline" label={t('serverSettings.channel.deleteTag', { name: tag.name })} color={colors.danger} onPress={() => remove(tag.id, tag.name)} />
              </View>
            }
          />
        ))}
      </Section>
      <T variant="small">{t('serverSettings.tags.max')}</T>
    </ScrollView>
  )
}
