// Logique pure de l'arbre « catégories > salons » de la synchro Discord (aucun React).
// Une sélection est l'ensemble des identifiants Discord cochés (catégories ET salons).

export type ChannelKind = 'text' | 'voice' | 'announcement' | 'stage' | 'forum' | 'media'

export interface TreeChannel { id: string; name: string; kind: ChannelKind; selected: boolean }
export interface TreeCategory { id: string; name: string; selected: boolean; default_excluded?: boolean; channels: TreeChannel[] }
export interface SyncTree { categories: TreeCategory[]; uncategorized: TreeChannel[] }
export type CheckState = 'all' | 'some' | 'none'

export const initialSelection = (tree: SyncTree): Set<string> => {
  const sel = new Set<string>()
  for (const c of tree.categories) {
    if (c.selected) sel.add(c.id)
    for (const ch of c.channels) if (ch.selected) sel.add(ch.id)
  }
  for (const ch of tree.uncategorized) if (ch.selected) sel.add(ch.id)
  return sel
}

export const categoryState = (cat: TreeCategory, sel: Set<string>): CheckState => {
  if (cat.channels.length === 0) return sel.has(cat.id) ? 'all' : 'none'
  const n = cat.channels.filter(ch => sel.has(ch.id)).length
  return n === 0 ? 'none' : n === cat.channels.length ? 'all' : 'some'
}

/** Coche ou décoche une catégorie et tous ses salons. */
export const toggleCategory = (cat: TreeCategory, sel: Set<string>, on: boolean): Set<string> => {
  const next = new Set(sel)
  for (const id of [cat.id, ...cat.channels.map(c => c.id)]) {
    if (on) next.add(id)
    else next.delete(id)
  }
  return next
}

/** Coche ou décoche un salon ; la catégorie reste cochée tant qu'un de ses salons l'est. */
export const toggleChannel = (cat: TreeCategory | null, id: string, sel: Set<string>, on: boolean): Set<string> => {
  const next = new Set(sel)
  if (on) next.add(id)
  else next.delete(id)
  if (cat) {
    if (cat.channels.some(c => next.has(c.id))) next.add(cat.id)
    else next.delete(cat.id)
  }
  return next
}

const allIds = (tree: SyncTree): string[] => [
  ...tree.categories.flatMap(c => [c.id, ...c.channels.map(ch => ch.id)]),
  ...tree.uncategorized.map(ch => ch.id),
]

export const selectAll = (tree: SyncTree): Set<string> => new Set(allIds(tree))
export const selectNone = (): Set<string> => new Set()

export const invertSelection = (tree: SyncTree, sel: Set<string>): Set<string> => {
  const next = new Set<string>()
  for (const c of tree.categories) {
    for (const ch of c.channels) if (!sel.has(ch.id)) next.add(ch.id)
    if (c.channels.length ? c.channels.some(ch => next.has(ch.id)) : !sel.has(c.id)) next.add(c.id)
  }
  for (const ch of tree.uncategorized) if (!sel.has(ch.id)) next.add(ch.id)
  return next
}

export const counts = (tree: SyncTree, sel: Set<string>) => {
  const ids = allIds(tree)
  return { selected: ids.filter(i => sel.has(i)).length, total: ids.length }
}

const fold = (s: string) => s.toLowerCase().normalize('NFKD').replace(/[\u0300-\u036f]/g, '').replace(/[^\p{L}\p{N}]/gu, '')

/** Filtre de recherche : une catégorie qui correspond garde tous ses salons, sinon seuls les salons trouvés. */
export const filterTree = (tree: SyncTree, query: string): SyncTree => {
  const q = fold(query)
  if (!q) return tree
  const hit = (n: string) => fold(n).includes(q)
  const categories: TreeCategory[] = []
  for (const c of tree.categories) {
    if (hit(c.name)) categories.push(c)
    else {
      const channels = c.channels.filter(ch => hit(ch.name))
      if (channels.length) categories.push({ ...c, channels })
    }
  }
  return { categories, uncategorized: tree.uncategorized.filter(ch => hit(ch.name)) }
}

/** Corps envoyé au serveur : chaque élément de l'arbre est soit coché, soit décoché. */
export const toPayload = (tree: SyncTree, sel: Set<string>) => {
  const ids = allIds(tree)
  return { included_ids: ids.filter(i => sel.has(i)), excluded_ids: ids.filter(i => !sel.has(i)) }
}

/** Ligne plate de l'arbre affiché (une FlatList virtualise ; pas de listes imbriquées). */
export type TreeRow =
  | { type: 'category'; cat: TreeCategory; open: boolean }
  | { type: 'channel'; ch: TreeChannel; catId: string | null }

/** Aplatit l'arbre filtré : salons d'une catégorie repliée omis (sauf pendant une recherche). */
export const flattenTree = (shown: SyncTree, closed: ReadonlySet<string>, searching: boolean): TreeRow[] => {
  const rows: TreeRow[] = []
  for (const cat of shown.categories) {
    const open = searching || !closed.has(cat.id)
    rows.push({ type: 'category', cat, open })
    if (open) for (const ch of cat.channels) rows.push({ type: 'channel', ch, catId: cat.id })
  }
  for (const ch of shown.uncategorized) rows.push({ type: 'channel', ch, catId: null })
  return rows
}
