// Aperçu schématique d'un thème de navigation des Actualités (quelques blocs aux couleurs du thème de l'app).
import type { ReactNode } from 'react'
import { StyleSheet, View, type ViewStyle } from 'react-native'
import { colors } from '@/theme'
import type { ThemeId } from './logic'

const p = StyleSheet.create({
  frame: { flexDirection: 'row', height: 48, borderRadius: 6, borderWidth: 1, borderColor: colors.bgHover, backgroundColor: colors.bg, overflow: 'hidden' },
  block: { borderRadius: 1, backgroundColor: colors.bgHover },
  accent: { backgroundColor: colors.primary, opacity: 0.75 },
  cards: { flex: 1, flexDirection: 'row', flexWrap: 'wrap', gap: 2, padding: 2 },
  card: { width: '47%', height: '45%' },
  tile: { width: '22%', height: 12 },
  side: { gap: 2, padding: 2, borderRightWidth: 1, borderColor: colors.bgHover },
  col: { flex: 1, gap: 2, padding: 2 },
  tabs: { flexDirection: 'row', gap: 4, padding: 2, borderBottomWidth: 1, borderColor: colors.bgHover },
})

const b = (style: ViewStyle, k?: number) => <View key={k} style={[p.block, style]} />
const a = (style: ViewStyle, k?: number) => <View key={k} style={[p.block, p.accent, style]} />
const dot = (on: boolean, k: number, size = 7) => <View key={k} style={{ width: size, height: size, borderRadius: size / 2, backgroundColor: on ? colors.primary : colors.bgHover }} />
const cards = <View style={p.cards}>{[0, 1, 2, 3].map((i) => b(p.card, i))}</View>
const side = (inner: ReactNode, width = 26, extra?: ViewStyle) => <View style={[p.side, { width }, extra]}>{inner}</View>
const row = (inner: ReactNode) => <View style={{ flexDirection: 'row', gap: 2 }}>{inner}</View>
const line = (k: number) => <View key={k} style={{ flexDirection: 'row', alignItems: 'center', gap: 2 }}>{dot(false, 0, 5)}{b({ height: 3, flex: 1 })}</View>

const BODY: Record<ThemeId, ReactNode> = {
  1: <>{side(<>{a({ height: 2, width: 10 })}{b({ height: 3 })}{b({ height: 3, marginLeft: 3 })}{b({ height: 3, marginLeft: 3 })}{a({ height: 2, width: 10, marginTop: 2 })}{b({ height: 3 })}</>)}{cards}</>,
  2: <View style={p.col}>{row(<>{a({ height: 5, width: 14 })}{b({ height: 5, width: 14 })}{b({ height: 5, width: 14 })}</>)}{row(<>{b({ height: 5, width: 18 })}{b({ height: 5, width: 18 })}</>)}{cards}</View>,
  3: <View style={[p.cards, { flexWrap: 'wrap' }]}>{[0, 1, 2, 3, 4, 5, 6, 7].map((i) => (i === 1 ? a(p.tile, i) : b(p.tile, i)))}</View>,
  4: <View style={{ flex: 1 }}><View style={[p.tabs]}>{a({ height: 3, width: 14 })}{b({ height: 3, width: 14 })}{b({ height: 3, width: 14 })}</View>{cards}</View>,
  5: <>{side(<>{[0, 1, 2, 3].map((i) => dot(i === 1, i, 9))}</>, 14, { alignItems: 'center' })}{side(<>{[0, 1, 2, 3].map((i) => b({ height: 3 }, i))}</>)}{cards}</>,
  6: <>{side(<>{b({ height: 3 })}{a({ height: 3 })}{a({ height: 3 })}<View style={{ height: 3 }} />{b({ height: 7 })}{b({ height: 7 })}</>)}{cards}</>,
  7: <View style={p.col}>{a({ height: 5, width: 22 })}<View style={[p.cards, { borderWidth: 1, borderColor: colors.bgHover, borderRadius: 2 }]}>{[0, 1, 2, 3].map((i) => <View key={i} style={{ flex: 1, gap: 2 }}>{b({ height: 2 })}{b({ height: 2 })}{b({ height: 2 })}</View>)}</View></View>,
  8: <>{side(<>{row(<>{b({ height: 3, flex: 1 })}{a({ height: 3, flex: 1 })}{b({ height: 3, flex: 1 })}</>)}{row([0, 1, 2].map((i) => dot(false, i, 5)))}{row([0, 1, 2].map((i) => dot(false, i, 5)))}</>, 30)}{cards}</>,
  9: <>{side(<>{a({ height: 2, width: 10 })}{b({ height: 3 })}{a({ height: 3 })}{b({ height: 3 })}</>, 22)}{side(<>{a({ height: 3 })}{[0, 1, 2, 3].map(line)}</>, 30)}{cards}</>,
  10: <>{side(<>{[0, 1, 2, 3].map((i) => dot(i === 1, i, 9))}</>, 14, { alignItems: 'center' })}{side(<>{a({ height: 3 })}{[0, 1, 2, 3].map(line)}</>, 36)}{cards}</>,
}

export function ThemePreview({ id }: { id: ThemeId }) {
  return <View style={p.frame} accessible={false} importantForAccessibility="no-hide-descendants">{BODY[id]}</View>
}
