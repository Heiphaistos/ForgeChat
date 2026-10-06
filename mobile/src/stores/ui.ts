import { create } from 'zustand'

/**
 * État d'interface éphémère (non persisté, conservé pendant la session).
 * `selectedServerId` : serveur affiché sur l'accueil ; `null` = messages privés.
 */
export const useUi = create<{ selectedServerId: string | null; selectServer: (id: string | null) => void; reset: () => void }>((set) => ({
  selectedServerId: null,
  selectServer: (id) => set({ selectedServerId: id }),
  reset: () => set({ selectedServerId: null }),
}))
