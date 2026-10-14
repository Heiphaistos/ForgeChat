import { useState } from 'react'
import { Pressable, Switch, Text, View } from 'react-native'
import { Avatar } from '@/components/Avatar'
import {
  AvatarRing, RING_ANIMATED, RING_COLORS_MAX, RING_FILLS, RING_RANGES, RING_SEGMENTED, RING_SHAPES, RING_STYLES, cleanRing,
  ringNum, type AvatarRingData, type RingNumKey,
} from '@/components/AvatarRing'
import { TextField } from '@/components/ui'
import { THEME_SWATCHES } from '@/features/account/profileDecor'
import { useT, type Key } from '@/i18n'
import { parseHex, toHex } from '@/lib/nameStyle'
import { spacing } from '@/theme'
import { Chip, Stepper, kit } from './editorKit'

const SWATCHES = [...THEME_SWATCHES.slice(0, 10), 0xffffff, 0xff00e5, 0x00f0ff, 0x7dffb0]
const RING_NEW: AvatarRingData = { colors: [0x5865f2], width: 3, style: 'solid' }
/** Pas des boutons − / + de chaque réglage. */
const STEP: Record<Exclude<RingNumKey, 'gap'>, number> = { width: 1, angle: 15, segments: 1, speed: 25, brightness: 10, glow: 25, opacity: 10, intensity: 25 }

/**
 * Éditeur complet de l'anneau d'avatar v2 (global ou profil de serveur) : 1 à 8 couleurs,
 * style, remplissage, angle, forme, épaisseur, écart, segments, vitesse, sens, luminosité,
 * lueur, opacité, intensité, avec aperçu en direct. `value` null = pas d'anneau.
 */
export function AvatarRingEditor({
  value, onChange, avatar, name, hint,
}: {
  value: AvatarRingData | null
  onChange: (v: AvatarRingData | null) => void
  avatar: string | null | undefined
  name: string
  hint: string
}) {
  const t = useT()
  const [slot, setSlot] = useState(0)
  const [hex, setHex] = useState('')
  const r = value
  const set = (patch: Partial<AvatarRingData>) => r && onChange(cleanRing({ ...r, ...patch }))
  const setColors = (next: number[]) => {
    set({ colors: next })
    setSlot((s) => Math.min(s, Math.max(0, next.length - 1)))
  }
  const setSlotColor = (c: number) => r && setColors(r.colors.map((x, i) => (i === slot ? c : x)))
  const num = (k: Exclude<RingNumKey, 'gap'>) => {
    if (!r) return null
    const [min, max] = RING_RANGES[k]
    const n = ringNum(r, k)
    return <Stepper key={k} label={t(`ring.${k}` as Key, { n })} value={n} min={min} max={max} step={STEP[k]} onChange={(x) => set({ [k]: x })} />
  }
  const animated = !!r && RING_ANIMATED.includes(r.style)

  return (
    <View style={{ gap: spacing.md }}>
      <Text style={kit.title}>{t('ring.title')}</Text>
      <Text style={kit.hint}>{hint}</Text>
      <View style={kit.row}>
        <Text style={kit.optLabel}>{t('ring.enable')}</Text>
        <Switch value={!!r} onValueChange={(on) => onChange(on ? (r ?? RING_NEW) : null)} accessibilityLabel={t('ring.enable')} />
      </View>
      {r ? (
        <>
          <View style={{ alignItems: 'center', padding: spacing.xl }} accessible accessibilityLabel={t('ring.preview')}>
            <AvatarRing ring={r} size={80}>
              <Avatar uri={avatar ?? null} name={name} size={80} />
            </AvatarRing>
          </View>

          <Text style={kit.label}>{t('ring.colors', { n: r.colors.length, max: RING_COLORS_MAX })}</Text>
          <View style={kit.wrap}>
            {r.colors.map((c, i) => (
              <Pressable
                key={i}
                onPress={() => setSlot(i)}
                accessibilityRole="button"
                accessibilityLabel={t('ring.slotA11y', { n: i + 1, hex: toHex(c) })}
                accessibilityState={{ selected: slot === i }}
                style={[kit.slot, { backgroundColor: toHex(c) }, slot === i && kit.swatchOn]}
              />
            ))}
            {r.colors.length < RING_COLORS_MAX ? <Chip label={t('ring.addColor')} selected={false} onPress={() => setColors([...r.colors, SWATCHES[(r.colors.length * 3) % SWATCHES.length]!])} /> : null}
            {r.colors.length > 1 ? <Chip label={t('ring.removeColor')} selected={false} onPress={() => setColors(r.colors.filter((_, i) => i !== slot))} /> : null}
          </View>
          <View style={kit.wrap}>
            {SWATCHES.map((c) => (
              <Pressable
                key={c}
                onPress={() => setSlotColor(c)}
                accessibilityRole="button"
                accessibilityLabel={t('settings.cosmetics.colorA11y', { hex: toHex(c) })}
                accessibilityState={{ selected: r.colors[slot] === c }}
                style={[kit.swatch, { backgroundColor: toHex(c) }, r.colors[slot] === c && kit.swatchOn]}
              />
            ))}
          </View>
          <View style={{ flexDirection: 'row', gap: spacing.sm, alignItems: 'flex-end' }}>
            <View style={{ flex: 1 }}>
              <TextField
                label={t('settings.nameStyle.hex')}
                placeholder="#5865f2"
                value={hex}
                onChangeText={setHex}
                autoCapitalize="none"
                autoCorrect={false}
                maxLength={7}
                error={hex && parseHex(hex) == null ? t('settings.nameStyle.hexError') : undefined}
              />
            </View>
            <Chip label={t('settings.nameStyle.apply')} selected={false} onPress={() => { const c = parseHex(hex); if (c != null) setSlotColor(c) }} />
          </View>

          <Text style={kit.label}>{t('ring.style')}</Text>
          <View style={kit.wrap}>
            {RING_STYLES.map((s) => <Chip key={s} label={t(`ring.style.${s}` as Key)} selected={r.style === s} onPress={() => set({ style: s })} />)}
          </View>
          {r.colors.length > 1 ? (
            <>
              <Text style={kit.label}>{t('ring.fill')}</Text>
              <View style={kit.wrap}>
                {RING_FILLS.map((f) => <Chip key={f} label={t(`ring.fill.${f}` as Key)} selected={(r.fill ?? 'conic') === f} onPress={() => set({ fill: f })} />)}
              </View>
            </>
          ) : null}
          <Text style={kit.label}>{t('ring.shape')}</Text>
          <View style={kit.wrap}>
            {RING_SHAPES.map((s) => <Chip key={s} label={t(`ring.shape.${s}` as Key)} selected={(r.shape ?? 'circle') === s} onPress={() => set({ shape: s })} />)}
          </View>

          {num('width')}
          <Stepper
            label={r.gap == null ? t('ring.gapAuto') : t('ring.gap', { n: r.gap })}
            value={r.gap ?? -1}
            min={-1}
            max={RING_RANGES.gap[1]}
            step={1}
            onChange={(n) => set({ gap: n < 0 ? undefined : n })}
          />
          {r.fill !== 'radial' ? num('angle') : null}
          {RING_SEGMENTED.includes(r.style) ? num('segments') : null}
          {num('brightness')}
          {num('glow')}
          {num('opacity')}
          {animated ? (
            <>
              {num('speed')}
              {num('intensity')}
              <View style={kit.row}>
                <Text style={kit.optLabel}>{t('pdeco.opts.direction')}</Text>
                <Chip label={t('pdeco.opts.cw')} selected={r.direction !== 'ccw'} onPress={() => set({ direction: 'cw' })} />
                <Chip label={t('pdeco.opts.ccw')} selected={r.direction === 'ccw'} onPress={() => set({ direction: 'ccw' })} />
              </View>
              <Text style={kit.hint}>{t('ring.staticHint')}</Text>
            </>
          ) : null}
          <Chip label={t('ring.reset')} selected={false} onPress={() => onChange({ colors: r.colors, width: 3, style: r.style })} />
        </>
      ) : null}
    </View>
  )
}
