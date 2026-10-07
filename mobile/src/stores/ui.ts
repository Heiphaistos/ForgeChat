import { create } from 'zustand'

/**
 * État d'interface éphémère (non persisté, conservé pendant la session).
 * `selectedServerId` : serveur affiché sur l'accueil ; `null` = messages privés.
 * `chatOpen` : le salon du serveur (dernier consulté, stores/lastChannel) couvre la liste des salons,
 * comme Discord mobile ; le refermer (← ou glisser vers la droite) ramène à la liste.
 * `collapsed` : catégories repliées dans la liste des salons (clé = id de catégorie).
 */
interface UiState {
  selectedServerId: string | null
  chatOpen: boolean
  collapsed: Record<string, true>
  selectServer: (id: string | null) => void
  setChatOpen: (open: boolean) => void
  toggleCategory: (id: string) => void
  reset: () => void
}

export const useUi = create<UiState>((set) => ({
  selectedServerId: null,
  chatOpen: false,
  collapsed: {},
  selectServer: (id) => set({ selectedServerId: id, chatOpen: false }),
  setChatOpen: (open) => set({ chatOpen: open }),
  toggleCategory: (id) =>
    set((s) => {
      const collapsed = { ...s.collapsed }
      if (collapsed[id]) delete collapsed[id]
      else collapsed[id] = true
      return { collapsed }
    }),
  reset: () => set({ selectedServerId: null, chatOpen: false }),
}))
