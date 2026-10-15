// Entrées fixes de la barre des serveurs (sans import : testé par `node --test scripts/railLayout.test.mjs`).
import type { RailLayout } from './railLayout.ts'

// ─── Entrées fixes (Messages privés, Tutoriel, Actualités…) : masquables et réordonnables ───

/** Ordre par défaut : Tutoriel juste au-dessus d'Actualités. */
export const FIXED_IDS = ['dms', 'saved', 'tutorials', 'news', 'notifications'] as const

/** Ordre enregistré (ids inconnus ignorés), entrées manquantes ajoutées à leur place par défaut. */
export function fixedOrder(stored: readonly string[] | undefined): string[] {
  const out = (stored ?? []).filter((id, i, a) => (FIXED_IDS as readonly string[]).includes(id) && a.indexOf(id) === i)
  for (const id of FIXED_IDS) {
    if (out.includes(id)) continue
    // Insérée avant la première entrée qui la suit par défaut et qui est déjà là, sinon à la fin.
    const next = FIXED_IDS.slice(FIXED_IDS.indexOf(id) + 1).map(n => out.indexOf(n)).filter(i => i !== -1)
    out.splice(next.length ? Math.min(...next) : out.length, 0, id)
  }
  return out
}

/** Entrées fixes affichées, dans l'ordre. */
export const visibleFixed = (l: Pick<RailLayout, 'fixed' | 'hidden'>): string[] => fixedOrder(l.fixed).filter(id => !l.hidden?.includes(id))

/** Masque ou réaffiche une entrée fixe. */
export function setFixedHidden(l: RailLayout, id: string, hide: boolean): RailLayout {
  const rest = (l.hidden ?? []).filter(h => h !== id)
  return { ...l, hidden: hide ? [...rest, id] : rest }
}

/** Déplace une entrée fixe avant / après une autre. */
export function moveFixed(l: RailLayout, id: string, targetId: string, zone: 'before' | 'after'): RailLayout {
  if (id === targetId) return l
  const o = fixedOrder(l.fixed).filter(x => x !== id)
  const i = o.indexOf(targetId)
  if (i === -1 || !FIXED_IDS.includes(id as typeof FIXED_IDS[number])) return l
  o.splice(zone === 'after' ? i + 1 : i, 0, id)
  return { ...l, fixed: o }
}

/** Entrées fixes remises à leur ordre d'origine et toutes visibles. */
export const resetFixed = (l: RailLayout): RailLayout => ({ order: l.order, folders: l.folders })
