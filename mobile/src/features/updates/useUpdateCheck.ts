import * as Linking from 'expo-linking'
import { useEffect } from 'react'
import { Alert } from 'react-native'
import { APP_VERSION, UPDATES_REPO } from '@/config/env'
import { logger } from '@/lib/logger'
import { useSettings } from '@/stores/settings'
import { fetchAvailableUpdate, isDue, type AvailableUpdate } from './updateCheck'

/** Propose la mise à jour : la page de la release s'ouvre dans le navigateur du téléphone. */
export function proposeUpdate(update: AvailableUpdate) {
  Alert.alert(
    'Nouvelle version disponible',
    `ForgeChat ${update.version} est disponible (tu as la ${APP_VERSION}).\n\n` +
      'La page de téléchargement va s’ouvrir sur GitHub. Vérifie l’empreinte indiquée avant d’installer.',
    [
      { text: 'Ignorer cette version', onPress: () => useSettings.getState().set({ updateSkippedVersion: update.version }) },
      { text: 'Plus tard', style: 'cancel' },
      { text: 'Télécharger', onPress: () => void Linking.openURL(update.url).catch(() => undefined) },
    ],
  )
}

/**
 * Vérification automatique : rien si désactivée, si le build n'a pas de dépôt de releases, ou si la
 * dernière vérification date de moins d'un jour. Propose la mise à jour sauf version ignorée.
 */
export async function runAutomaticUpdateCheck(now = Date.now(), fetchImpl: typeof fetch = fetch): Promise<AvailableUpdate | null> {
  const { updateCheck, updateLastCheckAt, updateSkippedVersion, set } = useSettings.getState()
  if (!UPDATES_REPO || !updateCheck || !isDue(updateLastCheckAt, now)) return null
  set({ updateLastCheckAt: now })
  try {
    const update = await fetchAvailableUpdate(UPDATES_REPO, APP_VERSION, fetchImpl)
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
  if (!UPDATES_REPO) return
  try {
    const update = await fetchAvailableUpdate(UPDATES_REPO, APP_VERSION)
    if (update) proposeUpdate(update)
    else Alert.alert('À jour', `Tu as la dernière version (${APP_VERSION}).`)
  } catch {
    Alert.alert('Vérification impossible', 'GitHub ne répond pas. Réessaie plus tard.')
  }
}
