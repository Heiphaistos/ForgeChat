import { create } from 'zustand'
import type { AvailableUpdate } from './updateCheck'

/**
 * Mise à jour proposée (bannière UpdateBanner) :
 *  - available : proposée ;
 *  - ready     : téléchargement lancé dans le navigateur, à ouvrir une fois terminé ;
 *  - error     : aucun navigateur n'a pu ouvrir le lien.
 */
export type UpdatePhase = 'available' | 'ready' | 'error'

interface UpdateState {
  update: AvailableUpdate | null
  phase: UpdatePhase
  /** « Plus tard » : bannière masquée jusqu'à la prochaine vérification qui retrouve la mise à jour. */
  dismissed: boolean
}

export const useUpdate = create<UpdateState>(() => ({ update: null, phase: 'available', dismissed: false }))

/** Affiche la bannière ; une mise à jour déjà lancée de la même version garde son état. */
export function offerUpdate(update: AvailableUpdate) {
  const s = useUpdate.getState()
  if (s.update?.version === update.version && s.update.sha256 === update.sha256 && s.phase !== 'error') {
    useUpdate.setState({ dismissed: false })
    return
  }
  useUpdate.setState({ update, phase: 'available', dismissed: false })
}
