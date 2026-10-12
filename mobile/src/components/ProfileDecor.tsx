import { useEffect, useState, type ReactNode } from 'react'
import { AccessibilityInfo, Animated, Easing, StyleSheet, Text, View, type StyleProp, type ViewStyle } from 'react-native'
import { PROFILE_EFFECTS, findDecoration, profileTheme } from '@/features/account/profileDecor'

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

/** Anneau décoratif autour d'un avatar de `size` px (bordures colorées, sans SVG). */
export function AvatarDecoration({ id, size, children }: { id?: string | null; size: number; children: ReactNode }) {
  const deco = findDecoration(id)
  const reduce = useReduceMotion()
  const [v] = useState(() => new Animated.Value(0))
  const anim = reduce ? undefined : deco?.anim
  useEffect(() => {
    if (!anim) return
    v.setValue(0)
    const loop = Animated.loop(
      Animated.timing(v, { toValue: 1, duration: anim === 'spin' ? 6000 : 2400, easing: Easing.linear, useNativeDriver: true }),
    )
    loop.start()
    return () => loop.stop()
  }, [anim, v])
  if (!deco) return <>{children}</>
  const w = Math.max(2, Math.round(size * 0.07))
  // « transparent » (comète, laser) : côté laissé vide, comme les trous du dégradé web.
  const side = (i: number) => deco.colors[i % deco.colors.length]
  const borderStyle = deco.kind === 'dashed' || deco.kind === 'stripes' ? ('dashed' as const) : deco.kind === 'segments' ? ('dotted' as const) : ('solid' as const)
  const ring = (gap: number, width: number, solidColor?: string) => ({
    position: 'absolute' as const,
    left: -gap,
    top: -gap,
    width: size + gap * 2,
    height: size + gap * 2,
    borderRadius: size / 2 + gap,
    borderWidth: width,
    borderStyle: solidColor ? ('solid' as const) : borderStyle,
    borderTopColor: solidColor ?? side(0),
    borderRightColor: solidColor ?? side(1),
    borderBottomColor: solidColor ?? side(2),
    borderLeftColor: solidColor ?? side(3),
  })
  // Halo : ombre colorée (iOS) ; Android n'ombre pas une bordure, la couleur suffit.
  const glow = deco.glow ? { shadowColor: deco.glow, shadowOpacity: 0.9, shadowRadius: Math.max(3, w), shadowOffset: { width: 0, height: 0 } } : null
  const motion = !anim
    ? null
    : anim === 'spin'
      ? { transform: [{ rotate: v.interpolate({ inputRange: [0, 1], outputRange: ['0deg', '360deg'] }) }] }
      : { opacity: v.interpolate({ inputRange: [0, 0.5, 1], outputRange: [1, 0.5, 1] }) }
  const glyphSize = Math.max(7, Math.round(size * 0.2))
  const r = size / 2 + w * 0.6
  return (
    <View style={{ width: size, height: size }}>
      {children}
      <Animated.View pointerEvents="none" style={[ring(w + 1, w), glow, motion]} />
      {deco.kind === 'double' ? <View pointerEvents="none" style={ring(w * 2 + 3, Math.max(1, w / 2))} /> : null}
      {deco.kind === 'dual' ? <View pointerEvents="none" style={[ring(w * 2 + 2, 1.5, deco.colors[deco.colors.length - 1]), { opacity: 0.85 }]} /> : null}
      {deco.glyph && size >= 28
        ? [45, 135, 225, 315].map((a, i) => (
            <Text
              key={a}
              accessible={false}
              style={{
                position: 'absolute',
                left: size / 2 + r * Math.cos((a * Math.PI) / 180) - glyphSize / 2,
                top: size / 2 + r * Math.sin((a * Math.PI) / 180) - glyphSize / 2,
                width: glyphSize,
                height: glyphSize,
                fontSize: glyphSize * 0.85,
                lineHeight: glyphSize,
                textAlign: 'center',
                color: deco.glow ?? deco.colors[i % deco.colors.length],
              }}
            >
              {deco.glyph}
            </Text>
          ))
        : null}
    </View>
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
 *  (aurore, éclair, brume…) devient un voile coloré qui apparaît puis s'efface. */
export function ProfileEffect({ id }: { id?: string | null }) {
  const fx = PROFILE_EFFECTS.find((e) => e.id === id)
  const reduce = useReduceMotion()
  const [tint] = useState(() => new Animated.Value(0))
  const [parts] = useState(() =>
    Array.from({ length: 14 }, (_, i) => ({
      v: new Animated.Value(0),
      left: `${Math.round(Math.random() * 92)}%` as const,
      top: `${Math.round(Math.random() * 85)}%` as const,
      delay: i * 150 + Math.random() * 300,
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
