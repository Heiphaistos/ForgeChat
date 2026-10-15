// Entrées fixes de la barre des serveurs (mêmes ids et même logique que le web :
// client/src/components/layout/railFixed.ts). L'état vit dans server-layout.fixed / .hidden.
import type { ServerLayout } from './layout'

export const FIXED_IDS = ['dms', 'saved', 'tutorials', 'news', 'notifications'] as const
export type FixedId = (typeof FIXED_IDS)[number]

/** Entrées que le mobile affiche (les autres existent ailleurs dans l'app, mais gardent leur place dans `fixed`). */
export const MOBILE_FIXED: readonly FixedId[] = ['dms', 'tutorials', 'news']

const strings = (v: unknown): string[] => (Array.isArray(v) ? v.filter((x): x is string => typeof x === 'string') : [])
const isFixed = (id: string): id is FixedId => (FIXED_IDS as readonly string[]).includes(id)

/** Ordre enregistré (ids inconnus et doublons ignorés), entrées manquantes remises à leur place par défaut. */
export function fixedOrder(stored: unknown): FixedId[] {
  const out = strings(stored).filter((id, i, a): id is FixedId => isFixed(id) && a.indexOf(id) === i)
  for (const id of FIXED_IDS) {
    if (out.includes(id)) continue
    const next = FIXED_IDS.slice(FIXED_IDS.indexOf(id) + 1).map((n) => out.indexOf(n)).filter((i) => i !== -1)
    out.splice(next.length ? Math.min(...next) : out.length, 0, id)
  }
  return out
}

export const isHidden = (l: ServerLayout | null | undefined, id: string) => strings(l?.hidden).includes(id)

/** Entrées fixes affichées par ce client, dans l'ordre choisi. */
export const visibleFixed = (l: ServerLayout | null | undefined, only: readonly FixedId[] = MOBILE_FIXED): FixedId[] =>
  fixedOrder(l?.fixed).filter((id) => only.includes(id) && !isHidden(l, id))

/** Masque ou réaffiche une entrée ; toutes les autres clés du layout sont conservées. */
export function setFixedHidden(l: ServerLayout | null | undefined, id: FixedId, hide: boolean): ServerLayout {
  const rest = strings(l?.hidden).filter((h) => h !== id)
  return { ...l, hidden: hide ? [...rest, id] : rest }
}

/** Monte (-1) ou descend (+1) une entrée d'un cran parmi celles affichées (`shown`). */
export function moveFixedStep(l: ServerLayout | null | undefined, id: FixedId, dir: -1 | 1, shown: readonly FixedId[]): ServerLayout {
  const order = fixedOrder(l?.fixed)
  const vis = order.filter((x) => shown.includes(x))
  const target = vis[vis.indexOf(id) + dir]
  if (!target || !vis.includes(id)) return { ...l }
  const rest = order.filter((x) => x !== id)
  rest.splice(rest.indexOf(target) + (dir === 1 ? 1 : 0), 0, id)
  return { ...l, fixed: rest }
}

/** Ordre d'origine, tout visible ; `order`, `folders` et clés inconnues restent. */
export function resetFixed(l: ServerLayout | null | undefined): ServerLayout {
  const { fixed: _f, hidden: _h, ...rest } = l ?? {}
  return rest
}

/** Base d'écriture : le web attend `order` et `folders` ; toutes les autres clés (même inconnues) passent telles quelles. */
export const withBase = (l: ServerLayout | null | undefined): ServerLayout => ({ order: [], folders: {}, ...l })
