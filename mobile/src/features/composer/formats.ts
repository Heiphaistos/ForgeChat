/**
 * Formats de message partagés avec le client web : ce que l'app envoie doit s'afficher sur le web,
 * et ce que le web envoie doit s'afficher ici. Fonctions pures (testées).
 */

// ─── Stickers (web : components/chat/sticker-utils.ts) ───────────────────────

export type ParsedSticker = { name: string; emoji: string; url?: undefined } | { name: string; url: string; emoji?: undefined }

/** Sticker emoji `[sticker:🐱:cat]` ou sticker image du serveur `[sticker:nom](url)`. */
export function formatSticker(s: { name: string; emoji?: string; url?: string }): string {
  if (s.url) return `[sticker:${s.name}](${s.url})`
  return `[sticker:${s.emoji ?? ''}:${s.name}]`
}

/** Message entièrement composé d'un sticker → ses parties ; sinon null (texte normal). */
export function parseSticker(content: string | null | undefined): ParsedSticker | null {
  if (!content || content.length > 600) return null
  const img = /^\[sticker:([^\]]+)\]\(([^)]+)\)$/.exec(content)
  if (img) return { name: img[1]!, url: img[2]! }
  const emoji = /^\[sticker:(.+?):(.+?)\]$/.exec(content)
  if (emoji) return { emoji: emoji[1]!, name: emoji[2]! }
  return null
}

// ─── GIF (contenu du message = URL du GIF, comme le web) ───────────────────

const TENOR_GIF = /^https:\/\/media\d*\.tenor\.com\/(?:m\/)?[A-Za-z0-9_-]{1,64}\/[A-Za-z0-9._-]{1,120}\.gif$/
const KLIPY_GIF = /^https:\/\/static\d{0,2}\.klipy\.com\/[A-Za-z0-9._~\/-]{1,300}\.(?:gif|webp)$/
const GIPHY_GIF = /^https:\/\/(?:media\d?|i)\.giphy\.com\/media\/[A-Za-z0-9]{1,64}\/[A-Za-z0-9._-]{1,60}\.(?:gif|webp)$/
const COMMONS_GIF = /^https:\/\/(?:upload|thumb)\.wikimedia\.org\/wikipedia\/commons\/[A-Za-z0-9._~%()\/-]{1,300}\.gif$/

/**
 * Message qui n'est QUE l'URL d'un GIF (GIPHY / Wikimedia : recherche GIF par le serveur ; Tenor,
 * KLIPY : anciens messages) → l'URL et sa source, sinon null. Aucun autre hôte n'est chargé comme image.
 */
export function remoteGif(content: string | null | undefined): { url: string; provider: 'Tenor' | 'KLIPY' | 'GIPHY' | 'Wikimedia' } | null {
  const c = content?.trim()
  if (!c || c.length > 400 || c.includes('..')) return null
  if (TENOR_GIF.test(c)) return { url: c, provider: 'Tenor' }
  if (KLIPY_GIF.test(c)) return { url: c, provider: 'KLIPY' }
  if (GIPHY_GIF.test(c)) return { url: c, provider: 'GIPHY' }
  if (COMMONS_GIF.test(c)) return { url: c, provider: 'Wikimedia' }
  return null
}

/** URL du GIF (GIPHY, Wikimedia, Tenor ou KLIPY), sinon null. */
export function tenorGifUrl(content: string | null | undefined): string | null {
  return remoteGif(content)?.url ?? null
}

// ─── Messages vocaux (web : MessageInput.handleVoiceMessage) ──────────────────

/** Durée maximale d'un message vocal, comme le web (2 minutes). */
export const VOICE_MAX_SECONDS = 120

/** « 🎤 Message vocal (1:05) » : le texte que le web place dans le message. */
export function voiceMessageContent(seconds: number): string {
  const s = Math.max(0, Math.round(seconds))
  return `🎤 Message vocal (${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')})`
}

/**
 * Nom du fichier envoyé depuis Android : AAC dans un conteneur MP4. Le serveur refuse « .m4a » mais
 * accepte « .mp4 » (enregistré en video/mp4, lu par le lecteur du web comme ses propres vocaux .webm).
 */
export function voiceFileName(now = Date.now()): string {
  return `voice-${now}.mp4`
}

/** Texte automatique d'un message vocal (masqué quand le lecteur s'affiche). */
export function isVoiceMessageText(content: string | null | undefined): boolean {
  return !!content && /^🎤 Message vocal \(\d{1,2}:\d{2}\)$/u.test(content)
}

const VOICE_FILE = /^voice-\d{10,16}\.(webm|ogg|mp4|m4a)$/i

/** Pièce jointe d'un message vocal (web ou app) : lue avec le lecteur audio, même si son type est vidéo. */
export function isVoiceAttachment(a: { filename: string; content_type: string }): boolean {
  return VOICE_FILE.test(a.filename) && /^(audio|video)\//.test(a.content_type)
}

// ─── Contenu modifiable ──────────────────────────────────────────────────────

/**
 * Le message a-t-il un vrai texte, que l'auteur peut modifier ou copier ? Non pour un message vocal,
 * un sticker, un GIF seul ou une pièce jointe sans texte.
 */
export function hasEditableText(m: { content: string | null; attachments: readonly { filename: string; content_type: string }[] }): boolean {
  const c = m.content?.trim()
  if (!c) return false
  if (isVoiceMessageText(c) && m.attachments.some(isVoiceAttachment)) return false
  if (parseSticker(c) || tenorGifUrl(c)) return false
  return true
}

// ─── Expiration (serveur : expires_at, purge chaque minute + MESSAGE_DELETE) ──

/** Le message a-t-il expiré à `now` ? (date invalide : non) */
export function isExpired(expiresAt: string | null | undefined, now: number): boolean {
  if (!expiresAt) return false
  const t = Date.parse(expiresAt)
  return Number.isFinite(t) && t <= now
}

/** Prochaine expiration (ms) parmi les messages, ou null. */
export function nextExpiry(messages: readonly { expiresAt?: string | null }[], now: number): number | null {
  let next: number | null = null
  for (const m of messages) {
    if (!m.expiresAt) continue
    const t = Date.parse(m.expiresAt)
    if (Number.isFinite(t) && t > now && (next === null || t < next)) next = t
  }
  return next
}

/** « 4 min », « 2 h », « 3 j » : temps restant avant disparition. */
export function remainingLabel(expiresAt: string, now: number): string {
  const ms = Date.parse(expiresAt) - now
  if (!Number.isFinite(ms) || ms <= 0) return 'maintenant'
  const min = Math.ceil(ms / 60_000)
  if (min < 60) return `${min} min`
  const h = Math.round(min / 60)
  if (h < 48) return `${h} h`
  return `${Math.round(h / 24)} j`
}
