import * as ImagePicker from 'expo-image-picker'
import { useState } from 'react'
import { Alert, Pressable, ScrollView, Text } from 'react-native'
import { usersApi } from '@/api/users'
import { Avatar } from '@/components/Avatar'
import { Button, TextField } from '@/components/ui'
import { LIMITS } from '@/config/env'
import { ProfileBanner } from '@/features/account/ProfileBanner'
import { formatBirthday, parseBirthday, usernameError } from '@/features/account/rules'
import { errorMessage } from '@/lib/http'
import { useAuth } from '@/stores/auth'
import type { User } from '@/types/models'
import { colors, font, spacing } from '@/theme'
import { ensurePhotoAccess } from '@/lib/photoAccess'

const BANNER_MAX_BYTES = 10 * 1024 * 1024 // users::upload_banner

export default function ProfileSettings() {
  const user = useAuth((s) => s.user) as (User & { birthday?: string | null }) | null
  const setUser = useAuth((s) => s.setUser)
  const [username, setUsername] = useState(user?.username ?? '')
  const [bio, setBio] = useState(user?.bio ?? '')
  const [customStatus, setCustomStatus] = useState(user?.custom_status ?? '')
  const [pronouns, setPronouns] = useState(user?.pronouns ?? '')
  const [birthday, setBirthday] = useState(formatBirthday(user?.birthday))
  const [errors, setErrors] = useState<{ username?: string; birthday?: string }>({})
  const [saving, setSaving] = useState(false)
  const [uploading, setUploading] = useState<'avatar' | 'banner' | null>(null)
  if (!user) return null

  const save = async () => {
    const nameErr = usernameError(username)
    const bday = parseBirthday(birthday)
    const errs = { username: nameErr ?? undefined, birthday: 'error' in bday ? bday.error : undefined }
    setErrors(errs)
    if (errs.username || errs.birthday || 'error' in bday) return
    setSaving(true)
    try {
      const updated = await usersApi.updateMe({
        username: username.trim() !== user.username ? username.trim() : undefined,
        bio: bio.trim(),
        custom_status: customStatus.trim(),
        pronouns: pronouns.trim(),
        // Seulement si modifié : absent = inchangé, null = effacé.
        birthday: bday.value !== (user.birthday ?? null) ? bday.value : undefined,
      })
      setUser(updated)
      Alert.alert('Profil mis à jour')
    } catch (e) {
      Alert.alert('Enregistrement impossible', errorMessage(e))
    } finally {
      setSaving(false)
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
      const file = { uri: a.uri, name: `${kind}.jpg`, type: 'image/jpeg' }
      if (kind === 'avatar') setUser(await usersApi.uploadAvatar(file))
      else setUser({ banner: (await usersApi.uploadBanner(file)).banner })
    } catch (e) {
      Alert.alert('Envoi impossible', errorMessage(e))
    } finally {
      setUploading(null)
    }
  }

  return (
    <ScrollView style={{ backgroundColor: colors.bg }} contentContainerStyle={{ padding: spacing.xl, gap: spacing.lg }} keyboardShouldPersistTaps="handled">
      <ProfileBanner uri={user.banner} name={user.username} />
      <Pressable onPress={() => void pick('avatar')} style={{ alignItems: 'center', gap: spacing.sm }} accessibilityRole="button" accessibilityLabel="Changer d'avatar">
        <Avatar uri={user.avatar} name={user.username} size={96} />
        <Text style={{ color: colors.link, fontSize: font.sm }}>{uploading === 'avatar' ? 'Envoi…' : 'Changer l’avatar'}</Text>
      </Pressable>
      <Button
        title={uploading === 'banner' ? 'Envoi…' : user.banner ? 'Changer la bannière' : 'Ajouter une bannière'}
        variant="secondary"
        icon="image-outline"
        disabled={uploading !== null}
        onPress={() => void pick('banner')}
      />
      <TextField
        label={`Pseudo (#${user.discriminator})`}
        value={username}
        onChangeText={setUsername}
        autoCapitalize="none"
        autoCorrect={false}
        maxLength={32}
        error={errors.username}
      />
      <TextField label="Statut personnalisé" value={customStatus} onChangeText={setCustomStatus} maxLength={128} />
      <TextField label="Pronoms" value={pronouns} onChangeText={setPronouns} maxLength={30} />
      <TextField
        label="Anniversaire"
        placeholder="JJ/MM/AAAA"
        value={birthday}
        onChangeText={setBirthday}
        keyboardType="numbers-and-punctuation"
        maxLength={10}
        error={errors.birthday}
      />
      <TextField label="À propos de moi" value={bio} onChangeText={setBio} maxLength={190} multiline style={{ minHeight: 100 }} />
      <Button title="Enregistrer" onPress={save} loading={saving} />
    </ScrollView>
  )
}
