/**
 * Parseur Markdown « Discord-like » minimal et SÛR.
 *
 * - Produit un arbre de nœuds rendu en <Text> natifs : aucun HTML, aucune
 *   WebView, donc aucune injection de script possible.
 * - Profondeur d'imbrication et taille d'entrée bornées (anti-DoS).
 * - Seuls les liens http(s) sont reconnus.
 */

export type InlineNode =
  | { t: 'text'; v: string }
  | { t: 'code'; v: string }
  | { t: 'bold'; c: InlineNode[] }
  | { t: 'italic'; c: InlineNode[] }
  | { t: 'strike'; c: InlineNode[] }
  | { t: 'spoiler'; c: InlineNode[] }
  | { t: 'link'; url: string }
  | { t: 'mention'; v: string; everyone: boolean }

export type BlockNode =
  | { t: 'para'; c: InlineNode[] }
  | { t: 'quote'; c: InlineNode[] }
  | { t: 'codeblock'; lang: string | null; v: string }

const MAX_INPUT = 6000
const MAX_DEPTH = 4

const INLINE_RE =
  /(`[^`\n]+`)|(\*\*[^*\n][^*]*?\*\*)|(~~[^~\n][^~]*?~~)|(\|\|[^|\n][^|]*?\|\|)|(\*[^*\s][^*\n]*?\*)|(https?:\/\/[^\s<>]+[^\s<>().,;:!?'"\]])|(<@[0-9a-fA-F-]{36}>)|(@(?:everyone|here|[A-Za-z0-9_-]{2,32}))/g

export function parseInline(input: string, depth = 0): InlineNode[] {
  const out: InlineNode[] = []
  if (!input) return out
  if (depth >= MAX_DEPTH) return [{ t: 'text', v: input }]

  const re = new RegExp(INLINE_RE.source, 'g')
  let last = 0
  let m: RegExpExecArray | null
  while ((m = re.exec(input)) !== null) {
    const [tok] = m
    if (m.index > last) out.push({ t: 'text', v: input.slice(last, m.index) })
    if (m[1]) out.push({ t: 'code', v: tok.slice(1, -1) })
    else if (m[2]) out.push({ t: 'bold', c: parseInline(tok.slice(2, -2), depth + 1) })
    else if (m[3]) out.push({ t: 'strike', c: parseInline(tok.slice(2, -2), depth + 1) })
    else if (m[4]) out.push({ t: 'spoiler', c: parseInline(tok.slice(2, -2), depth + 1) })
    else if (m[5]) out.push({ t: 'italic', c: parseInline(tok.slice(1, -1), depth + 1) })
    else if (m[6]) out.push({ t: 'link', url: tok })
    else if (m[7]) out.push({ t: 'mention', v: tok.slice(2, -1), everyone: false })
    else if (m[8]) {
      const name = tok.slice(1)
      out.push({ t: 'mention', v: name, everyone: name === 'everyone' || name === 'here' })
    }
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
    if (line.startsWith('> ') || line === '>') {
      flush()
      blocks.push({ t: 'quote', c: parseInline(line.replace(/^>\s?/, '')) })
    } else para.push(line)
  }
  flush()
}

/** Vrai si le message mentionne l'utilisateur (pseudo, <@id>, @everyone/@here). */
export function mentionsUser(content: string | null, userId: string, username: string): boolean {
  if (!content) return false
  if (content.includes(`<@${userId}>`)) return true
  if (/@(everyone|here)\b/.test(content)) return true
  const re = new RegExp(`@${username.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}(?![A-Za-z0-9_-])`, 'i')
  return re.test(content)
}
