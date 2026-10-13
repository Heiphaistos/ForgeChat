import { useEffect, useMemo, useState, type ReactNode } from 'react'
import { AccessibilityInfo, Animated, Easing, StyleSheet, Text, View, type StyleProp, type ViewStyle } from 'react-native'
import {
  PROFILE_EFFECTS, cleanDecoOpts, decoColor, findDecoration, fxCount, profileTheme, type DecoOpts, type Decoration,
} from '@/features/account/profileDecor'

/** « Réduire les animations » du système. */
export function useReduceMotion() {
  const [reduce, setReduce] = useState(true)
  useEffect(() => {
    let alive = true
    void AccessibilityInfo.isReduceMotionEnabled().then((r) => alive && setReduce(r))
    const sub = AccessibilityInfo.addEventListener('reduceMotionChanged', setReduce)
    return () => {
      alive = false
      sub.remove()
    }
  }, [])
  return reduce
}

/** Cycle commun de toutes les animations d'une décoration (12 s à vitesse 100 %) : un seul
 *  Animated.Value par avatar, dont chaque élément tire sa rotation ou sa pulsation. */
const CYCLE_MS = 12000

/** Pulsation : `beats` allers-retours entre a et b sur un cycle. */
function beat(v: Animated.Value, beats: number, a: number, b: number, phase = 0) {
  const inputRange: number[] = []
  const outputRange: number[] = []
  for (let i = 0; i <= beats * 2; i++) {
    inputRange.push(i / (beats * 2))
    outputRange.push((i + phase) % 2 ? b : a)
  }
  return v.interpolate({ inputRange, outputRange })
}

/** `turns` tours par cycle, dans le sens choisi. */
const spin = (v: Animated.Value, turns: number, dir: number) => ({
  transform: [{ rotate: v.interpolate({ inputRange: [0, 1], outputRange: ['0deg', `${turns * 360 * dir}deg`] }) }],
})

/** Accessoire rendu par glyphes (pas de SVG sur mobile sans dépendance). */
const ORNAMENT_GLYPH: Record<string, string> = {
  crown: '♛', tiara: '♕', antlers: 'Ψ', bow: '⋈', laurel: '❦', partyhat: '▲', witchhat: '▲', santahat: '▲',
}

/**
 * Décoration autour d'un avatar de `size` px : bordures colorées, glyphes, formes simples et
 * Animated (rotation, pulsation), figée si « réduire les animations » ou si l'animation est coupée.
 * `opts` : réglages reçus du serveur (users.avatar_decoration_opts), relus par cleanDecoOpts.
 */
export function AvatarDecoration({ id, size, opts, children }: { id?: string | null; size: number; opts?: unknown; children: ReactNode }) {
  const deco = findDecoration(id)
  const o = useMemo(() => cleanDecoOpts(opts), [opts])
  if (!deco) return <>{children}</>
  return (
    <DecoLayers deco={deco} size={size} o={o}>
      {children}
    </DecoLayers>
  )
}

function DecoLayers({ deco, size, o, children }: { deco: Decoration; size: number; o: DecoOpts; children: ReactNode }) {
  const reduce = useReduceMotion()
  const [v] = useState(() => new Animated.Value(0))
  const moving = !reduce && o.animate
  const big = size >= 28
  const needsLoop = moving && !!(deco.anim || o.pulse || deco.orbit || (big && (deco.wreath || deco.aura || deco.ripple || deco.flames || deco.arcs || deco.rain || deco.ornament)))
  const duration = Math.round((CYCLE_MS * 100) / o.speed)
  useEffect(() => {
    if (!needsLoop) return
    v.setValue(0)
    const loop = Animated.loop(Animated.timing(v, { toValue: 1, duration, easing: Easing.linear, useNativeDriver: true }))
    loop.start()
    return () => loop.stop()
  }, [needsLoop, duration, v])

  const k = o.scale / 100
  const w = Math.max(2, Math.round(size * 0.07 * (deco.thick ?? 1) * k))
  const grow = Math.round((size * (k - 1)) / 2)
  const dir = (o.direction === 'ccw' ? -1 : 1) * (deco.reverse ? -1 : 1)
  const col = (c: string) => decoColor(c, o)
  const colors = deco.colors.map(col)
  const accent = deco.glow ? col(deco.glow) : (colors[colors.length - 1] ?? '#ffffff')
  const side = (i: number) => colors[i % colors.length] ?? '#ffffff'
  const square = deco.kind === 'frame' || deco.kind === 'pixelframe'
  const borderStyle = deco.kind === 'dashed' || deco.kind === 'stripes' ? ('dashed' as const) : deco.kind === 'segments' || deco.kind === 'pixelframe' ? ('dotted' as const) : ('solid' as const)
  const radiusFor = (gap: number) => (deco.kind === 'pixelframe' ? 0 : square ? (size + gap * 2) * 0.24 : size / 2 + gap)
  const ring = (gap: number, width: number, solidColor?: string) => ({
    position: 'absolute' as const,
    left: -gap,
    top: -gap,
    width: size + gap * 2,
    height: size + gap * 2,
    borderRadius: radiusFor(gap),
    borderWidth: width,
    borderStyle: solidColor ? ('solid' as const) : borderStyle,
    borderTopColor: solidColor ?? side(0),
    borderRightColor: solidColor ?? side(1),
    borderBottomColor: solidColor ?? side(2),
    borderLeftColor: solidColor ?? side(3),
  })
  // Halo : ombre colorée (iOS) ; Android n'ombre pas une bordure, la couleur suffit.
  const glowR = deco.glow ? (Math.max(3, w) * o.glow) / 100 : o.glow > 100 ? (Math.max(3, w) * (o.glow - 100)) / 100 : 0
  const glow = glowR > 0 ? { shadowColor: accent, shadowOpacity: 0.9, shadowRadius: glowR, shadowOffset: { width: 0, height: 0 } } : null
  const ringMotion = !needsLoop || !deco.anim ? null : deco.anim === 'spin' ? spin(v, 2, dir) : { opacity: beat(v, 5, 1, 0.5) }
  const throb = needsLoop && o.pulse ? { transform: [{ scale: beat(v, 5, 1, 1.07) }] } : null
  const gap = w + 1 + grow
  const glyphSize = Math.max(7, Math.round(size * 0.2 * k))
  const r = size / 2 + w * 0.6 + grow
  const at = (deg: number, s: number, rr = r) => ({
    position: 'absolute' as const,
    left: size / 2 + rr * Math.cos((deg * Math.PI) / 180) - s / 2,
    top: size / 2 + rr * Math.sin((deg * Math.PI) / 180) - s / 2,
    width: s,
    height: s,
    fontSize: s * 0.8,
    lineHeight: s,
    textAlign: 'center' as const,
  })
  /** Glyphes répartis sur un bras tournant (orbite, couronne). */
  const arms = (chars: string[], turns: number, s: number, color: (i: number) => string) => (
    <Animated.View pointerEvents="none" style={[StyleSheet.absoluteFill, needsLoop ? spin(v, turns, dir) : null]}>
      {chars.map((ch, i) => (
        <Text key={i} accessible={false} style={[at(-90 + (360 / chars.length) * i, s, size / 2 + gap - w / 2), { color: color(i) }]}>
          {ch}
        </Text>
      ))}
    </Animated.View>
  )
  const orn = big ? deco.ornament : undefined
  const earColor = colors[0] ?? '#ffffff'
  return (
    <View style={{ width: size, height: size }}>
      {children}
      <Animated.View pointerEvents="none" style={[StyleSheet.absoluteFill, { opacity: o.opacity / 100 }, throb]}>
        {big && deco.aura ? (
          <Animated.View
            style={[ring(gap + w, w * 1.6, col(deco.aura)), { opacity: needsLoop ? beat(v, 5, 0.25, 0.6) : 0.4, shadowColor: col(deco.aura), shadowOpacity: 0.9, shadowRadius: w * 2, shadowOffset: { width: 0, height: 0 } }]}
          />
        ) : null}
        {big && deco.ripple ? (
          <Animated.View
            style={[
              ring(gap, 2, col(deco.ripple)),
              needsLoop ? { opacity: v.interpolate({ inputRange: [0, 0.2, 0.2001, 0.4, 0.4001, 0.6, 0.6001, 0.8, 0.8001, 1], outputRange: [0.8, 0, 0.8, 0, 0.8, 0, 0.8, 0, 0.8, 0] }), transform: [{ scale: v.interpolate({ inputRange: [0, 0.2, 0.2001, 0.4, 0.4001, 0.6, 0.6001, 0.8, 0.8001, 1], outputRange: [1, 1.4, 1, 1.4, 1, 1.4, 1, 1.4, 1, 1.4] }) }] } : { opacity: 0.45 },
            ]}
          />
        ) : null}
        <Animated.View style={[ring(gap, w), glow, ringMotion]} />
        {deco.kind === 'double' ? <View style={ring(w * 2 + 3 + grow, Math.max(1, w / 2))} /> : null}
        {deco.kind === 'dual' ? <View style={[ring(w * 2 + 2 + grow, 1.5, colors[colors.length - 1]), { opacity: 0.85 }]} /> : null}
        {big && deco.flames
          ? Array.from({ length: 8 }, (_, i) => (
              <Animated.Text key={`f${i}`} accessible={false} style={[at(i * 45 - 90, glyphSize, r + w * 0.6), { color: side(i), opacity: needsLoop ? beat(v, 12, 1, 0.45, i % 2) : 0.9 }]}>
                ▲
              </Animated.Text>
            ))
          : null}
        {big && deco.arcs
          ? [30, 150, 270].map((a, i) => (
              <Animated.Text key={`a${a}`} accessible={false} style={[at(a, glyphSize, r + w * 0.4), { color: col(deco.arcs!), opacity: needsLoop ? beat(v, 8, 0, 1, i % 2) : 0.8 }]}>
                ⚡
              </Animated.Text>
            ))
          : null}
        {deco.glyph && big
          ? [45, 135, 225, 315].map((a, i) => (
              <Animated.Text key={a} accessible={false} style={[at(a, glyphSize), { color: deco.glow ? accent : side(i), opacity: needsLoop ? beat(v, 5, 1, 0.55, i % 2) : 1 }]}>
                {deco.glyph}
              </Animated.Text>
            ))
          : null}
        {big && deco.rain
          ? Array.from(deco.rain.chars).slice(0, 6).map((ch, i, all) => (
              <Animated.Text key={`r${i}`} accessible={false} style={[at((360 / all.length) * i + 25, glyphSize, r + w * 0.4), { color: deco.glow ? accent : side(i), opacity: needsLoop ? beat(v, 4, 0.15, 1, i % 2) : 0.85 }]}>
                {ch}
              </Animated.Text>
            ))
          : null}
        {big && deco.wreath ? arms(Array.from(deco.wreath), 1, Math.max(6, Math.round(glyphSize * 0.62)), (i) => (deco.glow ? accent : side(i))) : null}
        {deco.orbit ? arms(Array.from({ length: deco.orbitN ?? 1 }, () => deco.orbit!), 3, Math.max(6, Math.round(size * 0.14 * k)), () => accent) : null}
        {orn ? <Ornament kind={orn} size={size} color={earColor} accent={colors[1] ?? earColor} motion={needsLoop ? beat(v, 6, 0, 1) : null} /> : null}
      </Animated.View>
    </View>
  )
}

/** Accessoire approché : formes simples (oreilles, auréole, ailes, casque) ou glyphe. */
function Ornament({ kind, size, color, accent, motion }: { kind: string; size: number; color: string; accent: string; motion: Animated.AnimatedInterpolation<number> | null }) {
  const s = size
  const tri = (left: number, rot: string, h: number, c: string) => (
    <View
      style={{
        position: 'absolute',
        left,
        top: -h * 0.55,
        width: 0,
        height: 0,
        borderLeftWidth: s * 0.14,
        borderRightWidth: s * 0.14,
        borderBottomWidth: h,
        borderLeftColor: 'transparent',
        borderRightColor: 'transparent',
        borderBottomColor: c,
        transform: [{ rotate: rot }],
      }}
    />
  )
  const bob = motion ? { transform: [{ translateY: motion.interpolate({ inputRange: [0, 1], outputRange: [0, -s * 0.03] }) }] } : null
  if (kind === 'halo') {
    return <Animated.View style={[{ position: 'absolute', left: s * 0.2, top: -s * 0.2, width: s * 0.6, height: s * 0.16, borderRadius: s * 0.3, borderWidth: Math.max(2, s * 0.05), borderColor: color }, bob]} />
  }
  if (kind === 'catears' || kind === 'foxears' || kind === 'horns') {
    const h = s * (kind === 'foxears' ? 0.36 : kind === 'horns' ? 0.3 : 0.28)
    return (
      <Animated.View style={[StyleSheet.absoluteFill, bob]}>
        {tri(s * 0.06, '-22deg', h, kind === 'horns' ? accent : color)}
        {tri(s * 0.66, '22deg', h, kind === 'horns' ? accent : color)}
      </Animated.View>
    )
  }
  if (kind === 'bunnyears') {
    const ear = (left: number, rot: string) => (
      <View style={{ position: 'absolute', left, top: -s * 0.42, width: s * 0.18, height: s * 0.52, borderRadius: s * 0.1, backgroundColor: color, borderWidth: s * 0.04, borderColor: accent, transform: [{ rotate: rot }] }} />
    )
    return (
      <Animated.View style={[StyleSheet.absoluteFill, bob]}>
        {ear(s * 0.18, '-14deg')}
        {ear(s * 0.64, '14deg')}
      </Animated.View>
    )
  }
  if (kind === 'headphones') {
    const cup = (left: number) => <View style={{ position: 'absolute', left, top: s * 0.36, width: s * 0.16, height: s * 0.3, borderRadius: s * 0.07, backgroundColor: color, borderWidth: 1.5, borderColor: accent }} />
    return (
      <Animated.View style={[StyleSheet.absoluteFill, motion ? { transform: [{ scale: motion.interpolate({ inputRange: [0, 1], outputRange: [1, 1.03] }) }] } : null]}>
        <View style={{ position: 'absolute', left: s * 0.04, top: -s * 0.1, width: s * 0.92, height: s * 0.6, borderTopLeftRadius: s * 0.46, borderTopRightRadius: s * 0.46, borderWidth: Math.max(2, s * 0.06), borderBottomWidth: 0, borderColor: color }} />
        {cup(-s * 0.06)}
        {cup(s * 0.9)}
      </Animated.View>
    )
  }
  if (kind === 'wings' || kind === 'fairywings' || kind === 'batwings') {
    const flap = motion ? motion.interpolate({ inputRange: [0, 1], outputRange: [1, 0.75] }) : 1
    const wing = (left: number, rot: string) => (
      <Animated.View
        style={{
          position: 'absolute',
          left,
          top: s * 0.12,
          width: s * 0.42,
          height: s * 0.5,
          borderRadius: s * 0.25,
          backgroundColor: color,
          opacity: kind === 'fairywings' ? 0.6 : 0.95,
          borderWidth: 1.5,
          borderColor: accent,
          transform: [{ rotate: rot }, { scaleX: flap }],
        }}
      />
    )
    return (
      <View style={StyleSheet.absoluteFill}>
        {wing(-s * 0.4, '-20deg')}
        {wing(s * 0.98, '20deg')}
      </View>
    )
  }
  const g = ORNAMENT_GLYPH[kind]
  if (!g) return null
  const gs = Math.round(s * 0.32)
  const pair = kind === 'antlers' || kind === 'laurel'
  const text = (left: number, top: number) => (
    <Text accessible={false} style={{ position: 'absolute', left, top, width: gs, fontSize: gs, lineHeight: gs, textAlign: 'center', color: kind === 'laurel' ? accent : color }}>
      {g}
    </Text>
  )
  return (
    <Animated.View style={[StyleSheet.absoluteFill, bob]}>
      {pair
        ? kind === 'laurel'
          ? [text(-gs * 0.4, s * 0.62), text(s - gs * 0.6, s * 0.62)]
          : [text(s * 0.08, -gs * 0.8), text(s * 0.92 - gs, -gs * 0.8)]
        : text(s / 2 - gs / 2, -gs * 0.85)}
    </Animated.View>
  )
}

/** Fiche colorée par le thème du profil (bandeau principal en haut, accent en bas). */
export function ProfileThemeCard({
  primary,
  accent,
  style,
  children,
}: {
  primary?: number | null
  accent?: number | null
  style?: StyleProp<ViewStyle>
  children: ReactNode
}) {
  const theme = profileTheme(primary, accent)
  if (!theme) return <View style={style}>{children}</View>
  return (
    <View style={[style, styles.card, { backgroundColor: theme.bottom }]}>
      <View pointerEvents="none" style={[styles.band, { backgroundColor: theme.top }]} />
      {/* Voile sombre : texte lisible quelles que soient les couleurs. */}
      <View pointerEvents="none" style={styles.veil} />
      {children}
    </View>
  )
}

/** Particules jouées une fois au montage (rejouer = remonter avec une autre `key`) ;
 *  rien si « réduire les animations ». Glyphes et couleurs du web ; le calque du web
 *  (aurore, éclair, brume…) devient un voile coloré qui apparaît puis s'efface.
 *  `intensity` (25-200 %) multiplie le nombre de particules. */
export function ProfileEffect({ id, intensity }: { id?: string | null; intensity?: number | null }) {
  const fx = PROFILE_EFFECTS.find((e) => e.id === id)
  const reduce = useReduceMotion()
  const [tint] = useState(() => new Animated.Value(0))
  const n = fx ? fxCount(fx, intensity ?? 100) : 0
  // Tirées une fois par montage : un changement d'effet ou d'intensité remonte le composant (`key`).
  const [parts] = useState(() =>
      Array.from({ length: n }, (_, i) => ({
        v: new Animated.Value(0),
        left: `${Math.round(Math.random() * 92)}%` as const,
        top: `${Math.round(Math.random() * 85)}%` as const,
        delay: i * Math.min(150, 2100 / Math.max(1, n)) + Math.random() * 300,
        size: 10 + Math.round(Math.random() * 10),
        pick: Math.random(),
        pickColor: Math.random(),
      })),
  )
  useEffect(() => {
    if (!fx || reduce) return
    const all = Animated.parallel([
      ...parts.map((p) =>
        Animated.timing(p.v, { toValue: 1, duration: 2600, delay: p.delay, easing: Easing.out(Easing.quad), useNativeDriver: true }),
      ),
      ...(fx.tint
        ? [Animated.sequence([
            Animated.timing(tint, { toValue: 1, duration: 800, useNativeDriver: true }),
            Animated.delay(2200),
            Animated.timing(tint, { toValue: 0, duration: 1500, useNativeDriver: true }),
          ])]
        : []),
    ])
    all.start()
    return () => all.stop()
  }, [fx, reduce, parts, tint])
  if (!fx || reduce) return null
  const travel = fx.motion === 'rise' ? -320 : fx.motion === 'fall' ? 320 : 0
  return (
    <View pointerEvents="none" style={styles.fx}>
      {fx.tint ? <Animated.View style={[StyleSheet.absoluteFill, { backgroundColor: fx.tint, opacity: tint }]} /> : null}
      {fx.chars.length
        ? parts.map((p, i) => (
            <Animated.Text
              key={i}
              style={{
                position: 'absolute',
                left: p.left,
                ...(fx.motion === 'twinkle' ? { top: p.top } : { [fx.motion === 'rise' ? 'bottom' : 'top']: 0 }),
                fontSize: p.size,
                color: fx.colors[Math.floor(p.pickColor * fx.colors.length)] ?? '#ffffff',
                opacity: p.v.interpolate({ inputRange: [0, 0.15, 0.5, 1], outputRange: [0, 1, fx.motion === 'twinkle' ? 0.4 : 1, 0] }),
                transform: [
                  { translateY: p.v.interpolate({ inputRange: [0, 1], outputRange: [0, travel] }) },
                  ...(fx.motion === 'twinkle' ? [{ scale: p.v.interpolate({ inputRange: [0, 0.5, 1], outputRange: [0.6, 1.15, 0.8] }) }] : []),
                ],
              }}
            >
              {fx.chars[Math.floor(p.pick * fx.chars.length)]}
            </Animated.Text>
          ))
        : null}
    </View>
  )
}

const styles = StyleSheet.create({
  card: { overflow: 'hidden' },
  band: { position: 'absolute', left: 0, right: 0, top: 0, height: '45%' },
  veil: { position: 'absolute', left: 0, right: 0, top: 0, bottom: 0, backgroundColor: 'rgba(0,0,0,0.35)' },
  fx: { position: 'absolute', left: 0, right: 0, top: 0, bottom: 0, overflow: 'hidden', zIndex: 1 },
})
