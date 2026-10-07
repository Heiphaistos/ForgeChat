import * as ImagePicker from 'expo-image-picker'
import { Alert } from 'react-native'
import { t } from '@/i18n'
import { ensurePhotoAccess } from '@/lib/photoAccess'
import { animatedImageType } from './rules'

/** Limite du serveur pour un avatar ou une bannière (image_probe.rs). */
export const PROFILE_IMAGE_MAX_BYTES = 10 * 1024 * 1024

/**
 * Avatar / bannière animés : galerie SANS recadrage ni ré-encodage (un recadrage aplatit le GIF),
 * fichier envoyé tel quel avec son vrai type. Le serveur relit le format dans les octets.
 */
export async function pickAnimatedImage(maxBytes = PROFILE_IMAGE_MAX_BYTES): Promise<{ uri: string; name: string; type: string } | null> {
  if (!(await ensurePhotoAccess())) return null
  const res = await ImagePicker.launchImageLibraryAsync({
    mediaTypes: ['images'],
    allowsEditing: false,
    quality: 1,
    // iOS : le fichier d'origine, pas une conversion JPEG/HEIC.
    preferredAssetRepresentationMode: ImagePicker.UIImagePickerPreferredAssetRepresentationMode.Current,
  })
  const a = res.canceled ? undefined : res.assets[0]
  if (!a) return null
  const type = animatedImageType(a.mimeType, a.fileName)
  if (!type) {
    Alert.alert(t('settings.animated.wrongType'), t('settings.animated.wrongTypeBody'))
    return null
  }
  if (a.fileSize && a.fileSize > maxBytes) {
    Alert.alert(t('settings.profile.tooLarge'), t('settings.profile.maxSize', { n: maxBytes / 1024 / 1024 }))
    return null
  }
  return { uri: a.uri, name: a.fileName || `image.${type === 'image/gif' ? 'gif' : 'webp'}`, type }
}
