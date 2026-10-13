import * as ImagePicker from 'expo-image-picker'
import { useState } from 'react'
import { router } from 'expo-router'
import { Alert, Pressable, ScrollView, Text, View } from 'react-native'
import { STATUS_CLEAR_AFTER, usersApi } from '@/api/users'
import { Avatar } from '@/components/Avatar'
import { Button, Row, SwitchRow, TextField } from '@/components/ui'
import { LIMITS } from '@/config/env'
import { ProfileBanner } from '@/features/account/ProfileBanner'
import { ProfileCosmeticsEditor, type Cosmetics } from '@/features/account/ProfileCosmeticsEditor'
import { hexColor } from '@/features/account/profileDecor'
import { NameStyleEditor } from '@/features/account/NameStyleEditor'
import { TagStyleEditor } from '@/features/account/TagStyleEditor'
import { AvatarRingEditor } from '@/features/account/AvatarRingEditor'
import { ProfileCardEditor } from '@/features/account/ProfileCardEditor'
import type { ProfileCard } from '@/features/account/profileCard'
import { profileForm, profilePatch } from '@/features/account/profilePatch'
import { AvatarRing, type AvatarRingData } from '@/components/AvatarRing'
import { PROFILE_IMAGE_MAX_BYTES, pickAnimatedImage } from '@/features/account/pickAnimated'
import { ProfileLinksEditor } from '@/features/account/ProfileLinksEditor'
import { profileLinkError, usernameError } from '@/features/account/rules'
import { formatUntil } from '@/lib/format'
import type { NameStyle } from '@/lib/nameStyle'
import { rememberUserStyle } from '@/stores/nameStyles'
import { useSettings } from '@/stores/settings'
import { useT } from '@/i18n'
import { errorMessage } from '@/lib/http'
import { logger } from '@/lib/logger'
import { useAuth } from '@/stores/auth'
import type { ProfileLink, User } from '@/types/models'
import { colors, font, radius, spacing } from '@/theme'
import { ensurePhotoAccess } from '@/lib/photoAccess'

const BANNER_MAX_BYTES = PROFILE_IMAGE_MAX_BYTES // users::upload_banner

/** Libellé de chaque durée d'effacement du statut (minutes). */
const CLEAR_AFTER_LABEL = {
  0: 'settings.status.never',
  30: 'settings.status.m30',
  60: 'settings.status.h1',
  240: 'settings.status.h4',
  1440: 'settings.status.h24',
  4320: 'settings.status.d3',
  10080: 'settings.status.d7',
} as const

export default function ProfileSettings() {
  const user = useAuth((s) => s.user)
  // Formulaire monté seulement une fois le compte chargé, remonté si le compte change.
  return user ? <ProfileForm key={user.id} user={user} /> : null
}

function ProfileForm({ user }: { user: User }) {
  const setUser = useAuth((s) => s.setUser)
  const t = useT()
  // Valeurs de départ lues une fois, au montage (le formulaire est remonté par `key` si le compte change).
  const [init] = useState(() => profileForm(user))
  const [username, setUsername] = useState(init.username)
  const [bio, setBio] = useState(init.bio)
  const [customStatus, setCustomStatus] = useState(init.customStatus)
  /** null = garder l'échéance actuelle (le statut n'est alors renvoyé que s'il a changé). */
  const [clearAfter, setClearAfter] = useState<number | null>(null)
  const [displayName, setDisplayName] = useState(init.displayName)
  const [tag, setTag] = useState(init.tag)
  const [nameStyle, setNameStyle] = useState<NameStyle>(init.nameStyle)
  const [links, setLinks] = useState<ProfileLink[]>(init.links)
  const [linkErrors, setLinkErrors] = useState(false)
  const animate = useSettings((s) => s.animateAvatars)
  const setSettings = useSettings((s) => s.set)
  const [pronouns, setPronouns] = useState(init.pronouns)
  const [cosmetics, setCosmetics] = useState<Cosmetics>(init.cosmetics)
  const [ring, setRing] = useState<AvatarRingData | null>(init.ring)
  const [card, setCard] = useState<ProfileCard>(init.card)
  const [errors, setErrors] = useState<{ username?: string }>({})
  const [saving, setSaving] = useState(false)
  const [uploading, setUploading] = useState<'avatar' | 'banner' | null>(null)

  const save = async () => {
    const nameErr = usernameError(username)
    const errs = { username: nameErr ?? undefined }
    setErrors(errs)
    const linkBad = links.some((l) => profileLinkError(l))
    setLinkErrors(linkBad)
    if (errs.username || linkBad) return
    setSaving(true)
    try {
      const updated = await usersApi.updateMe(profilePatch(user, { username, bio, customStatus, clearAfter, displayName, tag, nameStyle, links, pronouns, cosmetics, ring, card }))
      setUser(updated)
      rememberUserStyle(updated)
      setClearAfter(null)
      Alert.alert(t('settings.profile.updated'))
    } catch (e) {
      Alert.alert(t('settings.profile.saveFailed'), errorMessage(e))
    } finally {
      setSaving(false)
    }
  }

  const upload = async (kind: 'avatar' | 'banner', file: { uri: string; name: string; type: string }) => {
    setUploading(kind)
    try {
      if (kind === 'avatar') setUser(await usersApi.uploadAvatar(file))
      else setUser({ banner: (await usersApi.uploadBanner(file)).banner })
    } catch (e) {
      Alert.alert(t('settings.profile.uploadFailed'), errorMessage(e))
    } finally {
      setUploading(null)
    }
  }

  const removeBanner = async () => {
    try {
      await usersApi.updateMe({ banner: '' })
      setUser({ banner: null })
    } catch (e) {
      Alert.alert(t('settings.profile.saveFailed'), errorMessage(e))
    }
  }

  /** Galerie indisponible ou refusée par le système : message au lieu d'un rejet non géré. */
  const guarded = (fn: () => Promise<void>) => () => {
    fn().catch((e: unknown) => {
      logger.warn('profile', 'sélection d’image impossible', e)
      Alert.alert(t('settings.profile.pickFailed'), errorMessage(e))
    })
  }

  const pickAnimated = (kind: 'avatar' | 'banner') =>
    guarded(async () => {
      const file = await pickAnimatedImage()
      if (file) await upload(kind, file)
    })

  const pick = (kind: 'avatar' | 'banner') =>
    guarded(async () => {
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
        Alert.alert(t('settings.profile.tooLarge'), t('settings.profile.maxSize', { n: max / 1024 / 1024 }))
        return
      }
      await upload(kind, { uri: a.uri, name: `${kind}.jpg`, type: 'image/jpeg' })
    })

  return (
    <ScrollView style={{ backgroundColor: colors.bg }} contentContainerStyle={{ padding: spacing.xl, gap: spacing.lg }} keyboardShouldPersistTaps="handled">
      <ProfileBanner uri={user.banner} name={user.username} card={card} tint={cosmetics.primary != null ? hexColor(cosmetics.primary) : undefined} />
      <Pressable onPress={pick('avatar')} style={{ alignItems: 'center', gap: spacing.sm }} accessibilityRole="button" accessibilityLabel={t('settings.profile.changeAvatarA11y')}>
        <AvatarRing ring={ring} size={96}>
          <Avatar uri={user.avatar} name={user.username} size={96} decoration={cosmetics.decoration} decorationOpts={cosmetics.opts} />
        </AvatarRing>
        <Text style={{ color: colors.link, fontSize: font.sm }}>{uploading === 'avatar' ? t('settings.profile.uploading') : t('settings.profile.changeAvatar')}</Text>
      </Pressable>
      <Button
        title={uploading === 'banner' ? t('settings.profile.uploading') : user.banner ? t('settings.profile.changeBanner') : t('settings.profile.addBanner')}
        variant="secondary"
        icon="image-outline"
        disabled={uploading !== null}
        onPress={pick('banner')}
      />
      {user.banner ? <Button title={t('pcard.removeBanner')} variant="ghost" icon="trash-outline" disabled={uploading !== null} onPress={() => void removeBanner()} /> : null}
      <View style={{ flexDirection: 'row', gap: spacing.sm }}>
        <Button title={t('settings.animated.avatar')} variant="ghost" icon="film-outline" disabled={uploading !== null} onPress={pickAnimated('avatar')} style={{ flex: 1 }} />
        <Button title={t('settings.animated.banner')} variant="ghost" icon="film-outline" disabled={uploading !== null} onPress={pickAnimated('banner')} style={{ flex: 1 }} />
      </View>
      <SwitchRow
        icon="play-circle-outline"
        title={t('settings.animated.toggle')}
        subtitle={t('settings.animated.toggleSub')}
        value={animate}
        onValueChange={(v) => setSettings({ animateAvatars: v })}
      />
      <TextField label={t('settings.profile.displayName')} placeholder={user.username} value={displayName} onChangeText={setDisplayName} maxLength={32} />
      <TextField
        label={t('settings.profile.username', { tag: user.discriminator })}
        value={username}
        onChangeText={setUsername}
        autoCapitalize="none"
        autoCorrect={false}
        maxLength={32}
        error={errors.username}
      />
      <TextField label={t('settings.profile.tag')} placeholder={t('settings.profile.tagPlaceholder')} value={tag} onChangeText={setTag} maxLength={16} autoCorrect={false} />
      <TagStyleEditor name={tag} value={nameStyle.tag} onChange={(st) => setNameStyle((s) => ({ ...s, tag: st }))} />
      <NameStyleEditor value={nameStyle} onChange={setNameStyle} name={displayName.trim() || user.username} tag={tag.trim()} />
      <TextField label={t('settings.profile.customStatus')} value={customStatus} onChangeText={setCustomStatus} maxLength={128} />
      <View style={{ gap: spacing.sm }}>
        <Text style={{ color: colors.textMuted, fontSize: font.sm, fontWeight: '600' }}>
          {user.custom_status_expires_at && clearAfter == null
            ? t('settings.status.clearsAt', { when: formatUntil(user.custom_status_expires_at) })
            : t('settings.status.clearAfter')}
        </Text>
        <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: spacing.sm }}>
          {STATUS_CLEAR_AFTER.map((m) => (
            <Pressable
              key={m}
              onPress={() => setClearAfter(m)}
              accessibilityRole="button"
              accessibilityState={{ selected: clearAfter === m }}
              style={{ paddingHorizontal: spacing.md, paddingVertical: 6, borderRadius: radius.full, backgroundColor: clearAfter === m ? colors.primary : colors.bgElevated }}
            >
              <Text style={{ color: clearAfter === m ? '#fff' : colors.textSecondary, fontSize: font.sm }}>{t(CLEAR_AFTER_LABEL[m])}</Text>
            </Pressable>
          ))}
        </View>
      </View>
      <TextField label={t('settings.profile.pronouns')} value={pronouns} onChangeText={setPronouns} maxLength={30} />
      <Row icon="gift-outline" title={t('soc.settings.title')} subtitle={t('soc.settings.sub')} onPress={() => router.push('/settings/social')} chevron />
      <TextField label={t('settings.profile.bio')} value={bio} onChangeText={setBio} maxLength={190} multiline style={{ minHeight: 100 }} />
      <ProfileLinksEditor value={links} onChange={setLinks} showErrors={linkErrors} />
      <ProfileCosmeticsEditor value={cosmetics} onChange={setCosmetics} avatar={user.avatar} name={user.username} />
      <AvatarRingEditor value={ring} onChange={setRing} avatar={user.avatar} name={user.username} hint={t('ring.hint')} />
      <ProfileCardEditor value={card} onChange={setCard} primary={cosmetics.primary} accent={cosmetics.accent} avatar={user.avatar} name={displayName.trim() || user.username} ring={ring} />
      <Button title={t('settings.profile.save')} onPress={save} loading={saving} />
    </ScrollView>
  )
}
