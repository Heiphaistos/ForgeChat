import { useQuery } from '@tanstack/react-query'
import { Stack } from 'expo-router'
import { useState } from 'react'
import { Alert, Pressable, ScrollView, View } from 'react-native'
import { moderationApi } from '@/api/moderation'
import { Button, ErrorState, IconButton, Loading, Row, Section, T, TextField } from '@/components/ui'
import { roleColorHex } from '@/features/servers/perms'
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
  if (!valid) return <ErrorState message="Serveur invalide." />
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
      Alert.alert('Création impossible', errorMessage(e))
    } finally {
      setBusy(false)
    }
  }

  const remove = (id: string, label: string) =>
    Alert.alert(`Supprimer le tag « ${label} » ?`, 'Il est retiré de tous les membres.', [
      { text: 'Annuler', style: 'cancel' },
      {
        text: 'Supprimer',
        style: 'destructive',
        onPress: () =>
          void moderationApi
            .deleteTag(sid, id)
            .then(() => q.refetch())
            .catch((e) => Alert.alert('Suppression impossible', errorMessage(e))),
      },
    ])

  return (
    <ScrollView style={{ backgroundColor: colors.bg }} contentContainerStyle={{ padding: spacing.lg, gap: spacing.lg }} keyboardShouldPersistTaps="handled">
      <Stack.Screen options={{ title: 'Tags de clan' }} />
      <TextField label="Nouveau tag" value={name} onChangeText={setName} maxLength={32} placeholder="FORGE" />
      <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: spacing.sm }} accessibilityRole="radiogroup" accessibilityLabel="Couleur du tag">
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
      <Button title="Créer le tag" icon="add" onPress={create} loading={busy} disabled={!name.trim()} />
      <Section title={`Tags (${q.data?.length ?? 0})`} footer="Pour attribuer un tag : Membres, puis toucher un membre.">
        {q.data?.length ? null : <Row title="Aucun tag" />}
        {(q.data ?? []).map((t) => (
          <Row
            key={t.id}
            title={t.name}
            right={
              <View style={{ flexDirection: 'row', alignItems: 'center', gap: spacing.sm }}>
                <View style={{ width: 14, height: 14, borderRadius: 7, backgroundColor: roleColorHex(t.color) ?? colors.textMuted }} accessible={false} />
                <IconButton icon="trash-outline" label={`Supprimer le tag ${t.name}`} color={colors.danger} onPress={() => remove(t.id, t.name)} />
              </View>
            }
          />
        ))}
      </Section>
      <T variant="small">32 caractères au plus.</T>
    </ScrollView>
  )
}
