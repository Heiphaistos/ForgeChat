import { t } from '@/i18n'

/** Mot à recopier pour la première confirmation (la seconde est une alerte). */
export const DELETE_CONFIRM_WORD = 'SUPPRIMER'

/** Erreur à afficher avant tout appel serveur, ou null si la demande peut partir. */
export function deleteAccountError(password: string, confirmWord: string): string | null {
  if (confirmWord.trim().toUpperCase() !== DELETE_CONFIRM_WORD) return t('settings.deleteRules.typeWord', { word: DELETE_CONFIRM_WORD })
  if (!password) return t('settings.deleteRules.passwordRequired')
  return null
}

/** Où et quoi afficher après un refus du serveur (users::delete_account). */
export function deleteAccountFailure(e: unknown): { field: 'password' | 'form'; message: string } {
  const status = typeof e === 'object' && e && 'status' in e && typeof e.status === 'number' ? e.status : 0
  const msg = e instanceof Error ? e.message : ''
  if (status === 400 && /mot de passe/i.test(msg)) return { field: 'password', message: msg }
  if (status === 400 && msg) return { field: 'form', message: msg } // ex. propriétaire d'un serveur
  if (status === 429) return { field: 'form', message: t('settings.deleteRules.tooMany') }
  if (status === 0) return { field: 'form', message: t('settings.deleteRules.network') }
  return {
    field: 'form',
    message: t('settings.deleteRules.failed'),
  }
}
