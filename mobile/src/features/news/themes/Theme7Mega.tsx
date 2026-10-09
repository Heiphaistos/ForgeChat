// Thème 7 : bouton « Rubriques ▾ » qui ouvre un méga-menu plein écran (une section par groupe),
// sources de la rubrique affichée en bas.
import { Ionicons } from '@expo/vector-icons'
import { useState } from 'react'
import { Modal, Pressable, ScrollView, Text, View } from 'react-native'
import { useSafeAreaInsets } from 'react-native-safe-area-context'
import { colors, font, radius, spacing } from '@/theme'
import { viewCategory, type View as NewsView } from '../logic'
import { GROUP_COLOR, GROUP_ICON, Avatar, askMove, isCurrent, rubricIcon, s, type Nav } from '../shared'

export default function Theme7Mega({ nav }: { nav: Nav }) {
  const { t } = nav
  const insets = useSafeAreaInsets()
  const [open, setOpen] = useState(false)
  const go = (v: NewsView) => { nav.pick(v); setOpen(false) }
  const cat = viewCategory(nav.view)
  const shown = nav.rubrics.find((r) => r.cat === cat)
  const sources = nav.rubrics.reduce((n, r) => n + r.sites.length, 0)

  return (
    <>
      <Pressable onPress={() => setOpen(true)} style={{ flexDirection: 'row', alignItems: 'center', gap: 4, paddingHorizontal: 10, paddingVertical: 8, borderRadius: radius.md, backgroundColor: colors.primary }}
        accessibilityRole="button" accessibilityLabel={t('news.allRubrics')} accessibilityState={{ expanded: open }}>
        <Ionicons name="grid-outline" size={15} color="#fff" />
        <Ionicons name="chevron-down" size={14} color="#fff" />
      </Pressable>
      <Modal visible={open} animationType="fade" onRequestClose={() => setOpen(false)} statusBarTranslucent>
        <View style={{ flex: 1, backgroundColor: colors.bgAlt, paddingTop: insets.top, paddingBottom: insets.bottom }} accessibilityViewIsModal>
          <View style={{ flexDirection: 'row', alignItems: 'center', gap: spacing.sm, padding: spacing.md, borderBottomWidth: 1, borderColor: colors.border }}>
            <View style={{ flex: 1 }}>
              <Text style={{ color: colors.text, fontWeight: '700', fontSize: font.lg }} accessibilityRole="header">{t('news.allRubrics')}</Text>
              <Text style={[s.muted, { fontSize: font.xs }]}>{t('news.nRubrics', { n: nav.rubrics.length })} · {t('news.nSources', { n: sources })}</Text>
            </View>
            <Pressable onPress={() => setOpen(false)} hitSlop={8} accessibilityRole="button" accessibilityLabel={t('common.close')}>
              <Ionicons name="close" size={22} color={colors.textSecondary} />
            </Pressable>
          </View>
          <ScrollView contentContainerStyle={{ padding: spacing.md, gap: spacing.md }}>
            {nav.groups.map((g) => {
              const cats = g.rubrics.map((r) => r.cat)
              return (
                <View key={g.id}>
                  <View style={{ flexDirection: 'row', alignItems: 'center', gap: spacing.sm, paddingBottom: 6, marginBottom: 4, borderBottomWidth: 1, borderColor: colors.border }}>
                    <View style={{ width: 22, height: 22, borderRadius: 6, alignItems: 'center', justifyContent: 'center', backgroundColor: GROUP_COLOR[g.id] }}>
                      <Ionicons name={GROUP_ICON[g.id]} size={13} color="#fff" />
                    </View>
                    <Text style={{ flex: 1, color: colors.text, fontWeight: '700', fontSize: font.sm }}>{t(`news.group.${g.id}`)}</Text>
                    {g.today > 0 ? <Text style={[s.muted, { fontSize: 10 }]}>{t('news.todayShort', { n: g.today })}</Text> : null}
                  </View>
                  {g.rubrics.map((r) => {
                    const on = isCurrent(nav.view, r)
                    return (
                      <Pressable key={r.cat} onPress={() => go({ kind: 'category', category: r.cat })} onLongPress={() => askMove(nav, cats, r.cat)}
                        style={({ pressed }) => [s.row, (on || pressed) && { backgroundColor: colors.bgHover }, on && { borderWidth: 1, borderColor: colors.primary }]}
                        accessibilityRole="button" accessibilityState={{ selected: on }} accessibilityLabel={r.short} accessibilityHint={t('news.reorder')}>
                        <Ionicons name={rubricIcon(r.cat)} size={15} color={colors.textMuted} />
                        <Text style={[s.rowText, on && { color: colors.text }]} numberOfLines={1}>{r.short}</Text>
                        <Text style={[s.muted, { fontSize: 10 }]}>{t('news.nSrc', { n: r.sites.length })}</Text>
                        <Text style={{ width: 26, textAlign: 'right', color: colors.primary, fontSize: 10, fontWeight: '700' }}>{r.today || ''}</Text>
                      </Pressable>
                    )
                  })}
                </View>
              )
            })}
          </ScrollView>
          {shown ? (
            <View style={{ padding: spacing.md, gap: spacing.sm, borderTopWidth: 1, borderColor: colors.border }}>
              <Text style={{ color: colors.text, fontWeight: '700', fontSize: font.sm }}>{shown.short} · <Text style={s.muted}>{t('news.nSources', { n: shown.sites.length })}</Text></Text>
              <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ gap: 6 }}>
                {shown.sites.map((x) => (
                  <Pressable key={x.id} onPress={() => go({ kind: 'site', site: x })} style={[s.chip, { paddingLeft: 4 }]} accessibilityRole="button" accessibilityLabel={x.name}>
                    <Avatar name={x.name} size={18} />
                    <Text style={s.chipText}>{x.name}</Text>
                  </Pressable>
                ))}
              </ScrollView>
            </View>
          ) : null}
        </View>
      </Modal>
    </>
  )
}
