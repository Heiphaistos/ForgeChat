import * as ImagePicker from 'expo-image-picker'
import { useState } from 'react'
import { Alert, Pressable, ScrollView, Text, View } from 'react-native'
import { usersApi } from '@/api/users'
import { Avatar } from '@/components/Avatar'
import { Button, TextField } from '@/components/ui'
import { LIMITS } from '@/config/env'
import { errorMessage } from '@/lib/http'
import { useAuth } from '@/stores/auth'
import { colors, font, spacing } from '@/theme'
import { ensurePhotoAccess } from '@/lib/photoAccess'

export default function ProfileSettings() {
  const user = useAuth((s) => s.user)
  const setUser = useAuth((s) => s.setUser)
  const [bio, setBio] = useState(user?.bio ?? '')
  const [customStatus, setCustomStatus] = useState(user?.custom_status ?? '')
  const [pronouns, setPronouns] = useState(user?.pronouns ?? '')
  const [saving, setSaving] = useState(false)
  const [uploading, setUploading] = useState(false)
  if (!user) return null

  const save = async () => {
    setSaving(true)
    try {
      const updated = await usersApi.updateMe({ bio: bio.trim(), custom_status: customStatus.trim(), pronouns: pronouns.trim() })
      setUser(updated)
      Alert.alert('Profil mis à jour')
    } catch (e) {
      Alert.alert('Enregistrement impossible', errorMessage(e))
    } finally {
      setSaving(false)
    }
  }

  const pickAvatar = async () => {
    if (!(await ensurePhotoAccess())) return
    const res = await ImagePicker.launchImageLibraryAsync({
      mediaTypes: ['images'],
      allowsEditing: true,
      aspect: [1, 1],
      quality: 0.8, // ré-encodage JPEG : retire les métadonnées EXIF (GPS…)
    })
    if (res.canceled || !res.assets[0]) return
    const a = res.assets[0]
    if (a.fileSize && a.fileSize > LIMITS.avatarMaxBytes) {
      Alert.alert('Image trop lourde', 'Maximum 8 Mo.')
      return
    }
    setUploading(true)
    try {
      const updated = await usersApi.uploadAvatar({ uri: a.uri, name: 'avatar.jpg', type: 'image/jpeg' })
      setUser(updated)
    } catch (e) {
      Alert.alert('Envoi impossible', errorMessage(e))
    } finally {
      setUploading(false)
    }
  }

  return (
    <ScrollView style={{ backgroundColor: colors.bg }} contentContainerStyle={{ padding: spacing.xl, gap: spacing.lg }} keyboardShouldPersistTaps="handled">
      <Pressable onPress={pickAvatar} style={{ alignItems: 'center', gap: spacing.sm }} accessibilityRole="button" accessibilityLabel="Changer d'avatar">
        <Avatar uri={user.avatar} name={user.username} size={96} />
        <Text style={{ color: colors.link, fontSize: font.sm }}>{uploading ? 'Envoi…' : 'Changer l’avatar'}</Text>
      </Pressable>
      <View>
        <Text style={{ color: colors.textMuted, fontSize: font.sm }}>Pseudo</Text>
        <Text style={{ color: colors.text, fontSize: font.lg, fontWeight: '700' }}>
          {user.username}#{user.discriminator}
        </Text>
      </View>
      <TextField label="Statut personnalisé" value={customStatus} onChangeText={setCustomStatus} maxLength={128} />
      <TextField label="Pronoms" value={pronouns} onChangeText={setPronouns} maxLength={40} />
      <TextField label="À propos de moi" value={bio} onChangeText={setBio} maxLength={190} multiline style={{ minHeight: 100 }} />
      <Button title="Enregistrer" onPress={save} loading={saving} />
    </ScrollView>
  )
}
