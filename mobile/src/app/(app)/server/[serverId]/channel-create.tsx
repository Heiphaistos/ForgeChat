import { useQuery } from '@tanstack/react-query'
import { Stack, router } from 'expo-router'
import { useState } from 'react'
import { ScrollView, View } from 'react-native'
import { serversApi } from '@/api/servers'
import { Button, ErrorState, T, TextField } from '@/components/ui'
import { useT } from '@/i18n'
import { errorMessage } from '@/lib/http'
import { isUuid, useRouteParams } from '@/lib/params'
import { qk, queryClient } from '@/lib/queryClient'
import { colors, spacing } from '@/theme'

const TYPES = [
  { type: 'text', label: 'server.channelCreate.text', icon: 'chatbubble-outline' },
  { type: 'voice', label: 'server.channelCreate.voice', icon: 'volume-medium' },
  { type: 'media', label: 'server.channelCreate.media', icon: 'images-outline' },
  { type: 'category', label: 'server.channelCreate.category', icon: 'folder-open-outline' },
] as const

type Kind = (typeof TYPES)[number]['type']

export default function CreateChannelScreen() {
  const t = useT()
  const { valid, ids, text } = useRouteParams(['serverId'] as const, ['type', 'categoryId'])
  const categories = useQuery({
    queryKey: qk.categories(ids.serverId ?? ''),
    queryFn: () => serversApi.categories(ids.serverId!),
    enabled: valid,
  })
  const [name, setName] = useState('')
  const [type, setType] = useState<Kind>(text.type === 'category' ? 'category' : 'text')
  const [categoryId, setCategoryId] = useState<string | null>(isUuid(text.categoryId) ? text.categoryId : null)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  if (!valid) return <ErrorState message={t('server.invalid')} />

  const submit = async () => {
    const n = name.trim()
    if (n.length < 1 || n.length > 100) {
      setError(t('server.channelCreate.nameError'))
      return
    }
    setLoading(true)
    setError(null)
    try {
      if (type === 'category') await serversApi.createCategory(ids.serverId, n)
      else await serversApi.createChannel(ids.serverId, n, type, categoryId)
      await queryClient.invalidateQueries({ queryKey: type === 'category' ? qk.categories(ids.serverId) : qk.channels(ids.serverId) })
      router.back()
    } catch (e) {
      setError(errorMessage(e))
    } finally {
      setLoading(false)
    }
  }

  const cats = [...(categories.data ?? [])].sort((a, b) => a.position - b.position)

  return (
    <ScrollView style={{ backgroundColor: colors.bg }} contentContainerStyle={{ padding: spacing.xl, gap: spacing.lg }} keyboardShouldPersistTaps="handled">
      <Stack.Screen options={{ title: type === 'category' ? t('menu.createCategory') : t('menu.createChannel') }} />
      <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: spacing.sm }} accessibilityRole="radiogroup" accessibilityLabel={t('server.channelCreate.typeLabel')}>
        {TYPES.map((k) => (
          <Button
            key={k.type}
            title={t(k.label)}
            icon={k.icon}
            variant={type === k.type ? 'primary' : 'secondary'}
            onPress={() => setType(k.type)}
            accessibilityRole="radio"
            accessibilityState={{ selected: type === k.type }}
            style={{ flexGrow: 1 }}
          />
        ))}
      </View>
      <TextField label={type === 'category' ? t('server.channelCreate.categoryName') : t('server.channelCreate.channelName')} value={name} onChangeText={setName} maxLength={100} autoFocus autoCapitalize="none" error={error} />
      {cats.length && type !== 'category' ? (
        <View style={{ gap: spacing.sm }}>
          <T variant="muted">{t('server.channelCreate.category')}</T>
          <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: spacing.sm }} accessibilityRole="radiogroup" accessibilityLabel={t('server.channelCreate.category')}>
            {[{ id: null, name: t('server.channelCreate.none') }, ...cats].map((c) => (
              <Button
                key={c.id ?? 'none'}
                title={c.name}
                variant={categoryId === c.id ? 'primary' : 'secondary'}
                onPress={() => setCategoryId(c.id)}
                accessibilityRole="radio"
                accessibilityState={{ selected: categoryId === c.id }}
              />
            ))}
          </View>
        </View>
      ) : null}
      <Button title={type === 'category' ? t('server.channelCreate.submitCategory') : t('server.channelCreate.submitChannel')} onPress={submit} loading={loading} />
    </ScrollView>
  )
}
