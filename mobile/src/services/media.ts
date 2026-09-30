import { Platform, PermissionsAndroid } from 'react-native'
import InCallManager from 'react-native-incall-manager'
import { mediaDevices, type MediaStream } from 'react-native-webrtc'
import { logger } from '@/lib/logger'

/**
 * Accès micro/caméra + routage audio (écouteur / haut-parleur / Bluetooth).
 * Point unique pour les permissions média de l'app.
 */

export async function ensureMediaPermissions(video: boolean): Promise<boolean> {
  if (Platform.OS !== 'android') return true // iOS : prompt système au premier getUserMedia
  const perms = [PermissionsAndroid.PERMISSIONS.RECORD_AUDIO]
  if (video) perms.push(PermissionsAndroid.PERMISSIONS.CAMERA)
  if (Platform.Version >= 31) perms.push(PermissionsAndroid.PERMISSIONS.BLUETOOTH_CONNECT)
  const res = await PermissionsAndroid.requestMultiple(perms)
  return (
    res[PermissionsAndroid.PERMISSIONS.RECORD_AUDIO] === 'granted' &&
    (!video || res[PermissionsAndroid.PERMISSIONS.CAMERA] === 'granted')
  )
}

export async function getLocalMedia(video: boolean): Promise<{ stream: MediaStream; hasVideo: boolean }> {
  if (!(await ensureMediaPermissions(video))) throw new Error('Permission micro/caméra refusée')
  // Sur mobile, la pile WebRTC native active déjà AEC/NS/AGC matériels par défaut.
  const audio = true
  if (video) {
    try {
      const stream = (await mediaDevices.getUserMedia({
        audio,
        video: { facingMode: 'user', width: 640, height: 480, frameRate: 24 },
      })) as MediaStream
      return { stream, hasVideo: stream.getVideoTracks().length > 0 }
    } catch (e) {
      logger.warn('media', 'caméra indisponible, repli audio', e)
    }
  }
  const stream = (await mediaDevices.getUserMedia({ audio, video: false })) as MediaStream
  return { stream, hasVideo: false }
}

export function stopStream(stream: MediaStream | null | undefined) {
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

/** Session audio « appel » : proximité, écran allumé, routage adapté. */
export const audioSession = {
  start(video: boolean) {
    InCallManager.start({ media: video ? 'video' : 'audio' })
    InCallManager.setKeepScreenOn(true)
    InCallManager.setForceSpeakerphoneOn(video)
  },
  stop() {
    InCallManager.setKeepScreenOn(false)
    InCallManager.stop()
  },
  setSpeaker(on: boolean) {
    InCallManager.setForceSpeakerphoneOn(on)
  },
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
}
