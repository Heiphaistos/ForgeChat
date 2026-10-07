import { Ionicons } from '@expo/vector-icons'
import { useState } from 'react'
import { Modal, Pressable, StyleSheet, Text, View, type LayoutChangeEvent } from 'react-native'
import { Gesture, GestureDetector, GestureHandlerRootView } from 'react-native-gesture-handler'
import Animated, { useAnimatedStyle, useSharedValue, withTiming } from 'react-native-reanimated'
import { useSafeAreaInsets } from 'react-native-safe-area-context'
import { RTCView, type MediaStream } from '@livekit/react-native-webrtc'
import { clampOffset, clampZoom } from '@/features/calls/screenShareLogic'
import { useT } from '@/i18n'
import { colors, font, radius, spacing } from '@/theme'

export interface ViewerSource {
  key: string
  label: string
  stream: MediaStream
}

/**
 * Visionneuse plein écran d'une vidéo (écran partagé, caméra) : zoom au pincement, déplacement
 * au doigt une fois zoomé, double appui pour revenir à 1×, bascule entre les sources.
 *
 * RTCView s'appuie sur une SurfaceView Android, qui ignore les transformations (scale) : on
 * agrandit donc réellement la vue (largeur/hauteur) et on la décale, le cadre plein écran
 * coupant ce qui dépasse.
 */
export function StreamViewer({ sources, initialKey, onClose }: { sources: ViewerSource[]; initialKey: string | null; onClose: () => void }) {
  const insets = useSafeAreaInsets()
  const t = useT()
  // Source choisie dans la visionneuse (bascule caméra / écran) ; sinon celle demandée.
  const [picked, setPicked] = useState<string | null>(null)
  const [size, setSize] = useState({ w: 1, h: 1 })
  const scale = useSharedValue(1)
  const savedScale = useSharedValue(1)
  const tx = useSharedValue(0)
  const ty = useSharedValue(0)
  const savedTx = useSharedValue(0)
  const savedTy = useSharedValue(0)

  const wanted = picked ?? initialKey
  const source = sources.find((s) => s.key === wanted) ?? sources[0] ?? null
  const close = () => {
    setPicked(null)
    reset()
    onClose()
  }

  const reset = () => {
    'worklet'
    scale.value = withTiming(1)
    savedScale.value = 1
    tx.value = withTiming(0)
    ty.value = withTiming(0)
    savedTx.value = 0
    savedTy.value = 0
  }

  const { w, h } = size
  const pinch = Gesture.Pinch()
    .onUpdate((e) => {
      const s = clampZoom(savedScale.value * e.scale)
      const ratio = s / savedScale.value
      scale.value = s
      tx.value = clampOffset(e.focalX - (e.focalX - savedTx.value) * ratio, s, w)
      ty.value = clampOffset(e.focalY - (e.focalY - savedTy.value) * ratio, s, h)
    })
    .onEnd(() => {
      savedScale.value = scale.value
      savedTx.value = tx.value
      savedTy.value = ty.value
    })
  const pan = Gesture.Pan()
    .minPointers(1)
    .onUpdate((e) => {
      tx.value = clampOffset(savedTx.value + e.translationX, scale.value, w)
      ty.value = clampOffset(savedTy.value + e.translationY, scale.value, h)
    })
    .onEnd(() => {
      savedTx.value = tx.value
      savedTy.value = ty.value
    })
  const doubleTap = Gesture.Tap().numberOfTaps(2).onEnd(() => reset())
  const gesture = Gesture.Simultaneous(pinch, pan, doubleTap)

  const videoStyle = useAnimatedStyle(() => ({
    left: tx.value,
    top: ty.value,
    width: w * scale.value,
    height: h * scale.value,
  }))

  const onLayout = (e: LayoutChangeEvent) => setSize({ w: e.nativeEvent.layout.width, h: e.nativeEvent.layout.height })

  return (
    <Modal visible={!!initialKey && !!source} animationType="fade" onRequestClose={close} statusBarTranslucent navigationBarTranslucent>
      <GestureHandlerRootView style={styles.root}>
        <GestureDetector gesture={gesture}>
          <View style={styles.frame} onLayout={onLayout} accessibilityLabel={source ? t('panel.stream.zoom', { label: source.label }) : undefined}>
            {source ? (
              <Animated.View style={[styles.video, videoStyle]}>
                <RTCView streamURL={source.stream.toURL()} style={StyleSheet.absoluteFill} objectFit="contain" />
              </Animated.View>
            ) : null}
          </View>
        </GestureDetector>
        <View style={[styles.top, { paddingTop: insets.top + spacing.sm }]} pointerEvents="box-none">
          <Text style={styles.label} numberOfLines={1}>
            {source?.label}
          </Text>
          <Pressable onPress={close} accessibilityRole="button" accessibilityLabel={t('panel.stream.close')} hitSlop={8} style={styles.close}>
            <Ionicons name="close" size={26} color="#fff" />
          </Pressable>
        </View>
        {sources.length > 1 ? (
          <View style={[styles.switcher, { bottom: insets.bottom + spacing.lg }]}>
            {sources.map((s) => (
              <Pressable
                key={s.key}
                onPress={() => {
                  setPicked(s.key)
                  reset()
                }}
                accessibilityRole="button"
                accessibilityState={{ selected: s.key === source?.key }}
                style={[styles.chip, s.key === source?.key && styles.chipOn]}
              >
                <Text style={[styles.chipText, s.key === source?.key && { color: colors.bgDeep }]}>{s.label}</Text>
              </Pressable>
            ))}
          </View>
        ) : null}
      </GestureHandlerRootView>
    </Modal>
  )
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: '#000' },
  frame: { flex: 1, overflow: 'hidden' },
  video: { position: 'absolute' },
  top: { position: 'absolute', top: 0, left: 0, right: 0, flexDirection: 'row', alignItems: 'center', paddingHorizontal: spacing.lg, gap: spacing.md },
  label: { flex: 1, color: '#fff', fontSize: font.md, fontWeight: '700', textShadowColor: '#000', textShadowRadius: 6 },
  close: { width: 44, height: 44, borderRadius: 22, backgroundColor: 'rgba(0,0,0,0.5)', alignItems: 'center', justifyContent: 'center' },
  switcher: { position: 'absolute', alignSelf: 'center', flexDirection: 'row', gap: spacing.sm, backgroundColor: 'rgba(0,0,0,0.5)', padding: 4, borderRadius: radius.full },
  chip: { paddingHorizontal: spacing.md, paddingVertical: 6, borderRadius: radius.full },
  chipOn: { backgroundColor: '#fff' },
  chipText: { color: '#fff', fontWeight: '700', fontSize: font.sm },
})
