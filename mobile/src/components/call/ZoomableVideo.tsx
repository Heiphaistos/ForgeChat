import { useState } from 'react'
import { Platform, StyleSheet, View, type LayoutChangeEvent } from 'react-native'
import { Gesture, GestureDetector } from 'react-native-gesture-handler'
import Animated, { useAnimatedStyle, useSharedValue, withTiming } from 'react-native-reanimated'
import { RTCView, type MediaStream } from '@livekit/react-native-webrtc'
import { clampOffset, clampZoom } from '@/features/calls/screenShareLogic'

/** Zoom d'un double appui : assez pour lire le texte d'un écran partagé. */
const DOUBLE_TAP_ZOOM = 2.5

/**
 * Vidéo zoomable (plein écran, appel privé) : pincer pour zoomer, glisser pour se déplacer une
 * fois zoomé, double appui pour zoomer sur le point touché ou revenir à 1×, simple appui
 * transmis (`onTap` : afficher / masquer les commandes). Gestes et animation sur le fil UI.
 *
 * RTCView s'appuie sur une SurfaceView Android, qui ignore les transformations (scale) : on
 * agrandit donc réellement la vue (largeur/hauteur) et on la décale, le cadre coupant ce qui dépasse.
 */
export function ZoomableVideo({
  stream,
  fit,
  mirror,
  onTap,
  onDimensions,
  label,
  hint,
}: {
  stream: MediaStream
  fit: 'cover' | 'contain'
  mirror?: boolean
  onTap?: () => void
  /** Taille réelle de la vidéo (ratio de l'image dans l'image). */
  onDimensions?: (w: number, h: number) => void
  label?: string
  hint?: string
}) {
  const [size, setSize] = useState({ w: 1, h: 1 })
  const scale = useSharedValue(1)
  const savedScale = useSharedValue(1)
  const tx = useSharedValue(0)
  const ty = useSharedValue(0)
  const savedTx = useSharedValue(0)
  const savedTy = useSharedValue(0)
  const { w, h } = size

  const zoomTo = (s: number, fx: number, fy: number) => {
    'worklet'
    const ratio = s / savedScale.value
    const nx = clampOffset(fx - (fx - savedTx.value) * ratio, s, w)
    const ny = clampOffset(fy - (fy - savedTy.value) * ratio, s, h)
    scale.set(withTiming(s))
    tx.set(withTiming(nx))
    ty.set(withTiming(ny))
    savedScale.set(s)
    savedTx.set(nx)
    savedTy.set(ny)
  }

  const pinch = Gesture.Pinch()
    .onUpdate((e) => {
      const s = clampZoom(savedScale.value * e.scale)
      const ratio = s / savedScale.value
      scale.set(s)
      tx.set(clampOffset(e.focalX - (e.focalX - savedTx.value) * ratio, s, w))
      ty.set(clampOffset(e.focalY - (e.focalY - savedTy.value) * ratio, s, h))
    })
    .onEnd(() => {
      savedScale.set(scale.value)
      savedTx.set(tx.value)
      savedTy.set(ty.value)
    })
  const pan = Gesture.Pan()
    .minDistance(8)
    .onUpdate((e) => {
      tx.set(clampOffset(savedTx.value + e.translationX, scale.value, w))
      ty.set(clampOffset(savedTy.value + e.translationY, scale.value, h))
    })
    .onEnd(() => {
      savedTx.set(tx.value)
      savedTy.set(ty.value)
    })
  const doubleTap = Gesture.Tap()
    .numberOfTaps(2)
    .onEnd((e) => zoomTo(savedScale.value > 1.05 ? 1 : DOUBLE_TAP_ZOOM, e.x, e.y))
  const singleTap = Gesture.Tap()
    .runOnJS(true)
    .onEnd(() => onTap?.())
  const gesture = Gesture.Simultaneous(pinch, pan, Gesture.Exclusive(doubleTap, singleTap))

  const videoStyle = useAnimatedStyle(() => ({
    left: tx.value,
    top: ty.value,
    width: w * scale.value,
    height: h * scale.value,
  }))

  // Nouvelle taille (rotation, image dans l'image) : retour à 1×, les bornes du zoom ont changé.
  const reset = () => {
    'worklet'
    scale.set(1)
    savedScale.set(1)
    tx.set(0)
    ty.set(0)
    savedTx.set(0)
    savedTy.set(0)
  }
  const onLayout = (e: LayoutChangeEvent) => {
    reset()
    setSize({ w: e.nativeEvent.layout.width, h: e.nativeEvent.layout.height })
  }

  return (
    <GestureDetector gesture={gesture}>
      <View style={styles.frame} onLayout={onLayout} accessible accessibilityLabel={label} accessibilityHint={hint} accessibilityRole="image">
        <Animated.View style={[styles.video, videoStyle]}>
          <RTCView
            streamURL={stream.toURL()}
            style={StyleSheet.absoluteFill}
            objectFit={fit}
            mirror={!!mirror}
            onDimensionsChange={onDimensions ? (e) => onDimensions(e.nativeEvent.width, e.nativeEvent.height) : undefined}
            // iOS : image dans l'image du système en quittant l'app (Android : CallWindow.kt).
            iosPIP={Platform.OS === 'ios' ? { enabled: true, startAutomatically: true, stopAutomatically: true } : undefined}
          />
        </Animated.View>
      </View>
    </GestureDetector>
  )
}

const styles = StyleSheet.create({
  frame: { flex: 1, overflow: 'hidden', backgroundColor: '#000' },
  video: { position: 'absolute' },
})
