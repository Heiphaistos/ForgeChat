import { Ionicons } from '@expo/vector-icons'
import { useMutation, useQuery } from '@tanstack/react-query'
import { Alert, Platform, Pressable, ScrollView, Share, StyleSheet, Text, View } from 'react-native'
import { useMemo, useState } from 'react'
import { router } from 'expo-router'
import { settingsApi, settingsKey, type ServerSideSettings } from '@/api/settings'
import { Button, Row, Section, SwitchRow, TextField } from '@/components/ui'
import { shareCode, studioWithImport } from '@/features/appearance/themeShare'
import { http } from '@/lib/http'
import { accountCustomThemes, restartApp, themeStudioKey } from '@/features/appearance/sync'
import { useLang, useT, type Lang } from '@/i18n'
import { errorMessage } from '@/lib/http'
import { queryClient } from '@/lib/queryClient'
import { colors, font, radius, spacing } from '@/theme'
import { paletteFromSpec, THEMES, type Palette } from '@/theme/palettes'
import { appearance, deviceCustom, DENSITIES, saveAppearance, TEXT_SCALES, useAppearance, type AppearancePrefs } from '@/theme/prefs'
import { cssGradient, findPreset, findTheme, PRESET_GROUPS, PRESETS, type PresetGroup, type ThemeSpec } from '@/theme/themeCore'

/** Langues traduites (libellés dans leur propre langue, jamais traduits). */
const LANGS: { code: Lang; label: string }[] = [
  { code: 'fr', label: 'Français' },
  { code: 'en', label: 'English' },
]

/** Accents proposés (null = celui du thème) : accent_color du web, partagé entre appareils. */
const ACCENTS = [null, '#5865f2', '#00a8fc', '#23a55a', '#f0b232', '#e67e22', '#f23f43', '#eb6f92', '#9b59b6'] as const

/** Réglages qui ne s'appliquent qu'au lancement (couleurs, tailles et espacements lus avant tout écran). */
const needsRestart = (p: AppearancePrefs) =>
  p.theme !== appearance.theme ||
  p.accent !== appearance.accent ||
  p.textScale !== appearance.textScale ||
  p.density !== appearance.density ||
  JSON.stringify(p.custom) !== JSON.stringify(appearance.custom)

/** Vignettes affichées d'un coup : plus de 1 200 thèmes, rangés en collections. */
const PAGE = 24
const fold = (v: string) => v.normalize('NFD').replace(/\p{M}/gu, '').toLowerCase()

interface CardTheme {
  id: string
  label: string
  palette: Palette
  gradient: string | null
  spec?: ThemeSpec
}

/** Vignette d'un thème : ses couleurs (et son dégradé) sur une carte. */
function ThemeCard({ th, selected, onPress }: { th: CardTheme; selected: boolean; onPress: () => void }) {
  const t = useT()
  return (
    <Pressable
      onPress={onPress}
      accessibilityRole="button"
      accessibilityLabel={t('appearance.themeLabel', { name: th.label })}
      accessibilityState={{ selected }}
      style={[
        styles.card,
        { backgroundColor: th.palette.bg, borderColor: selected ? colors.primary : colors.border },
        th.gradient ? { experimental_backgroundImage: th.gradient } : null,
      ]}
    >
      <View style={styles.swatches}>
        {[th.palette.bgDeep, th.palette.bgAlt, th.palette.primary, th.palette.text].map((c, i) => (
          <View key={i} style={[styles.swatch, { backgroundColor: c }]} />
        ))}
      </View>
      <Text style={[styles.cardLabel, { color: th.palette.text }]} numberOfLines={1}>
        {th.label}
      </Text>
      {selected ? <Ionicons name="checkmark-circle" size={18} color={colors.primary} style={styles.check} /> : null}
    </Pressable>
  )
}

export default function AppearanceScreen() {
  const prefs = useAppearance()
  const t = useT()
  const lang = useLang((s) => s.lang)
  const setLang = useLang((s) => s.setLang)
  const save = useMutation({
    mutationFn: (patch: Partial<ServerSideSettings>) => settingsApi.update(patch),
    onSuccess: (data) => queryClient.setQueryData(settingsKey, data),
    onError: (e) => Alert.alert(t('appearance.notSynced'), t('appearance.notSyncedBody', { error: errorMessage(e) })),
  })

  const studio = useQuery({ queryKey: themeStudioKey, queryFn: settingsApi.themeStudio })
  const customs = accountCustomThemes(studio.data)
  const pickTheme = (id: string, custom?: ThemeSpec) => {
    saveAppearance({ theme: id, custom: custom ? deviceCustom(custom) : null })
    settingsApi.setTheme(id).catch(() => undefined)
  }

  // Import / export d'un code de thème (amélioration n° 42).
  const [code, setCode] = useState('')
  const importTheme = useMutation({
    mutationFn: async () => {
      const next = studioWithImport(studio.data as Record<string, unknown> | null, customs, code)
      if (!next) throw new Error(t('themeShare.invalid'))
      await http.put('/user/theme-studio', next.studio, { noQueue: true })
      return next.theme
    },
    onSuccess: (theme) => {
      setCode('')
      void studio.refetch()
      pickTheme(theme.id, theme)
    },
    onError: (e) => Alert.alert(t('themeShare.import'), errorMessage(e)),
  })
  const current = findTheme(prefs.theme, customs)
  const exportTheme = () => {
    if (current) void Share.share({ message: shareCode(current) })
  }

  // Galerie : collection choisie (celle du thème actif au départ), recherche, pages.
  const [group, setGroup] = useState<PresetGroup>(() => findPreset(prefs.theme)?.group ?? 'base')
  const [query, setQuery] = useState('')
  const [limit, setLimit] = useState(PAGE)
  const shown = useMemo(() => {
    const q = fold(query.trim())
    return THEMES.filter((th) => (q ? fold(`${th.label.fr} ${th.label.en}`).includes(q) : th.group === group))
  }, [group, query])

  const restart = () => {
    if (!restartApp()) Alert.alert(t('appearance.themeSaved'), t('appearance.reopenForTheme'))
  }

  return (
    <ScrollView style={{ backgroundColor: colors.bg }} contentContainerStyle={{ padding: spacing.lg }}>
      {needsRestart(prefs) ? (
        <View style={styles.pending}>
          <Text style={styles.pendingText}>
            {t(Platform.OS === 'android' ? 'appearance.restartAndroid' : 'appearance.restartIos')}
          </Text>
          {Platform.OS === 'android' ? <Button title={t('appearance.restartNow')} icon="refresh" onPress={restart} /> : null}
        </View>
      ) : null}

      <Section title={t('language.title')} footer={t('language.footer')}>
        {LANGS.map((l) => (
          <Row
            key={l.code}
            title={l.label}
            selected={lang === l.code}
            onPress={() => {
              setLang(l.code)
              save.mutate({ language: l.code })
            }}
            right={lang === l.code ? <Ionicons name="checkmark" size={20} color={colors.primary} /> : null}
          />
        ))}
      </Section>

      <Section title={t('appearance.theme')} footer={t('appearance.themeFooter')}>
        <View style={{ paddingHorizontal: spacing.md, paddingTop: spacing.md, gap: spacing.sm }}>
          <TextField
            label={t('themesMore.search', { n: PRESETS.length })}
            value={query}
            onChangeText={(v) => {
              setQuery(v)
              setLimit(PAGE)
            }}
            autoCapitalize="none"
            autoCorrect={false}
          />
          {query.trim() ? null : (
            <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.chips}>
              {PRESET_GROUPS.map((g) => (
                <Pressable
                  key={g}
                  onPress={() => {
                    setGroup(g)
                    setLimit(PAGE)
                  }}
                  accessibilityRole="tab"
                  accessibilityState={{ selected: group === g }}
                  style={[styles.chip, group === g ? { backgroundColor: colors.primary, borderColor: colors.primary } : null]}
                >
                  <Text style={[styles.chipText, group === g ? { color: '#ffffff' } : null]}>{t(`themesMore.tab.${g}`)}</Text>
                </Pressable>
              ))}
            </ScrollView>
          )}
          <Text style={styles.count}>{shown.length ? t('themesMore.count', { n: shown.length }) : t('themesMore.noMatch')}</Text>
        </View>
        <View style={styles.grid}>
          {shown.slice(0, limit).map((th) => (
            <ThemeCard
              key={th.id}
              th={{ id: th.id, label: th.label[lang], palette: th.palette, gradient: th.gradient }}
              selected={prefs.theme === th.id}
              onPress={() => pickTheme(th.id)}
            />
          ))}
        </View>
        {shown.length > limit ? (
          <View style={{ padding: spacing.md }}>
            <Button
              title={t('themesMore.showMore', { n: shown.length - limit })}
              variant="secondary"
              onPress={() => setLimit((l) => l + PAGE * 2)}
            />
          </View>
        ) : null}
      </Section>

      <Section title={t('appearance.themeCustom')} footer={t('appearance.customFooter')}>
        {customs.length ? (
          <View style={styles.grid}>
            {customs.map((c) => (
              <ThemeCard
                key={c.id}
                th={{ id: c.id, label: c.name, palette: paletteFromSpec(c), gradient: c.gradient ? cssGradient(c.gradient) : null }}
                selected={prefs.theme === c.id}
                onPress={() => pickTheme(c.id, c)}
              />
            ))}
          </View>
        ) : null}
      </Section>

      <Section title={t('themeShare.title')} footer={t('themeShare.footer')}>
        <View style={{ padding: spacing.lg, gap: spacing.md }}>
          {current ? <Button title={t('themeShare.export')} variant="secondary" icon="share-outline" onPress={exportTheme} /> : null}
          <TextField label={t('themeShare.code')} value={code} onChangeText={setCode} autoCapitalize="none" autoCorrect={false} multiline />
          <Button title={t('themeShare.import')} icon="download-outline" disabled={!code.trim()} loading={importTheme.isPending} onPress={() => importTheme.mutate()} />
        </View>
      </Section>

      <Section>
        <Row icon="apps-outline" title={t('appIcon.open')} subtitle={t('appIcon.openDesc')} onPress={() => router.push('/settings/app-icon')} chevron />
      </Section>

      <Section title={t('appearance.accent')} footer={t('appearance.syncedF')}>
        <View style={styles.accents}>
          {ACCENTS.map((c) => {
            const selected = prefs.accent === c
            return (
              <Pressable
                key={c ?? 'theme'}
                onPress={() => {
                  saveAppearance({ accent: c })
                  save.mutate({ accent_color: c })
                }}
                accessibilityRole="button"
                accessibilityLabel={c ? t('appearance.accentLabel', { color: c }) : t('appearance.accentTheme')}
                accessibilityState={{ selected }}
                style={[styles.accent, { backgroundColor: c ?? colors.bgElevated, borderColor: selected ? colors.text : 'transparent' }]}
              >
                {c ? null : <Ionicons name="color-palette-outline" size={18} color={colors.textMuted} />}
              </Pressable>
            )
          })}
        </View>
      </Section>

      <Section title={t('appearance.density')} footer={t('appearance.densityFooter')}>
        {DENSITIES.map((d) => (
          <Row
            key={d.value}
            title={t(d.label)}
            selected={prefs.density === d.value}
            onPress={() => saveAppearance({ density: d.value })}
            right={prefs.density === d.value ? <Ionicons name="checkmark" size={20} color={colors.primary} /> : null}
          />
        ))}
      </Section>

      <Section title={t('appearance.textSize')}>
        {TEXT_SCALES.map((s) => (
          <Row
            key={s.value}
            title={t(s.label)}
            selected={prefs.textScale === s.value}
            onPress={() => saveAppearance({ textScale: s.value })}
            right={prefs.textScale === s.value ? <Ionicons name="checkmark" size={20} color={colors.primary} /> : null}
          />
        ))}
      </Section>

      <Section title={t('appearance.timeFormat')} footer={t('appearance.synced')}>
        {(['24h', '12h'] as const).map((f) => (
          <Row
            key={f}
            title={t(f === '24h' ? 'appearance.time24' : 'appearance.time12')}
            selected={prefs.timeFormat === f}
            onPress={() => {
              saveAppearance({ timeFormat: f })
              save.mutate({ time_format: f })
            }}
            right={prefs.timeFormat === f ? <Ionicons name="checkmark" size={20} color={colors.primary} /> : null}
          />
        ))}
      </Section>

      <Section footer={t('appearance.categoriesFoldedFooter')}>
        <SwitchRow
          icon="list-outline"
          title={t('appearance.categoriesFolded')}
          value={prefs.categoriesFolded}
          onValueChange={(v) => saveAppearance({ categoriesFolded: v })}
        />
      </Section>

      <Section footer={t('appearance.streamerFooter')}>
        <SwitchRow
          icon="videocam-outline"
          title={t('appearance.streamer')}
          value={prefs.streamerMode}
          onValueChange={(v) => {
            saveAppearance({ streamerMode: v })
            save.mutate({ streamer_mode: v })
          }}
        />
      </Section>
    </ScrollView>
  )
}

const styles = StyleSheet.create({
  pending: { backgroundColor: colors.bgAlt, borderRadius: radius.lg, padding: spacing.lg, gap: spacing.md, marginBottom: spacing.xl },
  pendingText: { color: colors.text, fontSize: font.sm },
  grid: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.sm, padding: spacing.md },
  card: { width: '31%', flexGrow: 1, borderRadius: radius.md, borderWidth: 2, padding: spacing.sm, gap: spacing.sm },
  swatches: { flexDirection: 'row', gap: 4 },
  swatch: { flex: 1, height: 18, borderRadius: 4 },
  cardLabel: { fontSize: font.xs, fontWeight: '700' },
  check: { position: 'absolute', top: 4, right: 4 },
  chips: { gap: spacing.xs, paddingVertical: spacing.xs },
  chip: { paddingHorizontal: spacing.md, paddingVertical: 6, borderRadius: radius.full, borderWidth: 1, borderColor: colors.border },
  chipText: { color: colors.textMuted, fontSize: font.sm, fontWeight: '600' },
  count: { color: colors.textMuted, fontSize: font.xs },
  accents: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.md, padding: spacing.lg },
  accent: { width: 36, height: 36, borderRadius: radius.full, borderWidth: 3, alignItems: 'center', justifyContent: 'center' },
})
