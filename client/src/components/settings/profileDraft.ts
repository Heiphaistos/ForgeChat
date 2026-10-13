// Enregistrement unique du profil (audit C15) : chaque partie du formulaire (à propos,
// identité, cosmétiques) remonte son brouillon à ProfileSection, qui affiche une seule barre
// « modifications non enregistrées » et envoie un seul PATCH /users/me. Garde de sortie :
// SettingsPage demande confirmation avant de quitter la section ou la page.
import { useEffect, useState } from 'react'
import { confirm } from '../ui/ConfirmModal'
import { t } from '../../i18n'

export type Patch = Record<string, unknown>
/** `patch` null = rien à enregistrer pour cette partie ; `invalid` bloque l'enregistrement. */
export type DraftReport = (id: string, patch: Patch | null, invalid?: boolean) => void

/**
 * Compare la charge utile courante à celle du montage et la remonte au parent.
 * Le parent remonte la partie (`key`) pour réinitialiser ou après enregistrement.
 */
export function useDraft(id: string, payload: Patch, report: DraftReport, invalid = false) {
  const json = JSON.stringify(payload)
  const [initial] = useState(json)
  useEffect(() => {
    report(id, json === initial ? null : (JSON.parse(json) as Patch), invalid)
  }, [id, json, initial, invalid, report])
  useEffect(() => () => report(id, null), [id, report])
}

let dirty = false
let asking = false
const onBeforeUnload = (e: BeforeUnloadEvent) => { e.preventDefault() }

/** Modifications en attente : fermeture d'onglet / rechargement avertis par le navigateur. */
export function setUnsaved(next: boolean) {
  if (next === dirty) return
  dirty = next
  if (next) window.addEventListener('beforeunload', onBeforeUnload)
  else window.removeEventListener('beforeunload', onBeforeUnload)
}

/** true = on peut quitter (rien en attente, ou l'utilisateur accepte de perdre ses modifications). */
export async function confirmLeave(): Promise<boolean> {
  if (!dirty) return true
  if (asking) return false // une confirmation est déjà ouverte (ex. Échap pendant la boîte)
  asking = true
  try {
    const ok = await confirm({ message: t('psave.leaveConfirm'), confirmLabel: t('psave.leave'), cancelLabel: t('common.cancel'), danger: true })
    if (ok) setUnsaved(false)
    return ok
  } finally {
    asking = false
  }
}
