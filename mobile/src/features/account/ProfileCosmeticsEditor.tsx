import { useState } from 'react'
import { Pressable, ScrollView, StyleSheet, Text, View } from 'react-native'
import { Avatar } from '@/components/Avatar'
import { ProfileEffect, ProfileThemeCard } from '@/components/ProfileDecor'
import { DECORATIONS, PROFILE_EFFECTS, THEME_SWATCHES, hexColor } from '@/features/account/profileDecor'
import { useT } from '@/i18n'
import { colors, font, radius, spacing } from '@/theme'

export interface Cosmetics {
  decoration: string
  primary: number | null
  accent: number | null
  effect: string
}

/** Décoration d'avatar, thème et effet du profil (gratuits), avec aperçu. */
export function ProfileCosmeticsEditor({
  value,
  onChange,
  avatar,
  name,
}: {
  value: Cosmetics
  onChange: (v: Cosmetics) => void
  avatar: string | null
  name: string
}) {
  const t = useT()
  const [replay, setReplay] = useState(0)
  const set = (patch: Partial<Cosmetics>) => onChange({ ...value, ...patch })

  const chip = (label: string, selected: boolean, onPress: () => void, key: string) => (
    <Pressable
      key={key}
      onPress={onPress}
      accessibilityRole="button"
      accessibilityState={{ selected }}
      style={[styles.chip, selected && styles.chipOn]}
    >
      <Text style={{ color: selected ? '#fff' : colors.textSecondary, fontSize: font.sm }}>{label}</Text>
    </Pressable>
  )

  const swatches = (label: string, current: number | null, pick: (c: number | null) => void) => (
    <View style={{ gap: spacing.sm }}>
      <Text style={styles.label}>{label}</Text>
      <View style={styles.wrap}>
        {chip(t('settings.cosmetics.default'), current == null, () => pick(null), 'none')}
        {THEME_SWATCHES.map((c) => (
          <Pressable
            key={c}
            onPress={() => pick(c)}
            accessibilityRole="button"
            accessibilityLabel={t('settings.cosmetics.colorA11y', { hex: hexColor(c) })}
            accessibilityState={{ selected: current === c }}
            style={[styles.swatch, { backgroundColor: hexColor(c) }, current === c && styles.swatchOn]}
          />
        ))}
      </View>
    </View>
  )

  return (
    <View style={{ gap: spacing.lg }}>
      <Text style={styles.title}>{t('settings.cosmetics.title')}</Text>

      <Pressable onPress={() => setReplay((n) => n + 1)} accessibilityRole="button" accessibilityLabel={t('settings.cosmetics.replay')}>
        <ProfileThemeCard primary={value.primary} accent={value.accent} style={styles.preview}>
          <ProfileEffect key={`${value.effect}-${replay}`} id={value.effect} />
          <Avatar uri={avatar} name={name} size={64} decoration={value.decoration} />
          <Text style={[styles.previewName, value.primary == null && value.accent == null && { color: colors.text }]}>{name}</Text>
        </ProfileThemeCard>
      </Pressable>

      <Text style={styles.label}>{t('settings.cosmetics.decoration')}</Text>
      <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ gap: spacing.md, padding: spacing.sm }}>
        {[{ id: '', label: 'settings.cosmetics.noDecoration' as const }, ...DECORATIONS].map((d) => (
          <Pressable
            key={d.id || 'none'}
            onPress={() => set({ decoration: d.id })}
            accessibilityRole="button"
            accessibilityLabel={t('settings.cosmetics.decorationA11y', { name: t(d.label) })}
            accessibilityState={{ selected: value.decoration === d.id }}
            style={[styles.deco, value.decoration === d.id && styles.decoOn]}
          >
            <Avatar uri={avatar} name={name} size={40} decoration={d.id} />
            <Text style={styles.decoLabel} numberOfLines={1}>
              {t(d.label)}
            </Text>
          </Pressable>
        ))}
      </ScrollView>

      {swatches(t('settings.cosmetics.primary'), value.primary, (c) => set({ primary: c }))}
      {swatches(t('settings.cosmetics.accent'), value.accent, (c) => set({ accent: c }))}

      <Text style={styles.label}>{t('settings.cosmetics.effect')}</Text>
      <View style={styles.wrap}>
        {chip(t('settings.cosmetics.noEffect'), !value.effect, () => set({ effect: '' }), 'none')}
        {PROFILE_EFFECTS.map((e) => chip(t(e.label), value.effect === e.id, () => set({ effect: e.id }), e.id))}
      </View>
    </View>
  )
}

const styles = StyleSheet.create({
  title: { color: colors.text, fontSize: font.lg, fontWeight: '700' },
  label: { color: colors.textMuted, fontSize: font.sm, fontWeight: '600' },
  wrap: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.sm },
  chip: { paddingHorizontal: spacing.md, paddingVertical: 6, borderRadius: radius.full, backgroundColor: colors.bgElevated },
  chipOn: { backgroundColor: colors.primary },
  swatch: { width: 30, height: 30, borderRadius: 15, borderWidth: 2, borderColor: 'transparent' },
  swatchOn: { borderColor: colors.text },
  preview: { flexDirection: 'row', alignItems: 'center', gap: spacing.lg, padding: spacing.xl, borderRadius: radius.lg, backgroundColor: colors.bgElevated, minHeight: 110 },
  previewName: { color: '#fff', fontWeight: '700', fontSize: font.lg },
  deco: { alignItems: 'center', gap: 6, padding: spacing.sm, borderRadius: radius.md, borderWidth: 1, borderColor: 'transparent', width: 76 },
  decoOn: { borderColor: colors.primary },
  decoLabel: { color: colors.textMuted, fontSize: font.xs },
})
