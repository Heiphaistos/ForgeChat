import { create } from 'zustand'
import type { AvailableUpdate } from './updateCheck'

/**
 * Mise à jour proposée (bannière UpdateBanner) et avancement de son installation (installer.ts).
 *  - available   : proposée, rien de téléchargé ;
 *  - downloading : APK en cours de téléchargement (`progress` de 0 à 1, null si taille inconnue) ;
 *  - permission  : Android attend l'autorisation « installer des applications » ;
 *  - ready       : installeur Android ouvert (ou refermé sans installer : on peut le rouvrir) ;
 *  - error       : téléchargement en échec (`error` = réseau) ou fichier refusé (`error` = sha).
 */
export type UpdatePhase = 'available' | 'downloading' | 'permission' | 'ready' | 'error'

interface UpdateState {
  update: AvailableUpdate | null
  phase: UpdatePhase
  progress: number | null
  error: 'network' | 'sha' | null
  /** « Plus tard » : bannière masquée jusqu'à la prochaine vérification qui retrouve la mise à jour. */
  dismissed: boolean
}

export const useUpdate = create<UpdateState>(() => ({ update: null, phase: 'available', progress: null, error: null, dismissed: false }))

/** Affiche la bannière ; une installation déjà en cours de la même version garde son avancement. */
export function offerUpdate(update: AvailableUpdate) {
  const s = useUpdate.getState()
  if (s.update?.version === update.version && s.update.sha256 === update.sha256 && s.phase !== 'error') {
    useUpdate.setState({ dismissed: false })
    return
  }
  useUpdate.setState({ update, phase: 'available', progress: null, error: null, dismissed: false })
}
