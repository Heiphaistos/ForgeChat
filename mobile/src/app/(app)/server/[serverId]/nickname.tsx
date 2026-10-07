import * as ImagePicker from 'expo-image-picker'
import { useQuery } from '@tanstack/react-query'
import { router } from 'expo-router'
import { useState } from 'react'
import { Alert, Pressable, ScrollView, Text } from 'react-native'
import { serversApi } from '@/api/servers'
import { Avatar } from '@/components/Avatar'
import { Button, ErrorState, Loading, T, TextField } from '@/components/ui'
import { LIMITS } from '@/config/env'
import { ProfileBanner } from '@/features/account/ProfileBanner'
import { shownProfile } from '@/features/servers/memberProfile'
import { errorMessage } from '@/lib/http'
import { useRouteParams } from '@/lib/params'
import { ensurePhotoAccess } from '@/lib/photoAccess'
import { qk, queryClient } from '@/lib/queryClient'
import { useAuth } from '@/stores/auth'
import type { Member } from '@/types/models'
import { colors, font, spacing } from '@/theme'

const BANNER_MAX_BYTES = 10 * 1024 * 1024 // member_profile::image_column

/** « Mon profil sur ce serveur » : pseudo, avatar, bannière et bio visibles sur ce serveur seulement.
 *  Vide : profil du compte. */
export default function ServerProfileScreen() {
  const { valid, ids } = useRouteParams(['serverId'] as const)
  const me = useAuth((s) => s.user)
  const members = useQuery({ queryKey: qk.members(ids.serverId ?? ''), queryFn: () => serversApi.members(ids.serverId), enabled: valid })
  if (!valid) return <ErrorState message="Serveur invalide." />
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
      allowsEditing: true,
      aspect: kind === 'avatar' ? [1, 1] : [16, 5],
      quality: 0.8, // ré-encodage JPEG : retire les métadonnées EXIF (GPS…)
    })
    if (res.canceled || !res.assets[0]) return
    const a = res.assets[0]
    const max = kind === 'avatar' ? LIMITS.avatarMaxBytes : BANNER_MAX_BYTES
    if (a.fileSize && a.fileSize > max) {
      Alert.alert('Image trop lourde', `Maximum ${max / 1024 / 1024} Mo.`)
      return
    }
    setUploading(kind)
    try {
      await serversApi.uploadServerProfileImage(serverId, kind, { uri: a.uri, name: `${kind}.jpg`, type: 'image/jpeg' })
      await refresh()
    } catch (e) {
      Alert.alert('Envoi impossible', errorMessage(e))
    } finally {
      setUploading(null)
    }
  }

  const clear = (kind: 'avatar' | 'banner') =>
    serversApi
      .clearServerProfileImage(serverId, kind)
      .then(refresh)
      .catch((e) => Alert.alert('Action impossible', errorMessage(e)))

  // Avatar du serveur : le serveur le substitue à `avatar`, il diffère donc de celui du compte.
  const hasServerAvatar = !!member?.avatar && member.avatar !== me.avatar

  return (
    <ScrollView style={{ backgroundColor: colors.bg }} contentContainerStyle={{ padding: spacing.xl, gap: spacing.lg }} keyboardShouldPersistTaps="handled">
      <T variant="muted">Visible sur ce serveur uniquement. Vide : ton profil de compte.</T>
      <ProfileBanner uri={shown.banner} name={me.username} />
      <Pressable onPress={() => void pick('avatar')} style={{ alignItems: 'center', gap: spacing.sm }} accessibilityRole="button" accessibilityLabel="Changer l’avatar de ce serveur">
        <Avatar uri={shown.avatar} name={me.username} size={96} />
        <Text style={{ color: colors.link, fontSize: font.sm }}>{uploading === 'avatar' ? 'Envoi…' : 'Changer l’avatar'}</Text>
      </Pressable>
      {hasServerAvatar ? <Button title="Reprendre l’avatar du compte" variant="ghost" onPress={() => void clear('avatar')} /> : null}
      <Button
        title={uploading === 'banner' ? 'Envoi…' : member?.server_banner ? 'Changer la bannière' : 'Ajouter une bannière'}
        variant="secondary"
        icon="image-outline"
        disabled={uploading !== null}
        onPress={() => void pick('banner')}
      />
      {member?.server_banner ? <Button title="Reprendre la bannière du compte" variant="ghost" onPress={() => void clear('banner')} /> : null}
      <TextField label="Pseudo du serveur" value={nick} onChangeText={setNick} maxLength={32} placeholder={me.username} autoCorrect={false} />
      <TextField label="Bio du serveur" value={bio} onChangeText={setBio} maxLength={190} multiline placeholder={me.bio || 'Bio propre à ce serveur'} error={error} />
      <Button title="Enregistrer" onPress={() => void save()} loading={loading} />
    </ScrollView>
  )
}
