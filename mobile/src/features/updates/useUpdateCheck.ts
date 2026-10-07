import { useEffect } from 'react'
import { Alert, AppState } from 'react-native'
import { APP_VERSION, UPDATES_MANIFEST_URL } from '@/config/env'
import { t } from '@/i18n'
import { logger } from '@/lib/logger'
import { useSettings } from '@/stores/settings'
import { resumeAfterPermission, updateNative } from './installer'
import { fetchAvailableUpdate, isDue, type AvailableUpdate } from './updateCheck'
import { offerUpdate } from './updateStore'

let inFlight = false

/**
 * Vérification automatique : rien si désactivée, si le build n'a pas de manifeste de mises à jour, ou si la
 * dernière vérification réussie date de moins de 3 h. Propose la mise à jour (bannière) sauf version ignorée.
 * Un échec (réseau pas encore prêt…) ne compte pas : la vérification sera retentée au prochain retour.
 */
export async function runAutomaticUpdateCheck(now = Date.now(), fetchImpl: typeof fetch = fetch): Promise<AvailableUpdate | null> {
  const { updateCheck, updateLastCheckAt, updateSkippedVersion, set } = useSettings.getState()
  if (!UPDATES_MANIFEST_URL || !updateCheck || inFlight || !isDue(updateLastCheckAt, now)) return null
  inFlight = true
  try {
    const update = await fetchAvailableUpdate(UPDATES_MANIFEST_URL, APP_VERSION, fetchImpl)
    set({ updateLastCheckAt: now })
    // À jour : l'APK d'une mise à jour déjà installée n'a plus rien à faire dans le cache.
    if (!update) updateNative?.discardUpdate()
    if (!update || update.version === updateSkippedVersion) return null
    offerUpdate(update)
    return update
  } catch (e) {
    logger.debug('mise à jour', 'vérification impossible', e)
    return null
  } finally {
    inFlight = false
  }
}

/**
 * Au démarrage ET à chaque retour au premier plan : le service « Notifications sans Google » garde le
 * processus vivant, l'app ne repasse presque jamais par un démarrage à froid.
 */
export function useUpdateCheck() {
  const hydrated = useSettings((s) => s.hydrated)
  useEffect(() => {
    if (!hydrated) return
    void runAutomaticUpdateCheck()
    const sub = AppState.addEventListener('change', (state) => {
      if (state !== 'active') return
      resumeAfterPermission()
      void runAutomaticUpdateCheck()
    })
    return () => sub.remove()
  }, [hydrated])
}

/** Vérification demandée par l'utilisateur (réglages) : ignore l'intervalle et « ignorer cette version ». */
export async function checkForUpdateNow() {
  if (!UPDATES_MANIFEST_URL) return
  try {
    const update = await fetchAvailableUpdate(UPDATES_MANIFEST_URL, APP_VERSION)
    if (update) offerUpdate(update)
    else Alert.alert(t('store.update.upToDate'), t('store.update.upToDateBody', { version: APP_VERSION }))
  } catch {
    Alert.alert(t('store.update.checkFailed'), t('store.update.checkFailedBody'))
  }
}
