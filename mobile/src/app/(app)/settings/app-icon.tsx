import { Ionicons } from '@expo/vector-icons'
import { Image } from 'expo-image'
import { useEffect, useState } from 'react'
import { AccessibilityInfo, ActivityIndicator, Alert, Platform, Pressable, ScrollView, StyleSheet, Text, View, type ImageSourcePropType } from 'react-native'
import { Section } from '@/components/ui'
import { APP_ENV } from '@/config/env'
import { appIconSupported, applyAppIcon, currentAppIcon } from '@/features/appearance/appIcon'
import { presetId, presetNumber, type AppIconId } from '@/features/appearance/appIconIds'
import { DEFAULT_DEV_PREVIEW, DEFAULT_PREVIEW, PRESET_GROUPS, PRESET_PREVIEWS } from '@/features/appearance/appIconPreviews'
import { useT, type Key } from '@/i18n'
import { errorMessage } from '@/lib/http'
import { colors, font, radius, spacing } from '@/theme'
import { useAppearance } from '@/theme/prefs'

/** Icône d'origine de CE build (app.config.ts : variante orange « DEV » hors version publique). */
const DEFAULT_ICON = APP_ENV === 'production' ? DEFAULT_PREVIEW : DEFAULT_DEV_PREVIEW
const PRESET_NAMES = new Map(PRESET_GROUPS.flatMap((g) => g.presets.map((p) => [p.n, p.name] as const)))

function Tile({ source, label, selected, disabled, onPress }: { source: ImageSourcePropType; label: string; selected: boolean; disabled: boolean; onPress: () => void }) {
  return (
    <Pressable
      onPress={onPress}
      disabled={disabled}
      accessibilityRole="radio"
      accessibilityLabel={label}
      accessibilityState={{ checked: selected, disabled }}
      style={({ pressed }) => [styles.tile, { borderColor: selected ? colors.primary : 'transparent' }, pressed ? { opacity: 0.7 } : null]}
    >
      <Image source={source} style={styles.icon} contentFit="cover" />
      {selected ? <Ionicons name="checkmark-circle" size={18} color={colors.primary} style={styles.check} /> : null}
    </Pressable>
  )
}

/** Réglages → Apparence → Icône de l'app : les icônes du web et du bureau (par familles), plus celle d'origine. */
export default function AppIconScreen() {
  const t = useT()
  const saved = useAppearance((s) => s.appIcon)
  const [supported, setSupported] = useState<boolean | null>(null)
  const [busy, setBusy] = useState(false)

  useEffect(() => {
    let alive = true
    void appIconSupported().then(async (ok) => {
      // Le système fait foi (réinstallation, restauration) : le choix enregistré est resynchronisé.
      if (ok) await currentAppIcon().catch(() => null)
      if (alive) setSupported(ok)
    })
    return () => {
      alive = false
    }
  }, [])

  const pick = async (id: AppIconId | null) => {
    if (busy || id === saved) return
    setBusy(true)
    try {
      await applyAppIcon(id)
      AccessibilityInfo.announceForAccessibility(t('appIcon.applied'))
    } catch (e) {
      Alert.alert(t('appIcon.title'), t('appIcon.failed', { error: errorMessage(e) }))
    } finally {
      setBusy(false)
    }
  }

  const n = presetNumber(saved)
  const tr = (key: string, fallback: string) => {
    const v = t(key as Key)
    return v === key ? fallback : v
  }
  const currentName = n === null ? t('appIcon.default') : PRESET_NAMES.has(n) ? tr(`appIcon.p.${n}`, PRESET_NAMES.get(n) ?? '') : t('appIcon.preset', { n })

  return (
    <ScrollView style={{ backgroundColor: colors.bg }} contentContainerStyle={{ padding: spacing.lg }}>
      {supported === null ? <ActivityIndicator color={colors.primary} style={{ marginTop: spacing.xl }} /> : null}
      {supported === false ? (
        <View style={styles.note}>
          <Ionicons name="information-circle-outline" size={20} color={colors.textMuted} />
          <Text style={styles.noteText}>{t('appIcon.unsupported')}</Text>
        </View>
      ) : null}
      {supported ? (
        <>
          <View style={styles.note}>
            <Ionicons name={Platform.OS === 'ios' ? 'notifications-outline' : 'refresh-outline'} size={20} color={colors.textMuted} />
            <Text style={styles.noteText}>{t(Platform.OS === 'ios' ? 'appIcon.noteIos' : 'appIcon.noteAndroid')}</Text>
          </View>
          <Section title={t('appIcon.current', { name: currentName })} footer={t('appIcon.hint')}>
            <View style={styles.grid} accessibilityRole="radiogroup" accessibilityLabel={t('appIcon.title')}>
              <Tile source={DEFAULT_ICON} label={t('appIcon.default')} selected={saved === null} disabled={busy} onPress={() => void pick(null)} />
            </View>
          </Section>
          {PRESET_GROUPS.map((g) => (
            <Section key={g.id} title={tr(`appIcon.group.${g.id}`, g.label)}>
              <View style={styles.grid} accessibilityRole="radiogroup" accessibilityLabel={tr(`appIcon.group.${g.id}`, g.label)}>
                {g.presets.map((p) => (
                  <Tile
                    key={p.n}
                    source={PRESET_PREVIEWS[p.n]!}
                    label={tr(`appIcon.p.${p.n}`, p.name)}
                    selected={saved === presetId(p.n)}
                    disabled={busy}
                    onPress={() => void pick(presetId(p.n))}
                  />
                ))}
              </View>
            </Section>
          ))}
        </>
      ) : null}
    </ScrollView>
  )
}

const styles = StyleSheet.create({
  note: { flexDirection: 'row', gap: spacing.md, backgroundColor: colors.bgAlt, borderRadius: radius.lg, padding: spacing.lg, marginBottom: spacing.xl },
  noteText: { flex: 1, color: colors.text, fontSize: font.sm },
  grid: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.sm, padding: spacing.md, justifyContent: 'center' },
  tile: { width: 64, height: 64, borderRadius: radius.lg, borderWidth: 2, padding: 2 },
  icon: { flex: 1, borderRadius: radius.md },
  check: { position: 'absolute', top: -6, right: -6 },
})
