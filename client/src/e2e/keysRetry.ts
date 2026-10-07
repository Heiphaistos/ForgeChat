// Ré-essai du déchiffrement quand les clés arrivent (sans dépendance : testé par
// scripts/keysRetry.test.mjs). Un contenu ouvert avant que la clé de compte soit prête
// (déverrouillage au démarrage) ou avant les clés d'une conversation reste « en attente » :
// rien ne doit le mémoriser comme définitivement illisible.

type Kind = 'dm' | 'group' | 'channel'
export type KeysListener = (kind?: Kind, id?: string) => void
const listeners = new Set<KeysListener>()

/** Écoute « des clés sont arrivées » : toutes les conversations (sans argument) ou une seule. */
export function onKeysChanged(l: KeysListener): () => void {
  listeners.add(l)
  return () => { listeners.delete(l) }
}

export function emitKeysChanged(kind?: Kind, id?: string) {
  for (const l of [...listeners]) {
    try { l(kind, id) } catch { /* un écran démonté ne bloque pas les autres */ }
  }
}

/** Vrai si l'événement concerne cette conversation (ou toutes). */
export const keysFor = (kind: Kind, id: string | undefined, k?: Kind, i?: string) =>
  !!id && (!i || (k === kind && i === id))

/** Clé de compte devenue prête, ou remplacée (nouvelle clé). */
export const becameReady = <K>(s: { status: string; priv: K | null }, prev: { status: string; priv: K | null }) =>
  s.status === 'ready' && (prev.status !== 'ready' || s.priv !== prev.priv)

/**
 * État de conversation en cache encore utilisable : ouvert avec la clé de compte actuelle
 * (un état chargé avant son déverrouillage n'a aucune clé d'époque), et assez récent si on force.
 */
export const cacheUsable = <K>(hit: { priv: K | null; at: number } | undefined, priv: K | null, force: boolean, now: number) =>
  !!hit && hit.priv === priv && (!force || now - hit.at < 1000)

interface Lockable { id: string; e2e?: string; e2e_reply?: string }

/** Message (ou aperçu de sa réponse) chiffré pas encore lisible. */
export const isLocked = (m: unknown) => {
  const o = m as Lockable | null
  return o?.e2e === 'locked' || o?.e2e_reply === 'locked'
}

/** Remplace chaque message en attente par sa version lisible rechargée (même id), sans toucher aux autres. */
export function mergeUnlocked<T extends Lockable>(prev: T[], fresh: readonly T[]): T[] {
  const open = new Map(fresh.filter(m => !isLocked(m)).map(m => [m.id, m]))
  return prev.map(m => (isLocked(m) && open.get(m.id)) || m)
}
