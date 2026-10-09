// Briques communes aux thèmes de navigation des Actualités (téléphone) : données rangées selon les
// préférences du compte, icônes, pastilles, lignes, réordonnancement par appui long.
import { Ionicons } from '@expo/vector-icons'
import { useQuery } from '@tanstack/react-query'
import { useCallback, useMemo, type ReactNode } from 'react'
import { Alert, Pressable, StyleSheet, Text, View } from 'react-native'
import { newsApi, newsCategoryKey, type NewsSite } from '@/api/news'
import type { IconName } from '@/components/ui'
import { useT } from '@/i18n'
import { colors, font, outline, radius, spacing } from '@/theme'
import { buildNews, keyMatches, moveItem, moveWithin, shortName, togglePin, type GroupId, type NewsPrefs, type Rubric, type View as NewsView } from './logic'
import { useNewsPrefs } from './prefs'

/** Sites, rubriques et groupes rangés selon les préférences ; actions qui les modifient. */
export function useNewsData() {
  const t = useT()
  const q = useQuery({ queryKey: ['news'], queryFn: newsApi.sites, refetchInterval: 120_000 })
  const prefs = useNewsPrefs((s) => s.prefs)
  const update = useNewsPrefs((s) => s.update)
  const { rubrics, groups, visible } = useMemo(() => buildNews(q.data ?? [], prefs.order, prefs.muted), [q.data, prefs.order, prefs.muted])
  const move = useCallback(
    (subset: string[], cat: string, to: number) => update({ order: moveWithin(rubrics.map((r) => r.cat), subset, cat, to).map(newsCategoryKey) }),
    [rubrics, update],
  )
  const isFolded = useCallback((id: string, dflt: boolean) => prefs.folded[id] ?? dflt, [prefs.folded])
  const toggleFold = useCallback((id: string, dflt: boolean) => update({ folded: { ...prefs.folded, [id]: !(prefs.folded[id] ?? dflt) } }), [prefs.folded, update])
  return { t, q, all: q.data ?? [], prefs, update, rubrics, groups, sites: visible, move, isFolded, toggleFold }
}

/** Ce que chaque thème reçoit : données rangées, vue courante et réglages. */
export interface Nav extends Omit<ReturnType<typeof useNewsData>, 'q' | 'all'> {
  view: NewsView
  pick: (v: NewsView) => void
  openSettings: () => void
}

export const isCurrent = (v: NewsView, r: { cat: string } | NewsSite) =>
  'id' in r ? v.kind === 'site' && v.site.id === r.id : v.kind === 'category' && v.category === r.cat
export const pinToggle = (nav: { prefs: NewsPrefs; update: Nav['update'] }, id: string) => nav.update({ pins: togglePin(nav.prefs.pins, id) })
export const movePin = (nav: { prefs: NewsPrefs; update: Nav['update'] }, shown: string[], id: string, to: number) =>
  // Les épinglées introuvables (site coupé, rubrique disparue) restent mémorisées, en fin de liste.
  nav.update({ pins: [...moveItem(shown, id, to), ...nav.prefs.pins.filter((p) => !shown.includes(p))] })

/** Appui long : monter / descendre une rubrique parmi `subset` (le tactile n'a pas de glisser-déposer). */
export function askMove(nav: Pick<Nav, 't' | 'move'>, subset: string[], cat: string) {
  const i = subset.indexOf(cat)
  if (i < 0 || subset.length < 2) return
  const { t } = nav
  Alert.alert(shortName(cat), t('news.reorder'), [
    { text: t('news.moveTop'), onPress: () => nav.move(subset, cat, 0) },
    { text: t('news.moveUp'), onPress: () => nav.move(subset, cat, i - 1) },
    { text: t('news.moveDown'), onPress: () => nav.move(subset, cat, i + 1) },
    { text: t('common.cancel'), style: 'cancel' },
  ])
}

/** Accents de groupe (seules couleurs fixes de la page). */
export const GROUP_COLOR: Record<GroupId, string> = {
  tech: '#5865f2', societe: '#3ba55c', divert: '#eb459e', youtube: '#ed4245', bonsplans: '#faa81a', autres: colors.textMuted,
}
export const GROUP_ICON: Record<GroupId, IconName> = {
  tech: 'hardware-chip-outline', societe: 'globe-outline', divert: 'film-outline', youtube: 'logo-youtube', bonsplans: 'pricetag-outline', autres: 'folder-outline',
}
const ICONS: [string, IconName][] = [
  ['informatique', 'desktop-outline'], ['securite', 'shield-outline'], ['ia', 'sparkles-outline'], ['presse', 'newspaper-outline'],
  ['actualite', 'globe-outline'], ['actu', 'globe-outline'], ['sciences', 'flask-outline'], ['sport', 'trophy-outline'],
  ['jeux', 'game-controller-outline'], ['film', 'film-outline'], ['serie', 'tv-outline'], ['manga', 'book-outline'],
  ['musique', 'musical-notes-outline'], ['bon plan', 'pricetag-outline'], ['divertissement', 'happy-outline'], ['cuisine', 'restaurant-outline'],
]
export function rubricIcon(cat: string): IconName {
  const k = newsCategoryKey(shortName(cat))
  return ICONS.find(([p]) => keyMatches(k, p))?.[1] ?? 'newspaper-outline'
}

/** Icône de rubrique sur fond de la couleur de son groupe (tuiles, épinglées). */
export function RubricBadge({ r, size = 28 }: { r: Pick<Rubric, 'cat' | 'group'>; size?: number }) {
  return (
    <View style={[s.badge, { width: size, height: size, backgroundColor: GROUP_COLOR[r.group] }]}>
      <Ionicons name={rubricIcon(r.cat)} size={Math.round(size * 0.55)} color="#fff" />
    </View>
  )
}

const hue = (str: string) => [...str].reduce((h, c) => (h * 31 + c.charCodeAt(0)) % 360, 7)
/** Pastille de site : initiale sur une teinte stable (pas d'image de chaîne côté serveur). */
export function Avatar({ name, size = 22 }: { name: string; size?: number }) {
  return (
    <View style={[s.avatar, { width: size, height: size, borderRadius: size / 2, backgroundColor: `hsl(${hue(name)}, 45%, 32%)` }]} accessible={false}>
      <Text style={{ color: '#fff', fontWeight: '700', fontSize: Math.max(9, Math.round(size * 0.45)) }}>{name.trim().charAt(0).toUpperCase()}</Text>
    </View>
  )
}
export function Avatars({ sites, n = 3, size = 18 }: { sites: NewsSite[]; n?: number; size?: number }) {
  return (
    <View style={{ flexDirection: 'row' }}>
      {sites.slice(0, n).map((x, i) => (
        <View key={x.id} style={{ marginLeft: i ? -size / 3 : 0 }}><Avatar name={x.name} size={size} /></View>
      ))}
    </View>
  )
}

/** Compteur d'articles du jour (rien si zéro). */
export function Count({ n, muted }: { n: number; muted?: boolean }) {
  if (!n) return null
  return <Text style={[s.count, muted && s.countMuted]}>{n}</Text>
}

/** Petit titre de section en capitales. */
export function Label({ children, right }: { children: ReactNode; right?: ReactNode }) {
  return (
    <View style={s.label}>
      <Text style={s.labelText} numberOfLines={1}>{children}</Text>
      {right ? <Text style={s.labelRight}>{right}</Text> : null}
    </View>
  )
}

/** Boutons ↑↓ (réordonner). */
export function UpDown({ label, onUp, onDown }: { label: string; onUp?: () => void; onDown?: () => void }) {
  const t = useT()
  const b = (icon: IconName, fn: (() => void) | undefined, a11y: string) => (
    <Pressable onPress={fn} disabled={!fn} hitSlop={4} style={[s.ud, !fn && { opacity: 0.3 }]} accessibilityRole="button" accessibilityLabel={`${label} : ${a11y}`} accessibilityState={{ disabled: !fn }}>
      <Ionicons name={icon} size={14} color={colors.textMuted} />
    </Pressable>
  )
  return <View style={{ flexDirection: 'row', gap: 4 }}>{b('chevron-up', onUp, t('news.moveUp'))}{b('chevron-down', onDown, t('news.moveDown'))}</View>
}

/** Sélecteur d'onglets segmenté. */
export function Segmented<T extends string>({ value, onChange, items }: { value: T; onChange: (v: T) => void; items: [T, string, boolean?][] }) {
  return (
    <View style={s.seg} accessibilityRole="tablist">
      {items.map(([v, label, yt]) => (
        <Pressable key={v} onPress={() => onChange(v)} style={[s.segItem, value === v && { backgroundColor: colors.bgHover }]} accessibilityRole="tab" accessibilityState={{ selected: value === v }} accessibilityLabel={label}>
          {yt ? <Ionicons name="logo-youtube" size={14} color={GROUP_COLOR.youtube} /> : null}
          <Text style={[s.segText, value === v && { color: colors.text }]} numberOfLines={1}>{label}</Text>
        </Pressable>
      ))}
    </View>
  )
}

/** Ligne de navigation standard, surlignée si courante. */
export function NavRow({ on, onPress, onLongPress, label, children, style }: { on?: boolean; onPress: () => void; onLongPress?: () => void; label: string; children: ReactNode; style?: object }) {
  return (
    <Pressable
      onPress={onPress}
      onLongPress={onLongPress}
      style={({ pressed }) => [s.row, (on || pressed) && { backgroundColor: colors.bgHover }, style]}
      accessibilityRole="button"
      accessibilityLabel={label}
      accessibilityState={{ selected: !!on }}
    >
      {children}
    </Pressable>
  )
}

export function TopButton({ nav }: { nav: Nav }) {
  const on = nav.view.kind === 'top'
  return (
    <NavRow on={on} onPress={() => nav.pick({ kind: 'top' })} label={nav.t('news.top')}>
      <Ionicons name="flame" size={18} color="#fb923c" />
      <Text style={[s.rowText, { fontWeight: '700' }]}>{nav.t('news.top')}</Text>
    </NavRow>
  )
}

/** Ligne d'un site : pastille, nom, articles du jour. */
export function SiteRow({ nav, site, indent = 0, size = 22 }: { nav: Nav; site: NewsSite; indent?: number; size?: number }) {
  const on = isCurrent(nav.view, site)
  return (
    <NavRow on={on} onPress={() => nav.pick({ kind: 'site', site })} label={site.today ? nav.t('news.siteToday', { name: site.name, n: site.today }) : site.name} style={{ paddingLeft: spacing.sm + indent }}>
      <Avatar name={site.name} size={size} />
      <Text style={[s.rowText, on && { color: colors.text }]} numberOfLines={1}>{site.name}</Text>
      <Count n={site.today} muted />
    </NavRow>
  )
}

/** Puce (thèmes 2 et 4). */
export function Chip({ on, color, onPress, onLongPress, label, children }: { on: boolean; color?: string; onPress: () => void; onLongPress?: () => void; label: string; children: ReactNode }) {
  return (
    <Pressable
      onPress={onPress}
      onLongPress={onLongPress}
      style={[s.chip, on && { borderColor: color ?? colors.primary, backgroundColor: color ?? colors.bgHover }]}
      accessibilityRole="button"
      accessibilityLabel={label}
      accessibilityState={{ selected: on }}
    >
      {children}
    </Pressable>
  )
}

export const s = StyleSheet.create({
  badge: { borderRadius: radius.sm, alignItems: 'center', justifyContent: 'center' },
  avatar: { alignItems: 'center', justifyContent: 'center', borderWidth: 1, borderColor: colors.bgAlt },
  count: { color: '#fff', backgroundColor: colors.primary, borderRadius: radius.full, fontSize: font.xs, fontWeight: '700', paddingHorizontal: 6, overflow: 'hidden', minWidth: 20, textAlign: 'center' },
  countMuted: { color: colors.primary, backgroundColor: 'transparent' },
  label: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: spacing.sm, paddingHorizontal: spacing.sm, paddingTop: spacing.md, paddingBottom: spacing.xs },
  labelText: { flexShrink: 1, color: colors.textMuted, fontSize: font.xs, fontWeight: '700', textTransform: 'uppercase' },
  labelRight: { color: colors.textMuted, fontSize: font.xs },
  ud: { width: 28, height: 28, borderRadius: radius.sm, backgroundColor: colors.bgHover, alignItems: 'center', justifyContent: 'center' },
  seg: { flexDirection: 'row', padding: 2, borderRadius: radius.md, borderWidth: 1, borderColor: colors.border, backgroundColor: colors.bg },
  segItem: { flex: 1, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 4, paddingVertical: 8, borderRadius: radius.sm },
  segText: { color: colors.textMuted, fontSize: font.sm, fontWeight: '600' },
  row: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm, paddingHorizontal: spacing.sm, paddingVertical: 10, borderRadius: radius.sm },
  rowText: { flex: 1, color: colors.textSecondary, fontSize: font.md },
  chip: { flexDirection: 'row', alignItems: 'center', gap: 6, paddingHorizontal: 12, paddingVertical: 6, borderRadius: radius.full, borderWidth: 1, borderColor: colors.border, backgroundColor: colors.bgAlt },
  chipText: { color: colors.textSecondary, fontSize: font.sm },
  card: { backgroundColor: colors.bgAlt, borderRadius: radius.md, borderWidth: StyleSheet.hairlineWidth, borderColor: colors.border, ...outline },
  muted: { color: colors.textMuted, fontSize: font.sm },
  groupHead: { flexDirection: 'row', alignItems: 'center', gap: 6, paddingHorizontal: spacing.xs, paddingVertical: 6 },
  groupBar: { width: 3, height: 14, borderRadius: 2 },
  groupText: { flex: 1, color: colors.textMuted, fontSize: font.xs, fontWeight: '700', textTransform: 'uppercase' },
})
