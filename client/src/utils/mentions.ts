import { queryClient } from '../main'

// Jetons de mention stockés dans les messages (résolus par server/src/notify.rs) :
// <@uuid> membre, <@&uuid> rôle. @everyone / @here restent en texte.
export const MENTION_TOKEN_RE = /<@([&!]?)([0-9a-fA-F-]{36})>/g

interface MemberLike { user_id?: string; id?: string; username?: string }
interface RoleLike { id: string; name: string; color?: number; mentionable?: boolean }

/** Pseudo d'un utilisateur déjà présent dans le cache (profil ou liste de membres). */
export function cachedUsername(id: string): string | undefined {
  const direct = queryClient.getQueryData<{ username?: string }>(['user', id])?.username
  if (direct) return direct
  for (const [, list] of queryClient.getQueriesData<MemberLike[]>({ queryKey: ['members'] })) {
    const hit = Array.isArray(list) ? list.find(m => (m.user_id ?? m.id) === id) : undefined
    if (hit?.username) return hit.username
  }
  return undefined
}

export function cachedRole(id: string): RoleLike | undefined {
  for (const [, list] of queryClient.getQueriesData<RoleLike[]>({ queryKey: ['roles'] })) {
    const hit = Array.isArray(list) ? list.find(r => r.id === id) : undefined
    if (hit) return hit
  }
  return undefined
}

/** Texte lisible (toasts, notifications système) : jetons remplacés par @nom. */
export function mentionsToText(content: string): string {
  return content.replace(MENTION_TOKEN_RE, (_, kind: string, id: string) =>
    `@${(kind === '&' ? cachedRole(id)?.name : cachedUsername(id)) ?? 'inconnu'}`)
}

/**
 * À l'envoi : `@pseudo` / `@rôle` choisis dans l'autocomplétion (ou la liste des
 * membres) deviennent des jetons. Les noms les plus longs d'abord, pour que
 * `@bob` ne remplace pas le début de `@bobby`.
 */
export function encodeMentions(content: string, picked: Map<string, string>): string {
  if (picked.size === 0) return content
  const names = [...picked.keys()].sort((a, b) => b.length - a.length)
  const escaped = names.map(n => n.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'))
  const re = new RegExp(`(^|[^\\w])@(${escaped.join('|')})(?![\\w-])`, 'g')
  return content.replace(re, (_, pre: string, name: string) => `${pre}${picked.get(name) ?? `@${name}`}`)
}
