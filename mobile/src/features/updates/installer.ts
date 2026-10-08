import { requireOptionalNativeModule } from 'expo'
import * as Linking from 'expo-linking'
import { Platform } from 'react-native'
import { logger } from '@/lib/logger'
import { shaMatches } from './updateCheck'
import { useUpdate } from './updateStore'

/** Fonctions natives de modules/call-service (UpdateInstaller.kt). */
export interface UpdateNative {
  downloadUpdate(url: string, sha256: string): Promise<string>
  /** Dépose l'APK vérifié dans Téléchargements et ouvre la liste (false : plus de fichier vérifié). */
  installUpdate(): Promise<boolean>
  discardUpdate(): void
  addListener(event: 'onUpdateProgress', fn: (e: { received: number; total: number }) => void): { remove(): void }
}

const mod = Platform.OS === 'android' ? requireOptionalNativeModule<UpdateNative>('ForgeCallService') : null
/** null : iOS, ou build sans le module natif à jour (repli : téléchargement par le navigateur). */
export const updateNative: UpdateNative | null = mod && typeof mod.downloadUpdate === 'function' ? mod : null

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
 * Remet l'APK vérifié dans Téléchargements ; l'utilisateur l'installe d'un appui depuis le gestionnaire
 * de fichiers (pas de permission REQUEST_INSTALL_PACKAGES : HyperOS 3 refuse alors l'installation).
 */
async function install(native: UpdateNative) {
  try {
    // false : plus de fichier vérifié dans le cache (vidé par Android) : retélécharger.
    useUpdate.setState({ phase: (await native.installUpdate()) ? 'ready' : 'available', progress: null })
  } catch (e) {
    logger.warn('mise à jour', 'remise de l’APK impossible', e)
    useUpdate.setState({ phase: 'error', error: 'network', progress: null })
  }
}

/**
 * « Installer » : télécharge l'APK dans l'app (progression visible), vérifie son SHA-256 (ici et en
 * natif), puis lance l'installeur. Un fichier dont l'empreinte diffère est supprimé, jamais installé.
 */
export async function startUpdate(native: UpdateNative | null = updateNative): Promise<void> {
  const { update, phase } = useUpdate.getState()
  if (!update || phase === 'downloading') return
  if (!native) {
    if (Platform.OS === 'ios') return void openIpa(update.url)
    void Linking.openURL(update.url).catch(() => undefined)
    return
  }
  if (phase === 'ready') {
    // Fichier déjà remis : un nouvel appui retélécharge (la copie a pu être supprimée).
    useUpdate.setState({ phase: 'available' })
  }
  useUpdate.setState({ phase: 'downloading', progress: 0, error: null })
  const sub = native.addListener('onUpdateProgress', ({ received, total }) =>
    useUpdate.setState({ progress: total > 0 ? Math.min(1, received / total) : null }),
  )
  try {
    const sha = await native.downloadUpdate(update.url, update.sha256)
    if (!shaMatches(update.sha256, sha)) {
      native.discardUpdate()
      useUpdate.setState({ phase: 'error', error: 'sha', progress: null })
      return
    }
    await install(native)
  } catch (e) {
    logger.warn('mise à jour', 'téléchargement impossible', e)
    useUpdate.setState({ phase: 'error', error: 'network', progress: null })
  } finally {
    sub.remove()
  }
}
