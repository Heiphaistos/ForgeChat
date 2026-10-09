// Thème 4 : onglets par groupe, segments de rubriques, bouton « Sources & ordre » (molette).
import { Ionicons } from '@expo/vector-icons'
import { useState } from 'react'
import { Pressable, ScrollView, Text, View } from 'react-native'
import { colors, font, spacing } from '@/theme'
import { viewCategory, type GroupId } from '../logic'
import { GROUP_COLOR, GROUP_ICON, askMove, type Nav } from '../shared'
import { currentGroup } from './Theme2Chips'

export default function Theme4Tabs({ nav }: { nav: Nav }) {
  const { t, view } = nav
  const [sel, setSel] = useState<GroupId | null>(null)
  const gid = currentGroup(nav) ?? sel
  const group = nav.groups.find((g) => g.id === gid)
  const cat = viewCategory(view)
  const tab = (on: boolean, color: string) => ({ flexDirection: 'row' as const, alignItems: 'center' as const, gap: 6, paddingHorizontal: spacing.md, height: 42, borderBottomWidth: 2, borderColor: on ? color : 'transparent' })
  const topOn = view.kind === 'top' && !sel

  return (
    <View style={{ borderBottomWidth: 1, borderColor: colors.border }}>
      <View style={{ flexDirection: 'row', alignItems: 'center', borderBottomWidth: 1, borderColor: colors.border }}>
        <ScrollView horizontal showsHorizontalScrollIndicator={false} style={{ flex: 1 }}>
          <Pressable style={tab(topOn, colors.primary)} onPress={() => { setSel(null); nav.pick({ kind: 'top' }) }} accessibilityRole="tab" accessibilityState={{ selected: topOn }} accessibilityLabel={t('news.top')}>
            <Ionicons name="flame" size={14} color="#fb923c" />
            <Text style={{ color: topOn ? colors.text : colors.textMuted, fontWeight: topOn ? '700' : '400', fontSize: font.sm }}>{t('news.top')}</Text>
          </Pressable>
          {nav.groups.map((g) => {
            const on = gid === g.id
            return (
              <Pressable key={g.id} style={tab(on, GROUP_COLOR[g.id])} accessibilityRole="tab" accessibilityState={{ selected: on }} accessibilityLabel={t(`news.group.${g.id}`)}
                onPress={() => { setSel(g.id); const first = g.rubrics[0]; if (first && gid !== g.id) nav.pick({ kind: 'category', category: first.cat }) }}>
                <Ionicons name={GROUP_ICON[g.id]} size={14} color={on ? colors.text : colors.textMuted} />
                <Text style={{ color: on ? colors.text : colors.textMuted, fontWeight: on ? '700' : '400', fontSize: font.sm }}>{t(`news.group.${g.id}`)}</Text>
                {g.today > 0 ? (
                  <Text style={{ fontSize: 10, fontWeight: '700', color: '#fff', backgroundColor: on ? GROUP_COLOR[g.id] : colors.bgHover, borderRadius: 999, paddingHorizontal: 6, overflow: 'hidden' }}>{g.today}</Text>
                ) : null}
              </Pressable>
            )
          })}
        </ScrollView>
        <Pressable onPress={nav.openSettings} style={{ margin: spacing.xs, padding: 8, borderRadius: 8, backgroundColor: colors.primary }} accessibilityRole="button" accessibilityLabel={t('news.sourcesOrder')}>
          <Ionicons name="options-outline" size={16} color="#fff" />
        </Pressable>
      </View>
      {group ? (
        <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ gap: 4, padding: spacing.sm }}>
          {group.rubrics.map((r) => {
            const on = cat === r.cat
            return (
              <Pressable key={r.cat} onPress={() => nav.pick({ kind: 'category', category: r.cat })} onLongPress={() => askMove(nav, group.rubrics.map((x) => x.cat), r.cat)}
                style={{ flexDirection: 'row', gap: 4, paddingHorizontal: 12, paddingVertical: 6, borderRadius: 6, backgroundColor: on ? colors.bgHover : 'transparent' }}
                accessibilityRole="button" accessibilityState={{ selected: on }} accessibilityLabel={r.short} accessibilityHint={t('news.reorder')}>
                <Text style={{ color: on ? colors.text : colors.textSecondary, fontWeight: on ? '700' : '400', fontSize: font.sm }}>{r.short}</Text>
                {r.today > 0 ? <Text style={{ color: colors.primary, fontSize: 10, fontWeight: '700' }}>{r.today}</Text> : null}
              </Pressable>
            )
          })}
        </ScrollView>
      ) : null}
    </View>
  )
}
