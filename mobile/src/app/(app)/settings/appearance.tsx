import { Ionicons } from '@expo/vector-icons'
import { useMutation } from '@tanstack/react-query'
import { Alert, Platform, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native'
import { settingsApi, settingsKey, type ServerSideSettings } from '@/api/settings'
import { Button, Row, Section, SwitchRow } from '@/components/ui'
import { restartApp } from '@/features/appearance/sync'
import { useLang, useT, type Lang } from '@/i18n'
import { errorMessage } from '@/lib/http'
import { queryClient } from '@/lib/queryClient'
import { colors, font, radius, spacing } from '@/theme'
import { THEMES } from '@/theme/palettes'
import { appearance, saveAppearance, TEXT_SCALES, useAppearance, type AppearancePrefs } from '@/theme/prefs'

/** Langues traduites (libellés dans leur propre langue, jamais traduits). */
const LANGS: { code: Lang; label: string }[] = [
  { code: 'fr', label: 'Français' },
  { code: 'en', label: 'English' },
]

/** Accents proposés (null = celui du thème) : accent_color du web, partagé entre appareils. */
const ACCENTS = [null, '#5865f2', '#00a8fc', '#23a55a', '#f0b232', '#e67e22', '#f23f43', '#eb6f92', '#9b59b6'] as const

/** Réglages qui ne s'appliquent qu'au lancement (couleurs et tailles lues avant tout écran). */
const needsRestart = (p: AppearancePrefs) => p.theme !== appearance.theme || p.accent !== appearance.accent || p.textScale !== appearance.textScale

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
        <View style={styles.grid}>
          {THEMES.map((th) => {
            const selected = prefs.theme === th.id
            return (
              <Pressable
                key={th.id}
                onPress={() => {
                  saveAppearance({ theme: th.id })
                  settingsApi.setTheme(th.id).catch(() => undefined)
                }}
                accessibilityRole="button"
                accessibilityLabel={t('appearance.themeLabel', { name: th.label })}
                accessibilityState={{ selected }}
                style={[styles.card, { backgroundColor: th.palette.bg, borderColor: selected ? colors.primary : colors.border }]}
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
          })}
        </View>
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
  accents: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.md, padding: spacing.lg },
  accent: { width: 36, height: 36, borderRadius: radius.full, borderWidth: 3, alignItems: 'center', justifyContent: 'center' },
})
