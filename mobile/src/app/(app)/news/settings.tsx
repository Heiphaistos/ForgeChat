// Molette des Actualités : thème de navigation et personnalisation (épinglées, ordre des rubriques,
// sources coupées, groupes repliés). Mêmes préférences que le web et le PC (synchronisées par le compte).
import { Ionicons } from '@expo/vector-icons'
import { router, Stack } from 'expo-router'
import { useMemo, useState, type ReactNode } from 'react'
import { Pressable, ScrollView, StyleSheet, Switch, Text, View } from 'react-native'
import { useSafeAreaInsets } from 'react-native-safe-area-context'
import { Button } from '@/components/ui'
import { DEFAULT_THEME, THEMES, longName } from '@/features/news/logic'
import { GROUP_COLOR, Avatar, UpDown, movePin, pinToggle, useNewsData } from '@/features/news/shared'
import { ThemePreview } from '@/features/news/ThemePreview'
import { colors, font, outline, radius, spacing } from '@/theme'

function Section({ title, right, children }: { title: string; right?: ReactNode; children: ReactNode }) {
  return (
    <View style={{ gap: spacing.sm }}>
      <View style={styles.sectionHead}>
        <Text style={styles.sectionTitle} accessibilityRole="header">{title}</Text>
        {right}
      </View>
      {children}
    </View>
  )
}

function Small({ label, icon, onPress }: { label: string; icon?: 'refresh'; onPress: () => void }) {
  return (
    <Pressable onPress={onPress} style={styles.small} accessibilityRole="button" accessibilityLabel={label}>
      {icon ? <Ionicons name={icon} size={12} color={colors.textSecondary} /> : null}
      <Text style={{ color: colors.textSecondary, fontSize: font.xs }}>{label}</Text>
    </Pressable>
  )
}

export default function NewsSettingsScreen() {
  const nav = useNewsData()
  const { t, prefs, update, all } = nav
  const insets = useSafeAreaInsets()
  const cats = useMemo(() => nav.rubrics.map((r) => r.cat), [nav.rubrics])
  const allCats = useMemo(() => [...new Set([...cats, ...all.map((x) => x.category)])], [cats, all])
  const [srcCat, setSrcCat] = useState<string | null>(null)
  const cur = srcCat ?? allCats[0] ?? ''
  const srcSites = all.filter((x) => x.category === cur).sort((a, b) => a.name.localeCompare(b.name))
  const pinned = (id: string) => prefs.pins.includes(id)
  const label = (id: string) => {
    if (id.startsWith('s:')) return all.find((x) => x.id === id.slice(2))?.name
    const r = nav.rubrics.find((x) => `c:${x.key}` === id)
    return r && longName(r.cat)
  }
  const pins = prefs.pins.filter(label)
  const foldAll = (v: boolean) => update({ folded: Object.fromEntries([...nav.groups.map((g) => `g:${g.id}`), ...nav.rubrics.map((r) => r.key)].map((k) => [k, v])) })
  const pinBtn = (id: string, name: string, disabled?: boolean) => (
    <Pressable onPress={() => pinToggle(nav, id)} disabled={disabled} hitSlop={6} style={{ padding: 6, opacity: disabled ? 0.3 : 1 }}
      accessibilityRole="button" accessibilityState={{ selected: pinned(id), disabled: !!disabled }} accessibilityLabel={`${pinned(id) ? t('news.unpin') : t('news.pin')} ${name}`}>
      <Ionicons name={pinned(id) ? 'pin' : 'pin-outline'} size={15} color={pinned(id) ? colors.primary : colors.textMuted} />
    </Pressable>
  )

  return (
    <View style={{ flex: 1, backgroundColor: colors.bg }}>
      <Stack.Screen options={{ title: t('news.customize') }} />
      <ScrollView contentContainerStyle={{ padding: spacing.md, gap: spacing.xl }}>
        <Section title={t('news.theme')}>
          <View style={styles.grid}>
            {THEMES.map((id) => {
              const on = prefs.theme === id
              return (
                <Pressable key={id} onPress={() => update({ theme: id })} style={[styles.themeCard, on && { borderColor: colors.primary }]}
                  accessibilityRole="radio" accessibilityState={{ checked: on }} accessibilityLabel={`${id}. ${t(`news.theme${id}`)}. ${t(`news.theme${id}.desc`)}`}>
                  <ThemePreview id={id} />
                  <View style={{ flexDirection: 'row', alignItems: 'center', gap: 4 }}>
                    <Text style={{ color: colors.textMuted, fontWeight: '700', fontSize: font.sm }}>{id}.</Text>
                    <Text style={{ flex: 1, color: colors.text, fontWeight: '700', fontSize: font.sm }} numberOfLines={1}>{t(`news.theme${id}`)}</Text>
                    {on ? <Ionicons name="checkmark" size={15} color={colors.primary} /> : null}
                  </View>
                  <Text style={{ color: colors.textMuted, fontSize: 11 }}>
                    {t(`news.theme${id}.desc`)}{id === DEFAULT_THEME ? ` ${t('news.defaultTag')}` : ''}
                  </Text>
                </Pressable>
              )
            })}
          </View>
        </Section>

        <Section title={t('news.pinned')}>
          {!pins.length ? <Text style={styles.hint}>{t('news.pinHint')}</Text> : null}
          {pins.map((id, idx) => (
            <View key={id} style={styles.item}>
              <Ionicons name="pin" size={13} color={colors.primary} />
              <Text style={styles.itemText} numberOfLines={1}>{label(id)}</Text>
              <UpDown label={label(id) ?? ''} onUp={idx > 0 ? () => movePin(nav, pins, id, idx - 1) : undefined} onDown={idx < pins.length - 1 ? () => movePin(nav, pins, id, idx + 1) : undefined} />
              <Pressable onPress={() => pinToggle(nav, id)} hitSlop={6} style={{ padding: 6 }} accessibilityRole="button" accessibilityLabel={`${t('news.unpin')} ${label(id) ?? ''}`}>
                <Ionicons name="close" size={15} color={colors.textMuted} />
              </Pressable>
            </View>
          ))}
        </Section>

        <Section title={t('news.order')} right={<Small icon="refresh" label={t('news.defaultOrder')} onPress={() => update({ order: [] })} />}>
          {nav.rubrics.map((r, idx) => (
            <View key={r.cat} style={styles.item}>
              <Text style={[styles.tag, { backgroundColor: GROUP_COLOR[r.group] }]} numberOfLines={1}>{t(`news.groupTag.${r.group}`)}</Text>
              <Text style={styles.itemText} numberOfLines={1}>{r.short}</Text>
              {pinBtn(`c:${r.key}`, r.short)}
              <UpDown label={r.short} onUp={idx > 0 ? () => nav.move(cats, r.cat, idx - 1) : undefined} onDown={idx < cats.length - 1 ? () => nav.move(cats, r.cat, idx + 1) : undefined} />
            </View>
          ))}
        </Section>

        <Section title={t('news.mutedSources', { n: prefs.muted.length })} right={prefs.muted.length ? <Small icon="refresh" label={t('news.unmuteAll')} onPress={() => update({ muted: [] })} /> : undefined}>
          <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ gap: 6 }} accessibilityLabel={t('news.rubric')}>
            {allCats.map((c) => (
              <Pressable key={c} onPress={() => setSrcCat(c)} style={[styles.chip, c === cur && { backgroundColor: colors.primary, borderColor: colors.primary }]}
                accessibilityRole="button" accessibilityState={{ selected: c === cur }} accessibilityLabel={longName(c)}>
                <Text style={{ color: c === cur ? '#fff' : colors.textSecondary, fontSize: font.sm }}>{longName(c)}</Text>
              </Pressable>
            ))}
          </ScrollView>
          {srcSites.map((x) => {
            const off = prefs.muted.includes(x.id)
            return (
              <View key={x.id} style={styles.item}>
                <Avatar name={x.name} size={22} />
                <Text style={[styles.itemText, off && { color: colors.textMuted, textDecorationLine: 'line-through' }]} numberOfLines={1}>{x.name}</Text>
                {pinBtn(`s:${x.id}`, x.name, off)}
                <Switch
                  value={!off}
                  onValueChange={(v) => update({ muted: v ? prefs.muted.filter((m) => m !== x.id) : [...prefs.muted, x.id] })}
                  trackColor={{ true: colors.primary, false: colors.bgHover }}
                  thumbColor="#fff"
                  accessibilityLabel={t('news.showSource', { name: x.name })}
                />
              </View>
            )
          })}
        </Section>

        <Section title={t('news.folding')}>
          <View style={{ flexDirection: 'row', gap: spacing.sm, flexWrap: 'wrap' }}>
            <Small label={t('news.unfoldAll')} onPress={() => foldAll(false)} />
            <Small label={t('news.foldAll')} onPress={() => foldAll(true)} />
          </View>
        </Section>
      </ScrollView>
      <View style={[styles.footer, { paddingBottom: insets.bottom + spacing.sm }]}>
        <Button title={t('news.resetAll')} variant="secondary" style={{ flex: 1 }} onPress={() => update({ theme: DEFAULT_THEME, pins: [], order: [], muted: [], folded: {} })} />
        <Button title={t('common.close')} style={{ flex: 1 }} onPress={() => router.back()} />
      </View>
    </View>
  )
}

const styles = StyleSheet.create({
  sectionHead: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: spacing.sm },
  sectionTitle: { flexShrink: 1, color: colors.textMuted, fontSize: font.xs, fontWeight: '700', textTransform: 'uppercase' },
  small: { flexDirection: 'row', alignItems: 'center', gap: 4, paddingHorizontal: 10, paddingVertical: 6, borderRadius: radius.sm, backgroundColor: colors.bgHover },
  grid: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.sm },
  themeCard: { width: '48.5%', gap: 6, padding: spacing.sm, borderRadius: radius.md, borderWidth: 1, borderColor: colors.border, backgroundColor: colors.bgAlt },
  hint: { color: colors.textMuted, fontSize: font.xs },
  item: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm, paddingHorizontal: spacing.sm, paddingVertical: 6, borderRadius: radius.sm, backgroundColor: colors.bgAlt, ...outline },
  itemText: { flex: 1, color: colors.textSecondary, fontSize: font.sm },
  tag: { width: 46, textAlign: 'center', color: '#fff', fontSize: 9, fontWeight: '800', textTransform: 'uppercase', borderRadius: 4, paddingVertical: 2, overflow: 'hidden' },
  chip: { paddingHorizontal: 12, paddingVertical: 6, borderRadius: radius.full, borderWidth: 1, borderColor: colors.border, backgroundColor: colors.bgAlt },
  footer: { flexDirection: 'row', gap: spacing.sm, paddingHorizontal: spacing.md, paddingTop: spacing.sm, borderTopWidth: StyleSheet.hairlineWidth, borderColor: colors.border, backgroundColor: colors.bg },
})
