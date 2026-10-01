import { Alert, Platform } from 'react-native'
import { mediaDevices, type MediaStream, type MediaStreamTrack } from 'react-native-webrtc'
import { SCREEN_SHARE_WARNING } from '@/features/calls/screenShareLogic'

/**
 * Capture d'écran Android (MediaProjection) pour le partage d'écran.
 *
 * - Le choix « une seule application » ou « écran entier » est le dialogue système
 *   (Android 14 et plus) ; avant, écran entier uniquement.
 * - Pendant la capture, react-native-webrtc lance un service au premier plan de type
 *   mediaProjection (activé dans MainApplication par plugins/withScreenShare.js) : la
 *   notification système reste affichée tant que la capture dure.
 * - Pas de capture du son de l'écran en v1.
 * - Les fenêtres de ForgeChat protégées par FLAG_SECURE apparaissent en noir dans la capture.
 */

export const screenShareSupported = Platform.OS === 'android'

/** Avertit avant de partager : résout true si l'utilisateur confirme. */
export function confirmScreenShare(): Promise<boolean> {
  return new Promise((resolve) => {
    Alert.alert('Partager ton écran ?', SCREEN_SHARE_WARNING, [
      { text: 'Annuler', style: 'cancel', onPress: () => resolve(false) },
      { text: 'Partager', onPress: () => resolve(true) },
    ], { cancelable: true, onDismiss: () => resolve(false) })
  })
}

/** Ouvre le dialogue système puis renvoie le flux écran (une piste vidéo). Rejette si annulé. */
export async function captureScreen(): Promise<{ stream: MediaStream; track: MediaStreamTrack }> {
  if (!screenShareSupported) throw new Error('Partage d’écran disponible sur Android uniquement')
  const stream = (await mediaDevices.getDisplayMedia({})) as MediaStream
  const track = stream.getVideoTracks()[0]
  if (!track) {
    stream.getTracks().forEach((t) => t.stop())
    throw new Error('Aucune image d’écran reçue')
  }
  return { stream, track }
}

/** Arrête la capture : libère MediaProjection et retire la notification système. */
export function stopScreenCapture(stream: MediaStream | null) {
  if (!stream) return
  stream.getTracks().forEach((t) => {
    try {
      t.stop()
    } catch {
      /* déjà arrêtée */
    }
  })
  try {
    stream.release()
  } catch {
    /* ignore */
  }
}
