import { useQuery } from '@tanstack/react-query'
import { Stack, router } from 'expo-router'
import { useState } from 'react'
import { ScrollView, View } from 'react-native'
import { serversApi } from '@/api/servers'
import { Button, ErrorState, T, TextField } from '@/components/ui'
import { errorMessage } from '@/lib/http'
import { isUuid, useRouteParams } from '@/lib/params'
import { qk, queryClient } from '@/lib/queryClient'
import { colors, spacing } from '@/theme'

const TYPES = [
  { type: 'text', label: 'Textuel', icon: 'chatbubble-outline' },
  { type: 'voice', label: 'Vocal', icon: 'volume-medium' },
  { type: 'media', label: 'Médias', icon: 'images-outline' },
  { type: 'category', label: 'Catégorie', icon: 'folder-open-outline' },
] as const

type Kind = (typeof TYPES)[number]['type']

export default function CreateChannelScreen() {
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
  if (!valid) return <ErrorState message="Serveur invalide." />

  const submit = async () => {
    const n = name.trim()
    if (n.length < 1 || n.length > 100) {
      setError('Le nom doit faire entre 1 et 100 caractères.')
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
      <Stack.Screen options={{ title: type === 'category' ? 'Créer une catégorie' : 'Créer un salon' }} />
      <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: spacing.sm }} accessibilityRole="radiogroup" accessibilityLabel="Type de salon">
        {TYPES.map((t) => (
          <Button
            key={t.type}
            title={t.label}
            icon={t.icon}
            variant={type === t.type ? 'primary' : 'secondary'}
            onPress={() => setType(t.type)}
            accessibilityRole="radio"
            accessibilityState={{ selected: type === t.type }}
            style={{ flexGrow: 1 }}
          />
        ))}
      </View>
      <TextField label={type === 'category' ? 'Nom de la catégorie' : 'Nom du salon'} value={name} onChangeText={setName} maxLength={100} autoFocus autoCapitalize="none" error={error} />
      {cats.length && type !== 'category' ? (
        <View style={{ gap: spacing.sm }}>
          <T variant="muted">Catégorie</T>
          <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: spacing.sm }} accessibilityRole="radiogroup" accessibilityLabel="Catégorie">
            {[{ id: null, name: 'Aucune' }, ...cats].map((c) => (
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
      <Button title={type === 'category' ? 'Créer la catégorie' : 'Créer le salon'} onPress={submit} loading={loading} />
    </ScrollView>
  )
}
