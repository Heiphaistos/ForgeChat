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

/** Texte sans bloc de code, code en ligne ni spoiler `||…||` : on n'y cherche aucun lien. */
const visibleText = (t: string) => t.replace(/```[\s\S]*?(?:```|$)/g, ' ').replace(/`[^`\n]*`/g, ' ').replace(/\|\|[\s\S]*?\|\|/g, ' ')

/** Première URL http(s) visible d'un texte, sans la ponctuation qui la suit (`[a](url)`, `url.`). */
export function firstUrl(text: string): string | null {
  const m = visibleText(text).match(/https?:\/\/[^\s<>"]+/)?.[0]
  if (!m) return null
  let url = m.replace(/[.,;:!?'*_~\]]+$/, '')
  if (!url.includes('(')) url = url.replace(/\)+$/, '') // fin d'un lien masqué [a](url)
  return url.replace(/[.,;:!?'*_~\]]+$/, '')
}

const MEDIA_EXT = /\.(?:png|jpe?g|gif|webp|avif|bmp|svg|mp4|webm|mov|mkv|mp3|ogg|wav|flac)$/i

/** Lien à prévisualiser : le premier lien visible, sauf un média (déjà affiché ou téléchargeable). */
export function previewUrl(text: string): string | null {
  const url = firstUrl(text)
  if (!url) return null
  try {
    return MEDIA_EXT.test(new URL(url).pathname) ? null : url
  } catch {
    return null
  }
}

/**
 * Vrai pour un site public (http/https, nom de domaine) : seul cas où l'on demande un aperçu à
 * /og. Le serveur refait toutes les vérifications SSRF ; ceci évite seulement des appels inutiles.
 */
export function previewAllowed(url: string): boolean {
  try {
    const u = new URL(url)
    if (u.protocol !== 'https:' && u.protocol !== 'http:') return false
    const h = u.hostname.toLowerCase()
    return h.includes('.') && !/^[\d.]+$/.test(h) && !/(^|\.)(localhost|local|internal)$/.test(h)
  } catch {
    return false
  }
}
