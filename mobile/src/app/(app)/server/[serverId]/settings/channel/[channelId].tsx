import { useQuery } from '@tanstack/react-query'
import { router } from 'expo-router'
import { useState } from 'react'
import { ScrollView, View } from 'react-native'
import { serversApi } from '@/api/servers'
import { Button, ErrorState, Loading, T, TextField } from '@/components/ui'
import { confirmDeleteChannel, useServerPerms } from '@/features/servers/menus'
import { errorMessage } from '@/lib/http'
import { useRouteParams } from '@/lib/params'
import { qk, queryClient } from '@/lib/queryClient'
import type { Category, Channel } from '@/types/models'
import { colors, spacing } from '@/theme'

/** Modifier un salon : nom, sujet, catégorie (PATCH salon + PATCH /channels/:id/move), suppression. */
export default function EditChannelScreen() {
  const { valid, ids } = useRouteParams(['serverId', 'channelId'] as const)
  const sid = ids.serverId ?? ''
  const channels = useQuery({ queryKey: qk.channels(sid), queryFn: () => serversApi.channels(sid), enabled: valid })
  const categories = useQuery({ queryKey: qk.categories(sid), queryFn: () => serversApi.categories(sid), enabled: valid })
  const channel = channels.data?.find((c) => c.id === ids.channelId)
  if (!valid) return <ErrorState message="Salon invalide." />
  if (channels.isLoading) return <Loading />
  if (!channel) return <ErrorState message={channels.error ? errorMessage(channels.error) : 'Salon introuvable.'} />
  return <ChannelForm key={channel.id} serverId={sid} channel={channel} categories={categories.data ?? []} />
}

function ChannelForm({ serverId, channel, categories }: { serverId: string; channel: Channel; categories: Category[] }) {
  const perms = useServerPerms(serverId)
  const [name, setName] = useState(channel.name)
  const [topic, setTopic] = useState(channel.topic ?? '')
  const [categoryId, setCategoryId] = useState<string | null>(channel.category_id)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const save = async () => {
    const n = name.trim()
    if (n.length < 1 || n.length > 100) {
      setError('Le nom doit faire entre 1 et 100 caractères.')
      return
    }
    setSaving(true)
    setError(null)
    try {
      if (n !== channel.name || topic.trim() !== (channel.topic ?? '')) await serversApi.updateChannel(serverId, channel.id, { name: n, topic: topic.trim() })
      if (categoryId !== channel.category_id) await serversApi.moveChannel(channel.id, categoryId)
      await queryClient.invalidateQueries({ queryKey: qk.channels(serverId) })
      router.back()
    } catch (e) {
      setError(errorMessage(e))
    } finally {
      setSaving(false)
    }
  }

  const cats = [...categories].sort((a, b) => a.position - b.position)
  return (
    <ScrollView style={{ backgroundColor: colors.bg }} contentContainerStyle={{ padding: spacing.xl, gap: spacing.lg }} keyboardShouldPersistTaps="handled">
      {perms.canEditChannels ? (
        <>
          <TextField label="Nom du salon" value={name} onChangeText={setName} maxLength={100} autoCapitalize="none" />
          <TextField label="Sujet" value={topic} onChangeText={setTopic} multiline maxLength={1024} style={{ minHeight: 70, textAlignVertical: 'top' }} />
          {cats.length ? (
            <View style={{ gap: spacing.sm }}>
              <T variant="label">Catégorie</T>
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
          {error ? <T variant="error">{error}</T> : null}
          <Button title="Enregistrer" onPress={save} loading={saving} />
        </>
      ) : (
        <T variant="muted">Tu n’as pas le droit de modifier ce salon.</T>
      )}
      {perms.canDeleteChannel(channel.created_by) ? (
        <Button title="Supprimer le salon" variant="danger" icon="trash-outline" onPress={() => confirmDeleteChannel(serverId, channel, () => router.back())} />
      ) : null}
    </ScrollView>
  )
}
