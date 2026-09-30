/** Le message est parti (ou a été retiré s'il était vide) mais ses pièces jointes, non. */
export class AttachmentUploadError extends Error {
  override name = 'AttachmentUploadError'
}

/**
 * Contenu à remettre dans le composer après un échec d'envoi, pour ne rien perdre :
 * - échec avant le serveur : texte et fichiers ;
 * - échec du seul upload : les fichiers (le texte, lui, est déjà parti).
 * Ce que l'utilisateur a déjà retapé entre-temps n'est jamais écrasé.
 */
export function restoreAfterSendError<F>(
  e: unknown,
  sent: { text: string; files: readonly F[] },
  current: { text: string; files: readonly F[] },
): { text: string; files: F[] } {
  const files = current.files.length ? [...current.files] : [...sent.files]
  if (e instanceof AttachmentUploadError) return { text: current.text, files }
  return { text: current.text.trim() ? current.text : sent.text, files }
}
