import * as Linking from 'expo-linking'
import { useEffect } from 'react'
import { Alert } from 'react-native'
import { APP_VERSION, UPDATES_MANIFEST_URL } from '@/config/env'
import { t } from '@/i18n'
import { logger } from '@/lib/logger'
import { useSettings } from '@/stores/settings'
import { fetchAvailableUpdate, isDue, type AvailableUpdate } from './updateCheck'

/** Propose la mise à jour : l'APK se télécharge depuis le serveur ForgeChat, Android l'installe. */
export function proposeUpdate(update: AvailableUpdate) {
  Alert.alert(
    t('store.update.title'),
    t('store.update.body', { version: update.version, current: APP_VERSION, sha: update.sha256.slice(0, 16) }),
    [
      { text: t('store.update.skip'), onPress: () => useSettings.getState().set({ updateSkippedVersion: update.version }) },
      { text: t('store.update.later'), style: 'cancel' },
      { text: t('store.update.download'), onPress: () => void Linking.openURL(update.url).catch(() => undefined) },
    ],
  )
}

/**
 * Vérification automatique : rien si désactivée, si le build n'a pas de manifeste de mises à jour, ou si la
 * dernière vérification date de moins d'un jour. Propose la mise à jour sauf version ignorée.
 */
export async function runAutomaticUpdateCheck(now = Date.now(), fetchImpl: typeof fetch = fetch): Promise<AvailableUpdate | null> {
  const { updateCheck, updateLastCheckAt, updateSkippedVersion, set } = useSettings.getState()
  if (!UPDATES_MANIFEST_URL || !updateCheck || !isDue(updateLastCheckAt, now)) return null
  set({ updateLastCheckAt: now })
  try {
    const update = await fetchAvailableUpdate(UPDATES_MANIFEST_URL, APP_VERSION, fetchImpl)
    if (!update || update.version === updateSkippedVersion) return null
    proposeUpdate(update)
    return update
  } catch (e) {
    logger.debug('mise à jour', 'vérification impossible', e)
    return null
  }
}

/** Au démarrage de l'app connectée, une fois les réglages chargés. */
export function useUpdateCheck() {
  const hydrated = useSettings((s) => s.hydrated)
  useEffect(() => {
    if (hydrated) void runAutomaticUpdateCheck()
  }, [hydrated])
}

/** Vérification demandée par l'utilisateur (réglages) : ignore la limite quotidienne et « ignorer ». */
export async function checkForUpdateNow() {
  if (!UPDATES_MANIFEST_URL) return
  try {
    const update = await fetchAvailableUpdate(UPDATES_MANIFEST_URL, APP_VERSION)
    if (update) proposeUpdate(update)
    else Alert.alert(t('store.update.upToDate'), t('store.update.upToDateBody', { version: APP_VERSION }))
  } catch {
    Alert.alert(t('store.update.checkFailed'), t('store.update.checkFailedBody'))
  }
}
