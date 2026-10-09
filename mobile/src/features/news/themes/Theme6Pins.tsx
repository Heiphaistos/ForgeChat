// Thème 6 (par défaut) : Épinglées (rubriques et sites mélangés, ordre libre) + Dossiers repliables par groupe,
// avec l'onglet YouTube à avatars du thème 8.
import { Ionicons } from '@expo/vector-icons'
import { useState } from 'react'
import { Alert, Pressable, Text, View } from 'react-native'
import type { NewsSite } from '@/api/news'
import { colors, font, spacing } from '@/theme'
import type { Rubric } from '../logic'
import { GROUP_COLOR, GROUP_ICON, Avatar, Avatars, Count, Label, RubricBadge, Segmented, TopButton, isCurrent, movePin, pinToggle, s, type Nav } from '../shared'
import { YouTubeTab } from './Theme8Tabs'

/** Rubrique YouTube épinglée : « YouTube · <thème> » pour la distinguer de la rubrique homonyme. */
const pinName = (r: Rubric) => (r.group === 'youtube' ? `YouTube · ${r.short}` : r.short)

function Pins({ nav }: { nav: Nav }) {
  const { t, prefs } = nav
  const byKey = new Map(nav.rubrics.map((r) => [`c:${r.key}`, r]))
  const byId = new Map(nav.sites.map((x) => [`s:${x.id}`, x]))
  const items = prefs.pins
    .map((id) => [id, byKey.get(id) ?? byId.get(id)] as const)
    .filter((x): x is readonly [string, Rubric | NewsSite] => !!x[1])
  const ids = items.map(([id]) => id)
  const ask = (id: string, name: string) => {
    const i = ids.indexOf(id)
    Alert.alert(name, undefined, [
      { text: t('news.moveTop'), onPress: () => movePin(nav, ids, id, 0) },
      { text: t('news.moveUp'), onPress: () => movePin(nav, ids, id, i - 1) },
      { text: t('news.moveDown'), onPress: () => movePin(nav, ids, id, i + 1) },
      { text: t('news.unpin'), style: 'destructive', onPress: () => pinToggle(nav, id) },
      { text: t('common.cancel'), style: 'cancel' },
    ])
  }
  return (
    <>
      <Label right={items.length > 1 ? t('news.longPressSort') : undefined}>{t('news.pinned')}</Label>
      {!items.length ? <Text style={[s.muted, { paddingHorizontal: spacing.sm, fontSize: font.xs }]}>{t('news.pinHint')}</Text> : null}
      {items.map(([id, x]) => {
        const on = isCurrent(nav.view, x)
        const name = 'cat' in x ? pinName(x) : x.name
        return (
          <View key={id} style={[s.row, { paddingVertical: 0 }, on && { backgroundColor: colors.bgHover }]}>
            <Pressable
              style={{ flex: 1, flexDirection: 'row', alignItems: 'center', gap: spacing.sm, paddingVertical: 10 }}
              onPress={() => nav.pick('cat' in x ? { kind: 'category', category: x.cat } : { kind: 'site', site: x })}
              onLongPress={() => ask(id, name)}
              accessibilityRole="button"
              accessibilityLabel={name}
              accessibilityHint={t('news.reorder')}
            >
              {'cat' in x ? <RubricBadge r={x} size={22} /> : <Avatar name={x.name} size={22} />}
              <Text style={[s.rowText, on && { color: colors.text }]} numberOfLines={1}>{name}</Text>
              <Count n={x.today} />
            </Pressable>
            <Pressable onPress={() => pinToggle(nav, id)} hitSlop={8} style={{ padding: 6 }} accessibilityRole="button" accessibilityLabel={`${t('news.unpin')} ${name}`}>
              <Ionicons name="close" size={14} color={colors.textMuted} />
            </Pressable>
          </View>
        )
      })}
    </>
  )
}

function Folders({ nav }: { nav: Nav }) {
  const { t } = nav
  return (
    <>
      <Label>{t('news.folders')}</Label>
      <View style={{ gap: 6 }}>
        {nav.groups.map((g) => {
          const id = `g:${g.id}`
          const open = !nav.isFolded(id, true)
          return (
            <View key={g.id} style={[s.card, { overflow: 'hidden', backgroundColor: 'transparent' }]}>
              <Pressable onPress={() => nav.toggleFold(id, true)} style={{ flexDirection: 'row', alignItems: 'center', gap: spacing.sm, padding: 10 }}
                accessibilityRole="button" accessibilityLabel={t(`news.group.${g.id}`)} accessibilityState={{ expanded: open }}>
                <Ionicons name={GROUP_ICON[g.id]} size={16} color={GROUP_COLOR[g.id]} />
                <Text style={{ flex: 1, color: colors.text, fontWeight: '700', fontSize: font.sm }} numberOfLines={1}>{t(`news.group.${g.id}`)}</Text>
                <Text style={[s.muted, { fontSize: 10 }]}>{t('news.nRubrics', { n: g.rubrics.length })}</Text>
                <Count n={g.today} />
                <Ionicons name={open ? 'chevron-down' : 'chevron-forward'} size={14} color={colors.textMuted} />
              </Pressable>
              {open
                ? g.rubrics.map((r) => {
                    const pinned = nav.prefs.pins.includes(`c:${r.key}`)
                    return (
                      <View key={r.cat} style={{ flexDirection: 'row', alignItems: 'center', borderLeftWidth: 2, borderColor: GROUP_COLOR[g.id], backgroundColor: isCurrent(nav.view, r) ? colors.bgHover : 'transparent' }}>
                        <Pressable onPress={() => nav.pick({ kind: 'category', category: r.cat })} style={{ flex: 1, flexDirection: 'row', alignItems: 'center', gap: spacing.sm, paddingLeft: 10, paddingVertical: 10 }}
                          accessibilityRole="button" accessibilityLabel={r.today ? `${r.short}, ${t('news.nToday', { n: r.today })}` : r.short}>
                          <Text style={[s.rowText, { fontSize: font.sm }]} numberOfLines={1}>{r.short}</Text>
                          <Avatars sites={r.sites} n={3} size={16} />
                          <Text style={{ width: 26, textAlign: 'right', color: colors.primary, fontSize: 10, fontWeight: '700' }}>{r.today || ''}</Text>
                        </Pressable>
                        <Pressable onPress={() => pinToggle(nav, `c:${r.key}`)} hitSlop={6} style={{ padding: 8 }}
                          accessibilityRole="button" accessibilityState={{ selected: pinned }} accessibilityLabel={`${pinned ? t('news.unpin') : t('news.pin')} ${r.short}`}>
                          <Ionicons name={pinned ? 'pin' : 'pin-outline'} size={14} color={pinned ? colors.primary : colors.textMuted} />
                        </Pressable>
                      </View>
                    )
                  })
                : null}
            </View>
          )
        })}
      </View>
    </>
  )
}

export default function Theme6Pins({ nav }: { nav: Nav }) {
  const { t } = nav
  const [tab, setTab] = useState<'folders' | 'youtube'>('folders')
  return (
    <View style={{ padding: spacing.sm, gap: 4 }}>
      <TopButton nav={nav} />
      <Segmented value={tab} onChange={setTab} items={[['folders', t('news.rubrics')], ['youtube', 'YouTube', true]]} />
      {tab === 'folders' ? <><Pins nav={nav} /><Folders nav={nav} /></> : <View style={{ paddingTop: 4 }}><YouTubeTab nav={nav} /></View>}
    </View>
  )
}
