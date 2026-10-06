import type { QueryClient } from '@tanstack/react-query'
import type { Channel, Member, Role, ServerDetail } from '@/types/models'

/**
 * Résolution des jetons <@id>, <@&id> et <#id> à partir de ce qui est déjà en cache
 * (GET /servers/:id, GET /servers/:id/members, profils) — comme client/src/utils/mentions.ts.
 * Rien n'est demandé au serveur pour un simple affichage.
 */

function details(qc: QueryClient): ServerDetail[] {
  return qc
    .getQueriesData<ServerDetail>({ queryKey: ['server'] })
    .flatMap(([, d]) => (d && Array.isArray(d.roles) && Array.isArray(d.channels) ? [d] : []))
}

export function cachedRole(qc: QueryClient, id: string): Role | undefined {
  for (const d of details(qc)) {
    const r = d.roles.find((x) => x.id === id)
    if (r) return r
  }
  return undefined
}

export function cachedChannel(qc: QueryClient, id: string): Channel | undefined {
  for (const d of details(qc)) {
    const c = d.channels.find((x) => x.id === id)
    if (c) return c
  }
  for (const [, list] of qc.getQueriesData<Channel[]>({ queryKey: ['channels'] })) {
    const c = Array.isArray(list) ? list.find((x) => x.id === id) : undefined
    if (c) return c
  }
  return undefined
}

export function cachedUsername(qc: QueryClient, id: string): string | undefined {
  const direct = qc.getQueryData<{ username?: string }>(['user', id])?.username
  if (direct) return direct
  for (const [, list] of qc.getQueriesData<Member[]>({ queryKey: ['members'] })) {
    const hit = Array.isArray(list) ? list.find((m) => m.user_id === id) : undefined
    if (hit) return hit.nickname ?? hit.username
  }
  return undefined
}

/** Couleur d'un rôle (entier RGB) en #rrggbb ; null pour 0 (rôle sans couleur). */
export function roleColor(color: number | undefined): string | null {
  return color ? `#${(color & 0xffffff).toString(16).padStart(6, '0')}` : null
}
