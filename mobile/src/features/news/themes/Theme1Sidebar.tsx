// Thème 1 : barre à deux niveaux — groupes colorés > rubriques repliables > sites (feuille du bas au téléphone).
import { Ionicons } from '@expo/vector-icons'
import { useState } from 'react'
import { Pressable, Text, View } from 'react-native'
import { colors, spacing } from '@/theme'
import type { Rubric } from '../logic'
import { GROUP_COLOR, GROUP_ICON, Count, SiteRow, TopButton, askMove, isCurrent, s, type Nav } from '../shared'

const SHOWN = 5

/** Sites d'une rubrique : les premiers, puis « + N autres sources ». */
export function SiteList({ nav, r, indent = spacing.xl }: { nav: Nav; r: Rubric; indent?: number }) {
  const [all, setAll] = useState(false)
  return (
    <>
      {(all ? r.sites : r.sites.slice(0, SHOWN)).map((x) => <SiteRow key={x.id} nav={nav} site={x} indent={indent} />)}
      {r.sites.length > SHOWN ? (
        <Pressable onPress={() => setAll(!all)} style={{ paddingLeft: indent + spacing.sm, paddingVertical: 6 }} accessibilityRole="button">
          <Text style={{ color: colors.primary, fontSize: 13 }}>{all ? nav.t('news.less') : nav.t('news.moreSources', { n: r.sites.length - SHOWN })}</Text>
        </Pressable>
      ) : null}
    </>
  )
}

/** En-tête de groupe repliable (thèmes 1 et 9). */
export function GroupHeader({ nav, id, open, today, chevron }: { nav: Nav; id: Rubric['group']; open: boolean; today: number; chevron?: boolean }) {
  const label = nav.t(`news.group.${id}`)
  return (
    <Pressable onPress={() => nav.toggleFold(`g:${id}`, false)} style={s.groupHead} accessibilityRole="button" accessibilityLabel={label} accessibilityState={{ expanded: open }}>
      {chevron ? <Ionicons name={open ? 'chevron-down' : 'chevron-forward'} size={12} color={colors.textMuted} /> : null}
      <View style={[s.groupBar, { backgroundColor: GROUP_COLOR[id] }]} />
      <Ionicons name={GROUP_ICON[id]} size={13} color={colors.textMuted} />
      <Text style={s.groupText} numberOfLines={1}>{label}</Text>
      {today > 0 ? <Text style={s.labelRight}>{nav.t('news.todayShort', { n: today })}</Text> : null}
    </Pressable>
  )
}

export default function Theme1Sidebar({ nav }: { nav: Nav }) {
  return (
    <View style={{ padding: spacing.sm }}>
      <TopButton nav={nav} />
      {nav.groups.map((g) => {
        const open = !nav.isFolded(`g:${g.id}`, false)
        const cats = g.rubrics.map((r) => r.cat)
        return (
          <View key={g.id} style={{ paddingTop: spacing.sm }}>
            <GroupHeader nav={nav} id={g.id} open={open} today={g.today} />
            {open
              ? g.rubrics.map((r) => {
                  const ropen = !nav.isFolded(r.key, true)
                  const on = isCurrent(nav.view, r)
                  return (
                    <View key={r.cat}>
                      <View style={[s.row, { paddingVertical: 0 }, on && { backgroundColor: colors.bgHover }]}>
                        <Pressable onPress={() => nav.toggleFold(r.key, true)} hitSlop={8} style={{ paddingVertical: 10 }} accessibilityRole="button" accessibilityLabel={r.short} accessibilityState={{ expanded: ropen }}>
                          <Ionicons name={ropen ? 'chevron-down' : 'chevron-forward'} size={14} color={colors.textMuted} />
                        </Pressable>
                        <Pressable
                          style={{ flex: 1, flexDirection: 'row', alignItems: 'center', gap: spacing.sm, paddingVertical: 10 }}
                          onPress={() => nav.pick({ kind: 'category', category: r.cat })}
                          onLongPress={() => askMove(nav, cats, r.cat)}
                          accessibilityRole="button"
                          accessibilityLabel={`${r.short}, ${nav.t('news.nSources', { n: r.sites.length })}`}
                          accessibilityHint={nav.t('news.reorder')}
                        >
                          <Text style={[s.rowText, on && { color: colors.text }]} numberOfLines={1}>{r.short}</Text>
                          <Text style={s.labelRight}>{r.sites.length}</Text>
                          <Count n={r.today} />
                        </Pressable>
                      </View>
                      {ropen ? <SiteList nav={nav} r={r} /> : null}
                    </View>
                  )
                })
              : null}
          </View>
        )
      })}
    </View>
  )
}
