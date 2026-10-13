import { useMemo, useState } from 'react'
import { Pressable, ScrollView, StyleSheet, Switch, Text, TextInput, View } from 'react-native'
import { Avatar } from '@/components/Avatar'
import { ProfileEffect, ProfileThemeCard } from '@/components/ProfileDecor'
import {
  DECORATIONS, DECO_GROUPS, DECO_OPTS_DEFAULT, DECO_RANGES, FX_GROUPS, FX_INTENSITY, PROFILE_EFFECTS,
  cleanDecoOpts, cleanIntensity, decoOptsPayload, searchKey, type DecoNumKey, type DecoOpts,
} from '@/features/account/profileDecor'
import { ColorPicker } from './ColorPicker'
import { useT, type Key } from '@/i18n'
import { colors, font, radius, spacing } from '@/theme'

export interface Cosmetics {
  decoration: string
  /** Réglages de la décoration (users.avatar_decoration_opts). */
  opts: DecoOpts
  primary: number | null
  accent: number | null
  effect: string
  /** Intensité de l'effet en % (25-200). */
  intensity: number
}

const DECO_BY_ID = new Map(DECORATIONS.map((d) => [d.id, d]))
const FX_BY_ID = new Map(PROFILE_EFFECTS.map((f) => [f.id, f]))
/** Pas des boutons − / + de chaque réglage numérique. */
const STEP: Record<DecoNumKey, number> = { speed: 25, brightness: 10, saturation: 10, glow: 25, opacity: 10, hue: 30, scale: 5 }
const OPT_LABEL: Record<DecoNumKey, Key> = {
  speed: 'pdeco.opts.speed', brightness: 'pdeco.opts.brightness', saturation: 'pdeco.opts.saturation', glow: 'pdeco.opts.glow',
  opacity: 'pdeco.opts.opacity', hue: 'pdeco.opts.hue', scale: 'pdeco.opts.scale',
}

/** Décoration d'avatar (et ses réglages), thème et effet du profil (gratuits), avec aperçu. */
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
  const [decoQuery, setDecoQuery] = useState('')
  const [decoCat, setDecoCat] = useState('')
  const [fxQuery, setFxQuery] = useState('')
  const [fxCat, setFxCat] = useState('')
  const set = (patch: Partial<Cosmetics>) => onChange({ ...value, ...patch })
  const setOpts = (patch: Partial<DecoOpts>) => set({ opts: cleanDecoOpts({ ...value.opts, ...patch }) })

  // Filtre par catégorie et recherche (libellé traduit ou identifiant) ; la liste horizontale
  // ne rend que les vignettes visibles, l'animation de chacune reste légère (un seul Animated).
  const decoIds = useMemo(() => {
    const q = searchKey(decoQuery)
    return DECO_GROUPS.filter((g) => !decoCat || g.id === decoCat)
      .flatMap((g) => g.ids)
      .filter((id) => {
        const d = DECO_BY_ID.get(id)
        return d && (!q || searchKey(t(d.label)).includes(q) || id.includes(q))
      })
  }, [decoQuery, decoCat, t])
  const fxIds = useMemo(() => {
    const q = searchKey(fxQuery)
    return FX_GROUPS.filter((g) => !fxCat || g.id === fxCat)
      .flatMap((g) => g.ids)
      .filter((id) => {
        const f = FX_BY_ID.get(id)
        return f && (!q || searchKey(t(f.label)).includes(q) || id.includes(q))
      })
  }, [fxQuery, fxCat, t])

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

  const bar = (query: string, setQuery: (s: string) => void, cat: string, setCat: (s: string) => void, groups: { id: string; label: Key }[], all: string, a11y: string) => (
    <View style={{ gap: spacing.sm }}>
      <TextInput
        value={query}
        onChangeText={setQuery}
        placeholder={t('pdeco.search')}
        placeholderTextColor={colors.textMuted}
        accessibilityLabel={a11y}
        maxLength={40}
        style={styles.search}
      />
      <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ gap: spacing.sm }}>
        {chip(all, !cat, () => setCat(''), 'all')}
        {groups.map((g) => chip(t(g.label), cat === g.id, () => setCat(g.id), g.id))}
      </ScrollView>
    </View>
  )

  // Couleur libre (nuancier + teinte + #rrggbb) ; « par défaut » = null.
  const swatches = (label: string, current: number | null, pick: (c: number | null) => void) => (
    <ColorPicker label={label} value={current} onChange={pick} onClear={() => pick(null)} clearLabel={t('settings.cosmetics.default')} />
  )

  const stepper = (key: DecoNumKey) => {
    const [min, max] = DECO_RANGES[key]
    const n = value.opts[key]
    const label = t(OPT_LABEL[key], { n })
    return (
      <View key={key} style={styles.row}>
        <Text style={styles.optLabel}>{label}</Text>
        <Pressable onPress={() => setOpts({ [key]: Math.max(min, n - STEP[key]) })} disabled={n <= min} accessibilityRole="button" accessibilityLabel={`${t('pdeco.opts.less')} — ${label}`} style={[styles.step, n <= min && styles.dim]}>
          <Text style={styles.stepText}>−</Text>
        </Pressable>
        <Pressable onPress={() => setOpts({ [key]: Math.min(max, n + STEP[key]) })} disabled={n >= max} accessibilityRole="button" accessibilityLabel={`${t('pdeco.opts.more')} — ${label}`} style={[styles.step, n >= max && styles.dim]}>
          <Text style={styles.stepText}>+</Text>
        </Pressable>
      </View>
    )
  }

  const isDefault = Object.keys(decoOptsPayload(value.opts)).length === 0

  return (
    <View style={{ gap: spacing.lg }}>
      <Text style={styles.title}>{t('settings.cosmetics.title')}</Text>

      <Pressable onPress={() => setReplay((n) => n + 1)} accessibilityRole="button" accessibilityLabel={t('settings.cosmetics.replay')}>
        <ProfileThemeCard primary={value.primary} accent={value.accent} style={styles.preview}>
          <ProfileEffect key={`${value.effect}-${value.intensity}-${replay}`} id={value.effect} intensity={value.intensity} />
          <Avatar uri={avatar} name={name} size={64} decoration={value.decoration} decorationOpts={value.opts} />
          <Text style={[styles.previewName, value.primary == null && value.accent == null && { color: colors.text }]}>{name}</Text>
        </ProfileThemeCard>
      </Pressable>

      <Text style={styles.label}>{t('settings.cosmetics.decoration')}</Text>
      {bar(decoQuery, setDecoQuery, decoCat, setDecoCat, DECO_GROUPS, t('pdeco.all'), t('pdeco.searchA11y'))}
      <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ gap: spacing.md, padding: spacing.sm }}>
        {(decoQuery || decoCat ? decoIds : ['', ...decoIds]).map((id) => {
          const d = DECO_BY_ID.get(id)
          const label = d ? t(d.label) : t('settings.cosmetics.noDecoration')
          return (
            <Pressable
              key={id || 'none'}
              onPress={() => set({ decoration: id })}
              accessibilityRole="button"
              accessibilityLabel={t('settings.cosmetics.decorationA11y', { name: label })}
              accessibilityState={{ selected: value.decoration === id }}
              style={[styles.deco, value.decoration === id && styles.decoOn]}
            >
              <Avatar uri={avatar} name={name} size={40} decoration={id} />
              <Text style={styles.decoLabel} numberOfLines={1}>
                {label}
              </Text>
            </Pressable>
          )
        })}
        {!decoIds.length ? <Text style={styles.decoLabel}>{t('pdeco.noMatch')}</Text> : null}
      </ScrollView>

      {value.decoration ? (
        <View style={{ gap: spacing.sm }}>
          <Text style={styles.label}>{t('pdeco.opts.title')}</Text>
          <Text style={styles.hint}>{t('pdeco.opts.hint')}</Text>
          <View style={styles.row}>
            <Text style={styles.optLabel}>{t('pdeco.opts.animate')}</Text>
            <Switch value={value.opts.animate} onValueChange={(on) => setOpts({ animate: on })} accessibilityLabel={t('pdeco.opts.animate')} />
          </View>
          <View style={styles.row}>
            <Text style={styles.optLabel}>{t('pdeco.opts.pulse')}</Text>
            <Switch value={value.opts.pulse} onValueChange={(on) => setOpts({ pulse: on })} accessibilityLabel={t('pdeco.opts.pulse')} />
          </View>
          <View style={styles.row}>
            <Text style={styles.optLabel}>{t('pdeco.opts.direction')}</Text>
            {chip(t('pdeco.opts.cw'), value.opts.direction === 'cw', () => setOpts({ direction: 'cw' }), 'cw')}
            {chip(t('pdeco.opts.ccw'), value.opts.direction === 'ccw', () => setOpts({ direction: 'ccw' }), 'ccw')}
          </View>
          {(Object.keys(DECO_RANGES) as DecoNumKey[]).map(stepper)}
          {swatches(t('pdeco.opts.tint'), value.opts.tint, (c) => setOpts({ tint: c }))}
          {!isDefault ? chip(t('pdeco.opts.reset'), false, () => set({ opts: { ...DECO_OPTS_DEFAULT } }), 'reset') : null}
        </View>
      ) : null}

      {swatches(t('settings.cosmetics.primary'), value.primary, (c) => set({ primary: c }))}
      {swatches(t('settings.cosmetics.accent'), value.accent, (c) => set({ accent: c }))}

      <Text style={styles.label}>{t('settings.cosmetics.effect')}</Text>
      {bar(fxQuery, setFxQuery, fxCat, setFxCat, FX_GROUPS, t('pfx.all'), t('pfx.searchA11y'))}
      <View style={styles.wrap}>
        {!fxQuery && !fxCat ? chip(t('settings.cosmetics.noEffect'), !value.effect, () => set({ effect: '' }), 'none') : null}
        {fxIds.map((id) => chip(t(FX_BY_ID.get(id)!.label), value.effect === id, () => set({ effect: id }), id))}
        {!fxIds.length ? <Text style={styles.decoLabel}>{t('pdeco.noMatch')}</Text> : null}
      </View>
      {value.effect ? (
        <View style={styles.row}>
          <Text style={styles.optLabel}>{t('pfx.intensity', { n: value.intensity })}</Text>
          <Pressable onPress={() => set({ intensity: cleanIntensity(value.intensity - 25) })} disabled={value.intensity <= FX_INTENSITY[0]} accessibilityRole="button" accessibilityLabel={t('pdeco.opts.less')} style={[styles.step, value.intensity <= FX_INTENSITY[0] && styles.dim]}>
            <Text style={styles.stepText}>−</Text>
          </Pressable>
          <Pressable onPress={() => set({ intensity: cleanIntensity(value.intensity + 25) })} disabled={value.intensity >= FX_INTENSITY[1]} accessibilityRole="button" accessibilityLabel={t('pdeco.opts.more')} style={[styles.step, value.intensity >= FX_INTENSITY[1] && styles.dim]}>
            <Text style={styles.stepText}>+</Text>
          </Pressable>
        </View>
      ) : null}
    </View>
  )
}

const styles = StyleSheet.create({
  title: { color: colors.text, fontSize: font.lg, fontWeight: '700' },
  label: { color: colors.textMuted, fontSize: font.sm, fontWeight: '600' },
  hint: { color: colors.textMuted, fontSize: font.xs },
  wrap: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.sm },
  row: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm },
  optLabel: { color: colors.textSecondary, fontSize: font.sm, flex: 1 },
  step: { width: 36, height: 32, borderRadius: radius.md, backgroundColor: colors.bgElevated, alignItems: 'center', justifyContent: 'center' },
  stepText: { color: colors.text, fontSize: font.lg, fontWeight: '700' },
  dim: { opacity: 0.4 },
  search: { color: colors.text, backgroundColor: colors.bgElevated, borderRadius: radius.md, paddingHorizontal: spacing.md, paddingVertical: 8, fontSize: font.sm },
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
