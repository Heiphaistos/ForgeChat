import { useState } from 'react'
import { Pressable, StyleSheet, Text, View } from 'react-native'
import { StyledName, previewName } from '@/components/UserName'
import { THEME_SWATCHES } from '@/features/account/profileDecor'
import { useT, type Key } from '@/i18n'
import { ColorPicker } from './ColorPicker'
import { Stepper } from './editorKit'
import { effectLabel, fontLabel } from './nameStyleLabels'
import {
  LEVEL_DEFAULT, LEVEL_MAX, NAME_COLORS_MAX, NAME_EFFECTS, NAME_FONTS, NAME_GRADIENTS, OUTLINE_STYLES, OUTLINE_WIDTH_MAX,
  level, toHex, type NameStyle,
} from '@/lib/nameStyle'
import { colors, font, radius, spacing } from '@/theme'

/** Couleurs proposées pour le pseudo (en plus de la teinte libre et de la saisie hexadécimale). */
const NAME_SWATCHES = [...THEME_SWATCHES.slice(0, 10), 0xffffff, 0xff00e5, 0x00f0ff, 0x7dffb0]
const OUTLINE_SWATCHES = [0x000000, 0xffffff, ...NAME_SWATCHES.slice(0, 8)]
/** Angle du dégradé (models/profile_style.rs : 0-360, 90 par défaut), par pas de 15°. */
const ANGLE_MAX = 360
const ANGLE_DEFAULT = 90

/**
 * Style du pseudo : défaut / uni / dégradé (2 à 5 couleurs, angle, type), effet (intensité,
 * vitesse), police, contour (épaisseur, style, couleurs), aperçu en direct. Bornes du serveur.
 */
export function NameStyleEditor({ value, onChange, name, tag }: { value: NameStyle; onChange: (v: NameStyle) => void; name: string; tag?: string }) {
  const t = useT()
  const [slot, setSlot] = useState(0)
  const cs = value.colors
  const mode = cs.length === 0 ? 'default' : cs.length === 1 ? 'solid' : 'gradient'
  const set = (patch: Partial<NameStyle>) => onChange({ ...value, ...patch })
  const setColors = (next: number[]) => {
    set({ colors: next })
    setSlot((s) => Math.min(s, Math.max(0, next.length - 1)))
  }
  const setSlotColor = (c: number) => setColors(cs.map((x, i) => (i === slot ? c : x)))

  const chip = (label: string, selected: boolean, onPress: () => void, key: string) => (
    <Pressable key={key} onPress={onPress} accessibilityRole="button" accessibilityState={{ selected }} style={[styles.chip, selected && styles.chipOn]}>
      <Text style={{ color: selected ? '#fff' : colors.textSecondary, fontSize: font.sm }}>{label}</Text>
    </Pressable>
  )

  const intensity = level(value.intensity ?? LEVEL_DEFAULT)
  const speed = level(value.speed ?? LEVEL_DEFAULT)
  const angle = Math.min(ANGLE_MAX, Math.max(0, Math.round(value.angle ?? ANGLE_DEFAULT)))
  const width = Math.min(OUTLINE_WIDTH_MAX, Math.max(0, value.outline_width ?? 0))
  // L'angle ne vaut que pour le dégradé linéaire (fixe ou animé).
  const angled = mode === 'gradient' && (!value.gradient || value.gradient === 'flow')

  return (
    <View style={{ gap: spacing.md }}>
      <Text style={styles.title}>{t('settings.nameStyle.title')}</Text>
      <View style={styles.preview} accessible accessibilityLabel={t('settings.nameStyle.preview')}>
        <StyledName text={name} resolved={previewName(value)} style={styles.previewName} tag={tag} tagStyle={value.tag} />
      </View>

      <View style={styles.wrap}>
        {chip(t('settings.nameStyle.default'), mode === 'default', () => setColors([]), 'default')}
        {chip(t('settings.nameStyle.solid'), mode === 'solid', () => setColors([cs[0] ?? NAME_SWATCHES[0]!]), 'solid')}
        {chip(t('settings.nameStyle.gradient'), mode === 'gradient', () => setColors(cs.length >= 2 ? cs : [cs[0] ?? 0x5865f2, 0xeb459e]), 'gradient')}
      </View>

      {cs.length ? (
        <>
          <View style={styles.wrap}>
            {cs.map((c, i) => (
              <Pressable
                key={i}
                onPress={() => setSlot(i)}
                accessibilityRole="button"
                accessibilityLabel={t('settings.nameStyle.slotA11y', { n: i + 1, hex: toHex(c) })}
                accessibilityState={{ selected: slot === i }}
                style={[styles.slot, { backgroundColor: toHex(c) }, slot === i && styles.swatchOn]}
              />
            ))}
            {mode === 'gradient' && cs.length < NAME_COLORS_MAX ? chip(t('settings.nameStyle.addColor'), false, () => setColors([...cs, 0xfaa61a]), 'add') : null}
            {mode === 'gradient' && cs.length > 2 ? chip(t('settings.nameStyle.removeColor'), false, () => setColors(cs.filter((_, i) => i !== slot)), 'rm') : null}
          </View>
          <ColorPicker value={cs[slot]} onChange={setSlotColor} swatches={NAME_SWATCHES} />
        </>
      ) : null}

      {mode === 'gradient' ? (
        <>
          <Text style={styles.label}>{t('settings.nameStyle.gradientType')}</Text>
          <View style={styles.wrap}>
            {NAME_GRADIENTS.map((g) => chip(t(`settings.nameStyle.gradient.${g || 'linear'}` as Key), (value.gradient ?? '') === g, () => set({ gradient: g }), g || 'linear'))}
          </View>
          {angled ? <Stepper label={t('settings.nameStyle.angle', { n: angle })} value={angle} min={0} max={ANGLE_MAX} step={15} onChange={(n) => set({ angle: n })} /> : null}
        </>
      ) : null}

      <Text style={styles.label}>{t('settings.nameStyle.effect')}</Text>
      <View style={styles.wrap}>{NAME_EFFECTS.map((e) => chip(t(effectLabel(e)), (value.effect ?? '') === e, () => set({ effect: e }), e || 'none'))}</View>
      {value.effect ? (
        <>
          <Stepper label={t('settings.nameStyle.intensity', { n: intensity })} value={intensity} min={1} max={LEVEL_MAX} step={1} onChange={(n) => set({ intensity: n })} />
          <Stepper label={t('settings.nameStyle.speed', { n: speed })} value={speed} min={1} max={LEVEL_MAX} step={1} onChange={(n) => set({ speed: n })} />
        </>
      ) : null}
      <Text style={styles.label}>{t('settings.nameStyle.font')}</Text>
      <View style={styles.wrap}>{NAME_FONTS.map((f) => chip(t(fontLabel(f)), (value.font ?? '') === f, () => set({ font: f }), f || 'none'))}</View>

      <Stepper
        label={width ? t('settings.nameStyle.outlineWidth', { n: width }) : t('settings.nameStyle.outlineNone')}
        value={width}
        min={0}
        max={OUTLINE_WIDTH_MAX}
        step={1}
        onChange={(n) => set({ outline_width: n, outline: value.outline ?? 0 })}
      />
      {width ? (
        <>
          <View style={styles.wrap}>
            {OUTLINE_STYLES.map((o) => chip(t(`settings.nameStyle.outlineStyle.${o || 'solid'}` as Key), (value.outline_style ?? '') === o, () => set({ outline_style: o, outline2: o === 'double' ? value.outline2 ?? 0xffffff : undefined }), o || 'solid'))}
          </View>
          <ColorPicker label={t('settings.nameStyle.outlineColor')} value={value.outline ?? 0} onChange={(c) => set({ outline: c })} swatches={OUTLINE_SWATCHES} />
          {value.outline_style === 'double' ? (
            <ColorPicker label={t('settings.nameStyle.outline2')} value={value.outline2 ?? 0xffffff} onChange={(c) => set({ outline2: c })} swatches={OUTLINE_SWATCHES} />
          ) : null}
        </>
      ) : null}
      <Text style={styles.hint}>{t('settings.nameStyle.hint')} {t('settings.nameStyle.staticHint')}</Text>
    </View>
  )
}

const styles = StyleSheet.create({
  title: { color: colors.text, fontSize: font.lg, fontWeight: '700' },
  label: { color: colors.textMuted, fontSize: font.sm, fontWeight: '600' },
  hint: { color: colors.textMuted, fontSize: font.xs },
  wrap: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.sm, alignItems: 'center' },
  chip: { paddingHorizontal: spacing.md, paddingVertical: 6, borderRadius: radius.full, backgroundColor: colors.bgElevated },
  chipOn: { backgroundColor: colors.primary },
  slot: { width: 36, height: 36, borderRadius: radius.sm, borderWidth: 2, borderColor: 'transparent' },
  swatchOn: { borderColor: colors.text },
  preview: { flexDirection: 'row', alignItems: 'center', flexWrap: 'wrap', gap: spacing.sm, padding: spacing.lg, borderRadius: radius.lg, backgroundColor: colors.bg, borderWidth: 1, borderColor: colors.border },
  previewName: { color: colors.text, fontSize: font.xl, fontWeight: '700' },
})
