// Contenu des tutoriels (HTML du site tuto) rendu SANS innerHTML : la CSP impose Trusted Types, qui
// refuse tout HTML à balises, et aucun assainisseur n'est embarqué. On lit donc un sous-ensemble fixe
// de balises (celles que le site tuto autorise déjà) et on construit des éléments React : texte
// échappé par React, aucun attribut hors href (http/https) et src d'image (https), tout le reste est jeté.
import { createElement, type ReactNode } from 'react'
import { isSafeUrl } from '../../utils/safeUrl.ts'

const TAGS = new Set(['h2', 'h3', 'h4', 'p', 'strong', 'em', 's', 'u', 'ul', 'ol', 'li', 'blockquote', 'pre', 'code', 'a'])
const VOID = new Set(['br', 'hr', 'img'])
const NAMED: Record<string, string> = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: ' ' }

const decode = (t: string) => t.replace(/&(#x[0-9a-f]+|#\d+|[a-z]+);/gi, (m, e: string) => {
  if (e[0] !== '#') return NAMED[e.toLowerCase()] ?? m
  const cp = e[1].toLowerCase() === 'x' ? parseInt(e.slice(2), 16) : parseInt(e.slice(1), 10)
  try { return cp > 0 && cp <= 0x10ffff ? String.fromCodePoint(cp) : m } catch { return m }
})

const attr = (raw: string, name: string): string | undefined => {
  const m = new RegExp(String.raw`(?:^|\s)${name}\s*=\s*(?:"([^"]*)"|'([^']*)')`, 'i').exec(raw)
  return m ? decode(m[1] ?? m[2]) : undefined
}

interface Node { tag: string; props: Record<string, string>; kids: ReactNode[] }

export function htmlToReact(html: string): ReactNode[] {
  const src = html.replace(/<!--[\s\S]*?-->/g, '').replace(/<(script|style|iframe|object|embed)\b[\s\S]*?<\/\1\s*>/gi, '')
  const root: Node = { tag: '', props: {}, kids: [] }
  const stack: Node[] = [root]
  let key = 0
  const emit = (n: Node): ReactNode => createElement(n.tag, { ...n.props, key: key++ }, ...(VOID.has(n.tag) ? [] : n.kids))
  const top = () => stack[stack.length - 1]
  const re = /<(\/?)([a-z][a-z0-9]*)\b((?:"[^"]*"|'[^']*'|[^'">])*)>/gi
  let last = 0
  for (let m = re.exec(src); m; m = re.exec(src)) {
    if (m.index > last) top().kids.push(decode(src.slice(last, m.index)))
    last = re.lastIndex
    const [, close, name0, raw] = m
    const tag = name0.toLowerCase()
    if (close) {
      const i = stack.map(n => n.tag).lastIndexOf(tag)
      while (i > 0 && stack.length > i) { const n = stack.pop()!; top().kids.push(emit(n)) }
    } else if (tag === 'br' || tag === 'hr') {
      top().kids.push(emit({ tag, props: {}, kids: [] }))
    } else if (tag === 'img') {
      const s = attr(raw, 'src')
      if (s && s.startsWith('https://') && isSafeUrl(s)) {
        top().kids.push(emit({ tag, props: { src: s, alt: attr(raw, 'alt') ?? '', loading: 'lazy', referrerPolicy: 'no-referrer', className: 'max-w-full h-auto rounded-lg my-3' }, kids: [] }))
      }
    } else if (TAGS.has(tag)) {
      const props: Record<string, string> = {}
      if (tag === 'a') {
        const h = attr(raw, 'href')
        if (h && isSafeUrl(h)) Object.assign(props, { href: h, target: '_blank', rel: 'noopener noreferrer nofollow' })
      }
      stack.push({ tag, props, kids: [] })
    } // balise inconnue : jetée, son contenu reste
  }
  if (last < src.length) top().kids.push(decode(src.slice(last)))
  while (stack.length > 1) { const n = stack.pop()!; top().kids.push(emit(n)) }
  return root.kids
}
