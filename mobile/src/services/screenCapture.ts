import { Alert, Platform } from 'react-native'
import { SCREEN_SHARE_WARNING } from '@/features/calls/screenShareLogic'
import { t } from '@/i18n'

/**
 * Partage d'écran Android (MediaProjection), diffusé par LiveKit (setScreenShareEnabled).
 *
 * - Le choix « une seule application » ou « écran entier » est le dialogue système
 *   (Android 14 et plus) ; avant, écran entier uniquement.
 * - Pendant la capture, un service au premier plan de type mediaProjection tourne (activé par
 *   le plugin Expo de LiveKit) : la notification système reste affichée tant que la capture dure.
 * - Pas de capture du son de l'écran.
 * - Les fenêtres de ForgeChat protégées par FLAG_SECURE apparaissent en noir dans la capture.
 */

export const screenShareSupported = Platform.OS === 'android'

/** Avertit avant de partager : résout true si l'utilisateur confirme. */
export function confirmScreenShare(): Promise<boolean> {
  return new Promise((resolve) => {
    Alert.alert(t('store.screen.confirmTitle'), SCREEN_SHARE_WARNING(), [
      { text: t('common.cancel'), style: 'cancel', onPress: () => resolve(false) },
      { text: t('store.screen.share'), onPress: () => resolve(true) },
    ], { cancelable: true, onDismiss: () => resolve(false) })
  })
}
