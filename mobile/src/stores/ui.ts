import { create } from 'zustand'

/**
 * État d'interface éphémère (non persisté, conservé pendant la session).
 * `selectedServerId` : serveur affiché sur l'accueil ; `null` = messages privés.
 * `chatOpen` : le salon du serveur (dernier consulté, stores/lastChannel) couvre la liste des salons,
 * comme Discord mobile ; le refermer (← ou glisser vers la droite) ramène à la liste.
 * `collapsed` : catégories repliées (true) ou dépliées (false) à la main pendant la session ; une
 *   catégorie jamais touchée suit le réglage « catégories repliées à l'ouverture » (theme/prefs).
 */
interface UiState {
  selectedServerId: string | null
  chatOpen: boolean
  collapsed: Record<string, boolean>
  selectServer: (id: string | null) => void
  setChatOpen: (open: boolean) => void
  /** `folded` : état affiché au moment de l'appui. */
  toggleCategory: (id: string, folded: boolean) => void
  reset: () => void
}

export const useUi = create<UiState>((set) => ({
  selectedServerId: null,
  chatOpen: false,
  collapsed: {},
  selectServer: (id) => set({ selectedServerId: id, chatOpen: false }),
  setChatOpen: (open) => set({ chatOpen: open }),
  toggleCategory: (id, folded) => set((s) => ({ collapsed: { ...s.collapsed, [id]: !folded } })),
  reset: () => set({ selectedServerId: null, chatOpen: false }),
}))
