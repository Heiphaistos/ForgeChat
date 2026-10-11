// Choix propres à l'appareil, par compte : personnes ignorées (leurs messages sont repliés),
// conversations épinglées et fermées tant que le serveur ne les connaît pas (la branche web
// ux-menus les ajoute à PATCH /dms/:id/settings ; un serveur qui renvoie `is_pinned` l'emporte).
// ponytail: stockage local non synchronisé ; à retirer pour l'épinglage/fermeture dès que le serveur les sert partout.
import { useMemo } from 'react'
import { create } from 'zustand'
import { createJSONStorage, persist } from 'zustand/middleware'
import { fileStateStorage } from '@/lib/fileStorage'
import { getMyId } from '@/stores/auth'

interface Prefs {
  ignored: string[]
  pinned: string[]
  /** Menu vocal, pour moi seul : sons de soundboard ignorés, caméra et écran non reçus. */
  soundboardMuted: string[]
  videoOff: string[]
  /** Conversation → fermeture (ms) : masquée jusqu'au prochain message. */
  closed: Record<string, number>
}
const EMPTY: Prefs = { ignored: [], pinned: [], soundboardMuted: [], videoOff: [], closed: {} }
type ListField = 'ignored' | 'pinned' | 'soundboardMuted' | 'videoOff'

interface State {
  byUser: Record<string, Prefs>
  toggle: (field: ListField, id: string, on: boolean) => void
  setClosed: (id: string, at: number | null) => void
}

const update = (s: State, fn: (p: Prefs) => Prefs): Partial<State> => {
  const me = getMyId()
  // Comptes enregistrés avant l'ajout d'un champ : complétés par EMPTY.
  return me ? { byUser: { ...s.byUser, [me]: fn({ ...EMPTY, ...s.byUser[me] }) } } : {}
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
  const mine = useLocalPrefs((s) => s.byUser[getMyId() ?? ''])
  return useMemo(() => (mine ? { ...EMPTY, ...mine } : EMPTY), [mine])
}

/** Hors composant (salon vocal) : `userId` est-il dans la liste `field` du compte connecté ? */
export const hasLocalPref = (field: ListField, userId: string | undefined): boolean =>
  !!userId && !!useLocalPrefs.getState().byUser[getMyId() ?? '']?.[field]?.includes(userId)
