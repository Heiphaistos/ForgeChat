import { Pressable, StyleSheet, Text, View } from 'react-native'
import { useT } from '@/i18n'
import { colors, font, radius, spacing } from '@/theme'

/** Pastille sélectionnable (éditeurs d'anneau et de carte). */
export function Chip({ label, selected, onPress }: { label: string; selected: boolean; onPress: () => void }) {
  return (
    <Pressable onPress={onPress} accessibilityRole="button" accessibilityState={{ selected }} style={[kit.chip, selected && kit.chipOn]}>
      <Text style={{ color: selected ? '#fff' : colors.textSecondary, fontSize: font.sm }}>{label}</Text>
    </Pressable>
  )
}

/** Réglage numérique borné par boutons − / + (libellé incluant la valeur). */
export function Stepper({ label, value, min, max, step, onChange }: { label: string; value: number; min: number; max: number; step: number; onChange: (n: number) => void }) {
  const t = useT()
  const btn = (sign: -1 | 1) => {
    const off = sign < 0 ? value <= min : value >= max
    return (
      <Pressable
        onPress={() => onChange(Math.min(max, Math.max(min, value + sign * step)))}
        disabled={off}
        accessibilityRole="button"
        accessibilityLabel={`${t(sign < 0 ? 'pdeco.opts.less' : 'pdeco.opts.more')} — ${label}`}
        style={[kit.step, off && kit.dim]}
      >
        <Text style={kit.stepText}>{sign < 0 ? '−' : '+'}</Text>
      </Pressable>
    )
  }
  return (
    <View style={kit.row}>
      <Text style={kit.optLabel}>{label}</Text>
      {btn(-1)}
      {btn(1)}
    </View>
  )
}

export const kit = StyleSheet.create({
  title: { color: colors.text, fontSize: font.lg, fontWeight: '700' },
  label: { color: colors.textMuted, fontSize: font.sm, fontWeight: '600' },
  hint: { color: colors.textMuted, fontSize: font.xs },
  wrap: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.sm, alignItems: 'center' },
  row: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm },
  optLabel: { color: colors.textSecondary, fontSize: font.sm, flex: 1 },
  step: { width: 36, height: 32, borderRadius: radius.md, backgroundColor: colors.bgElevated, alignItems: 'center', justifyContent: 'center' },
  stepText: { color: colors.text, fontSize: font.lg, fontWeight: '700' },
  dim: { opacity: 0.4 },
  chip: { paddingHorizontal: spacing.md, paddingVertical: 6, borderRadius: radius.full, backgroundColor: colors.bgElevated },
  chipOn: { backgroundColor: colors.primary },
  swatch: { width: 28, height: 28, borderRadius: 14, borderWidth: 2, borderColor: 'transparent' },
  slot: { width: 34, height: 34, borderRadius: radius.sm, borderWidth: 2, borderColor: 'transparent' },
  swatchOn: { borderColor: colors.text },
})
