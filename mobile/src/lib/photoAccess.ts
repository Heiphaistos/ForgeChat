import * as ImagePicker from 'expo-image-picker'
import { Platform } from 'react-native'

/**
 * Accès à la galerie avant d'ouvrir le sélecteur.
 *
 * Android : le sélecteur de photos du système (PickVisualMedia) ne demande AUCUNE permission ;
 * l'app n'en déclare donc aucune (READ_MEDIA_IMAGES et READ_EXTERNAL_STORAGE sont bloquées dans
 * app.config.ts). Demander la permission « médiathèque » échouerait sur Android ≤ 12.
 * iOS : la permission photos reste demandée.
 */
export function needsPhotoPermission(os: string = Platform.OS): boolean {
  return os === 'ios'
}

export async function ensurePhotoAccess(): Promise<boolean> {
  if (!needsPhotoPermission()) return true
  const perm = await ImagePicker.requestMediaLibraryPermissionsAsync()
  return perm.granted
}
