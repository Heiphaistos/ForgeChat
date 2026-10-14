// Monté une fois dans MainLayout : événements temps réel des catégories (renommage, ordre,
// surcharges) et menu contextuel ouvrable de n'importe où (openGlobalMenu), pour les écrans
// qui n'ont pas le leur (ex. messages d'un groupe).
import { useEffect } from 'react'
import { useQueryClient } from '@tanstack/react-query'
import { useWs } from '../../store/ws'
import { useContextMenu, type ContextMenuEntry } from '../ui/ContextMenu'
import { applyCategoryPositions, mergeCategory, type CategoryLike } from '../../lib/discordFeatures'

const MENU_EVENT = 'forgechat:open-menu'

export function openGlobalMenu(e: React.MouseEvent, items: ContextMenuEntry[]) {
  e.preventDefault()
  e.stopPropagation()
  window.dispatchEvent(new CustomEvent(MENU_EVENT, { detail: { x: e.clientX, y: e.clientY, items } }))
}

interface CategoryEvent { server_id?: string; category?: unknown; positions?: unknown; category_id?: string }

export default function DiscordFeatureHost() {
  const qc = useQueryClient()
  const menu = useContextMenu()
  const openAt = menu.openAt

  useEffect(() => {
    const onMenu = (e: Event) => {
      const d = (e as CustomEvent<{ x: number; y: number; items: ContextMenuEntry[] }>).detail
      openAt(d.x, d.y, d.items)
    }
    window.addEventListener(MENU_EVENT, onMenu)
    return () => window.removeEventListener(MENU_EVENT, onMenu)
  }, [openAt])

  useEffect(() => {
    const on = useWs.getState().on
    // Cache absent (liste jamais ouverte) : rien à corriger, le prochain GET sera à jour.
    const patch = (sid: string | undefined, fn: (cats: CategoryLike[]) => CategoryLike[]) => {
      if (sid) qc.setQueryData<CategoryLike[]>(['categories', sid], old => (old ? fn(old) : old))
    }
    const offs = [
      on('CATEGORY_UPDATE', raw => { const d = raw as CategoryEvent; patch(d.server_id, c => mergeCategory(c, d.category)) }),
      on('CATEGORIES_REORDER', raw => { const d = raw as CategoryEvent; patch(d.server_id, c => applyCategoryPositions(c, d.positions)) }),
      on('CATEGORY_PERMISSION_UPDATE', raw => {
        const d = raw as CategoryEvent
        if (d.category_id) qc.invalidateQueries({ queryKey: ['category-permissions', d.category_id] })
      }),
    ]
    return () => offs.forEach(off => off())
  }, [qc])

  return menu.node
}
