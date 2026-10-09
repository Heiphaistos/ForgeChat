// Thème 8 : onglets Rubriques / YouTube (chaînes en avatars) / Sources A-Z, mode « Réordonner » avec flèches.
import { Ionicons } from '@expo/vector-icons'
import { useState } from 'react'
import { Pressable, Text, View } from 'react-native'
import { colors, font, radius, spacing } from '@/theme'
import { byLetter, type Rubric } from '../logic'
import { Avatar, Count, Segmented, SiteRow, TopButton, UpDown, isCurrent, rubricIcon, s, type Nav } from '../shared'

/** Cartes de rubriques avec les avatars de leurs sources ; en mode édition, flèches ↑↓. */
export function RubricCards({ nav, list, unit }: { nav: Nav; list: Rubric[]; unit: 'channels' | 'sources' }) {
  const { t } = nav
  const [editing, setEditing] = useState(false)
  const cats = list.map((r) => r.cat)
  const total = list.reduce((n, r) => n + r.sites.length, 0)
  return (
    <View style={{ gap: spacing.sm }}>
      <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: spacing.sm, paddingHorizontal: spacing.xs }}>
        <Text style={[s.labelText, { flex: 1 }]} numberOfLines={1}>
          {t('news.nThemes', { n: list.length })} · {t(unit === 'channels' ? 'news.nChannels' : 'news.nSources', { n: total })}
        </Text>
        <Pressable onPress={() => setEditing(!editing)} style={{ flexDirection: 'row', alignItems: 'center', gap: 4, paddingHorizontal: 10, paddingVertical: 6, borderRadius: radius.sm, backgroundColor: editing ? colors.primary : colors.bgHover }}
          accessibilityRole="button" accessibilityState={{ selected: editing }} accessibilityLabel={editing ? t('news.done') : t('news.reorderShort')}>
          <Ionicons name={editing ? 'checkmark' : 'swap-vertical'} size={13} color={editing ? '#fff' : colors.textSecondary} />
          <Text style={{ color: editing ? '#fff' : colors.textSecondary, fontSize: font.xs, fontWeight: '600' }}>{editing ? t('news.done') : t('news.reorderShort')}</Text>
        </Pressable>
      </View>
      {list.map((r, idx) => (
        <View key={r.cat} style={[s.card, { padding: spacing.sm }, isCurrent(nav.view, r) && { borderColor: colors.primary }]}>
          <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6 }}>
            <Pressable style={{ flex: 1, flexDirection: 'row', alignItems: 'center', gap: 6 }} onPress={() => nav.pick({ kind: 'category', category: r.cat })} accessibilityRole="button" accessibilityLabel={r.short}>
              <Ionicons name={rubricIcon(r.cat)} size={14} color={colors.textMuted} />
              <Text style={{ flex: 1, color: colors.text, fontWeight: '700', fontSize: font.sm }} numberOfLines={1}>{r.short}</Text>
            </Pressable>
            <Count n={r.today} />
            {editing ? <UpDown label={r.short} onUp={idx > 0 ? () => nav.move(cats, r.cat, idx - 1) : undefined} onDown={idx < list.length - 1 ? () => nav.move(cats, r.cat, idx + 1) : undefined} /> : null}
          </View>
          <View style={{ flexDirection: 'row', marginTop: spacing.sm }}>
            {r.sites.slice(0, 3).map((x) => (
              <Pressable key={x.id} onPress={() => nav.pick({ kind: 'site', site: x })} style={{ width: '25%', alignItems: 'center', gap: 4 }} accessibilityRole="button" accessibilityLabel={x.name}>
                <Avatar name={x.name} size={32} />
                <Text style={{ color: colors.textMuted, fontSize: 10 }} numberOfLines={1}>{x.name}</Text>
              </Pressable>
            ))}
            {r.sites.length > 3 ? (
              <Pressable onPress={() => nav.pick({ kind: 'category', category: r.cat })} style={{ width: '25%', alignItems: 'center', gap: 4 }} accessibilityRole="button" accessibilityLabel={t('news.allOf', { name: r.short })}>
                <View style={{ width: 32, height: 32, borderRadius: 16, borderWidth: 1, borderStyle: 'dashed', borderColor: colors.border, alignItems: 'center', justifyContent: 'center' }}>
                  <Text style={{ color: colors.textMuted, fontSize: 10 }}>+{r.sites.length - 3}</Text>
                </View>
                <Text style={{ color: colors.textMuted, fontSize: 10 }} numberOfLines={1}>{t(unit === 'channels' ? 'news.channels' : 'news.sources')}</Text>
              </Pressable>
            ) : null}
          </View>
        </View>
      ))}
    </View>
  )
}

/** Onglet YouTube : les chaînes par thème, en avatars. */
export function YouTubeTab({ nav }: { nav: Nav }) {
  const yt = nav.groups.find((g) => g.id === 'youtube')
  return yt ? <RubricCards nav={nav} list={yt.rubrics} unit="channels" /> : <Text style={[s.muted, { padding: spacing.sm }]}>{nav.t('news.empty')}</Text>
}

function SourcesAZ({ nav }: { nav: Nav }) {
  return (
    <View>
      {byLetter(nav.sites).map(([l, list]) => (
        <View key={l}>
          <Text style={{ paddingHorizontal: spacing.sm, paddingTop: spacing.sm, color: colors.primary, fontSize: font.xs, fontWeight: '800' }} accessibilityRole="header">{l}</Text>
          {list.map((x) => <SiteRow key={x.id} nav={nav} site={x} />)}
        </View>
      ))}
    </View>
  )
}

type Tab8 = 'rubrics' | 'youtube' | 'az'

export default function Theme8Tabs({ nav }: { nav: Nav }) {
  const { t } = nav
  const [tab, setTab] = useState<Tab8>('youtube')
  return (
    <View style={{ padding: spacing.sm, gap: spacing.sm }}>
      <TopButton nav={nav} />
      <Segmented value={tab} onChange={setTab} items={[['rubrics', t('news.rubrics')], ['youtube', 'YouTube', true], ['az', t('news.sourcesAZ')]]} />
      {tab === 'rubrics' ? <RubricCards nav={nav} list={nav.rubrics.filter((r) => r.group !== 'youtube')} unit="sources" /> : null}
      {tab === 'youtube' ? <YouTubeTab nav={nav} /> : null}
      {tab === 'az' ? <SourcesAZ nav={nav} /> : null}
    </View>
  )
}
