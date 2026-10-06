/**
 * Parseur Markdown « Discord-like » SÛR, aligné sur client/src/utils/markdown.tsx.
 *
 * - Produit un arbre de nœuds rendu en <Text> natifs : aucun HTML, aucune
 *   WebView, donc aucune injection de script possible.
 * - Profondeur d'imbrication et taille d'entrée bornées (anti-DoS).
 * - Seuls les liens http(s) sont reconnus.
 */

export type TimestampFormat = 'R' | 'r' | 'D' | 'd' | 'F' | 'f' | 'T' | 't'

export type InlineNode =
  | { t: 'text'; v: string }
  | { t: 'code'; v: string }
  | { t: 'bold'; c: InlineNode[] }
  | { t: 'italic'; c: InlineNode[] }
  | { t: 'underline'; c: InlineNode[] }
  | { t: 'strike'; c: InlineNode[] }
  | { t: 'spoiler'; c: InlineNode[] }
  /** `label` : lien masqué « [texte](url) » (la vraie adresse est confirmée avant ouverture). */
  | { t: 'link'; url: string; label?: string }
  | { t: 'mention'; v: string; everyone: boolean }
  /** « <@&id> » : mention de rôle (nom et couleur lus dans le cache du serveur). */
  | { t: 'role'; id: string }
  /** « <#id> » : salon. */
  | { t: 'channel'; id: string }
  /** « <t:unix:F> » : horodatage affiché dans l'heure locale. */
  | { t: 'time'; unix: number; fmt: TimestampFormat }
  /** « :nom: » : emoji personnalisé du serveur, rendu en texte si inconnu. */
  | { t: 'emoji'; v: string }
  /** « <:nom:id> » / « <a:nom:id> » : emoji de n'importe quel serveur (GET /emojis/:id). */
  | { t: 'remoteEmoji'; id: string; name: string }

export type BlockNode =
  | { t: 'para'; c: InlineNode[] }
  | { t: 'heading'; level: 1 | 2 | 3; c: InlineNode[] }
  | { t: 'quote'; c: InlineNode[] }
  | { t: 'codeblock'; lang: string | null; v: string }

const MAX_INPUT = 6000
const MAX_DEPTH = 4
const UUID = '[0-9a-fA-F-]{36}'

// Un groupe capturant par jeton, dans l'ordre des branches de parseInline.
const INLINE_RE = new RegExp(
  [
    /(`[^`\n]+`)/.source, // 1 code
    `(<a?:[A-Za-z0-9_]{1,32}:${UUID}>)`, // 2 emoji d'un serveur quelconque
    /(<t:-?\d{1,12}:[RrDdFfTt]>)/.source, // 3 horodatage
    `(<@&${UUID}>)`, // 4 rôle
    `(<@!?${UUID}>)`, // 5 membre
    `(<#${UUID}>)`, // 6 salon
    /(\[[^\]\n]{1,200}\]\(https?:\/\/[^\s()<>]+\))/.source, // 7 lien masqué
    /(\*\*\*[^*\n]+?\*\*\*)/.source, // 8 gras italique
    /(\*\*[^*\n][^*]*?\*\*)/.source, // 9 gras
    /(__[^_\n]+?__)/.source, // 10 souligné
    /(~~[^~\n][^~]*?~~)/.source, // 11 barré
    /(\|\|[^|\n][^|]*?\|\|)/.source, // 12 spoiler
    /(\*[^*\s][^*\n]*?\*)/.source, // 13 italique *
    /(_[^_\s][^_\n]*?_)/.source, // 14 italique _
    /(https?:\/\/[^\s<>]+[^\s<>().,;:!?'"\]])/.source, // 15 lien
    /(@(?:everyone|here|[A-Za-z0-9_-]{2,32}))/.source, // 16 mention par pseudo
    /(:[A-Za-z0-9_]{1,32}:)/.source, // 17 emoji du serveur
  ].join('|'),
  'g',
)

const WORD = /[\p{L}\p{N}_]/u

export function parseInline(input: string, depth = 0): InlineNode[] {
  const out: InlineNode[] = []
  if (!input) return out
  if (depth >= MAX_DEPTH) return [{ t: 'text', v: input }]

  const re = new RegExp(INLINE_RE.source, 'g')
  const sub = (s: string) => parseInline(s, depth + 1)
  let last = 0
  let m: RegExpExecArray | null
  while ((m = re.exec(input)) !== null) {
    const [tok] = m
    // « _ » / « __ » seulement aux frontières de mot (comme le web) : max_retries_value reste du texte.
    if ((m[10] || m[14]) && (WORD.test(input[m.index - 1] ?? '') || WORD.test(input[m.index + tok.length] ?? ''))) {
      re.lastIndex = m.index + 1
      continue
    }
    if (m.index > last) out.push({ t: 'text', v: input.slice(last, m.index) })
    if (m[1]) out.push({ t: 'code', v: tok.slice(1, -1) })
    else if (m[2]) {
      const [, name = '', id = ''] = tok.slice(1, -1).split(':')
      out.push({ t: 'remoteEmoji', id: id.toLowerCase(), name })
    } else if (m[3]) {
      const [, unix = '0', fmt = 'f'] = tok.slice(1, -1).split(':')
      out.push({ t: 'time', unix: Number(unix), fmt: fmt as TimestampFormat })
    } else if (m[4]) out.push({ t: 'role', id: tok.slice(3, -1).toLowerCase() })
    else if (m[5]) out.push({ t: 'mention', v: tok.slice(tok[2] === '!' ? 3 : 2, -1).toLowerCase(), everyone: false })
    else if (m[6]) out.push({ t: 'channel', id: tok.slice(2, -1).toLowerCase() })
    else if (m[7]) {
      const mid = tok.indexOf('](')
      out.push({ t: 'link', url: tok.slice(mid + 2, -1), label: tok.slice(1, mid) })
    } else if (m[8]) out.push({ t: 'bold', c: [{ t: 'italic', c: sub(tok.slice(3, -3)) }] })
    else if (m[9]) out.push({ t: 'bold', c: sub(tok.slice(2, -2)) })
    else if (m[10]) out.push({ t: 'underline', c: sub(tok.slice(2, -2)) })
    else if (m[11]) out.push({ t: 'strike', c: sub(tok.slice(2, -2)) })
    else if (m[12]) out.push({ t: 'spoiler', c: sub(tok.slice(2, -2)) })
    else if (m[13] || m[14]) out.push({ t: 'italic', c: sub(tok.slice(1, -1)) })
    else if (m[15]) out.push({ t: 'link', url: tok })
    else if (m[16]) {
      const name = tok.slice(1)
      out.push({ t: 'mention', v: name, everyone: name === 'everyone' || name === 'here' })
    } else if (m[17]) out.push({ t: 'emoji', v: tok.slice(1, -1) })
    last = m.index + tok.length
  }
  if (last < input.length) out.push({ t: 'text', v: input.slice(last) })
  return mergeText(out)
}

function mergeText(nodes: InlineNode[]): InlineNode[] {
  const out: InlineNode[] = []
  for (const n of nodes) {
    const prev = out[out.length - 1]
    if (n.t === 'text' && prev?.t === 'text') prev.v += n.v
    else out.push(n)
  }
  return out
}

export function parseMarkdown(raw: string): BlockNode[] {
  const input = raw.length > MAX_INPUT ? raw.slice(0, MAX_INPUT) : raw
  const blocks: BlockNode[] = []
  const fence = /```([A-Za-z0-9_+-]{0,20})\n?([\s\S]*?)```/g
  let last = 0
  let m: RegExpExecArray | null
  while ((m = fence.exec(input)) !== null) {
    if (m.index > last) pushText(blocks, input.slice(last, m.index))
    blocks.push({ t: 'codeblock', lang: m[1] || null, v: (m[2] ?? '').replace(/\n$/, '') })
    last = m.index + m[0].length
  }
  if (last < input.length) pushText(blocks, input.slice(last))
  return blocks
}

function pushText(blocks: BlockNode[], text: string) {
  const lines = text.split('\n')
  let para: string[] = []
  const flush = () => {
    if (para.length) {
      const joined = para.join('\n')
      if (joined.trim().length) blocks.push({ t: 'para', c: parseInline(joined) })
      para = []
    }
  }
  for (const line of lines) {
    const heading = /^(#{1,3}) (.+)$/.exec(line)
    if (heading) {
      flush()
      blocks.push({ t: 'heading', level: heading[1]!.length as 1 | 2 | 3, c: parseInline(heading[2]!) })
    } else if (line.startsWith('> ') || line === '>') {
      flush()
      blocks.push({ t: 'quote', c: parseInline(line.replace(/^>\s?/, '')) })
    } else para.push(line)
  }
  flush()
}

const pad = (n: number) => String(n).padStart(2, '0')
const MONTHS = ['janv.', 'févr.', 'mars', 'avr.', 'mai', 'juin', 'juil.', 'août', 'sept.', 'oct.', 'nov.', 'déc.']
const DAYS = ['dimanche', 'lundi', 'mardi', 'mercredi', 'jeudi', 'vendredi', 'samedi']

/** Texte d'un horodatage « <t:unix:fmt> » en heure locale ; R/r : mêmes libellés relatifs que le web. */
export function formatTimestamp(unix: number, fmt: TimestampFormat, now = Date.now()): string {
  const d = new Date(unix * 1000)
  if (Number.isNaN(d.getTime())) return '—'
  const date = `${pad(d.getDate())}/${pad(d.getMonth() + 1)}/${d.getFullYear()}`
  const longDate = `${d.getDate()} ${MONTHS[d.getMonth()]} ${d.getFullYear()}`
  const time = `${pad(d.getHours())}:${pad(d.getMinutes())}`
  switch (fmt) {
    case 'd':
      return date
    case 'D':
      return longDate
    case 't':
      return time
    case 'T':
      return `${time}:${pad(d.getSeconds())}`
    case 'f':
      return `${longDate} ${time}`
    case 'F':
      return `${DAYS[d.getDay()]} ${longDate} ${time}`
    default: {
      const diff = now - d.getTime()
      const abs = Math.abs(diff)
      if (abs < 60_000) return "à l'instant"
      const [n, unit] =
        abs < 3_600_000
          ? [Math.floor(abs / 60_000), 'minute']
          : abs < 86_400_000
            ? [Math.floor(abs / 3_600_000), 'heure']
            : [Math.floor(abs / 86_400_000), 'jour']
      const label = `${n} ${unit}${n > 1 ? 's' : ''}`
      return diff < 0 ? `dans ${label}` : `il y a ${label}`
    }
  }
}

const MEDIA_EXT = /\.(?:png|jpe?g|gif|webp|avif|bmp|svg|mp4|webm|mov|mkv|mp3|ogg|wav|flac)$/i

/**
 * Lien du message à prévisualiser (GET /og) : le premier lien http(s) hors code et spoiler,
 * sauf un média (déjà affiché ou téléchargeable).
 */
export function previewUrl(content: string | null | undefined): string | null {
  if (!content) return null
  for (const b of parseMarkdown(content)) {
    if (b.t === 'codeblock') continue
    const url = firstLink(b.c)
    if (!url) continue
    try {
      return MEDIA_EXT.test(new URL(url).pathname) ? null : url
    } catch {
      return null
    }
  }
  return null
}

function firstLink(nodes: InlineNode[]): string | null {
  for (const n of nodes) {
    if (n.t === 'link') return n.url
    if ('c' in n && n.t !== 'spoiler') {
      const url = firstLink(n.c)
      if (url) return url
    }
  }
  return null
}

/** Vrai si le message mentionne l'utilisateur (pseudo, <@id>, @everyone/@here). */
export function mentionsUser(content: string | null, userId: string, username: string): boolean {
  if (!content) return false
  if (content.includes(`<@${userId}>`)) return true
  if (/@(everyone|here)\b/.test(content)) return true
  const re = new RegExp(`@${username.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}(?![A-Za-z0-9_-])`, 'i')
  return re.test(content)
}
