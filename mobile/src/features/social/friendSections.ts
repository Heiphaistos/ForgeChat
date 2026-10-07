// Amis rangés (lot « Profil et social ») : favoris épinglés, groupes dans l'ordre
// choisi, puis les autres. Un favori n'apparaît qu'en tête.
import type { FriendGroup } from '@/api/social'

export interface Sectioned<F> { key: string; title: string | null; data: F[] }

export function friendSections<F extends { friend_id: string; is_favorite?: boolean }>(
  friends: F[],
  groups: FriendGroup[],
  titles: { favorites: string; others: string },
): Sectioned<F>[] {
  const placed = new Set<string>()
  const favorites = friends.filter((f) => f.is_favorite)
  favorites.forEach((f) => placed.add(f.friend_id))
  const byGroup = [...groups]
    .sort((a, b) => a.position - b.position)
    .map((g) => {
      const data = friends.filter((f) => g.member_ids.includes(f.friend_id) && !f.is_favorite)
      data.forEach((f) => placed.add(f.friend_id))
      return { key: g.id, title: g.name, data }
    })
  const others = friends.filter((f) => !placed.has(f.friend_id))
  const organized = favorites.length > 0 || byGroup.some((s) => s.data.length > 0)
  return [
    { key: 'favorites', title: titles.favorites, data: favorites },
    ...byGroup,
    { key: 'others', title: organized ? titles.others : null, data: others },
  ].filter((s) => s.data.length > 0)
}
