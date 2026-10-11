// Choix propres à l'appareil, par compte : personnes ignorées (leurs messages sont repliés),
// conversations épinglées et fermées tant que le serveur ne les connaît pas (la branche web
// ux-menus les ajoute à PATCH /dms/:id/settings ; un serveur qui renvoie `is_pinned` l'emporte).
// ponytail: stockage local non synchronisé ; à retirer pour l'épinglage/fermeture dès que le serveur les sert partout.
import { create } from 'zustand'
import { createJSONStorage, persist } from 'zustand/middleware'
import { fileStateStorage } from '@/lib/fileStorage'
import { getMyId } from '@/stores/auth'

interface Prefs {
  ignored: string[]
  pinned: string[]
  /** Conversation → fermeture (ms) : masquée jusqu'au prochain message. */
  closed: Record<string, number>
}
const EMPTY: Prefs = { ignored: [], pinned: [], closed: {} }

interface State {
  byUser: Record<string, Prefs>
  toggle: (field: 'ignored' | 'pinned', id: string, on: boolean) => void
  setClosed: (id: string, at: number | null) => void
}

const update = (s: State, fn: (p: Prefs) => Prefs): Partial<State> => {
  const me = getMyId()
  return me ? { byUser: { ...s.byUser, [me]: fn(s.byUser[me] ?? EMPTY) } } : {}
}

export const useLocalPrefs = create<State>()(
  persist(
    (set) => ({
      byUser: {},
      toggle: (field, id, on) =>
        set((s) => update(s, (p) => ({ ...p, [field]: on ? [...new Set([...p[field], id])] : p[field].filter((x) => x !== id) }))),
      setClosed: (id, at) =>
        set((s) =>
          update(s, (p) => {
            const closed = { ...p.closed }
            if (at === null) delete closed[id]
            else closed[id] = at
            return { ...p, closed }
          }),
        ),
    }),
    { name: 'fc.ux.local.v1', storage: createJSONStorage(() => fileStateStorage), partialize: ({ byUser }) => ({ byUser }) },
  ),
)

/** Préférences du compte connecté (sélecteur React). */
export function useMyLocalPrefs(): Prefs {
  return useLocalPrefs((s) => s.byUser[getMyId() ?? ''] ?? EMPTY)
}
