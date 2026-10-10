// Journal des messages supprimés ou modifiés (Extras) : LOCAL et en mémoire seulement. Le
// texte déjà déchiffré reste affiché (barré, grisé) jusqu'au rechargement de la page ; il
// n'est jamais envoyé, ni écrit sur le disque. Module pur : testé par scripts/messageLog.test.mjs.

export interface Loggable {
  id: string
  content?: string | null
  author_id?: string
  sender_id?: string
  expires_at?: string | null
  expire_on_read?: boolean
  logged_deleted?: boolean
  logged_edits?: string[]
}

/**
 * Suppression reçue : le message est retiré, ou gardé barré si le journal est actif. Jamais
 * gardés : mes propres messages, les messages éphémères (leur but est de disparaître) et les
 * messages sans texte lisible.
 */
export function applyDeletion<T extends Loggable>(list: T[], id: string, logging: boolean, meId?: string | null): T[] {
  const m = list.find(x => x.id === id)
  const keep = logging && !!m && !!m.content && (m.author_id ?? m.sender_id) !== meId && !m.expires_at && !m.expire_on_read
  return keep ? list.map(x => (x.id === id ? { ...x, logged_deleted: true } : x)) : list.filter(x => x.id !== id)
}

/** Modification reçue : anciennes versions à afficher (au plus 10), ou undefined sans journal ni changement. */
export function editHistory(m: Loggable, next: string | null | undefined, logging: boolean): string[] | undefined {
  if (!logging || !m.content || next == null || next === m.content) return m.logged_edits
  return [...(m.logged_edits ?? []), m.content].slice(-10)
}
