import { Ionicons } from '@expo/vector-icons'
import { useEffect, useMemo, useRef, useState, type ReactNode } from 'react'
import { Platform, Pressable, StyleSheet, View, type StyleProp, type ViewStyle } from 'react-native'
import Animated, { useAnimatedStyle, useSharedValue, withTiming } from 'react-native-reanimated'
import { Sheet, type SheetAction } from '@/components/Sheet'
import type { IconName } from '@/components/ui'
import { CONTROLS_HIDE_MS, createAutoHide } from '@/features/calls/videoLayout'
import { useT, type Key } from '@/i18n'
import { callAudio } from '@/services/livekit'
import { colors } from '@/theme'

/** Bouton rond des écrans d'appel (toujours sombres, comme Discord). */
export function CallButton({
  icon,
  label,
  onPress,
  active,
  danger,
  dim,
  dot,
  size = 54,
}: {
  icon: IconName
  label: string
  onPress: () => void
  active?: boolean
  danger?: boolean
  dim?: boolean
  /** Point vert (une vidéo tourne dans le salon…). */
  dot?: boolean
  size?: number
}) {
  return (
    <Pressable
      onPress={onPress}
      accessibilityRole="button"
      accessibilityLabel={label}
      accessibilityState={{ selected: !!active }}
      hitSlop={4}
      style={[
        styles.btn,
        { width: size, height: size, borderRadius: size / 2 },
        active && { backgroundColor: '#f2f3f5' },
        danger && { backgroundColor: colors.danger },
        dim && { opacity: 0.5 },
      ]}
    >
      <Ionicons name={icon} size={Math.round(size * 0.46)} color={active ? '#111214' : '#fff'} />
      {dot ? <View style={styles.dot} /> : null}
    </Pressable>
  )
}

/**
 * Commandes qui se masquent après quelques secondes sans interaction quand une vidéo est affichée,
 * et réapparaissent au toucher. `enabled` false (pas de vidéo) : toujours visibles.
 */
export function useAutoHide(enabled: boolean) {
  const [visible, setVisible] = useState(true)
  const ctl = useMemo(() => createAutoHide(CONTROLS_HIDE_MS, setVisible), [])
  useEffect(() => ctl.setEnabled(enabled), [ctl, enabled])
  useEffect(() => () => ctl.dispose(), [ctl])
  return { visible, poke: ctl.poke, toggle: ctl.toggle }
}

/** Fondu + glissement des commandes (fil UI, Reanimated) ; ne capte plus les appuis une fois masquées. */
export function AutoHideView({
  visible,
  from = 'bottom',
  style,
  children,
  onTouch,
}: {
  visible: boolean
  from?: 'top' | 'bottom'
  style?: StyleProp<ViewStyle>
  children: ReactNode
  /** Toute interaction avec les commandes relance le délai de masquage. */
  onTouch?: () => void
}) {
  const shown = useSharedValue(visible ? 1 : 0)
  useEffect(() => {
    shown.value = withTiming(visible ? 1 : 0, { duration: 200 })
  }, [visible, shown])
  const anim = useAnimatedStyle(() => ({
    opacity: shown.value,
    transform: [{ translateY: (1 - shown.value) * (from === 'top' ? -24 : 24) }],
  }))
  return (
    <Animated.View style={[style, anim]} pointerEvents={visible ? 'box-none' : 'none'} onTouchStart={onTouch}>
      {children}
    </Animated.View>
  )
}

const OUTPUT_ICON: Record<string, IconName> = {
  speaker: 'volume-high',
  earpiece: 'ear-outline',
  headset: 'headset',
  bluetooth: 'bluetooth',
}
const OUTPUT_LABEL: Record<string, Key> = {
  speaker: 'call.output.speaker',
  earpiece: 'call.output.earpiece',
  headset: 'call.output.headset',
  bluetooth: 'call.output.bluetooth',
}

/**
 * Sortie audio : sans casque ni Bluetooth, un appui bascule haut-parleur / écouteur ; sinon une
 * feuille propose toutes les sorties (iOS : sélecteur du système). `setSpeaker` route le son,
 * `markSpeaker` met seulement l'état à jour (sortie déjà choisie ici).
 */
export function useAudioRoute(speaker: boolean, setSpeaker: () => void, markSpeaker: (on: boolean) => void) {
  const t = useT()
  const [choices, setChoices] = useState<string[] | null>(null)
  const [picked, setPicked] = useState<string | null>(null)
  const lastSpeaker = useRef(speaker)
  // Bascule faite ailleurs (barre de notification, autre écran) : l'icône suit l'état du store.
  useEffect(() => {
    if (lastSpeaker.current !== speaker) setPicked(null)
    lastSpeaker.current = speaker
  }, [speaker])

  const open = async () => {
    if (Platform.OS === 'ios') {
      await callAudio.showRoutePicker()
      return
    }
    const outputs = await callAudio.outputs()
    if (!outputs.some((o) => o === 'bluetooth' || o === 'headset')) {
      setPicked(null)
      setSpeaker()
      return
    }
    setChoices(outputs.filter((o) => OUTPUT_LABEL[o]))
  }

  const current = picked ?? (speaker ? 'speaker' : 'earpiece')
  const actions: SheetAction[] = (choices ?? []).map((o) => ({
    label: t(OUTPUT_LABEL[o]!),
    icon: OUTPUT_ICON[o] ?? 'volume-high',
    selected: o === current,
    onPress: () => {
      setPicked(o)
      lastSpeaker.current = o === 'speaker'
      markSpeaker(o === 'speaker')
      void callAudio.selectOutput(o)
    },
  }))
  const sheet = <Sheet visible={!!choices} onClose={() => setChoices(null)} title={t('call.audioOutput')} actions={actions} />
  return { open: () => void open(), icon: OUTPUT_ICON[current] ?? 'volume-high', label: t('call.audioOutput'), sheet, onSpeaker: current === 'speaker' }
}

const styles = StyleSheet.create({
  btn: { backgroundColor: 'rgba(255,255,255,0.18)', alignItems: 'center', justifyContent: 'center' },
  dot: { position: 'absolute', top: 4, right: 4, width: 12, height: 12, borderRadius: 6, backgroundColor: colors.success, borderWidth: 2, borderColor: '#111214' },
})
