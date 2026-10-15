// Contenu des tutoriels (HTML du site tuto) -> arbre de noeuds, SANS WebView ni innerHTML.
// Même liste blanche que le web (client/src/pages/tutorials/htmlToReact.ts) : tout le reste est jeté
// (le contenu des balises inconnues reste), aucun attribut hors href (http/https) et src d'image (https).

export type HtmlNode =
  | { t: 'text'; s: string }
  | { t: 'el'; tag: string; kids: HtmlNode[]; href?: string; src?: string; alt?: string }

const TAGS = new Set(['h2', 'h3', 'h4', 'p', 'strong', 'em', 's', 'u', 'ul', 'ol', 'li', 'blockquote', 'pre', 'code', 'a'])
const NAMED: Record<string, string> = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: ' ' }

const decode = (t: string) =>
  t.replace(/&(#x[0-9a-f]+|#\d+|[a-z]+);/gi, (m, e: string) => {
    if (e[0] !== '#') return NAMED[e.toLowerCase()] ?? m
    const cp = e[1]?.toLowerCase() === 'x' ? parseInt(e.slice(2), 16) : parseInt(e.slice(1), 10)
    try { return cp > 0 && cp <= 0x10ffff ? String.fromCodePoint(cp) : m } catch { return m }
  })

const attr = (raw: string, name: string): string | undefined => {
  const m = new RegExp(String.raw`(?:^|\s)${name}\s*=\s*(?:"([^"]*)"|'([^']*)')`, 'i').exec(raw)
  return m ? decode(m[1] ?? m[2] ?? '') : undefined
}

/** Adresse sans identifiants, schéma http(s) (ou https seul si `httpsOnly`). */
export function safeHttp(raw: string | undefined, httpsOnly = false): string | undefined {
  if (!raw) return undefined
  try {
    const u = new URL(raw.trim())
    if (u.protocol !== 'https:' && (httpsOnly || u.protocol !== 'http:')) return undefined
    return u.username || u.password ? undefined : u.toString()
  } catch { return undefined }
}

type El = Extract<HtmlNode, { t: 'el' }>

export function parseTutorialHtml(html: string): HtmlNode[] {
  const src = html.replace(/<!--[\s\S]*?-->/g, '').replace(/<(script|style|iframe|object|embed)\b[\s\S]*?<\/\1\s*>/gi, '')
  const root: El = { t: 'el', tag: '', kids: [] }
  const stack: El[] = [root]
  const top = () => stack[stack.length - 1] as El
  const inPre = () => stack.some((n) => n.tag === 'pre')
  const text = (raw: string) => {
    const s = decode(inPre() ? raw : raw.replace(/\s+/g, ' '))
    if (s) top().kids.push({ t: 'text', s })
  }
  const pop = () => { const n = stack.pop() as El; top().kids.push(n) }
  const re = /<(\/?)([a-z][a-z0-9]*)\b((?:"[^"]*"|'[^']*'|[^'">])*)>/gi
  let last = 0
  for (let m = re.exec(src); m; m = re.exec(src)) {
    if (m.index > last) text(src.slice(last, m.index))
    last = re.lastIndex
    const close = m[1]
    const tag = (m[2] ?? '').toLowerCase()
    const raw = m[3] ?? ''
    if (close) {
      const i = stack.map((n) => n.tag).lastIndexOf(tag)
      while (i > 0 && stack.length > i) pop()
    } else if (tag === 'br' || tag === 'hr') {
      top().kids.push({ t: 'el', tag, kids: [] })
    } else if (tag === 'img') {
      const s = safeHttp(attr(raw, 'src'), true)
      if (s) top().kids.push({ t: 'el', tag, kids: [], src: s, alt: attr(raw, 'alt') ?? '' })
    } else if (TAGS.has(tag)) {
      const el: El = { t: 'el', tag, kids: [] }
      if (tag === 'a') { const h = safeHttp(attr(raw, 'href')); if (h) el.href = h }
      stack.push(el)
    } // balise inconnue : jetée, son contenu reste
  }
  if (last < src.length) text(src.slice(last))
  while (stack.length > 1) pop()
  return root.kids
}
