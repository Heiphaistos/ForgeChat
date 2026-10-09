// Thème 5 : rail horizontal de rubriques en icônes rondes (comme le rail des serveurs) + sources de la rubrique.
import { Ionicons } from '@expo/vector-icons'
import { useState } from 'react'
import { Pressable, ScrollView, Text, TextInput, View } from 'react-native'
import { colors, font, radius, spacing } from '@/theme'
import { viewCategory } from '../logic'
import { GROUP_COLOR, SiteRow, askMove, isCurrent, rubricIcon, s, type Nav } from '../shared'

export default function Theme5Rail({ nav }: { nav: Nav }) {
  const { t, view } = nav
  const [sel, setSel] = useState<string | null>(null)
  const [filter, setFilter] = useState('')
  const r = nav.rubrics.find((x) => x.cat === (viewCategory(view) ?? sel)) ?? nav.rubrics[0]
  const cats = nav.rubrics.map((x) => x.cat)
  const f = filter.trim().toLowerCase()
  const sites = r ? r.sites.filter((x) => !f || x.name.toLowerCase().includes(f)) : []
  const circle = (on: boolean) => ({ width: 46, height: 46, borderRadius: on ? 16 : 23, alignItems: 'center' as const, justifyContent: 'center' as const, backgroundColor: on ? colors.primary : colors.bgHover })

  return (
    <View>
      <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ alignItems: 'center', gap: spacing.sm, padding: spacing.sm }} style={{ borderBottomWidth: 1, borderColor: colors.border }}>
        <Pressable style={circle(view.kind === 'top')} onPress={() => nav.pick({ kind: 'top' })} accessibilityRole="button" accessibilityLabel={t('news.top')} accessibilityState={{ selected: view.kind === 'top' }}>
          <Ionicons name="flame" size={20} color={view.kind === 'top' ? '#fff' : '#fb923c'} />
        </Pressable>
        {nav.rubrics.map((x, idx) => {
          const on = r?.cat === x.cat && view.kind !== 'top'
          const sep = idx === 0 || nav.rubrics[idx - 1]?.group !== x.group
          return (
            <View key={x.cat} style={{ flexDirection: 'row', alignItems: 'center', gap: spacing.sm }}>
              {sep ? <View style={{ width: 3, height: 24, borderRadius: 2, backgroundColor: GROUP_COLOR[x.group] }} /> : null}
              <Pressable style={circle(on)} onPress={() => { setSel(x.cat); nav.pick({ kind: 'category', category: x.cat }) }} onLongPress={() => askMove(nav, cats, x.cat)}
                accessibilityRole="button" accessibilityLabel={x.today ? `${x.short}, ${t('news.nToday', { n: x.today })}` : x.short} accessibilityState={{ selected: on }} accessibilityHint={t('news.reorder')}>
                <Ionicons name={rubricIcon(x.cat)} size={20} color={on ? '#fff' : colors.textSecondary} />
                {x.group === 'youtube' ? <View style={{ position: 'absolute', top: 0, left: 0, width: 12, height: 8, borderRadius: 2, backgroundColor: GROUP_COLOR.youtube }} /> : null}
                {x.today > 0 ? <Text style={[s.count, { position: 'absolute', bottom: -4, right: -6, fontSize: 9 }]}>{x.today}</Text> : null}
              </Pressable>
            </View>
          )
        })}
      </ScrollView>
      {r ? (
        <View style={{ padding: spacing.sm, gap: spacing.sm }}>
          <View style={{ flexDirection: 'row', alignItems: 'center', gap: spacing.sm }}>
            <Ionicons name={rubricIcon(r.cat)} size={18} color={colors.text} />
            <Text style={{ flex: 1, color: colors.text, fontWeight: '700', fontSize: font.lg }} numberOfLines={1} accessibilityRole="header">{r.short}</Text>
          </View>
          <Text style={[s.muted, { fontSize: font.xs }]}>{t(`news.group.${r.group}`)} · {t('news.nSources', { n: r.sites.length })} · {t('news.nToday', { n: r.today })}</Text>
          <View style={{ flexDirection: 'row', alignItems: 'center', gap: spacing.sm }}>
            <Pressable onPress={() => nav.pick({ kind: 'category', category: r.cat })} style={{ paddingHorizontal: 10, paddingVertical: 6, borderRadius: radius.sm, backgroundColor: isCurrent(view, r) ? colors.primary : colors.bgHover }} accessibilityRole="button">
              <Text style={{ color: isCurrent(view, r) ? '#fff' : colors.text, fontSize: font.sm }}>{t('news.wholeRubric')}</Text>
            </Pressable>
            <TextInput value={filter} onChangeText={setFilter} placeholder={t('news.filter')} placeholderTextColor={colors.textMuted} accessibilityLabel={t('news.filter')}
              style={{ flex: 1, color: colors.text, backgroundColor: colors.bg, borderRadius: radius.sm, paddingHorizontal: spacing.sm, paddingVertical: 6, fontSize: font.sm }} />
          </View>
          {sites.map((x) => <SiteRow key={x.id} nav={nav} site={x} />)}
          <Text style={[s.muted, { fontSize: font.xs, padding: spacing.sm, borderWidth: 1, borderStyle: 'dashed', borderColor: colors.border, borderRadius: radius.md }]}>{t('news.railHint')}</Text>
        </View>
      ) : null}
    </View>
  )
}
