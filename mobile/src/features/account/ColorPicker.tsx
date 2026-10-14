import { useState } from 'react'
import { Pressable, StyleSheet, Text, View, type GestureResponderEvent } from 'react-native'
import { TextField } from '@/components/ui'
import { useT } from '@/i18n'
import { fromHsl, toHex, toHsl } from '@/lib/nameStyle'
import { colors, radius, spacing } from '@/theme'
import { THEME_SWATCHES } from './profileDecor'
import { Chip, kit } from './editorKit'

/** Bande de teintes (une case tous les 15°) et luminosités proposées pour la teinte choisie. */
const HUES = Array.from({ length: 24 }, (_, i) => i * 15)
const SHADES = [0.2, 0.32, 0.44, 0.55, 0.66, 0.78, 0.9]
const HEX6 = /^#?[0-9a-f]{6}$/i

/**
 * Couleur libre sans dépendance : nuancier, bande de teintes (toucher ou glisser ; réglable au
 * lecteur d'écran), nuances de la teinte et saisie « #rrggbb ». Ne produit que des entiers
 * 0xRRGGBB, comme le serveur les attend.
 */
export function ColorPicker({ value, onChange, label, swatches = THEME_SWATCHES, onClear, clearLabel }: {
  value: number | null | undefined
  onChange: (c: number) => void
  label?: string
  swatches?: readonly number[]
  /** Pastille « par défaut / sans couleur » (sélectionnée quand value est vide). */
  onClear?: () => void
  clearLabel?: string
}) {
  const t = useT()
  const [hex, setHex] = useState(value != null ? toHex(value) : '')
  const [width, setWidth] = useState(0)
  // Champ resynchronisé pendant le rendu quand la couleur change ailleurs (nuancier, bande, autre emplacement).
  const [synced, setSynced] = useState(value)
  if (value !== synced) {
    setSynced(value)
    setHex(value != null ? toHex(value) : '')
  }

  const [h, s, l] = value != null ? toHsl(value) : [0, 0.85, 0.55]
  // Gris, blanc ou noir : la bande propose une couleur franche plutôt qu'un gris invisible.
  const sat = s < 0.15 ? 0.85 : s
  const lum = l < 0.12 || l > 0.9 ? 0.55 : l
  const hue = Math.round(h)
  const atX = (e: GestureResponderEvent) => {
    if (width > 0) onChange(fromHsl((Math.min(width, Math.max(0, e.nativeEvent.locationX)) / width) * 359, sat, lum))
  }

  const swatch = (c: number, a11y: string) => (
    <Pressable
      key={c}
      onPress={() => onChange(c)}
      accessibilityRole="button"
      accessibilityLabel={a11y}
      accessibilityState={{ selected: value === c }}
      style={[kit.swatch, { backgroundColor: toHex(c) }, value === c && kit.swatchOn]}
    />
  )

  return (
    <View style={{ gap: spacing.sm }}>
      {label ? <Text style={kit.label}>{label}</Text> : null}
      <View style={kit.wrap}>
        {onClear ? <Chip label={clearLabel ?? ''} selected={value == null} onPress={onClear} /> : null}
        {swatches.map((c) => swatch(c, t('settings.cosmetics.colorA11y', { hex: toHex(c) })))}
      </View>
      <View
        accessible
        accessibilityRole="adjustable"
        accessibilityLabel={label ? `${label} — ${t('color.hue')}` : t('color.hue')}
        accessibilityValue={{ text: t('color.hueValue', { n: hue }) }}
        accessibilityActions={[{ name: 'increment' }, { name: 'decrement' }]}
        onAccessibilityAction={(e) => onChange(fromHsl(h + (e.nativeEvent.actionName === 'increment' ? 15 : -15), sat, lum))}
        onLayout={(e) => setWidth(e.nativeEvent.layout.width)}
        onStartShouldSetResponder={() => true}
        onMoveShouldSetResponder={() => true}
        onResponderTerminationRequest={() => false}
        onResponderGrant={atX}
        onResponderMove={atX}
        hitSlop={{ top: 6, bottom: 6 }}
        style={styles.strip}
      >
        {HUES.map((x) => (
          <View key={x} pointerEvents="none" style={{ flex: 1, backgroundColor: toHex(fromHsl(x, 0.85, 0.55)) }} />
        ))}
        {value != null ? <View pointerEvents="none" style={[styles.marker, { left: `${(h / 360) * 100}%` }]} /> : null}
      </View>
      <View style={kit.wrap}>{SHADES.map((x) => fromHsl(h, sat, x)).map((c) => swatch(c, t('color.shadeA11y', { hex: toHex(c) })))}</View>
      <TextField
        label={t('color.hex')}
        placeholder="#5865f2"
        value={hex}
        onChangeText={(v) => {
          setHex(v)
          if (HEX6.test(v.trim())) onChange(parseInt(v.trim().replace('#', ''), 16))
        }}
        autoCapitalize="none"
        autoCorrect={false}
        maxLength={7}
        // Erreur seulement une fois 6 caractères saisis (pas pendant la frappe).
        error={hex.trim().replace('#', '').length >= 6 && !HEX6.test(hex.trim()) ? t('color.hexError') : undefined}
      />
    </View>
  )
}

const styles = StyleSheet.create({
  strip: { flexDirection: 'row', height: 32, borderRadius: radius.md, overflow: 'hidden', borderWidth: 1, borderColor: colors.border },
  marker: { position: 'absolute', top: 0, bottom: 0, width: 4, marginLeft: -2, backgroundColor: '#ffffff', borderWidth: 1, borderColor: '#000000' },
})
