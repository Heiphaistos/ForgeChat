import { Platform, PermissionsAndroid } from 'react-native'
import InCallManager from 'react-native-incall-manager'

/**
 * Permissions micro/caméra et sonneries d'appel. Le média lui-même (micro, caméra, écran, son
 * des autres) passe par LiveKit (services/livekit.ts) ; le routage audio de l'appel aussi
 * (AudioSession). InCallManager ne sert plus qu'aux tonalités et à garder l'écran allumé.
 */

export async function ensureMediaPermissions(video: boolean): Promise<boolean> {
  if (Platform.OS !== 'android') return true // iOS : demande système à la première capture
  const perms = [PermissionsAndroid.PERMISSIONS.RECORD_AUDIO]
  if (video) perms.push(PermissionsAndroid.PERMISSIONS.CAMERA)
  if (Platform.Version >= 31) perms.push(PermissionsAndroid.PERMISSIONS.BLUETOOTH_CONNECT)
  const res = await PermissionsAndroid.requestMultiple(perms)
  return (
    res[PermissionsAndroid.PERMISSIONS.RECORD_AUDIO] === 'granted' &&
    (!video || res[PermissionsAndroid.PERMISSIONS.CAMERA] === 'granted')
  )
}

export const ringtones = {
  startRinging() {
    InCallManager.startRingtone('_DEFAULT_', [0, 800, 600], 'playback', 45)
  },
  stopRinging() {
    InCallManager.stopRingtone()
  },
  startRingback() {
    InCallManager.startRingback('_DTMF_')
  },
  stopRingback() {
    InCallManager.stopRingback()
  },
  keepScreenOn(on: boolean) {
    InCallManager.setKeepScreenOn(on)
  },
}
