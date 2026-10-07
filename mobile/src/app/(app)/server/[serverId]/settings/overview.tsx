import { Image } from 'expo-image'
import * as ImagePicker from 'expo-image-picker'
import { useState } from 'react'
import { Alert, Pressable, ScrollView, View } from 'react-native'
import { serversApi } from '@/api/servers'
import { Avatar } from '@/components/Avatar'
import { Button, ErrorState, Loading, SwitchRow, T, TextField } from '@/components/ui'
import { useServerDetail } from '@/features/servers/menus'
import { useT } from '@/i18n'
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
  const t = useT()
  if (!valid) return <ErrorState message={t('serverSettings.invalidServer')} />
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
  const [roleOverrides, setRoleOverrides] = useState(server.role_color_overrides_name !== false)
  const t = useT()

  const toggleRoleOverrides = async (v: boolean) => {
    setRoleOverrides(v)
    try {
      await serversApi.update(server.id, { role_color_overrides_name: v })
      await refresh(server.id)
    } catch (e) {
      setRoleOverrides(!v)
      Alert.alert(t('common.actionFailed'), errorMessage(e))
    }
  }

  const save = async () => {
    const n = name.trim()
    if (n.length < 2 || n.length > 100) {
      setError(t('serverSettings.overview.nameLength'))
      return
    }
    setSaving(true)
    setError(null)
    try {
      await serversApi.update(server.id, { name: n, description: description.trim() })
      await refresh(server.id)
      Alert.alert(t('serverSettings.overview.updated'))
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
      Alert.alert(t('serverSettings.imageTooLarge'), t('serverSettings.maxMb', { n: kind === 'icon' ? 8 : 2 }))
      return
    }
    setUploading(kind)
    try {
      await serversApi.uploadImage(server.id, kind, { uri: a.uri, name: `${kind}.jpg`, type: 'image/jpeg' })
      await refresh(server.id)
    } catch (e) {
      Alert.alert(t('serverSettings.uploadFailed'), errorMessage(e))
    } finally {
      setUploading(null)
    }
  }

  const banner = resolveMediaUrl(server.banner)

  return (
    <ScrollView style={{ backgroundColor: colors.bg }} contentContainerStyle={{ padding: spacing.xl, gap: spacing.lg }} keyboardShouldPersistTaps="handled">
      <View style={{ flexDirection: 'row', alignItems: 'center', gap: spacing.lg }}>
        <Pressable onPress={() => void pick('icon')} accessibilityRole="button" accessibilityLabel={t('serverSettings.overview.changeIconA11y')} disabled={!!uploading}>
          <Avatar uri={server.icon} name={server.name} size={72} rounded={false} />
        </Pressable>
        <Button title={t('serverSettings.overview.changeIcon')} variant="secondary" icon="image-outline" onPress={() => void pick('icon')} loading={uploading === 'icon'} style={{ flex: 1 }} />
      </View>
      {banner ? (
        <Image source={{ uri: banner }} style={{ height: 96, borderRadius: radius.md }} contentFit="cover" accessibilityLabel={t('serverSettings.overview.currentBanner')} />
      ) : null}
      <Button title={t(banner ? 'serverSettings.overview.changeBanner' : 'serverSettings.overview.addBanner')} variant="secondary" icon="images-outline" onPress={() => void pick('banner')} loading={uploading === 'banner'} />
      <TextField label={t('serverSettings.overview.name')} value={name} onChangeText={setName} maxLength={100} />
      <TextField label={t('serverSettings.overview.description')} value={description} onChangeText={setDescription} multiline maxLength={1000} style={{ minHeight: 90, textAlignVertical: 'top' }} />
      <SwitchRow
        icon="color-palette-outline"
        title={t('serverSettings.overview.roleColorOverrides')}
        subtitle={t('serverSettings.overview.roleColorOverridesSub')}
        value={roleOverrides}
        onValueChange={(v) => void toggleRoleOverrides(v)}
      />
      {error ? <T variant="error">{error}</T> : null}
      <Button title={t('serverSettings.save')} onPress={save} loading={saving} />
    </ScrollView>
  )
}
