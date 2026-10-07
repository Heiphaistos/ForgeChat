import * as ImagePicker from 'expo-image-picker'
import { useState } from 'react'
import { Alert, Pressable, ScrollView, Text } from 'react-native'
import { usersApi } from '@/api/users'
import { Avatar } from '@/components/Avatar'
import { Button, TextField } from '@/components/ui'
import { LIMITS } from '@/config/env'
import { ProfileBanner } from '@/features/account/ProfileBanner'
import { ProfileCosmeticsEditor, type Cosmetics } from '@/features/account/ProfileCosmeticsEditor'
import { formatBirthday, parseBirthday, usernameError } from '@/features/account/rules'
import { useT } from '@/i18n'
import { errorMessage } from '@/lib/http'
import { useAuth } from '@/stores/auth'
import type { User } from '@/types/models'
import { colors, font, spacing } from '@/theme'
import { ensurePhotoAccess } from '@/lib/photoAccess'

const BANNER_MAX_BYTES = 10 * 1024 * 1024 // users::upload_banner

export default function ProfileSettings() {
  const user = useAuth((s) => s.user) as (User & { birthday?: string | null }) | null
  const setUser = useAuth((s) => s.setUser)
  const t = useT()
  const [username, setUsername] = useState(user?.username ?? '')
  const [bio, setBio] = useState(user?.bio ?? '')
  const [customStatus, setCustomStatus] = useState(user?.custom_status ?? '')
  const [pronouns, setPronouns] = useState(user?.pronouns ?? '')
  const [birthday, setBirthday] = useState(formatBirthday(user?.birthday))
  const [cosmetics, setCosmetics] = useState<Cosmetics>({
    decoration: user?.avatar_decoration ?? '',
    primary: user?.profile_color_primary ?? null,
    accent: user?.profile_color_accent ?? null,
    effect: user?.profile_effect ?? '',
  })
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
        // "" et -1 = retirer.
        avatar_decoration: cosmetics.decoration,
        profile_color_primary: cosmetics.primary ?? -1,
        profile_color_accent: cosmetics.accent ?? -1,
        profile_effect: cosmetics.effect,
      })
      setUser(updated)
      Alert.alert(t('settings.profile.updated'))
    } catch (e) {
      Alert.alert(t('settings.profile.saveFailed'), errorMessage(e))
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
      Alert.alert(t('settings.profile.tooLarge'), t('settings.profile.maxSize', { n: max / 1024 / 1024 }))
      return
    }
    setUploading(kind)
    try {
      const file = { uri: a.uri, name: `${kind}.jpg`, type: 'image/jpeg' }
      if (kind === 'avatar') setUser(await usersApi.uploadAvatar(file))
      else setUser({ banner: (await usersApi.uploadBanner(file)).banner })
    } catch (e) {
      Alert.alert(t('settings.profile.uploadFailed'), errorMessage(e))
    } finally {
      setUploading(null)
    }
  }

  return (
    <ScrollView style={{ backgroundColor: colors.bg }} contentContainerStyle={{ padding: spacing.xl, gap: spacing.lg }} keyboardShouldPersistTaps="handled">
      <ProfileBanner uri={user.banner} name={user.username} />
      <Pressable onPress={() => void pick('avatar')} style={{ alignItems: 'center', gap: spacing.sm }} accessibilityRole="button" accessibilityLabel={t('settings.profile.changeAvatarA11y')}>
        <Avatar uri={user.avatar} name={user.username} size={96} decoration={cosmetics.decoration} />
        <Text style={{ color: colors.link, fontSize: font.sm }}>{uploading === 'avatar' ? t('settings.profile.uploading') : t('settings.profile.changeAvatar')}</Text>
      </Pressable>
      <Button
        title={uploading === 'banner' ? t('settings.profile.uploading') : user.banner ? t('settings.profile.changeBanner') : t('settings.profile.addBanner')}
        variant="secondary"
        icon="image-outline"
        disabled={uploading !== null}
        onPress={() => void pick('banner')}
      />
      <TextField
        label={t('settings.profile.username', { tag: user.discriminator })}
        value={username}
        onChangeText={setUsername}
        autoCapitalize="none"
        autoCorrect={false}
        maxLength={32}
        error={errors.username}
      />
      <TextField label={t('settings.profile.customStatus')} value={customStatus} onChangeText={setCustomStatus} maxLength={128} />
      <TextField label={t('settings.profile.pronouns')} value={pronouns} onChangeText={setPronouns} maxLength={30} />
      <TextField
        label={t('settings.profile.birthday')}
        placeholder={t('settings.profile.birthdayPlaceholder')}
        value={birthday}
        onChangeText={setBirthday}
        keyboardType="numbers-and-punctuation"
        maxLength={10}
        error={errors.birthday}
      />
      <TextField label={t('settings.profile.bio')} value={bio} onChangeText={setBio} maxLength={190} multiline style={{ minHeight: 100 }} />
      <ProfileCosmeticsEditor value={cosmetics} onChange={setCosmetics} avatar={user.avatar} name={user.username} />
      <Button title={t('settings.profile.save')} onPress={save} loading={saving} />
    </ScrollView>
  )
}
