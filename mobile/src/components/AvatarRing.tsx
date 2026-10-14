import { useEffect, useMemo, useState, type ReactNode } from 'react'
import { Animated, Easing, View, type ViewStyle } from 'react-native'
import { toHex } from '@/lib/nameStyle'
import { adjustColor } from '@/features/account/profileDecor'
import { useReduceMotion } from './ProfileDecor'
import {
  RING_ANIMATED, RING_GLOWING, cleanRing, linearSides, ringDuration, ringGap, ringNum, ringPalette, shapeRadius,
  type AvatarRingData, type RingStyle,
} from './avatarRingCore'

export * from './avatarRingCore'

/**
 * Anneau d'avatar v2 (global users.avatar_ring ou profil de serveur), relu par cleanRing.
 * Rendu en primitives React Native, sans SVG ni dégradé natif — approximations assumées :
 * - « conic » : secteurs francs (une couleur par côté de bordure jusqu'à 4 couleurs, au-delà un
 *   calque par couleur réduit au côté haut et tourné de 360/n°) ;
 * - « linear » : première couleur en haut, dernière en bas, celles du milieu sur les flancs,
 *   l'angle fait tourner le calque ;
 * - « radial » : bandes concentriques de l'intérieur vers l'extérieur de l'épaisseur ;
 * - formes « rounded »/« squircle » : pas de rotation du calque (le carré tournerait) ; l'angle
 *   décale les couleurs d'un côté par quart de tour et la rotation devient une pulsation ;
 *   segments, rayons et glyphes suivent un cercle ;
 * - lueur : ombre colorée (iOS ; Android n'ombre pas une bordure).
 * Une seule Animated.Value par anneau (pilote natif) ; figé si « réduire les animations ».
 */
export function AvatarRing({ ring, size, children }: { ring?: unknown; size: number; children: ReactNode }) {
  const r = useMemo(() => cleanRing(ring), [ring])
  const reduce = useReduceMotion()
  const [v] = useState(() => new Animated.Value(0))
  const moving = !!r && !reduce && RING_ANIMATED.includes(r.style)
  const duration = r ? ringDuration(r) : 0
  useEffect(() => {
    if (!moving) return
    v.setValue(0)
    const loop = Animated.loop(Animated.timing(v, { toValue: 1, duration, easing: Easing.linear, useNativeDriver: true }))
    loop.start()
    return () => loop.stop()
  }, [moving, duration, v])
  if (!r) return <>{children}</>
  return (
    <View style={{ width: size, height: size }}>
      {children}
      <RingLayers r={r} size={size} v={moving ? v : null} />
    </View>
  )
}

type Motion = Animated.WithAnimatedValue<ViewStyle> | null

/** Valeurs réparties uniformément sur un cycle. */
const steps = (v: Animated.Value, out: number[]) => v.interpolate({ inputRange: out.map((_, i) => i / (out.length - 1)), outputRange: out })
const turn = (v: Animated.Value, turns: number, dir: number): Motion => ({
  transform: [{ rotate: v.interpolate({ inputRange: [0, 1], outputRange: ['0deg', `${360 * turns * dir}deg`] }) }],
})
/** Éclat bref de l'élément i sur n, décalé dans le cycle (scintillement, flammes, pluie). */
const blink = (v: Animated.Value, i: number, n: number, lo: number) => {
  const p = 0.001 + (i / n) * 0.83
  return v.interpolate({ inputRange: [0, p, p + 0.08, p + 0.16, 1], outputRange: [lo, lo, 1, lo, lo] })
}

/** Styles où des segments remplacent l'anneau plein. */
const TICKS_ONLY: readonly RingStyle[] = ['segmented', 'stripes', 'dashed_spin', 'chase']
const SPINNING: readonly RingStyle[] = ['spin', 'gradient_spin', 'rainbow', 'comet', 'twin_comet', 'prism', 'aurora', 'vortex']
/** Opacité de l'anneau de fond des styles où un autre calque porte l'effet. */
const DIM: Partial<Record<RingStyle, number>> = { radar: 0.35, orbit: 0.5, double_orbit: 0.5, matrix: 0.2 }

function RingLayers({ r, size, v }: { r: AvatarRingData; size: number; v: Animated.Value | null }) {
  const s = r.style
  const scale = Math.min(1, size / 72) // épaisseur réduite sur les petits avatars (listes, messages)
  const w = Math.max(1, Math.round(r.width * scale))
  const g = ringGap(r, w, scale) + w // bord extérieur de l'anneau, au-delà du bord de l'avatar
  const circle = !r.shape
  const k = ringNum(r, 'intensity') / 100
  const lo = (a: number) => Math.max(0.05, 1 - a * k)
  const dir = r.direction === 'ccw' ? -1 : 1
  const angle = ringNum(r, 'angle')
  const n = ringNum(r, 'segments')
  const cs = ringPalette(r).map((c) => adjustColor(toHex(c), 0, 100, ringNum(r, 'brightness')))
  const first = cs[0] ?? '#ffffff'
  const last = cs[cs.length - 1] ?? first
  const R = size / 2 + g - w / 2 // rayon de la ligne médiane de l'anneau

  const frame = (off: number, width: number): ViewStyle => ({
    position: 'absolute', left: -off, top: -off, width: size + off * 2, height: size + off * 2,
    borderRadius: shapeRadius(r.shape, size + off * 2), borderWidth: width,
    borderStyle: s === 'dashed' ? 'dashed' : s === 'dotted' ? 'dotted' : 'solid',
  })
  const q = Math.round(angle / 90) % 4
  const sides = (c4: string[]): ViewStyle => {
    const c = circle ? c4 : c4.map((_, i) => c4[(i + 4 - q) % 4]) // forme non ronde : l'angle décale les côtés
    return { borderTopColor: c[0], borderRightColor: c[1], borderBottomColor: c[2], borderLeftColor: c[3] }
  }
  const cycle = (pal: string[]) => [0, 1, 2, 3].map((i) => pal[i % pal.length] ?? first)
  const one = (c: string) => sides([c, c, c, c])
  const rot = (deg: number): ViewStyle | null => (circle && deg ? { transform: [{ rotate: `${deg}deg` }] } : null)
  const spinOrPulse = (turns: number): Motion => (!v ? null : circle ? turn(v, turns, dir) : { opacity: steps(v, [1, lo(0.4), 1]) })
  const glowPct = ringNum(r, 'glow')
  const glowR = RING_GLOWING.includes(s) ? (Math.max(2, w) * glowPct) / 100 : glowPct > 100 ? (Math.max(2, w) * (glowPct - 100)) / 100 : 0
  const glow: ViewStyle | null = glowR > 0 ? { shadowColor: first, shadowOpacity: 0.9, shadowRadius: glowR, shadowOffset: { width: 0, height: 0 } } : null
  const layer: ViewStyle = { position: 'absolute', left: 0, top: 0, width: size, height: size }

  /** Anneau plein, rempli selon `fill`. */
  const fillRing = (off: number, width: number, pal: string[]): ReactNode => {
    if (s === 'comet') return <View style={[frame(off, width), sides(['transparent', 'transparent', last, first])]} />
    if (s === 'twin_comet') return <View style={[frame(off, width), sides(['transparent', first, 'transparent', last])]} />
    if (r.fill === 'radial' && pal.length > 1) {
      const bands = Math.max(1, Math.min(pal.length, width))
      const t = width / bands
      return pal.slice(0, bands).map((c, i) => <View key={i} style={[frame(off - width + (i + 1) * t, t), one(c)]} />)
    }
    if (r.fill === 'linear') return <View style={[frame(off, width), sides(linearSides(pal)), rot(angle)]} />
    if (pal.length <= 4 || !circle) return <View style={[frame(off, width), sides(cycle(pal)), rot(angle)]} />
    return pal.map((c, i) => <View key={i} style={[frame(off, width), sides([c, 'transparent', 'transparent', 'transparent']), rot(angle + (i * 360) / pal.length)]} />)
  }

  const baseMotion = ((): Motion => {
    if (!v) return null
    if (SPINNING.includes(s)) return spinOrPulse(1)
    switch (s) {
      case 'pulse': return { opacity: steps(v, [1, lo(0.45), 1]) }
      case 'neon_pulse': return { opacity: steps(v, [1, lo(0.6), 1]) }
      case 'breathe': return { opacity: steps(v, [1, lo(0.35), 1]), transform: [{ scale: steps(v, [1, 1 + 0.05 * k, 1]) }] }
      case 'heartbeat': return { transform: [{ scale: v.interpolate({ inputRange: [0, 0.1, 0.2, 0.3, 0.4, 1], outputRange: [1, 1 + 0.08 * k, 1, 1 + 0.08 * k, 1, 1] }) }] }
      case 'flicker': return { opacity: steps(v, [1, lo(0.6), 1, 1, lo(0.4), 1, lo(0.7), 1]) }
      case 'electric': return { opacity: steps(v, [1, lo(0.5), 1, lo(0.3), 1]) }
      case 'fire': return { opacity: steps(v, [1, lo(0.25), 1, lo(0.15), 1]) }
      case 'glitch': return { transform: [{ translateX: steps(v, [0, 2 * k, -2 * k, 0, 0, 1.5 * k, 0]) }] }
      case 'wave': return { transform: [{ scaleX: steps(v, [1, 1 + 0.04 * k, 1, 1 - 0.04 * k, 1]) }, { scaleY: steps(v, [1, 1 - 0.04 * k, 1, 1 + 0.04 * k, 1]) }] }
      default: return null
    }
  })()

  /** Segments posés sur le cercle médian (tangents) ; `slant` incline les rayures. */
  const ticks = (count: number, f: number, slant: number, opacity: (i: number) => number | Animated.AnimatedInterpolation<number>) => {
    const len = ((2 * Math.PI * R) / count) * f
    return Array.from({ length: count }, (_, i) => {
      const th = angle + (i * 360) / count - 90
      const rad = (th * Math.PI) / 180
      return (
        <Animated.View
          key={i}
          style={{
            position: 'absolute', left: size / 2 + R * Math.cos(rad) - len / 2, top: size / 2 + R * Math.sin(rad) - w / 2,
            width: len, height: w, borderRadius: s === 'stripes' ? 0 : w / 3, backgroundColor: cs[i % cs.length] ?? first,
            opacity: opacity(i), transform: [{ rotate: `${th + 90 + slant}deg` }],
          }}
        />
      )
    })
  }
  /** Glyphes autour de l'anneau (étincelles, flammes), orientés vers l'extérieur. */
  const glyphs = (count: number, ch: string, gs: number, rr: number) =>
    Array.from({ length: count }, (_, i) => {
      const th = angle + (i * 360) / count - 90
      const rad = (th * Math.PI) / 180
      return (
        <Animated.Text
          key={i}
          accessible={false}
          style={{
            position: 'absolute', left: size / 2 + rr * Math.cos(rad) - gs / 2, top: size / 2 + rr * Math.sin(rad) - gs / 2,
            width: gs, height: gs, fontSize: gs * 0.8, lineHeight: gs, textAlign: 'center', color: cs[i % cs.length] ?? first,
            opacity: v ? blink(v, i, count, lo(0.6)) : 0.9, transform: [{ rotate: `${th + 90}deg` }],
          }}
        >
          {ch}
        </Animated.Text>
      )
    })

  const thin = Math.max(1, Math.round(w / 2))
  const dot = Math.max(4, Math.round(w * 1.8))
  const dotStyle = (top: number, c: string): ViewStyle => ({ position: 'absolute', left: size / 2 - dot / 2, top, width: dot, height: dot, borderRadius: dot / 2, backgroundColor: c })
  const gsz = Math.max(7, Math.round(size * 0.16))
  const extras = ((): ReactNode => {
    switch (s) {
      case 'double': return <View style={[frame(g + thin + 2, thin), sides(cycle(cs))]} />
      case 'halo': return <View style={[frame(g + w * 2 + 1, w * 2), one(first), glow, { opacity: 0.35 }]} />
      case 'radar': return <Animated.View style={[layer, spinOrPulse(1)]}><View style={[frame(g, w), sides([first, 'transparent', 'transparent', 'transparent'])]} /></Animated.View>
      case 'orbit':
      case 'double_orbit':
        return (
          <Animated.View style={[layer, glow, v ? turn(v, 1, dir) : null]}>
            <View style={dotStyle(-g + w / 2 - dot / 2, first)} />
            {s === 'double_orbit' ? <View style={dotStyle(size + g - w / 2 - dot / 2, last)} /> : null}
          </Animated.View>
        )
      case 'ripple': return v ? <Animated.View style={[frame(g, thin), one(first), { opacity: v.interpolate({ inputRange: [0, 1], outputRange: [Math.min(1, 0.8 * k), 0] }), transform: [{ scale: v.interpolate({ inputRange: [0, 1], outputRange: [1, 1 + 0.3 * k] }) }] }]} /> : null
      case 'aurora': return <Animated.View style={[frame(g + w + 1, Math.max(1, Math.round(w * 1.5))), one(cs[1] ?? first), { opacity: v ? steps(v, [0.2, Math.min(1, 0.6 * k), 0.2]) : 0.35 }]} />
      case 'electric': return <Animated.View style={[frame(g + 2, 1), one(last), { borderStyle: 'dashed' }, v && circle ? turn(v, 2, dir) : null]} />
      case 'vortex': return <Animated.View style={[frame(Math.max(0, g - w - 1), thin), sides(cycle([...cs].reverse())), v && circle ? turn(v, 2, -dir) : null]} />
      case 'glitch': return <Animated.View style={[frame(g, w), one(last), { opacity: 0.5 }, v ? { transform: [{ translateX: steps(v, [0, -2 * k, 2 * k, 0, 0, -1.5 * k, 0]) }] } : null]} />
      case 'sparkle': return glyphs(6, '✦', gsz, R + w)
      case 'fire': return glyphs(8, '▲', gsz, R + w * 0.8)
      case 'sunburst': {
        const len = Math.max(3, Math.round(w * 1.5) + 2)
        const rays = Array.from({ length: 12 }, (_, i) => {
          const th = angle + i * 30 - 90
          const rad = (th * Math.PI) / 180
          const rr = R + w / 2 + len / 2 + 1
          return <View key={i} style={{ position: 'absolute', left: size / 2 + rr * Math.cos(rad) - len / 2, top: size / 2 + rr * Math.sin(rad) - thin / 2, width: len, height: thin, backgroundColor: cs[i % cs.length] ?? first, transform: [{ rotate: `${th}deg` }] }} />
        })
        return <Animated.View style={[layer, glow, v ? turn(v, 1, dir) : null]}>{rays}</Animated.View>
      }
      case 'segmented': return ticks(n, 0.72, 0, () => 1)
      case 'stripes': return ticks(n, 0.45, 35, () => 1)
      case 'dashed_spin': return <Animated.View style={[layer, v ? turn(v, 1, dir) : null]}>{ticks(n, 0.55, 0, () => 1)}</Animated.View>
      case 'chase': return <Animated.View style={[layer, glow, v ? turn(v, 1, dir) : null]}>{ticks(n, 0.6, 0, (i) => 1 - (i / n) * 0.8)}</Animated.View>
      case 'matrix': return ticks(n, 0.35, 0, (i) => (v ? blink(v, (i * 7) % n, n, 0.15) : 0.6))
      default: return null
    }
  })()

  return (
    <View pointerEvents="none" style={[layer, { opacity: ringNum(r, 'opacity') / 100 }]}>
      {TICKS_ONLY.includes(s) ? null : (
        <Animated.View style={[layer, glow, { opacity: DIM[s] ?? 1 }, baseMotion]}>{fillRing(g, w, s === 'gradient_spin' ? [...cs, ...cs] : cs)}</Animated.View>
      )}
      {extras}
    </View>
  )
}
