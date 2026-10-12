import { useEffect, useState, type ReactNode } from 'react'
import { Animated, Easing, View } from 'react-native'
import { toHex } from '@/lib/nameStyle'
import { useReduceMotion } from './ProfileDecor'

/**
 * Anneau d'avatar du profil de serveur (server_members.server_avatar_ring), validé par le
 * serveur (models/profile_style::parse_avatar_ring) et relu ici avec les mêmes bornes : 1 à 3
 * couleurs 0xRRGGBB, épaisseur 1-8, style en liste blanche. Rendu par bordures (une couleur
 * par côté pour un dégradé), rotation ou pulsation par Animated, figé si « réduire les animations ».
 */
export const RING_STYLES = ['solid', 'dashed', 'dotted', 'double', 'glow', 'spin', 'pulse'] as const
export type RingStyle = (typeof RING_STYLES)[number]
export const RING_WIDTH_MAX = 8

export interface AvatarRingData {
  colors: number[]
  width: number
  style: RingStyle
}

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
  return { colors, width, style }
}

export function AvatarRing({ ring, size, children }: { ring?: unknown; size: number; children: ReactNode }) {
  const r = cleanRing(ring)
  const reduce = useReduceMotion()
  const [v] = useState(() => new Animated.Value(0))
  const anim = !reduce && (r?.style === 'spin' || r?.style === 'pulse') ? r.style : null
  useEffect(() => {
    if (!anim) return
    v.setValue(0)
    const loop = Animated.loop(
      Animated.timing(v, { toValue: 1, duration: anim === 'spin' ? 4000 : 2400, easing: Easing.linear, useNativeDriver: true }),
    )
    loop.start()
    return () => loop.stop()
  }, [anim, v])
  if (!r) return <>{children}</>
  const w = Math.max(1, Math.round(r.width * Math.min(1, size / 72)))
  const gap = w + Math.max(1, Math.round(w / 2))
  const cs = r.colors.map(toHex)
  const side = (i: number) => cs[i % cs.length]
  const border = r.style === 'dashed' || r.style === 'dotted' ? r.style : 'solid'
  const motion = !anim
    ? null
    : anim === 'spin'
      ? { transform: [{ rotate: v.interpolate({ inputRange: [0, 1], outputRange: ['0deg', '360deg'] }) }] }
      : { opacity: v.interpolate({ inputRange: [0, 0.5, 1], outputRange: [1, 0.55, 1] }) }
  const glow = r.style === 'glow' || r.style === 'pulse'
    ? { shadowColor: cs[0], shadowOpacity: 0.9, shadowRadius: Math.max(2, w), shadowOffset: { width: 0, height: 0 } }
    : null
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
