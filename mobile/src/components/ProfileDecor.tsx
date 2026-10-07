import { useEffect, useState, type ReactNode } from 'react'
import { AccessibilityInfo, Animated, Easing, StyleSheet, View, type StyleProp, type ViewStyle } from 'react-native'
import { PROFILE_EFFECTS, findDecoration, profileTheme } from '@/features/account/profileDecor'

/** « Réduire les animations » du système. */
function useReduceMotion() {
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
  const side = (i: number) => deco.colors[i % deco.colors.length]
  const ring = (gap: number, width: number) => ({
    position: 'absolute' as const,
    left: -gap,
    top: -gap,
    width: size + gap * 2,
    height: size + gap * 2,
    borderRadius: size / 2 + gap,
    borderWidth: width,
    borderStyle: deco.kind === 'dashed' ? ('dashed' as const) : ('solid' as const),
    borderTopColor: side(0),
    borderRightColor: side(1),
    borderBottomColor: side(2),
    borderLeftColor: side(3),
  })
  const motion = !anim
    ? null
    : anim === 'spin'
      ? { transform: [{ rotate: v.interpolate({ inputRange: [0, 1], outputRange: ['0deg', '360deg'] }) }] }
      : { opacity: v.interpolate({ inputRange: [0, 0.5, 1], outputRange: [1, 0.5, 1] }) }
  return (
    <View style={{ width: size, height: size }}>
      {children}
      <Animated.View pointerEvents="none" style={[ring(w + 1, w), motion]} />
      {deco.kind === 'double' ? <View pointerEvents="none" style={ring(w * 2 + 3, Math.max(1, w / 2))} /> : null}
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
 *  rien si « réduire les animations ». */
export function ProfileEffect({ id }: { id?: string | null }) {
  const fx = PROFILE_EFFECTS.find((e) => e.id === id)
  const reduce = useReduceMotion()
  const [parts] = useState(() =>
    Array.from({ length: 12 }, (_, i) => ({
      v: new Animated.Value(0),
      left: `${Math.round(Math.random() * 92)}%` as const,
      delay: i * 160 + Math.random() * 300,
      size: 12 + Math.round(Math.random() * 10),
    })),
  )
  useEffect(() => {
    if (!fx || reduce) return
    const all = Animated.parallel(
      parts.map((p) =>
        Animated.timing(p.v, { toValue: 1, duration: 2600, delay: p.delay, easing: Easing.out(Easing.quad), useNativeDriver: true }),
      ),
    )
    all.start()
    return () => all.stop()
  }, [fx, reduce, parts])
  if (!fx || reduce) return null
  return (
    <View pointerEvents="none" style={styles.fx}>
      {parts.map((p, i) => (
        <Animated.Text
          key={i}
          style={{
            position: 'absolute',
            left: p.left,
            [fx.rise ? 'bottom' : 'top']: 0,
            fontSize: p.size,
            color: fx.color,
            opacity: p.v.interpolate({ inputRange: [0, 0.15, 1], outputRange: [0, 1, 0] }),
            transform: [{ translateY: p.v.interpolate({ inputRange: [0, 1], outputRange: [0, fx.rise ? -320 : 320] }) }],
          }}
        >
          {fx.char}
        </Animated.Text>
      ))}
    </View>
  )
}

const styles = StyleSheet.create({
  card: { overflow: 'hidden' },
  band: { position: 'absolute', left: 0, right: 0, top: 0, height: '45%' },
  veil: { position: 'absolute', left: 0, right: 0, top: 0, bottom: 0, backgroundColor: 'rgba(0,0,0,0.35)' },
  fx: { position: 'absolute', left: 0, right: 0, top: 0, bottom: 0, overflow: 'hidden', zIndex: 1 },
})
