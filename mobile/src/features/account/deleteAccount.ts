/** Mot à recopier pour la première confirmation (la seconde est une alerte). */
export const DELETE_CONFIRM_WORD = 'SUPPRIMER'

/** Erreur à afficher avant tout appel serveur, ou null si la demande peut partir. */
export function deleteAccountError(password: string, confirmWord: string): string | null {
  if (confirmWord.trim().toUpperCase() !== DELETE_CONFIRM_WORD) return `Recopie « ${DELETE_CONFIRM_WORD} » pour confirmer.`
  if (!password) return 'Ton mot de passe est requis.'
  return null
}

/** Où et quoi afficher après un refus du serveur (users::delete_account). */
export function deleteAccountFailure(e: unknown): { field: 'password' | 'form'; message: string } {
  const status = typeof e === 'object' && e && 'status' in e && typeof e.status === 'number' ? e.status : 0
  const msg = e instanceof Error ? e.message : ''
  if (status === 400 && /mot de passe/i.test(msg)) return { field: 'password', message: msg }
  if (status === 400 && msg) return { field: 'form', message: msg } // ex. propriétaire d'un serveur
  if (status === 429) return { field: 'form', message: 'Trop de tentatives. Réessaie dans 15 minutes.' }
  if (status === 0) return { field: 'form', message: 'Réseau indisponible. Vérifie ta connexion et réessaie.' }
  return {
    field: 'form',
    message: "Le serveur n'a pas pu supprimer ton compte. Réessaie plus tard ou contacte le support.",
  }
}
