import type { Category, Channel, Role } from '@/types/models'
import { channelSections } from './channels'

/** Copie de `list` où l'élément `index` a échangé sa place avec son voisin ; null en bout de liste. */
export function moveItem<T>(list: readonly T[], index: number, delta: -1 | 1): T[] | null {
  const to = index + delta
  if (index < 0 || index >= list.length || to < 0 || to >= list.length) return null
  const out = [...list]
  ;[out[index], out[to]] = [out[to]!, out[index]!]
  return out
}

/**
 * Ordre complet des salons après avoir monté (-1) ou descendu (+1) `channelId` dans sa catégorie,
 * pour PATCH /servers/:id/channels/reorder (positions 0..n dans l'ordre envoyé). Archivés et masqués compris.
 * ponytail: les salons invisibles pour moi gardent leur ancienne position ; l'ordre relatif des visibles est juste.
 */
export function reorderChannelIds(channels: Channel[], categories: Category[], channelId: string, delta: -1 | 1): string[] | null {
  const all = channels.map((c) => ({ ...c, hidden: false, archived: false }))
  const sections = channelSections(all, categories).map((s) => s.data.map((c) => c.id))
  const section = sections.find((ids) => ids.includes(channelId))
  const moved = section && moveItem(section, section.indexOf(channelId), delta)
  if (!section || !moved) return null
  return sections.flatMap((ids) => (ids === section ? moved : ids))
}

/** Rôles hors @everyone, du plus haut au plus bas (ordre attendu par PATCH /servers/:id/roles/order). */
export const rolesTopDown = (roles: Role[]) => roles.filter((r) => !r.is_everyone).sort((a, b) => b.position - a.position)

/**
 * Ordre des rôles après avoir monté (-1) ou descendu (+1) `roleId`. `canMove(rôle)` : rôle sous le mien
 * (perms.roleBelow) ; le serveur refuse de faire passer un rôle au-dessus d'un rôle intouchable.
 */
export function reorderRoleIds(roles: Role[], roleId: string, delta: -1 | 1, canMove: (r: Role) => boolean): string[] | null {
  const list = rolesTopDown(roles)
  const i = list.findIndex((r) => r.id === roleId)
  const moved = moveItem(list, i, delta)
  if (!moved || !canMove(list[i]!) || !canMove(list[i + delta]!)) return null
  return moved.map((r) => r.id)
}
