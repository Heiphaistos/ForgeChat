import { Image } from 'expo-image'
import * as ImagePicker from 'expo-image-picker'
import { useState } from 'react'
import { Alert, Pressable, ScrollView, View } from 'react-native'
import { serversApi } from '@/api/servers'
import { Avatar } from '@/components/Avatar'
import { Button, ErrorState, Loading, T, TextField } from '@/components/ui'
import { useServerDetail } from '@/features/servers/menus'
import { errorMessage } from '@/lib/http'
import { resolveMediaUrl } from '@/lib/links'
import { useRouteParams } from '@/lib/params'
import { ensurePhotoAccess } from '@/lib/photoAccess'
import { qk, queryClient } from '@/lib/queryClient'
import type { Server } from '@/types/models'
import { colors, radius, spacing } from '@/theme'

// Limites de servers.rs : icône 8 Mo, bannière 2 Mo.
const MAX_BYTES = { icon: 8 * 1024 * 1024, banner: 2 * 1024 * 1024 }

const refresh = (id: string) =>
  Promise.all([queryClient.invalidateQueries({ queryKey: qk.servers }), queryClient.invalidateQueries({ queryKey: qk.server(id) })])

/** Vue d'ensemble (propriétaire) : nom, description, icône, bannière. */
export default function OverviewScreen() {
  const { valid, ids } = useRouteParams(['serverId'] as const)
  const detail = useServerDetail(ids.serverId ?? '', valid)
  const server = detail.data?.server
  if (!valid) return <ErrorState message="Serveur invalide." />
  if (detail.isLoading) return <Loading />
  if (!server) return <ErrorState message={errorMessage(detail.error)} onRetry={() => void detail.refetch()} />
  return <OverviewForm key={server.id} server={server} />
}

function OverviewForm({ server }: { server: Server }) {
  const [name, setName] = useState(server.name)
  const [description, setDescription] = useState(server.description ?? '')
  const [saving, setSaving] = useState(false)
  const [uploading, setUploading] = useState<'icon' | 'banner' | null>(null)
  const [error, setError] = useState<string | null>(null)

  const save = async () => {
    const n = name.trim()
    if (n.length < 2 || n.length > 100) {
      setError('Le nom doit faire entre 2 et 100 caractères.')
      return
    }
    setSaving(true)
    setError(null)
    try {
      await serversApi.update(server.id, { name: n, description: description.trim() })
      await refresh(server.id)
      Alert.alert('Serveur mis à jour')
    } catch (e) {
      setError(errorMessage(e))
    } finally {
      setSaving(false)
    }
  }

  const pick = async (kind: 'icon' | 'banner') => {
    if (!(await ensurePhotoAccess())) return
    const res = await ImagePicker.launchImageLibraryAsync({
      mediaTypes: ['images'],
      allowsEditing: true,
      aspect: kind === 'icon' ? [1, 1] : [3, 1],
      quality: 0.8, // ré-encodage JPEG : retire les métadonnées EXIF
    })
    const a = res.canceled ? undefined : res.assets[0]
    if (!a) return
    if (a.fileSize && a.fileSize > MAX_BYTES[kind]) {
      Alert.alert('Image trop lourde', kind === 'icon' ? 'Maximum 8 Mo.' : 'Maximum 2 Mo.')
      return
    }
    setUploading(kind)
    try {
      await serversApi.uploadImage(server.id, kind, { uri: a.uri, name: `${kind}.jpg`, type: 'image/jpeg' })
      await refresh(server.id)
    } catch (e) {
      Alert.alert('Envoi impossible', errorMessage(e))
    } finally {
      setUploading(null)
    }
  }

  const banner = resolveMediaUrl(server.banner)

  return (
    <ScrollView style={{ backgroundColor: colors.bg }} contentContainerStyle={{ padding: spacing.xl, gap: spacing.lg }} keyboardShouldPersistTaps="handled">
      <View style={{ flexDirection: 'row', alignItems: 'center', gap: spacing.lg }}>
        <Pressable onPress={() => void pick('icon')} accessibilityRole="button" accessibilityLabel="Changer l'icône du serveur" disabled={!!uploading}>
          <Avatar uri={server.icon} name={server.name} size={72} rounded={false} />
        </Pressable>
        <Button title="Changer l'icône" variant="secondary" icon="image-outline" onPress={() => void pick('icon')} loading={uploading === 'icon'} style={{ flex: 1 }} />
      </View>
      {banner ? (
        <Image source={{ uri: banner }} style={{ height: 96, borderRadius: radius.md }} contentFit="cover" accessibilityLabel="Bannière actuelle" />
      ) : null}
      <Button title={banner ? 'Changer la bannière' : 'Ajouter une bannière'} variant="secondary" icon="images-outline" onPress={() => void pick('banner')} loading={uploading === 'banner'} />
      <TextField label="Nom du serveur" value={name} onChangeText={setName} maxLength={100} />
      <TextField label="Description" value={description} onChangeText={setDescription} multiline maxLength={1000} style={{ minHeight: 90, textAlignVertical: 'top' }} />
      {error ? <T variant="error">{error}</T> : null}
      <Button title="Enregistrer" onPress={save} loading={saving} />
    </ScrollView>
  )
}
