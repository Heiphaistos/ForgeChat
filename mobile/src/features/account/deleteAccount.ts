/** Mot à recopier pour la première confirmation (la seconde est une alerte). */
export const DELETE_CONFIRM_WORD = 'SUPPRIMER'

/** Erreur à afficher avant tout appel serveur, ou null si la demande peut partir. */
export function deleteAccountError(password: string, confirmWord: string): string | null {
  if (confirmWord.trim().toUpperCase() !== DELETE_CONFIRM_WORD) return `Recopie « ${DELETE_CONFIRM_WORD} » pour confirmer.`
  if (!password) return 'Ton mot de passe est requis.'
  return null
}
