// Préférences d'affichage propres à l'appareil, par compte : utilisateurs ignorés (leurs
// messages sont repliés) et serveurs dont on masque les salons rendus muets. Rien n'est
// envoyé au serveur.
// ponytail: stockage local, non synchronisé entre appareils ; une table serveur le jour où il le faut.
import { create } from 'zustand'
import { useAuth } from './auth'

interface Prefs { ignored: string[]; hideMuted: string[] }
const KEY = 'fc_ux_prefs'
const EMPTY: Prefs = { ignored: [], hideMuted: [] }

function load(): Record<string, Prefs> {
  try {
    const v: unknown = JSON.parse(localStorage.getItem(KEY) ?? '{}')
    return v && typeof v === 'object' ? (v as Record<string, Prefs>) : {}
  } catch { return {} }
}

const toggle = (list: string[], id: string, on: boolean) => on ? [...new Set([...list, id])] : list.filter(x => x !== id)

interface UxPrefsState {
  byUser: Record<string, Prefs>
  set: (field: keyof Prefs, id: string, on: boolean) => void
}

export const useUxPrefs = create<UxPrefsState>((set, get) => ({
  byUser: load(),
  set: (field, id, on) => {
    const me = useAuth.getState().user?.id
    if (!me) return
    const mine = get().byUser[me] ?? EMPTY
    const byUser = { ...get().byUser, [me]: { ...mine, [field]: toggle(mine[field] ?? [], id, on) } }
    try { localStorage.setItem(KEY, JSON.stringify(byUser)) } catch { /* sans mémoire : appliqué pour la session */ }
    set({ byUser })
  },
}))

/** Préférences du compte connecté. */
export function useMyUxPrefs(): Prefs {
  const me = useAuth(s => s.user?.id)
  return useUxPrefs(s => (me && s.byUser[me]) || EMPTY)
}
