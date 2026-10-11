// Ouverture du menu utilisateur partagé, depuis n'importe quel pseudo ou avatar ; le rendu
// et les actions sont dans UserMenuHost (monté une fois dans App).
import { create } from 'zustand'
import type { ContextMenuEntry } from '../ui/ContextMenu'
import { longPress } from '../ui/ContextMenu'

export interface UserMenuTarget {
  userId: string
  username: string
  avatar?: string | null
  /** Serveur du contexte (modération, rôles) ; à défaut, celui de l'adresse courante. */
  serverId?: string
  /** Personne entendue en vocal : ajoute « Volume ». */
  voice?: boolean
  /** Habille les entrées utilisateur (ex. menu d'une conversation de la liste). */
  wrap?: (userEntries: ContextMenuEntry[]) => ContextMenuEntry[]
}

interface UserMenuState {
  menu: { x: number; y: number; target: UserMenuTarget } | null
  /** Serveur du dernier menu : reste après la fermeture pour les fenêtres de modération. */
  serverId?: string
  show: (x: number, y: number, target: UserMenuTarget) => void
  close: () => void
}

export const serverInPath = () => window.location.pathname.match(/^\/servers\/([0-9a-fA-F-]{36})/)?.[1]

export const useUserMenu = create<UserMenuState>(set => ({
  menu: null,
  show: (x, y, target) => set({ menu: { x, y, target }, serverId: target.serverId ?? serverInPath() }),
  close: () => set({ menu: null }),
}))

type PointerLike = { clientX: number; clientY: number; preventDefault?: () => void; stopPropagation?: () => void }

export function openUserMenu(e: PointerLike, target: UserMenuTarget) {
  e.preventDefault?.()
  e.stopPropagation?.()
  useUserMenu.getState().show(e.clientX, e.clientY, target)
}

/** Clic droit et appui long qui ouvrent le menu de `target`. */
export function userMenuProps(target: UserMenuTarget) {
  return {
    onContextMenu: (e: React.MouseEvent) => openUserMenu(e, target),
    ...longPress((x, y) => useUserMenu.getState().show(x, y, target)),
  }
}
