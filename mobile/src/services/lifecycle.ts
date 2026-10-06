import * as ScreenCapture from 'expo-screen-capture'
import { AppState, Platform, type AppStateStatus } from 'react-native'
import { usersApi } from '@/api/users'
import { logger } from '@/lib/logger'
import { realtime } from '@/lib/realtime'
import { useAuth } from '@/stores/auth'
import { useCall } from '@/stores/call'
import { useLock } from '@/stores/lock'
import { useSettings } from '@/stores/settings'
import { useUnread } from '@/stores/unread'
import { useVoice } from '@/stores/voice'

/**
 * Cycle de vie de l'app :
 * - arrière-plan : on FERME le WebSocket (sauf appel/vocal en cours). Le serveur
 *   voit alors l'utilisateur hors ligne et bascule sur les notifications push —
 *   sans cela, iOS gèle la socket et le serveur croit l'utilisateur connecté.
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
      const inCall = useCall.getState().phase !== 'idle' || !!useVoice.getState().channelId
      if (signedIn && !inCall) realtime.stop()
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

  return () => sub.remove()
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
