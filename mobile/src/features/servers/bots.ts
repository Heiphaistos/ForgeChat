import { isUuid } from '@/lib/params'

/** Bot d'un serveur (handlers/bots.rs::list_bots). */
export interface ServerBot {
  botUserId: string
  name: string
  username: string
  createdAt: string | null
}

const obj = (v: unknown): Record<string, unknown> => (v && typeof v === 'object' ? (v as Record<string, unknown>) : {})

export function normalizeBots(raw: unknown): ServerBot[] {
  if (!Array.isArray(raw)) return []
  return raw.map(obj).flatMap((r) =>
    isUuid(r.bot_user_id) && typeof r.name === 'string'
      ? [{ botUserId: r.bot_user_id.toLowerCase(), name: r.name, username: typeof r.username === 'string' ? r.username : r.name, createdAt: typeof r.created_at === 'string' ? r.created_at : null }]
      : [],
  )
}

/** create_bot : nom rogné, 1 à 32 octets (le serveur compte `name.len()`, donc des octets UTF-8). null si invalide. */
export function botName(raw: string): string | null {
  const n = raw.trim()
  const bytes = new TextEncoder().encode(n).length
  return bytes >= 1 && bytes <= 32 ? n : null
}

/** Le token n'est renvoyé qu'à la création et à la régénération : lu défensivement, jamais vide. */
export const botToken = (raw: unknown): string | null => {
  const t = obj(raw).token
  return typeof t === 'string' && t ? t : null
}
