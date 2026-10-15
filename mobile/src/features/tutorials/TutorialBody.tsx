import { Image } from 'expo-image'
import { useState, type ReactNode } from 'react'
import { StyleSheet, Text, View, type TextStyle } from 'react-native'
import { openExternalUrl } from '@/lib/links'
import { colors, font, radius, spacing } from '@/theme'
import type { HtmlNode } from './html'

// Rendu natif de l'arbre produit par parseTutorialHtml : que des <Text>/<View>/<Image>, jamais de WebView.

const INLINE: Record<string, TextStyle> = {
  strong: { fontWeight: '700' },
  em: { fontStyle: 'italic' },
  s: { textDecorationLine: 'line-through' },
  u: { textDecorationLine: 'underline' },
  code: { fontFamily: 'monospace', backgroundColor: colors.bgAlt, fontSize: font.sm },
}
const BLOCK = new Set(['h2', 'h3', 'h4', 'p', 'ul', 'ol', 'blockquote', 'pre', 'hr', 'img'])
const blank = (n: HtmlNode) => n.t === 'text' && !n.s.trim()

function TutorialImage({ src, alt }: { src: string; alt: string }) {
  const [ratio, setRatio] = useState(16 / 9)
  return (
    <Image
      source={{ uri: src }}
      contentFit="contain"
      accessibilityLabel={alt || undefined}
      accessible={!!alt}
      onLoad={(e) => { const { width, height } = e.source; if (width && height) setRatio(width / height) }}
      style={[styles.img, { aspectRatio: ratio }]}
    />
  )
}

function inline(nodes: HtmlNode[]): ReactNode[] {
  return nodes.map((n, i) => {
    if (n.t === 'text') return n.s
    if (n.tag === 'br') return '\n'
    if (n.tag === 'a') {
      const href = n.href
      return (
        <Text key={i} style={href ? styles.link : undefined} accessibilityRole={href ? 'link' : undefined} onPress={href ? () => void openExternalUrl(href) : undefined}>
          {inline(n.kids)}
        </Text>
      )
    }
    if (BLOCK.has(n.tag)) return <Text key={i}>{inline(n.kids)}</Text> // bloc imbriqué dans un en-ligne : aplati
    return <Text key={i} style={INLINE[n.tag]}>{inline(n.kids)}</Text>
  })
}

/** Regroupe les noeuds en-ligne consécutifs d'un conteneur en paragraphes ; les blocs restent seuls. */
function blocks(nodes: HtmlNode[], keyBase = ''): ReactNode[] {
  const out: ReactNode[] = []
  let run: HtmlNode[] = []
  const flush = () => {
    if (run.some((n) => !blank(n))) out.push(<Text key={`${keyBase}r${out.length}`} style={styles.p}>{inline(run)}</Text>)
    run = []
  }
  nodes.forEach((n, i) => {
    if (n.t === 'text' || !BLOCK.has(n.tag)) { run.push(n); return }
    flush()
    const key = `${keyBase}${i}`
    const kids = n.kids
    switch (n.tag) {
      case 'h2': case 'h3': case 'h4':
        out.push(<Text key={key} accessibilityRole="header" style={styles[n.tag]}>{inline(kids)}</Text>)
        break
      case 'p':
        if (kids.some((k) => k.t === 'el' && (k.tag === 'img' || k.tag === 'ul' || k.tag === 'ol' || k.tag === 'pre'))) out.push(...blocks(kids, key))
        else if (kids.some((k) => !blank(k))) out.push(<Text key={key} style={styles.p}>{inline(kids)}</Text>)
        break
      case 'ul': case 'ol': {
        const items = kids.filter((k): k is Extract<HtmlNode, { t: 'el' }> => k.t === 'el' && k.tag === 'li')
        out.push(
          <View key={key} style={styles.list}>
            {items.map((li, j) => (
              <View key={j} style={styles.li}>
                <Text style={styles.bullet}>{n.tag === 'ol' ? `${j + 1}.` : '•'}</Text>
                <View style={{ flex: 1, gap: spacing.xs }}>{blocks(li.kids, `${key}.${j}.`)}</View>
              </View>
            ))}
          </View>,
        )
        break
      }
      case 'blockquote':
        out.push(<View key={key} style={styles.quote}>{blocks(kids, `${key}.`)}</View>)
        break
      case 'pre': {
        const code = flatText(kids).replace(/^\n/, '').replace(/\n$/, '')
        out.push(<View key={key} style={styles.pre}><Text selectable style={styles.preText}>{code}</Text></View>)
        break
      }
      case 'hr':
        out.push(<View key={key} style={styles.hr} />)
        break
      case 'img':
        if (n.src) out.push(<TutorialImage key={key} src={n.src} alt={n.alt ?? ''} />)
        break
    }
  })
  flush()
  return out
}

/** Texte brut d'un sous-arbre (bloc de code : balises internes ignorées). */
export function flatText(nodes: HtmlNode[]): string {
  return nodes.map((n) => (n.t === 'text' ? n.s : n.tag === 'br' ? '\n' : flatText(n.kids))).join('')
}

export function TutorialBody({ nodes }: { nodes: HtmlNode[] }) {
  return <View style={{ gap: spacing.md }}>{blocks(nodes)}</View>
}

const styles = StyleSheet.create({
  p: { color: colors.text, fontSize: font.md, lineHeight: Math.round(font.md * 1.5) },
  h2: { color: colors.text, fontSize: font.xl, fontWeight: '800', marginTop: spacing.md },
  h3: { color: colors.text, fontSize: font.lg, fontWeight: '700', marginTop: spacing.sm },
  h4: { color: colors.text, fontSize: font.md, fontWeight: '700', marginTop: spacing.xs },
  link: { color: colors.primary, textDecorationLine: 'underline' },
  list: { gap: spacing.xs },
  li: { flexDirection: 'row', gap: spacing.sm, paddingLeft: spacing.sm },
  bullet: { color: colors.textMuted, fontSize: font.md, minWidth: 18, lineHeight: Math.round(font.md * 1.5) },
  quote: { borderLeftWidth: 3, borderLeftColor: colors.primary, paddingLeft: spacing.md, gap: spacing.xs },
  pre: { backgroundColor: colors.bgDeep, borderRadius: radius.md, padding: spacing.md },
  preText: { color: colors.text, fontFamily: 'monospace', fontSize: font.sm },
  hr: { height: 1, backgroundColor: colors.bgHover, marginVertical: spacing.sm },
  img: { width: '100%', borderRadius: radius.md, backgroundColor: colors.bgAlt },
})
