import type { ServerProfilePatch } from '@/api/servers'
import { cleanRing, type AvatarRingData } from '@/components/avatarRingCore'
import { cleanNameStyle, type NameStyle } from '@/lib/nameStyle'
import type { Member } from '@/types/models'

const same = (a: unknown, b: unknown) => JSON.stringify(a) === JSON.stringify(b)

/**
 * « Mon profil sur ce serveur » : seulement ce qui change (pseudo à part, PATCH /nickname ;
 * le reste en un PATCH /profile). `style` null = style du compte.
 */
export function serverProfileChanges(
  member: Pick<Member, 'nickname' | 'server_bio' | 'server_avatar_ring' | 'server_name_style'> | null | undefined,
  next: { nick: string; bio: string; ring: AvatarRingData | null; style: NameStyle | null },
): { nickname?: string | null; profile: ServerProfilePatch } {
  const out: { nickname?: string | null; profile: ServerProfilePatch } = { profile: {} }
  const nick = next.nick.trim() || null
  if (nick !== (member?.nickname || null)) out.nickname = nick
  const bio = next.bio.trim() || null
  if (bio !== (member?.server_bio || null)) out.profile.bio = bio
  const ring = cleanRing(next.ring)
  if (!same(ring, cleanRing(member?.server_avatar_ring))) out.profile.avatar_ring = ring ?? {}
  const style = cleanNameStyle(next.style)
  if (!same(style, cleanNameStyle(member?.server_name_style))) out.profile.name_style = style ?? {}
  return out
}

/** Fiche profil ; avec `serverId`, elle montre le profil propre à ce serveur. */
export function userRoute(userId: string, serverId?: string): string {
  return serverId ? `/user/${userId}?serverId=${serverId}` : `/user/${userId}`
}

interface Shown {
  name: string
  avatar: string | null
  banner: string | null
  bio: string | null
}

/** Profil affiché : surnom, avatar, bannière et bio du serveur l'emportent sur ceux du compte.
 *  `member.avatar` est déjà l'avatar du serveur s'il y en a un (COALESCE côté serveur). */
export function shownProfile(
  user: { username: string; avatar?: string | null; banner?: string | null; bio?: string | null },
  member?: Pick<Member, 'nickname' | 'avatar' | 'server_banner' | 'server_bio'> | null,
): Shown {
  return {
    name: member?.nickname || user.username,
    avatar: member?.avatar ?? user.avatar ?? null,
    banner: member?.server_banner ?? user.banner ?? null,
    bio: member?.server_bio ?? user.bio ?? null,
  }
}
