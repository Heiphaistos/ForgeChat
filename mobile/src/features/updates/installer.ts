import { requireOptionalNativeModule } from 'expo'
import * as Linking from 'expo-linking'
import { Platform } from 'react-native'
import { logger } from '@/lib/logger'
import { shaMatches } from './updateCheck'
import { useUpdate } from './updateStore'

/** Fonctions natives de modules/call-service (UpdateInstaller.kt). */
export interface UpdateNative {
  downloadUpdate(url: string, sha256: string): Promise<string>
  canInstallUpdate(): boolean
  openInstallSettings(): void
  installUpdate(): boolean
  discardUpdate(): void
  addListener(event: 'onUpdateProgress', fn: (e: { received: number; total: number }) => void): { remove(): void }
}

const mod = Platform.OS === 'android' ? requireOptionalNativeModule<UpdateNative>('ForgeCallService') : null
/** null : iOS, ou build sans le module natif à jour (repli : téléchargement par le navigateur). */
export const updateNative: UpdateNative | null = mod && typeof mod.downloadUpdate === 'function' ? mod : null

/** Ouvre l'installeur Android, ou le réglage « installer des applications » s'il n'est pas encore accordé. */
function install(native: UpdateNative) {
  if (!native.canInstallUpdate()) {
    useUpdate.setState({ phase: 'permission' })
    native.openInstallSettings()
    return
  }
  // false : plus de fichier vérifié dans le cache (vidé par Android) : retélécharger.
  useUpdate.setState({ phase: native.installUpdate() ? 'ready' : 'available', progress: null })
}

/**
 * « Installer » : télécharge l'APK dans l'app (progression visible), vérifie son SHA-256 (ici et en
 * natif), puis lance l'installeur. Un fichier dont l'empreinte diffère est supprimé, jamais installé.
 */
export async function startUpdate(native: UpdateNative | null = updateNative): Promise<void> {
  const { update, phase } = useUpdate.getState()
  if (!update || phase === 'downloading') return
  if (!native) {
    void Linking.openURL(update.url).catch(() => undefined)
    return
  }
  if (phase === 'ready' || phase === 'permission') return install(native)
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
    install(native)
  } catch (e) {
    logger.warn('mise à jour', 'téléchargement impossible', e)
    useUpdate.setState({ phase: 'error', error: 'network', progress: null })
  } finally {
    sub.remove()
  }
}

/** Retour au premier plan après le réglage « installer des applications » : l'installation reprend. */
export function resumeAfterPermission(native: UpdateNative | null = updateNative) {
  if (native && useUpdate.getState().phase === 'permission' && native.canInstallUpdate()) install(native)
}
