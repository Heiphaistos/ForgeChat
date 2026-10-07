import { useEffect } from 'react'
import { Pressable, StyleSheet, useWindowDimensions } from 'react-native'
import { Gesture, GestureDetector } from 'react-native-gesture-handler'
import Animated, { useAnimatedStyle, useSharedValue, withSpring } from 'react-native-reanimated'
import { useSafeAreaInsets } from 'react-native-safe-area-context'
import { RTCView } from '@livekit/react-native-webrtc'
import { snapToCorner } from '@/features/calls/videoLayout'
import { useT } from '@/i18n'
import { colors, spacing } from '@/theme'
import type { CallTile } from './VideoTile'

const SPRING = { damping: 18, stiffness: 180 }

/**
 * Petite vignette vidéo (ma caméra, ou le correspondant après échange) : se déplace au doigt et
 * s'accroche au coin le plus proche (fil UI, Reanimated). Un appui la met en grand (`onPress`).
 * `top` / `bottom` : zones occupées par les commandes, que la vignette évite.
 */
export function SelfView({ tile, onPress, top, bottom }: { tile: CallTile; onPress?: () => void; top: number; bottom: number }) {
  const t = useT()
  const { width: W, height: H } = useWindowDimensions()
  const insets = useSafeAreaInsets()
  const landscape = W > H
  const w = landscape ? 150 : 104
  const h = landscape ? 104 : 150
  const frame = { W, H, top: insets.top + top, bottom: insets.bottom + bottom, side: insets.left + spacing.md }
  const x = useSharedValue(W - frame.side - w)
  const y = useSharedValue(frame.top)
  const startX = useSharedValue(0)
  const startY = useSharedValue(0)

  const snap = () => {
    'worklet'
    const c = snapToCorner(x.value, y.value, w, h, frame)
    x.set(withSpring(c.x, SPRING))
    y.set(withSpring(c.y, SPRING))
  }
  // Rotation, commandes affichées ou masquées : la vignette reste dans son coin.
  // eslint-disable-next-line react-hooks/exhaustive-deps -- snap et frame sont recréés à chaque rendu
  useEffect(snap, [W, H, w, h, frame.top, frame.bottom, frame.side])

  const pan = Gesture.Pan()
    .minDistance(4)
    .onStart(() => {
      startX.set(x.value)
      startY.set(y.value)
    })
    .onUpdate((e) => {
      x.set(startX.value + e.translationX)
      y.set(startY.value + e.translationY)
    })
    .onEnd(snap)

  // left/top plutôt que transform : la SurfaceView de RTCView ignore les transformations.
  const style = useAnimatedStyle(() => ({ left: x.value, top: y.value }))
  if (!tile.stream) return null
  return (
    <GestureDetector gesture={pan}>
      <Animated.View style={[styles.box, { width: w, height: h }, tile.speaking && styles.speaking, style]}>
        <Pressable style={StyleSheet.absoluteFill} onPress={onPress} accessibilityRole="button" accessibilityLabel={t('call.selfView')} accessibilityHint={onPress ? t('call.swap') : undefined}>
          {/* zOrder 1 : au-dessus de la vidéo principale (deux SurfaceView superposées). */}
          <RTCView streamURL={tile.stream.toURL()} style={StyleSheet.absoluteFill} objectFit="cover" mirror={!!tile.mirror} zOrder={1} />
        </Pressable>
      </Animated.View>
    </GestureDetector>
  )
}

const styles = StyleSheet.create({
  box: { position: 'absolute', borderRadius: 12, overflow: 'hidden', backgroundColor: '#000', borderWidth: 2, borderColor: 'rgba(255,255,255,0.25)' },
  speaking: { borderColor: colors.success },
})
