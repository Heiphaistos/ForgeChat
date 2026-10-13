import { useEffect, useState, type ReactNode } from 'react'
import { Animated, Easing, View } from 'react-native'
import { toHex } from '@/lib/nameStyle'
import { adjustColor } from '@/features/account/profileDecor'
import { useReduceMotion } from './ProfileDecor'

/**
 * Anneau d'avatar du profil de serveur (server_members.server_avatar_ring), validé par le
 * serveur (models/profile_style::parse_avatar_ring) et relu ici avec les mêmes bornes : 1 à 3
 * couleurs 0xRRGGBB, épaisseur 1-8, style en liste blanche, vitesse 25-400 %, sens, luminosité
 * 50-200 % et lueur 0-300 %. Rendu par bordures (une couleur par côté pour un dégradé), rotation
 * ou pulsation par Animated, figé si « réduire les animations ».
 */
export const RING_STYLES = [
  'solid', 'dashed', 'dotted', 'double', 'glow', 'spin', 'pulse',
  'gradient_spin', 'rainbow', 'dashed_spin', 'neon_pulse', 'comet', 'segmented', 'breathe',
] as const
export type RingStyle = (typeof RING_STYLES)[number]
export const RING_WIDTH_MAX = 8
export const RING_RANGES = { speed: [25, 400], brightness: [50, 200], glow: [0, 300] } as const

export interface AvatarRingData {
  colors: number[]
  width: number
  style: RingStyle
  speed?: number
  direction?: 'cw' | 'ccw'
  brightness?: number
  glow?: number
}

const RAINBOW = [0xff3b30, 0xff9500, 0xffcc00, 0x34c759, 0x007aff, 0xaf52de]
const SPINNING: readonly RingStyle[] = ['spin', 'gradient_spin', 'rainbow', 'dashed_spin', 'comet']
const PULSING: readonly RingStyle[] = ['pulse', 'neon_pulse', 'breathe']
const GLOWING: readonly RingStyle[] = ['glow', 'pulse', 'neon_pulse', 'breathe', 'comet']

const pct = (v: unknown, [min, max]: readonly [number, number]) =>
  typeof v === 'number' && Number.isFinite(v) ? Math.min(max, Math.max(min, Math.round(v))) : 100

/** Anneau reçu nettoyé ; null = pas d'anneau. */
export function cleanRing(r: unknown): AvatarRingData | null {
  if (!r || typeof r !== 'object') return null
  const o = r as Record<string, unknown>
  const colors = Array.isArray(o.colors)
    ? o.colors.filter((c): c is number => Number.isInteger(c) && (c as number) >= 0 && (c as number) <= 0xffffff).slice(0, 3)
    : []
  if (!colors.length) return null
  const width = Number.isInteger(o.width) ? Math.min(RING_WIDTH_MAX, Math.max(1, o.width as number)) : 3
  const style = (RING_STYLES as readonly unknown[]).includes(o.style) ? (o.style as RingStyle) : 'solid'
  const out: AvatarRingData = { colors, width, style }
  const speed = pct(o.speed, RING_RANGES.speed)
  const brightness = pct(o.brightness, RING_RANGES.brightness)
  const glow = pct(o.glow, RING_RANGES.glow)
  if (speed !== 100) out.speed = speed
  if (o.direction === 'ccw') out.direction = 'ccw'
  if (brightness !== 100) out.brightness = brightness
  if (glow !== 100) out.glow = glow
  return out
}

export function AvatarRing({ ring, size, children }: { ring?: unknown; size: number; children: ReactNode }) {
  const r = cleanRing(ring)
  const reduce = useReduceMotion()
  const [v] = useState(() => new Animated.Value(0))
  const anim = reduce || !r ? null : SPINNING.includes(r.style) ? 'spin' : PULSING.includes(r.style) ? 'pulse' : null
  const base = !r ? 4000 : r.style === 'comet' ? 1800 : r.style === 'gradient_spin' ? 2600 : r.style === 'rainbow' ? 6000 : anim === 'pulse' ? 2400 : 4000
  const duration = Math.round((base * 100) / (r?.speed ?? 100))
  useEffect(() => {
    if (!anim) return
    v.setValue(0)
    const loop = Animated.loop(Animated.timing(v, { toValue: 1, duration, easing: Easing.linear, useNativeDriver: true }))
    loop.start()
    return () => loop.stop()
  }, [anim, duration, v])
  if (!r) return <>{children}</>
  const w = Math.max(1, Math.round(r.width * Math.min(1, size / 72)))
  const gap = w + Math.max(1, Math.round(w / 2))
  const bright = r.brightness ?? 100
  const cs = (r.style === 'rainbow' ? RAINBOW : r.colors).map((c) => adjustColor(toHex(c), 0, 100, bright))
  const side = (i: number) => (r.style === 'comet' && i < 2 ? 'transparent' : cs[i % cs.length])
  const border = r.style === 'dashed' || r.style === 'dashed_spin' ? 'dashed' : r.style === 'dotted' || r.style === 'segmented' ? 'dotted' : 'solid'
  const dir = r.direction === 'ccw' ? -1 : 1
  const motion = !anim
    ? null
    : anim === 'spin'
      ? { transform: [{ rotate: v.interpolate({ inputRange: [0, 1], outputRange: ['0deg', `${360 * dir}deg`] }) }] }
      : { opacity: v.interpolate({ inputRange: [0, 0.5, 1], outputRange: [1, 0.55, 1] }) }
  const glowPct = r.glow ?? 100
  const glowR = GLOWING.includes(r.style) ? (Math.max(2, w) * glowPct) / 100 : glowPct > 100 ? (Math.max(2, w) * (glowPct - 100)) / 100 : 0
  const glow = glowR > 0 ? { shadowColor: cs[0], shadowOpacity: 0.9, shadowRadius: glowR, shadowOffset: { width: 0, height: 0 } } : null
  const box = (g: number, width: number) => ({
    position: 'absolute' as const,
    left: -g,
    top: -g,
    width: size + g * 2,
    height: size + g * 2,
    borderRadius: size / 2 + g,
    borderWidth: width,
    borderStyle: border as 'solid' | 'dashed' | 'dotted',
    borderTopColor: side(0),
    borderRightColor: side(1),
    borderBottomColor: side(2),
    borderLeftColor: side(3),
  })
  return (
    <View style={{ width: size, height: size }}>
      {children}
      <Animated.View pointerEvents="none" style={[box(gap, w), glow, motion]} />
      {r.style === 'double' ? <View pointerEvents="none" style={box(gap + w + 2, Math.max(1, Math.round(w / 2)))} /> : null}
    </View>
  )
}
