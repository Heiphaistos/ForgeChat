// Logique pure des fonctions « façon Discord » (non-lu, statut vocal, forum, comptes visibles).
// Sans React ni réseau : testée par __tests__/discord-features.test.ts. Toute donnée du serveur est non fiable.
import type { IconName } from '@/components/ui'

const count = (v: unknown) => (typeof v === 'number' && Number.isInteger(v) && v >= 0 ? v : null)

/** Compteurs renvoyés par POST …/unread (`{ count, mention_count }`) ; null si la forme est fausse. */
export function unreadCounts(raw: unknown): { count: number; mentionCount: number } | null {
  const d = raw && typeof raw === 'object' ? (raw as Record<string, unknown>) : null
  const c = count(d?.count)
  const m = count(d?.mention_count)
  return c === null || m === null ? null : { count: c, mentionCount: m }
}

export interface UnreadPatch { channelId: string; serverId: string | null; count: number; mentionCount: number }

/** READ_STATE_UPDATE `{ unread: true }` validé ; null sinon (sans `unread` : simple « lu »). */
export function parseUnreadEvent(raw: unknown): UnreadPatch | null {
  const d = raw && typeof raw === 'object' ? (raw as Record<string, unknown>) : null
  if (!d || d.unread !== true || typeof d.channel_id !== 'string' || !d.channel_id) return null
  const counts = unreadCounts(d)
  if (!counts) return null
  return { channelId: d.channel_id, serverId: typeof d.server_id === 'string' && d.server_id ? d.server_id : null, ...counts }
}

/** Statut d'un salon vocal tel qu'envoyé : une ligne, espaces resserrés, 500 caractères ; '' = effacer. */
export function cleanVoiceStatus(s: string): string {
  return [...s.replace(/\s+/g, ' ').trim()].slice(0, 500).join('')
}

/** Statut modifiable : salon vocal ou scène, et j'y suis connecté ou j'ai le droit de modifier les salons. */
export function canSetVoiceStatus(type: string, channelId: string, connectedTo: string | null, canEdit: boolean): boolean {
  return (type === 'voice' || type === 'stage') && (canEdit || connectedTo === channelId)
}

/** Réactions rapides d'un forum : la réaction par défaut du salon en tête, sans doublon, même longueur. */
export function withDefaultReaction(base: readonly string[], emoji: string | null | undefined): readonly string[] {
  const e = emoji?.trim()
  if (!e) return base
  return [e, ...base.filter((x) => x !== e)].slice(0, base.length)
}

export interface PublicAccount { platform: string; username: string; url: string | null; verified: boolean }

/** Comptes connectés visibles d'un profil (GET /users/:id/profile) : lien https seulement. */
export function publicAccounts(raw: unknown): PublicAccount[] {
  if (!Array.isArray(raw)) return []
  return raw.flatMap((a: unknown) => {
    const r = a && typeof a === 'object' ? (a as Record<string, unknown>) : {}
    if (typeof r.platform !== 'string' || !r.platform || typeof r.platform_username !== 'string' || !r.platform_username) return []
    const url = typeof r.platform_url === 'string' && /^https:\/\/[^\s/]+/i.test(r.platform_url) ? r.platform_url : null
    return [{ platform: r.platform, username: r.platform_username, url, verified: r.verified === true }]
  })
}

const PLATFORM_ICONS: Record<string, IconName> = {
  github: 'logo-github', twitch: 'logo-twitch', youtube: 'logo-youtube', steam: 'logo-steam', xbox: 'logo-xbox',
  playstation: 'logo-playstation', reddit: 'logo-reddit', twitter: 'logo-twitter', x: 'logo-x', instagram: 'logo-instagram',
  tiktok: 'logo-tiktok', discord: 'logo-discord', facebook: 'logo-facebook', linkedin: 'logo-linkedin',
}

/** Icône de la plateforme (lien générique si inconnue). */
export const platformIcon = (platform: string): IconName => PLATFORM_ICONS[platform.toLowerCase()] ?? 'link-outline'
