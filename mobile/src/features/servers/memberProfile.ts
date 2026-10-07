import type { Member } from '@/types/models'

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
