// Thème 3 : grille de tuiles de rubriques (icône, articles du jour, sources) ; un appui ouvre les articles.
import { Ionicons } from '@expo/vector-icons'
import { Pressable, Text, View } from 'react-native'
import { colors, font, spacing } from '@/theme'
import { GROUP_COLOR, Avatars, RubricBadge, askMove, s, type Nav } from '../shared'

export default function Theme3Tiles({ nav }: { nav: Nav }) {
  const { t } = nav
  // Hors « À la une » : un simple retour vers la grille, les articles prennent la place.
  if (nav.view.kind !== 'top') {
    return (
      <View style={{ paddingHorizontal: spacing.md, paddingTop: spacing.sm, flexDirection: 'row' }}>
        <Pressable onPress={() => nav.pick({ kind: 'top' })} style={[s.chip, { borderRadius: 8 }]} accessibilityRole="button" accessibilityLabel={t('news.rubrics')}>
          <Ionicons name="grid-outline" size={14} color={colors.text} />
          <Text style={[s.chipText, { color: colors.text }]}>{t('news.rubrics')}</Text>
        </Pressable>
      </View>
    )
  }
  const sources = nav.rubrics.reduce((n, r) => n + r.sites.length, 0)
  const today = nav.rubrics.reduce((n, r) => n + r.today, 0)
  return (
    <View style={{ padding: spacing.md, gap: spacing.md }}>
      <View>
        <Text style={{ color: colors.text, fontSize: font.xxl, fontWeight: '800' }} accessibilityRole="header">{t('news.rubrics')}</Text>
        <Text style={s.muted}>{t('news.stats', { r: nav.rubrics.length, s: sources, a: today })}</Text>
      </View>
      {nav.groups.map((g) => {
        const cats = g.rubrics.map((r) => r.cat)
        return (
          <View key={g.id} style={{ gap: spacing.sm }}>
            <View style={s.groupHead}>
              <View style={[s.groupBar, { backgroundColor: GROUP_COLOR[g.id] }]} />
              <Text style={s.groupText}>{t(`news.group.${g.id}`)}</Text>
            </View>
            <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: spacing.sm }}>
              {g.rubrics.map((r) => (
                <Pressable
                  key={r.cat}
                  onPress={() => nav.pick({ kind: 'category', category: r.cat })}
                  onLongPress={() => askMove(nav, cats, r.cat)}
                  style={({ pressed }) => [s.card, { width: '48.5%', padding: spacing.md, gap: spacing.sm }, pressed && { borderColor: colors.primary }]}
                  accessibilityRole="button"
                  accessibilityLabel={`${r.short}, ${t('news.nToday', { n: r.today })}, ${t('news.nSources', { n: r.sites.length })}`}
                  accessibilityHint={t('news.reorder')}
                >
                  <View style={{ flexDirection: 'row', alignItems: 'center', gap: spacing.sm }}>
                    <RubricBadge r={r} size={26} />
                    <Text style={{ flex: 1, color: colors.text, fontWeight: '700', fontSize: font.sm }} numberOfLines={2}>{r.short}</Text>
                  </View>
                  <Text style={s.muted} numberOfLines={1}>
                    <Text style={{ color: colors.text, fontWeight: '800', fontSize: font.lg }}>{r.today} </Text>
                    {t('news.articlesToday')}
                  </Text>
                  <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6 }}>
                    <Avatars sites={r.sites} n={4} size={18} />
                    <Text style={[s.muted, { fontSize: 11, flex: 1 }]} numberOfLines={1}>{t('news.nSources', { n: r.sites.length })}</Text>
                  </View>
                </Pressable>
              ))}
            </View>
          </View>
        )
      })}
    </View>
  )
}
