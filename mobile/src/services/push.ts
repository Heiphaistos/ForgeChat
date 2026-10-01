import Constants from 'expo-constants'
import * as Device from 'expo-device'
import * as Notifications from 'expo-notifications'
import * as SecureStore from 'expo-secure-store'
import { router } from 'expo-router'
import { Platform } from 'react-native'
import { pushApi } from '@/api/push'
import { IS_LAN } from '@/config/env'
import { logger } from '@/lib/logger'
import { registerPreSignOutHook, registerSignOutHook } from '@/stores/auth'
import { useSettings } from '@/stores/settings'
import { useUnread } from '@/stores/unread'

/**
 * Notifications push (via le service Expo → APNs / FCM).
 *
 * Vie privée : par défaut le serveur n'envoie PAS le contenu des messages
 * (« Nouveau message de X ») — l'utilisateur peut activer l'aperçu.
 * Les données de la notification ne sont que des identifiants, re-validés
 * (format UUID) avant toute navigation.
 */

const TOKEN_KEY = 'fc.push_token.v1'
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i
const isId = (v: unknown): v is string => typeof v === 'string' && UUID.test(v)

export function configureNotifications() {
  Notifications.setNotificationHandler({
    handleNotification: async (n) => {
      // Ne pas afficher de bannière pour la conversation déjà ouverte.
      const data = n.request.content.data as Record<string, unknown> | undefined
      const conv = data && (data.dm_id ?? data.group_id ?? data.channel_id)
      const active = useUnread.getState().activeConversation
      const show = !(typeof conv === 'string' && conv === active)
      return { shouldShowBanner: show, shouldShowList: show, shouldPlaySound: show, shouldSetBadge: false }
    },
  })

  if (Platform.OS === 'android') {
    void Notifications.setNotificationChannelAsync('messages', {
      name: 'Messages',
      importance: Notifications.AndroidImportance.HIGH,
      lockscreenVisibility: Notifications.AndroidNotificationVisibility.PRIVATE,
      vibrationPattern: [0, 200, 100, 200],
      lightColor: '#5865f2',
    })
    void Notifications.setNotificationChannelAsync('calls', {
      name: 'Appels',
      importance: Notifications.AndroidImportance.MAX,
      lockscreenVisibility: Notifications.AndroidNotificationVisibility.PUBLIC,
      vibrationPattern: [0, 800, 600, 800],
      // Pas de `sound` : absent = son système par défaut ; une chaîne serait lue comme un fichier res/raw.
    })
  }
}

/** Route vers l'écran correspondant à une notification touchée. */
export function routeFromNotification(data: Record<string, unknown> | undefined) {
  if (!data) return
  const kind = data.kind
  if (kind === 'dm' && isId(data.dm_id)) router.push(`/dm/${data.dm_id}`)
  else if (kind === 'group' && isId(data.group_id)) router.push(`/group/${data.group_id}`)
  else if (kind === 'channel' && isId(data.server_id) && isId(data.channel_id))
    router.push(`/channel/${data.server_id}/${data.channel_id}`)
  else if (kind === 'friend_request') router.push('/friends')
  // kind === 'call' : l'ouverture de l'app suffit, le serveur rejoue l'appel en cours via WS.
}

export function listenNotificationTaps(): () => void {
  const sub = Notifications.addNotificationResponseReceivedListener((resp) => {
    routeFromNotification(resp.notification.request.content.data as Record<string, unknown>)
  })
  // Cas « app tuée » : la notification qui a lancé l'app.
  // Léger délai : laisser la navigation « connectée » se monter avant de router.
  const timer = setTimeout(() => {
    const last = Notifications.getLastNotificationResponse()
    if (last) {
      routeFromNotification(last.notification.request.content.data as Record<string, unknown>)
      Notifications.clearLastNotificationResponse()
    }
  }, 400)
  return () => {
    clearTimeout(timer)
    sub.remove()
  }
}

async function getStoredToken() {
  try {
    return await SecureStore.getItemAsync(TOKEN_KEY)
  } catch {
    return null
  }
}

/** Enregistre (ou met à jour) le token push de cet appareil auprès du serveur. */
export async function syncPushRegistration(): Promise<void> {
  const { pushEnabled, pushPreview } = useSettings.getState()
  if (!pushEnabled) {
    await unregisterPush()
    return
  }
  if (!Device.isDevice) return // simulateurs : pas de push
  // Profil LAN : ni projet EAS ni Firebase dans l'APK, le serveur local n'envoie pas de push.
  // On n'essaie pas (pas d'erreur ni de nouvelle tentative) ; les messages arrivent par WebSocket.
  if (IS_LAN) return
  const projectId =
    (Constants.expoConfig?.extra as { eas?: { projectId?: string } } | undefined)?.eas?.projectId ??
    Constants.easConfig?.projectId
  if (!projectId) {
    logger.warn('push', 'EAS projectId absent — push désactivé (voir .env.example)')
    return
  }

  let { status } = await Notifications.getPermissionsAsync()
  if (status !== 'granted') status = (await Notifications.requestPermissionsAsync()).status
  if (status !== 'granted') return

  try {
    const { data: token } = await Notifications.getExpoPushTokenAsync({ projectId })
    await pushApi.register({
      token,
      platform: Platform.OS === 'ios' ? 'ios' : 'android',
      provider: 'expo',
      show_preview: pushPreview,
      device_name: Device.modelName ?? undefined,
    })
    await SecureStore.setItemAsync(TOKEN_KEY, token)
  } catch (e) {
    // Serveur non patché (404) ou service push indisponible : l'app reste fonctionnelle.
    logger.warn('push', 'enregistrement impossible', e)
  }
}

export async function unregisterPush(): Promise<void> {
  const token = await getStoredToken()
  if (!token) return
  try {
    await pushApi.unregister(token)
  } catch (e) {
    logger.debug('push', 'désinscription', e)
  }
  await SecureStore.deleteItemAsync(TOKEN_KEY).catch(() => undefined)
}

// Désinscription tant que la session est valide…
registerPreSignOutHook(() => unregisterPush())
// …puis nettoyage local dans tous les cas (y compris session expirée).
registerSignOutHook(async () => {
  await SecureStore.deleteItemAsync(TOKEN_KEY).catch(() => undefined)
  await Notifications.dismissAllNotificationsAsync().catch(() => undefined)
  await Notifications.setBadgeCountAsync(0).catch(() => undefined)
})
