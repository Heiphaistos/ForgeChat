import { parseSafeUrl } from '@/lib/links'

/** Plateformes acceptées par user_settings.rs::ALLOWED_PLATFORMS (même liste et mêmes modèles d'URL que le web). */
export const PLATFORMS = [
  { id: 'github', label: 'GitHub', urlTemplate: 'https://github.com/{username}' },
  { id: 'twitter', label: 'Twitter / X' },
  { id: 'steam', label: 'Steam' },
  { id: 'spotify', label: 'Spotify' },
  { id: 'youtube', label: 'YouTube' },
  { id: 'twitch', label: 'Twitch', urlTemplate: 'https://twitch.tv/{username}' },
  { id: 'linkedin', label: 'LinkedIn' },
  { id: 'reddit', label: 'Reddit', urlTemplate: 'https://reddit.com/user/{username}' },
  { id: 'instagram', label: 'Instagram' },
  { id: 'tiktok', label: 'TikTok' },
] as const

export interface ConnectedAccount {
  id: string
  platform: string
  username: string
  url: string | null
  verified: boolean
  visible: boolean
}

export function normalizeAccounts(raw: unknown): ConnectedAccount[] {
  if (!Array.isArray(raw)) return []
  return raw.flatMap((a: unknown) => {
    const r = a && typeof a === 'object' ? (a as Record<string, unknown>) : {}
    if (typeof r.id !== 'string' || typeof r.platform !== 'string' || typeof r.platform_username !== 'string') return []
    return [
      {
        id: r.id,
        platform: r.platform,
        username: r.platform_username,
        url: typeof r.platform_url === 'string' && parseSafeUrl(r.platform_url) ? r.platform_url : null,
        verified: r.verified === true,
        visible: r.visible === true,
      },
    ]
  })
}

/**
 * Corps de POST /user/connected-accounts : pseudo obligatoire ; sans URL, elle est déduite du modèle de la
 * plateforme (GitHub, Twitch, Reddit) ; une URL saisie doit être http(s) (le serveur la refuse sinon).
 * Retourne null si le pseudo est vide ou l'URL invalide.
 */
export function addAccountBody(platform: string, username: string, url: string) {
  const name = username.trim()
  const u = url.trim()
  if (!name || (u && !parseSafeUrl(u))) return null
  const tpl = PLATFORMS.find((p) => p.id === platform)
  const meta = tpl && 'urlTemplate' in tpl ? tpl.urlTemplate : null
  return { platform, platform_username: name, platform_url: u || (meta ? meta.replace('{username}', encodeURIComponent(name.replace(/^[@/]+/, ''))) : null) }
}
