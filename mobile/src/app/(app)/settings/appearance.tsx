import { Ionicons } from '@expo/vector-icons'
import { useMutation } from '@tanstack/react-query'
import { Alert, Platform, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native'
import { settingsApi, settingsKey, type ServerSideSettings } from '@/api/settings'
import { Button, Row, Section, SwitchRow } from '@/components/ui'
import { restartApp } from '@/features/appearance/sync'
import { errorMessage } from '@/lib/http'
import { queryClient } from '@/lib/queryClient'
import { colors, font, radius, spacing } from '@/theme'
import { THEMES } from '@/theme/palettes'
import { appearance, saveAppearance, TEXT_SCALES, useAppearance, type AppearancePrefs } from '@/theme/prefs'

/** Accents proposés (null = celui du thème) : accent_color du web, partagé entre appareils. */
const ACCENTS = [null, '#5865f2', '#00a8fc', '#23a55a', '#f0b232', '#e67e22', '#f23f43', '#eb6f92', '#9b59b6'] as const

/** Réglages qui ne s'appliquent qu'au lancement (couleurs et tailles lues avant tout écran). */
const needsRestart = (p: AppearancePrefs) => p.theme !== appearance.theme || p.accent !== appearance.accent || p.textScale !== appearance.textScale

export default function AppearanceScreen() {
  const prefs = useAppearance()
  const save = useMutation({
    mutationFn: (patch: Partial<ServerSideSettings>) => settingsApi.update(patch),
    onSuccess: (data) => queryClient.setQueryData(settingsKey, data),
    onError: (e) => Alert.alert('Réglage non synchronisé', `Gardé sur cet appareil seulement.\n${errorMessage(e)}`),
  })

  const restart = () => {
    if (!restartApp()) Alert.alert('Thème enregistré', 'Ferme et rouvre l’app pour appliquer le thème.')
  }

  return (
    <ScrollView style={{ backgroundColor: colors.bg }} contentContainerStyle={{ padding: spacing.lg }}>
      {needsRestart(prefs) ? (
        <View style={styles.pending}>
          <Text style={styles.pendingText}>
            {Platform.OS === 'android' ? 'Redémarre l’app pour appliquer les couleurs et la taille du texte.' : 'Ferme et rouvre l’app pour appliquer les couleurs et la taille du texte.'}
          </Text>
          {Platform.OS === 'android' ? <Button title="Redémarrer maintenant" icon="refresh" onPress={restart} /> : null}
        </View>
      ) : null}

      <Section title="Thème" footer="Mêmes thèmes que sur le web. Le thème est propre à cet appareil.">
        <View style={styles.grid}>
          {THEMES.map((t) => {
            const selected = prefs.theme === t.id
            return (
              <Pressable
                key={t.id}
                onPress={() => saveAppearance({ theme: t.id })}
                accessibilityRole="button"
                accessibilityLabel={`Thème ${t.label}`}
                accessibilityState={{ selected }}
                style={[styles.card, { backgroundColor: t.palette.bg, borderColor: selected ? colors.primary : colors.border }]}
              >
                <View style={styles.swatches}>
                  {[t.palette.bgDeep, t.palette.bgAlt, t.palette.primary, t.palette.text].map((c, i) => (
                    <View key={i} style={[styles.swatch, { backgroundColor: c }]} />
                  ))}
                </View>
                <Text style={[styles.cardLabel, { color: t.palette.text }]} numberOfLines={1}>
                  {t.label}
                </Text>
                {selected ? <Ionicons name="checkmark-circle" size={18} color={colors.primary} style={styles.check} /> : null}
              </Pressable>
            )
          })}
        </View>
      </Section>

      <Section title="Couleur d'accent" footer="Synchronisée avec le web.">
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
                accessibilityLabel={c ? `Accent ${c}` : 'Accent du thème'}
                accessibilityState={{ selected }}
                style={[styles.accent, { backgroundColor: c ?? colors.bgElevated, borderColor: selected ? colors.text : 'transparent' }]}
              >
                {c ? null : <Ionicons name="color-palette-outline" size={18} color={colors.textMuted} />}
              </Pressable>
            )
          })}
        </View>
      </Section>

      <Section title="Taille du texte">
        {TEXT_SCALES.map((s) => (
          <Row
            key={s.value}
            title={s.label}
            selected={prefs.textScale === s.value}
            onPress={() => saveAppearance({ textScale: s.value })}
            right={prefs.textScale === s.value ? <Ionicons name="checkmark" size={20} color={colors.primary} /> : null}
          />
        ))}
      </Section>

      <Section title="Format de l'heure" footer="Synchronisé avec le web.">
        {(['24h', '12h'] as const).map((f) => (
          <Row
            key={f}
            title={f === '24h' ? '24 heures (14:05)' : '12 heures (02:05 PM)'}
            selected={prefs.timeFormat === f}
            onPress={() => {
              saveAppearance({ timeFormat: f })
              save.mutate({ time_format: f })
            }}
            right={prefs.timeFormat === f ? <Ionicons name="checkmark" size={20} color={colors.primary} /> : null}
          />
        ))}
      </Section>

      <Section footer="Masque ton tag et les codes d'invitation à l'écran, comme sur le web.">
        <SwitchRow
          icon="videocam-outline"
          title="Mode streamer"
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
