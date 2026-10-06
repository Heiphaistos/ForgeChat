import { useQuery } from '@tanstack/react-query'
import { Image } from 'expo-image'
import * as ImagePicker from 'expo-image-picker'
import { Stack } from 'expo-router'
import { useState } from 'react'
import { Alert, ScrollView, View } from 'react-native'
import { moderationApi } from '@/api/moderation'
import { serversApi } from '@/api/servers'
import { Button, ErrorState, IconButton, Loading, Row, Section, TextField } from '@/components/ui'
import { errorMessage } from '@/lib/http'
import { resolveMediaUrl } from '@/lib/links'
import { useRouteParams } from '@/lib/params'
import { ensurePhotoAccess } from '@/lib/photoAccess'
import { qk, queryClient } from '@/lib/queryClient'
import { colors, spacing } from '@/theme'

type Kind = 'emoji' | 'sticker'
interface Item {
  id: string
  name: string
  url: string
}

// Limites de emojis.rs et stickers.rs.
const RULES: Record<Kind, { name: RegExp; nameHint: string; types: string[]; max: (type: string) => number }> = {
  emoji: {
    name: /^[a-z0-9_]{1,32}$/,
    nameHint: '1 à 32 caractères : lettres minuscules, chiffres, _',
    types: ['image/png', 'image/jpeg', 'image/gif', 'image/webp'],
    max: (t) => (t === 'image/gif' ? 512 : 256) * 1024,
  },
  sticker: { name: /^.{1,50}$/, nameHint: '1 à 50 caractères', types: ['image/png', 'image/webp', 'image/gif'], max: () => 2 * 1024 * 1024 },
}

const items = (raw: unknown): Item[] =>
  Array.isArray(raw) ? raw.filter((x): x is Item => !!x && typeof x.id === 'string' && typeof x.name === 'string' && typeof x.url === 'string') : []

/** Emojis et stickers du serveur (MANAGE_SERVER) : ajout depuis la galerie, suppression. */
export default function EmojisScreen() {
  const { valid, ids } = useRouteParams(['serverId'] as const)
  const sid = ids.serverId ?? ''
  const emojis = useQuery({ queryKey: qk.emojis(sid), queryFn: () => serversApi.emojis(sid), enabled: valid })
  const stickers = useQuery({ queryKey: ['stickers', sid], queryFn: () => serversApi.stickers(sid), enabled: valid })
  const [names, setNames] = useState<Record<Kind, string>>({ emoji: '', sticker: '' })
  const [busy, setBusy] = useState<Kind | null>(null)
  if (!valid) return <ErrorState message="Serveur invalide." />
  if (emojis.isLoading || stickers.isLoading) return <Loading />
  if (emojis.error) return <ErrorState message={errorMessage(emojis.error)} onRetry={() => void emojis.refetch()} />

  const refresh = (kind: Kind) => queryClient.invalidateQueries({ queryKey: kind === 'emoji' ? qk.emojis(sid) : ['stickers', sid] })

  const add = async (kind: Kind) => {
    const rule = RULES[kind]
    const name = kind === 'emoji' ? names.emoji.trim().toLowerCase() : names.sticker.trim()
    if (!rule.name.test(name)) return Alert.alert('Nom invalide', rule.nameHint)
    if (!(await ensurePhotoAccess())) return
    // Pas de recadrage : il ré-encoderait en JPEG, refusé pour les stickers, et ferait perdre l'animation.
    const res = await ImagePicker.launchImageLibraryAsync({ mediaTypes: ['images'] })
    const a = res.canceled ? undefined : res.assets[0]
    if (!a) return
    const type = a.mimeType ?? 'image/png'
    if (!rule.types.includes(type)) return Alert.alert('Format refusé', kind === 'emoji' ? 'PNG, JPEG, GIF ou WEBP.' : 'PNG, WEBP ou GIF.')
    if (a.fileSize && a.fileSize > rule.max(type)) return Alert.alert('Image trop lourde', `Maximum ${Math.round(rule.max(type) / 1024)} Ko.`)
    setBusy(kind)
    try {
      const file = { uri: a.uri, name: a.fileName ?? `${kind}.${type.split('/')[1]}`, type }
      await (kind === 'emoji' ? moderationApi.createEmoji(sid, name, file) : moderationApi.createSticker(sid, name, file))
      setNames((n) => ({ ...n, [kind]: '' }))
      await refresh(kind)
    } catch (e) {
      Alert.alert('Ajout impossible', errorMessage(e))
    } finally {
      setBusy(null)
    }
  }

  const remove = (kind: Kind, it: Item) =>
    Alert.alert(`Supprimer « ${it.name} » ?`, undefined, [
      { text: 'Annuler', style: 'cancel' },
      {
        text: 'Supprimer',
        style: 'destructive',
        onPress: () =>
          void (kind === 'emoji' ? moderationApi.deleteEmoji(sid, it.id) : moderationApi.deleteSticker(sid, it.id))
            .then(() => refresh(kind))
            .catch((e) => Alert.alert('Suppression impossible', errorMessage(e))),
      },
    ])

  const section = (kind: Kind, title: string, list: Item[]) => (
    <Section title={`${title} (${list.length})`} footer={RULES[kind].nameHint}>
      {list.map((it) => (
        <Row
          key={it.id}
          title={kind === 'emoji' ? `:${it.name}:` : it.name}
          right={
            <View style={{ flexDirection: 'row', alignItems: 'center', gap: spacing.sm }}>
              <Image source={{ uri: resolveMediaUrl(it.url) ?? undefined }} style={{ width: 32, height: 32 }} contentFit="contain" accessible={false} />
              <IconButton icon="trash-outline" label={`Supprimer ${it.name}`} color={colors.danger} onPress={() => remove(kind, it)} />
            </View>
          }
        />
      ))}
      <View style={{ padding: spacing.sm, gap: spacing.sm }}>
        <TextField
          value={names[kind]}
          onChangeText={(t) => setNames((n) => ({ ...n, [kind]: t }))}
          placeholder={kind === 'emoji' ? 'nom_de_l_emoji' : 'Nom du sticker'}
          accessibilityLabel={kind === 'emoji' ? "Nom du nouvel emoji" : 'Nom du nouveau sticker'}
          autoCapitalize="none"
          maxLength={kind === 'emoji' ? 32 : 50}
        />
        <Button title={kind === 'emoji' ? 'Choisir l’image de l’emoji' : 'Choisir l’image du sticker'} variant="secondary" icon="image-outline" loading={busy === kind} onPress={() => void add(kind)} />
      </View>
    </Section>
  )

  return (
    <ScrollView style={{ backgroundColor: colors.bg }} contentContainerStyle={{ padding: spacing.lg }} keyboardShouldPersistTaps="handled">
      <Stack.Screen options={{ title: 'Emojis et stickers' }} />
      {section('emoji', 'Emojis', items(emojis.data))}
      {section('sticker', 'Stickers', items(stickers.data))}
    </ScrollView>
  )
}
