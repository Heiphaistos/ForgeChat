// Thèmes 9 et 10 : trois colonnes comme un serveur — genres | sources du genre | articles. Au téléphone,
// une colonne à la fois (genres → sources → articles, avec retour, bouton Retour d'Android compris).
// Le thème 10 présente les genres en icônes rondes, rangées par famille.
import { Ionicons } from '@expo/vector-icons'
import { useEffect, useMemo, useState, type ReactNode } from 'react'
import { BackHandler, Pressable, ScrollView, Text, TextInput, View } from 'react-native'
import type { NewsSite } from '@/api/news'
import type { IconName } from '@/components/ui'
import { colors, font, radius, spacing } from '@/theme'
import { families, genreOfView, genreView, type Genre, type View as NewsView } from '../logic'
import { GROUP_COLOR, Avatar, Count, Label, NavRow, Segmented, askMove, isCurrent, pinToggle, rubricIcon, s, type Nav } from '../shared'
import { GroupHeader } from './Theme1Sidebar'

type Step = 'genres' | 'sources' | 'feed'
type Fams = ReturnType<typeof families>

const genreIcon = (x: Genre): IconName => (x.id === 'youtube' ? 'logo-youtube' : rubricIcon(x.rubrics[0]?.cat ?? ''))
const genreLabel = (nav: Nav, x: Genre) => (x.today ? `${x.label}, ${nav.t('news.nToday', { n: x.today })}` : x.label)

/** Thème 9 : familles colorées repliables (comme le thème 1), un genre par ligne. */
function GenreList({ nav, fams, onPick, onTop }: { nav: Nav; fams: Fams; onPick: (x: Genre) => void; onTop: () => void }) {
  return (
    <View style={{ padding: spacing.sm }}>
      <NavRow onPress={onTop} label={nav.t('news.top')}>
        <Ionicons name="flame" size={18} color="#fb923c" />
        <Text style={[s.rowText, { fontWeight: '700' }]}>{nav.t('news.top')}</Text>
      </NavRow>
      {fams.map(({ g, list }) => {
        const open = !nav.isFolded(`g:${g.id}`, false)
        const cats = list.map((x) => x.rubrics[0]?.cat ?? '')
        return (
          <View key={g.id} style={{ paddingTop: spacing.sm }}>
            <GroupHeader nav={nav} id={g.id} open={open} today={g.today} chevron />
            {open
              ? list.map((x, i) => (
                  <NavRow key={x.id} onPress={() => onPick(x)} onLongPress={() => askMove(nav, cats, cats[i]!)} label={genreLabel(nav, x)}>
                    <Ionicons name={genreIcon(x)} size={17} color={x.id === 'youtube' ? GROUP_COLOR.youtube : colors.textMuted} />
                    <Text style={s.rowText} numberOfLines={1}>{x.label}</Text>
                    <Count n={x.today} muted />
                  </NavRow>
                ))
              : null}
          </View>
        )
      })}
    </View>
  )
}

/** Thème 10 : genres en icônes rondes, libellé court dessous, trait de couleur par famille. */
function GenreGrid({ nav, fams, onPick, onTop }: { nav: Nav; fams: Fams; onPick: (x: Genre) => void; onTop: () => void }) {
  const cell = (key: string, icon: ReactNode, label: string, today: number, onPress: () => void, a11y: string, onLongPress?: () => void) => (
    <Pressable key={key} onPress={onPress} onLongPress={onLongPress} style={{ width: '25%', alignItems: 'center', gap: 4, paddingVertical: 6 }} accessibilityRole="button" accessibilityLabel={a11y}>
      <View style={{ width: 52, height: 52, borderRadius: 26, alignItems: 'center', justifyContent: 'center', backgroundColor: colors.bgHover }}>
        {icon}
        {today > 0 ? <Text style={[s.count, { position: 'absolute', bottom: -4, right: -6, fontSize: 9 }]}>{today}</Text> : null}
      </View>
      <Text style={{ color: colors.textMuted, fontSize: 11, textAlign: 'center' }} numberOfLines={1}>{label}</Text>
    </Pressable>
  )
  return (
    <View style={{ padding: spacing.sm, gap: spacing.sm }}>
      <View style={{ flexDirection: 'row' }}>
        {cell('top', <Ionicons name="flame" size={22} color="#fb923c" />, nav.t('news.topShort'), 0, onTop, nav.t('news.top'))}
      </View>
      {fams.map(({ g, list }) => {
        const cats = list.map((x) => x.rubrics[0]?.cat ?? '')
        return (
          <View key={g.id} style={{ gap: 4 }}>
            <View style={s.groupHead}>
              <View style={[s.groupBar, { backgroundColor: GROUP_COLOR[g.id] }]} />
              <Text style={s.groupText}>{nav.t(`news.group.${g.id}`)}</Text>
            </View>
            <View style={{ flexDirection: 'row', flexWrap: 'wrap' }}>
              {list.map((x, i) =>
                cell(x.id, <Ionicons name={genreIcon(x)} size={22} color={x.id === 'youtube' ? GROUP_COLOR.youtube : colors.textSecondary} />, x.label, x.today, () => onPick(x), genreLabel(nav, x), () => askMove(nav, cats, cats[i]!)),
              )}
            </View>
          </View>
        )
      })}
    </View>
  )
}

/** Colonne 2 : « Tout <genre> », épinglées, puis les sources (YouTube : par thème ou A-Z). */
function Sources({ nav, x, onGo }: { nav: Nav; x: Genre; onGo: (v: NewsView) => void }) {
  const { t, view } = nav
  const [mode, setMode] = useState<'themes' | 'az'>('themes')
  const [filter, setFilter] = useState('')
  const f = filter.trim().toLowerCase()
  const yt = x.rubrics.length > 1
  const pinned = (site: NewsSite) => nav.prefs.pins.includes(`s:${site.id}`)
  const az = (l: NewsSite[]) => l.filter((site) => !f || site.name.toLowerCase().includes(f)).sort((a, b) => a.name.localeCompare(b.name))
  const pins = az(x.sites.filter(pinned))
  const first = x.rubrics[0]
  const allOn = yt ? view.kind === 'genre' && view.id === x.id : !!first && isCurrent(view, first)

  const row = (site: NewsSite) => {
    const on = isCurrent(view, site)
    const p = pinned(site)
    return (
      <View key={site.id} style={[s.row, { paddingVertical: 0 }, on && { backgroundColor: colors.bgHover }]}>
        <Pressable onPress={() => onGo({ kind: 'site', site })} style={{ flex: 1, flexDirection: 'row', alignItems: 'center', gap: spacing.sm, paddingVertical: 8 }}
          accessibilityRole="button" accessibilityLabel={site.today ? t('news.siteToday', { name: site.name, n: site.today }) : site.name}>
          <Avatar name={site.name} size={34} />
          <View style={{ flex: 1 }}>
            <Text style={{ color: on ? colors.text : colors.textSecondary, fontSize: font.md, fontWeight: on ? '600' : '400' }} numberOfLines={1}>{site.name}</Text>
            {site.last_title ? <Text style={[s.muted, { fontSize: font.xs }]} numberOfLines={1}>{site.last_title}</Text> : null}
          </View>
          <Count n={site.today} muted />
        </Pressable>
        <Pressable onPress={() => pinToggle(nav, `s:${site.id}`)} hitSlop={6} style={{ padding: 8 }}
          accessibilityRole="button" accessibilityState={{ selected: p }} accessibilityLabel={`${p ? t('news.unpin') : t('news.pin')} ${site.name}`}>
          <Ionicons name={p ? 'pin' : 'pin-outline'} size={14} color={p ? colors.primary : colors.textMuted} />
        </Pressable>
      </View>
    )
  }

  return (
    <View>
      <View style={{ padding: spacing.md, gap: spacing.sm, borderBottomWidth: 1, borderColor: colors.border }}>
        <Text style={[s.muted, { fontSize: font.xs }]} numberOfLines={1}>
          {t(yt ? 'news.nChannels' : 'news.nSources', { n: x.sites.length })}{yt ? ` · ${t('news.nThemes', { n: x.rubrics.length })}` : ''} · {t('news.todayShort', { n: x.today })}
        </Text>
        {yt ? <Segmented value={mode} onChange={setMode} items={[['themes', t('news.byTheme')], ['az', t('news.az')]]} /> : null}
        {x.sites.length > 6 ? (
          <TextInput value={filter} onChangeText={setFilter} placeholder={t('news.filter')} placeholderTextColor={colors.textMuted} accessibilityLabel={t('news.filter')}
            style={{ color: colors.text, backgroundColor: colors.bgAlt, borderRadius: radius.sm, paddingHorizontal: spacing.sm, paddingVertical: 8, fontSize: font.sm }} />
        ) : null}
      </View>
      <View style={{ padding: spacing.sm }}>
        <NavRow on={allOn} onPress={() => onGo(genreView(x))} label={t('news.allOf', { name: x.label })}>
          <View style={{ width: 34, height: 34, borderRadius: 17, alignItems: 'center', justifyContent: 'center', backgroundColor: GROUP_COLOR[x.group] }}>
            <Ionicons name="layers-outline" size={16} color="#fff" />
          </View>
          <Text style={[s.rowText, { color: colors.text, fontWeight: '700' }]} numberOfLines={1}>{t('news.allOf', { name: x.label })}</Text>
          <Count n={x.today} />
        </NavRow>
        {pins.length ? <><Label>{t('news.pinned')}</Label>{pins.map(row)}</> : null}
        {yt && mode === 'themes'
          ? x.rubrics.map((r) => {
              const list = az(r.sites.filter((site) => !pinned(site)))
              if (!list.length) return null
              const on = isCurrent(view, r)
              return (
                <View key={r.cat}>
                  <Pressable onPress={() => onGo({ kind: 'category', category: r.cat })} style={[s.label, { justifyContent: 'flex-start' }]}
                    accessibilityRole="button" accessibilityState={{ selected: on }} accessibilityLabel={t('news.allOf', { name: r.short })}>
                    <Ionicons name={rubricIcon(r.cat)} size={12} color={on ? colors.text : colors.textMuted} />
                    <Text style={[s.labelText, { flex: 1 }, on && { color: colors.text }]} numberOfLines={1}>{r.short}</Text>
                    <Text style={s.labelRight}>{list.length}</Text>
                  </Pressable>
                  {list.map(row)}
                </View>
              )
            })
          : <>{pins.length ? <Label>{t('news.sourcesTitle')}</Label> : null}{az(x.sites.filter((site) => !pinned(site))).map(row)}</>}
      </View>
    </View>
  )
}

/** Bouton retour de l'étape (flèche + libellé). */
function Back({ nav, label, onPress }: { nav: Nav; label: string; onPress: () => void }) {
  return (
    <Pressable onPress={onPress} hitSlop={8} style={{ flexDirection: 'row', alignItems: 'center', gap: 6, maxWidth: '45%' }} accessibilityRole="button" accessibilityLabel={`${nav.t('news.back')} : ${label}`}>
      <Ionicons name="arrow-back" size={20} color={colors.text} />
      <Text style={{ color: colors.text, fontWeight: '700', fontSize: font.sm }} numberOfLines={1}>{label}</Text>
    </Pressable>
  )
}

export default function Theme9Columns({ nav, compact, feed }: { nav: Nav; compact: boolean; feed: (lead: ReactNode) => ReactNode }) {
  const { t } = nav
  const fams = useMemo(() => families(nav.groups, t('news.group.youtube')), [nav.groups, t])
  const all = fams.flatMap((f) => f.list)
  const [sel, setSel] = useState<string | null>(null)
  const [step, setStep] = useState<Step>('genres')
  const cur = genreOfView(nav.view, all) ?? all.find((x) => x.id === sel) ?? all[0]
  const pickGenre = (x: Genre) => { setSel(x.id); nav.pick(genreView(x)); setStep('sources') }
  const go = (v: NewsView) => { nav.pick(v); setStep('feed') }
  const onTop = () => go({ kind: 'top' })
  const prev: Step = step === 'feed' && nav.view.kind !== 'top' && cur ? 'sources' : 'genres'

  // Bouton Retour d'Android : étape précédente avant de quitter l'écran.
  useEffect(() => {
    if (step === 'genres') return
    const sub = BackHandler.addEventListener('hardwareBackPress', () => { setStep(prev); return true })
    return () => sub.remove()
  }, [step, prev])

  if (step === 'feed') return <>{feed(<Back nav={nav} label={prev === 'sources' && cur ? cur.label : t('news.genres')} onPress={() => setStep(prev)} />)}</>
  if (step === 'sources' && cur) {
    return (
      <ScrollView style={{ flex: 1, backgroundColor: colors.bg }} keyboardShouldPersistTaps="handled">
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: spacing.sm, padding: spacing.md, borderBottomWidth: 1, borderColor: colors.border }}>
          <Back nav={nav} label={t('news.genres')} onPress={() => setStep('genres')} />
          <Ionicons name={genreIcon(cur)} size={17} color={cur.id === 'youtube' ? GROUP_COLOR.youtube : colors.textMuted} />
          <Text style={{ flex: 1, color: colors.text, fontWeight: '700', fontSize: font.md }} numberOfLines={1} accessibilityRole="header">{cur.label}</Text>
        </View>
        <Sources key={cur.id} nav={nav} x={cur} onGo={go} />
      </ScrollView>
    )
  }
  return (
    <ScrollView style={{ flex: 1, backgroundColor: colors.bg }}>
      {compact ? <GenreGrid nav={nav} fams={fams} onPick={pickGenre} onTop={onTop} /> : <GenreList nav={nav} fams={fams} onPick={pickGenre} onTop={onTop} />}
    </ScrollView>
  )
}
