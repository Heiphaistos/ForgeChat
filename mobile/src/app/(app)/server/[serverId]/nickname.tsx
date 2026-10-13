import * as ImagePicker from 'expo-image-picker'
import { useQuery } from '@tanstack/react-query'
import { router } from 'expo-router'
import { useState } from 'react'
import { Alert, Pressable, ScrollView, Text, View } from 'react-native'
import { serversApi } from '@/api/servers'
import { Avatar } from '@/components/Avatar'
import { Button, ErrorState, Loading, T, TextField } from '@/components/ui'
import { LIMITS } from '@/config/env'
import { ProfileBanner } from '@/features/account/ProfileBanner'
import { PROFILE_IMAGE_MAX_BYTES, pickAnimatedImage } from '@/features/account/pickAnimated'
import { shownProfile } from '@/features/servers/memberProfile'
import { useT } from '@/i18n'
import { errorMessage } from '@/lib/http'
import { useRouteParams } from '@/lib/params'
import { ensurePhotoAccess } from '@/lib/photoAccess'
import { qk, queryClient } from '@/lib/queryClient'
import { useAuth } from '@/stores/auth'
import type { Member } from '@/types/models'
import { colors, font, spacing } from '@/theme'

const BANNER_MAX_BYTES = PROFILE_IMAGE_MAX_BYTES // member_profile::image_column

/** « Mon profil sur ce serveur » : pseudo, avatar, bannière et bio visibles sur ce serveur seulement.
 *  Vide : profil du compte. */
export default function ServerProfileScreen() {
  const t = useT()
  const { valid, ids } = useRouteParams(['serverId'] as const)
  const me = useAuth((s) => s.user)
  const members = useQuery({ queryKey: qk.members(ids.serverId ?? ''), queryFn: () => serversApi.members(ids.serverId), enabled: valid })
  if (!valid) return <ErrorState message={t('server.invalid')} />
  if (members.isLoading || !me) return <Loading />
  const member = members.data?.find((m) => m.user_id === me.id)
  return <ServerProfileForm serverId={ids.serverId} me={me} member={member} />
}

function ServerProfileForm({
  serverId,
  me,
  member,
}: {
  serverId: string
  me: { username: string; avatar?: string | null; banner?: string | null; bio?: string | null }
  member?: Member
}) {
  const t = useT()
  const [nick, setNick] = useState(member?.nickname ?? '')
  const [bio, setBio] = useState(member?.server_bio ?? '')
  const [loading, setLoading] = useState(false)
  const [uploading, setUploading] = useState<'avatar' | 'banner' | null>(null)
  const [error, setError] = useState<string | null>(null)
  const shown = shownProfile(me, member)
  const refresh = () => queryClient.invalidateQueries({ queryKey: qk.members(serverId) })

  const save = async () => {
    setLoading(true)
    setError(null)
    try {
      await serversApi.setNickname(serverId, nick.trim() || null)
      await serversApi.setServerBio(serverId, bio.trim() || null)
      await refresh()
      router.back()
    } catch (e) {
      setError(errorMessage(e))
    } finally {
      setLoading(false)
    }
  }

  const pick = async (kind: 'avatar' | 'banner') => {
    if (!(await ensurePhotoAccess())) return
    const res = await ImagePicker.launchImageLibraryAsync({
      mediaTypes: ['images'],
      // Bannière gardée entière (aucun recadrage) : elle est affichée sans rognage partout.
      allowsEditing: kind === 'avatar',
      aspect: kind === 'avatar' ? [1, 1] : undefined,
      quality: kind === 'avatar' ? 0.8 : 0.92, // ré-encodage JPEG : retire les métadonnées EXIF (GPS…)
    })
    if (res.canceled || !res.assets[0]) return
    const a = res.assets[0]
    const max = kind === 'avatar' ? LIMITS.avatarMaxBytes : BANNER_MAX_BYTES
    if (a.fileSize && a.fileSize > max) {
      Alert.alert(t('server.nickname.tooBig'), t('server.nickname.maxSize', { n: max / 1024 / 1024 }))
      return
    }
    await upload(kind, { uri: a.uri, name: `${kind}.jpg`, type: 'image/jpeg' })
  }

  const upload = async (kind: 'avatar' | 'banner', file: { uri: string; name: string; type: string }) => {
    setUploading(kind)
    try {
      await serversApi.uploadServerProfileImage(serverId, kind, file)
      await refresh()
    } catch (e) {
      Alert.alert(t('server.nickname.uploadFailed'), errorMessage(e))
    } finally {
      setUploading(null)
    }
  }

  const pickAnimated = async (kind: 'avatar' | 'banner') => {
    const file = await pickAnimatedImage()
    if (file) await upload(kind, file)
  }

  const clear = (kind: 'avatar' | 'banner') =>
    serversApi
      .clearServerProfileImage(serverId, kind)
      .then(refresh)
      .catch((e) => Alert.alert(t('common.actionFailed'), errorMessage(e)))

  // Avatar du serveur : le serveur le substitue à `avatar`, il diffère donc de celui du compte.
  const hasServerAvatar = !!member?.avatar && member.avatar !== me.avatar

  return (
    <ScrollView style={{ backgroundColor: colors.bg }} contentContainerStyle={{ padding: spacing.xl, gap: spacing.lg }} keyboardShouldPersistTaps="handled">
      <T variant="muted">{t('server.nickname.intro')}</T>
      <ProfileBanner uri={shown.banner} name={me.username} />
      <Pressable onPress={() => void pick('avatar')} style={{ alignItems: 'center', gap: spacing.sm }} accessibilityRole="button" accessibilityLabel={t('server.nickname.changeAvatarLabel')}>
        <Avatar uri={shown.avatar} name={me.username} size={96} />
        <Text style={{ color: colors.link, fontSize: font.sm }}>{uploading === 'avatar' ? t('server.nickname.uploading') : t('server.nickname.changeAvatar')}</Text>
      </Pressable>
      {hasServerAvatar ? <Button title={t('server.nickname.resetAvatar')} variant="ghost" onPress={() => void clear('avatar')} /> : null}
      <Button
        title={uploading === 'banner' ? t('server.nickname.uploading') : member?.server_banner ? t('server.nickname.changeBanner') : t('server.nickname.addBanner')}
        variant="secondary"
        icon="image-outline"
        disabled={uploading !== null}
        onPress={() => void pick('banner')}
      />
      <View style={{ flexDirection: 'row', gap: spacing.sm }}>
        <Button title={t('settings.animated.avatar')} variant="ghost" icon="film-outline" disabled={uploading !== null} onPress={() => void pickAnimated('avatar')} style={{ flex: 1 }} />
        <Button title={t('settings.animated.banner')} variant="ghost" icon="film-outline" disabled={uploading !== null} onPress={() => void pickAnimated('banner')} style={{ flex: 1 }} />
      </View>
      {member?.server_banner ? <Button title={t('server.nickname.resetBanner')} variant="ghost" onPress={() => void clear('banner')} /> : null}
      <TextField label={t('server.nickname.nick')} value={nick} onChangeText={setNick} maxLength={32} placeholder={me.username} autoCorrect={false} />
      <TextField label={t('server.nickname.bio')} value={bio} onChangeText={setBio} maxLength={190} multiline placeholder={me.bio || t('server.nickname.bioPlaceholder')} error={error} />
      <Button title={t('server.save')} onPress={() => void save()} loading={loading} />
    </ScrollView>
  )
}
