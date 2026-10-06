import * as ScreenCapture from 'expo-screen-capture'
import { AppState, Platform, type AppStateStatus } from 'react-native'
import { usersApi } from '@/api/users'
import { logger } from '@/lib/logger'
import { realtime } from '@/lib/realtime'
import { useAuth } from '@/stores/auth'
import { useCall } from '@/stores/call'
import { useGroupCall } from '@/stores/groupCall'
import { useLock } from '@/stores/lock'
import { useSettings } from '@/stores/settings'
import { useUnread } from '@/stores/unread'
import { useVoice } from '@/stores/voice'

/** Appel, appel de groupe ou salon vocal en cours (le WebSocket reste ouvert en arrière-plan). */
const inCall = () => useCall.getState().phase !== 'idle' || !!useVoice.getState().channelId || !!useGroupCall.getState().groupId

/**
 * Cycle de vie de l'app :
 * - arrière-plan : on FERME le WebSocket (sauf appel/vocal en cours). Le serveur
 *   voit alors l'utilisateur hors ligne et bascule sur les notifications push —
 *   sans cela, iOS gèle la socket et le serveur croit l'utilisateur connecté.
 *   Un appel qui se termine en arrière-plan referme aussi le WebSocket.
 * - premier plan : reconnexion, resynchronisation des non-lus, verrouillage.
 */
export function bindLifecycle(): () => void {
  let current: AppStateStatus = AppState.currentState

  const sub = AppState.addEventListener('change', (next) => {
    const prev = current
    current = next
    const signedIn = useAuth.getState().status === 'signedIn'

    if (next === 'background') {
      useLock.getState().onBackground()
      if (signedIn && !inCall()) realtime.stop()
    } else if (next === 'active' && prev !== 'active') {
      useLock.getState().onForeground()
      if (signedIn) {
        realtime.start()
        realtime.kick()
        usersApi
          .unread()
          .then((items) => useUnread.getState().load(items))
          .catch((e) => logger.debug('lifecycle', 'unread', e))
      }
    }
  })

  // Appel terminé alors que l'app est en arrière-plan : refermer le WebSocket resté ouvert pour lui.
  // Délai : un déplacement de salon (VOICE_MOVE) quitte puis rejoint aussitôt.
  const closeIfIdle = () =>
    setTimeout(() => {
      if (current !== 'active' && !inCall() && useAuth.getState().status === 'signedIn') realtime.stop()
    }, 2000)
  const offs = [
    useCall.subscribe((s, prev) => s.phase === 'idle' && prev.phase !== 'idle' && closeIfIdle()),
    useVoice.subscribe((s, prev) => !s.channelId && !!prev.channelId && closeIfIdle()),
    useGroupCall.subscribe((s, prev) => !s.groupId && !!prev.groupId && closeIfIdle()),
  ]

  return () => {
    sub.remove()
    offs.forEach((off) => off())
  }
}

/** Applique la protection d'écran (sélecteur d'apps / captures) selon les réglages. */
export async function applyPrivacyScreen(enabled: boolean) {
  try {
    if (enabled) {
      if (Platform.OS === 'ios') await ScreenCapture.enableAppSwitcherProtectionAsync(0.9)
      // Android : FLAG_SECURE — masque l'aperçu dans les apps récentes ET bloque les captures.
      else await ScreenCapture.preventScreenCaptureAsync('privacy')
    } else {
      if (Platform.OS === 'ios') await ScreenCapture.disableAppSwitcherProtectionAsync()
      else await ScreenCapture.allowScreenCaptureAsync('privacy')
    }
  } catch (e) {
    logger.warn('privacy', 'protection écran', e)
  }
}

export function bindPrivacyScreen(): () => void {
  void applyPrivacyScreen(useSettings.getState().privacyScreen)
  return useSettings.subscribe((s, prev) => {
    if (s.privacyScreen !== prev.privacyScreen) void applyPrivacyScreen(s.privacyScreen)
  })
}
