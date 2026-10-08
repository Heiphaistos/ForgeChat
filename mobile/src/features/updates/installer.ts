import * as Linking from 'expo-linking'
import { Platform } from 'react-native'
import { useUpdate } from './updateStore'

/** iOS : AltStore puis SideStore installent l'IPA (même signature personnelle) ; sinon, page de l'IPA. */
async function openIpa(url: string) {
  const q = encodeURIComponent(url)
  for (const link of [`altstore://install?url=${q}`, `sidestore://install?url=${q}`, url]) {
    try {
      await Linking.openURL(link)
      return
    } catch { /* appli absente : lien suivant */ }
  }
}

/**
 * « Installer ». Android : le navigateur télécharge l'APK (HTTPS, serveur ForgeChat) puis l'ouvre
 * dans l'installeur du système, qui refuse tout APK signé avec une autre clé que l'app installée.
 * Pas d'installation depuis l'app : il faudrait REQUEST_INSTALL_PACKAGES, que HyperOS 3 refuse à la
 * première installation, et déposer l'APK dans Téléchargements ne proposait que des explorateurs
 * de fichiers (« Terminer l'action avec… », Xiaomi 15T Pro, 2026-10-08).
 */
export async function startUpdate(): Promise<void> {
  const { update } = useUpdate.getState()
  if (!update) return
  if (Platform.OS === 'ios') return void openIpa(update.url)
  try {
    await Linking.openURL(update.url)
    useUpdate.setState({ phase: 'ready' })
  } catch {
    useUpdate.setState({ phase: 'error' })
  }
}
