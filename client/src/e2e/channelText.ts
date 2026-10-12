// Ce que le serveur faisait avec le texte d'un salon, fait par l'appli avant de
// chiffrer (docs/CHIFFREMENT-E2E.md §4.3, §10) : mentions en métadonnées et
// règles AutoMod. Fonctions pures, partagées à l'identique avec le mobile
// (mobile/src/e2e/channelText.ts) et testées par scripts/channelText.test.mjs.

/** Mentions envoyées en clair avec un message chiffré (le serveur notifie sans lire le texte). */
export interface MentionMeta {
  mentions: string[]
  mention_roles: string[]
  mention_everyone: boolean
  mention_here: boolean
}

/** Retire les blocs ``` et `code` : une mention citée en code ne notifie pas (comme le serveur). */
function stripCode(text: string): string {
  return text.replace(/```[\s\S]*?```/g, ' ').replace(/`[^`]*`/g, ' ')
}

/** `<@id>` membre, `<@&id>` rôle, `@everyone`, `@here` (pas au milieu d'un mot). */
export function mentionMeta(text: string): MentionMeta {
  const s = stripCode(text)
  const users = new Set<string>()
  const roles = new Set<string>()
  for (const m of s.matchAll(/<@([&!]?)([0-9a-fA-F-]{36})>/g)) (m[1] === '&' ? roles : users).add((m[2] ?? '').toLowerCase())
  const word = (w: string) => new RegExp(`(^|[^\\w-])@${w}(?![\\w-])`).test(s)
  return {
    mentions: [...users].slice(0, 100),
    mention_roles: [...roles].slice(0, 20),
    mention_everyone: word('everyone'),
    mention_here: word('here'),
  }
}

/** Règles AutoMod du serveur (GET /servers/:id/automod/rules). */
export interface AutoModRules {
  enabled: boolean
  blocked_words: string[]
  max_mentions: number
  max_links: number
  anti_spam: boolean
  anti_caps: boolean
  /** Domaines dangereux (liste locale du serveur + liste intégrée), vide si l'option est coupée. */
  dangerous_domains?: string[]
}

export type AutoModBlock = 'word' | 'mentions' | 'links' | 'caps' | 'spam' | 'dangerous_link'

/** Hôtes des liens d'un texte (http(s):// ou www.), en minuscules. */
export function linkHosts(text: string): string[] {
  const hosts: string[] = []
  for (const m of text.matchAll(/(?:https?:\/\/|\bwww\.)(?:[^\s/?#@]*@)?([^\s/?#<>"'@:]+)/gi)) {
    const host = (m[1] ?? '').toLowerCase().replace(/\.+$/, '')
    if (host) hosts.push(host.startsWith('www.') ? host.slice(4) : host)
  }
  return hosts
}

/** Un lien du texte pointe vers un domaine de la liste (ou l'un de ses sous-domaines). */
export const hasDangerousLink = (text: string, domains: readonly string[]) =>
  linkHosts(text).some(h => domains.some(d => d && (h === d || h.endsWith(`.${d}`))))

const isAlnum = (ch: string | undefined) => !!ch && /[\p{L}\p{N}]/u.test(ch)

/** Mot ou expression entière (pas « hell » dans « hello »), comme `contains_word` du serveur. */
export function containsWord(haystack: string, needle: string): boolean {
  if (!needle) return false
  for (let i = haystack.indexOf(needle); i !== -1; i = haystack.indexOf(needle, i + 1)) {
    const before = [...haystack.slice(0, i)].pop()
    const after = [...haystack.slice(i + needle.length)][0]
    if (!isAlnum(before) && !isAlnum(after)) return true
  }
  return false
}

/**
 * Règle qui bloque `text`, ou null. `recent` : mes derniers textes envoyés sur ce
 * serveur (anti-spam : 3e message identique en moins de 8 s).
 */
export function automodBlock(rules: AutoModRules | null | undefined, text: string, recent: { text: string; at: number }[] = [], now = Date.now()): AutoModBlock | null {
  if (!rules?.enabled) return null
  const lower = text.toLowerCase()
  if (rules.blocked_words.some(w => w && containsWord(lower, w.toLowerCase()))) return 'word'
  if (rules.dangerous_domains?.length && hasDangerousLink(text, rules.dangerous_domains)) return 'dangerous_link'
  if (rules.max_mentions > 0 && (text.match(/@/g)?.length ?? 0) > rules.max_mentions) return 'mentions'
  if (rules.max_links > 0 && (lower.match(/https?:\/\//g)?.length ?? 0) > rules.max_links) return 'links'
  if (rules.anti_spam && recent.filter(r => r.text === text && now - r.at < 8000).length >= 2) return 'spam'
  if (rules.anti_caps && text.length > 10) {
    const alpha = [...text].filter(ch => /\p{L}/u.test(ch))
    const upper = alpha.filter(ch => ch !== ch.toLowerCase() && ch === ch.toUpperCase()).length
    if (alpha.length && upper * 10 > alpha.length * 7) return 'caps'
  }
  return null
}

/** Première URL http(s) d'un texte (aperçu de lien calculé par l'expéditeur). */
export function firstUrl(text: string): string | null {
  return text.match(/https?:\/\/[^\s<>"]+/)?.[0] ?? null
}

/**
 * Domaines dont le serveur fait l'aperçu (liste fixe de server/src/handlers/audit.rs, get_og_preview).
 * Vérifiée ICI avant tout appel à /og : un lien vers un autre site n'est jamais envoyé au serveur,
 * qui sinon apprendrait les liens partagés dans les conversations chiffrées.
 */
export const PREVIEW_DOMAINS = [
  'github.com', 'youtube.com', 'youtu.be', 'twitter.com', 'x.com',
  'reddit.com', 'stackoverflow.com', 'wikipedia.org', 'medium.com', 'heiphaistos.org',
] as const

export function previewAllowed(url: string): boolean {
  let host: string
  try {
    const u = new URL(url)
    if (u.protocol !== 'https:' && u.protocol !== 'http:') return false
    host = u.hostname.toLowerCase()
  } catch {
    return false
  }
  return PREVIEW_DOMAINS.some(d => host === d || host.endsWith(`.${d}`))
}
