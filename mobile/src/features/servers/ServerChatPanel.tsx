import { useFocusEffect } from 'expo-router'
import { useCallback, useEffect, useState } from 'react'
import { BackHandler, StyleSheet, useWindowDimensions, View } from 'react-native'
import { Gesture, GestureDetector } from 'react-native-gesture-handler'
import Animated, { useAnimatedStyle, useSharedValue, withTiming } from 'react-native-reanimated'
import { scheduleOnRN } from 'react-native-worklets'
import { IconButton } from '@/components/ui'
import { useT } from '@/i18n'
import { colors, spacing } from '@/theme'
import { ChannelActions, ChannelBody, ChannelTitle, useChannelInfo } from './ChannelChat'

const OPEN_MS = 220
const CLOSE_MS = 180

/**
 * Salon texte du serveur, posé par-dessus la liste des salons comme Discord mobile : il arrive en
 * glissant depuis la droite ; glisser vers la droite (ou ←, ou le retour Android) le referme.
 * L'animation et le geste tournent sur le thread UI (Reanimated) ; la conversation n'est montée que
 * le panneau ouvert (elle marque le salon « lu » et coupe ses non-lus tant qu'elle est montée).
 */
export function ServerChatPanel({ serverId, channelId, open, onClose }: { serverId: string; channelId: string | null; open: boolean; onClose: () => void }) {
  const t = useT()
  const { width } = useWindowDimensions()
  const x = useSharedValue(open ? 0 : width)
  // Reste monté pendant l'animation de fermeture ; démonté à la fin.
  const [mounted, setMounted] = useState(open)
  if (open && !mounted) setMounted(true)

  useEffect(() => {
    if (open) x.set(withTiming(0, { duration: OPEN_MS }))
    else
      x.set(
        withTiming(width, { duration: CLOSE_MS }, (done) => {
          if (done) scheduleOnRN(setMounted, false)
        }),
      )
  }, [open, width, x])

  // Retour Android : ramène à la liste des salons plutôt que de quitter l'accueil.
  useFocusEffect(
    useCallback(() => {
      if (!open) return
      const sub = BackHandler.addEventListener('hardwareBackPress', () => {
        onClose()
        return true
      })
      return () => sub.remove()
    }, [open, onClose]),
  )

  const pan = Gesture.Pan()
    .enabled(open)
    .activeOffsetX(20)
    .failOffsetY([-15, 15])
    .onUpdate((e) => {
      x.set(Math.max(0, e.translationX))
    })
    .onEnd((e) => {
      if (e.translationX > width * 0.3 || e.velocityX > 800) {
        x.set(
          withTiming(width, { duration: CLOSE_MS }, (done) => {
            if (done) scheduleOnRN(onClose)
          }),
        )
      } else {
        x.set(withTiming(0, { duration: OPEN_MS }))
      }
    })

  const style = useAnimatedStyle(() => ({ transform: [{ translateX: x.get() }] }))

  if (!mounted || !channelId) return null
  return (
    <GestureDetector gesture={pan}>
      <Animated.View style={[StyleSheet.absoluteFill, styles.panel, style]}>
        <PanelContent serverId={serverId} channelId={channelId} onBack={onClose} backLabel={t('common.back')} />
      </Animated.View>
    </GestureDetector>
  )
}

function PanelContent({ serverId, channelId, onBack, backLabel }: { serverId: string; channelId: string; onBack: () => void; backLabel: string }) {
  const info = useChannelInfo(serverId, channelId)
  return (
    <>
      <View style={styles.header}>
        <IconButton icon="arrow-back" label={backLabel} onPress={onBack} />
        <View style={{ flex: 1 }}>
          <ChannelTitle name={info.name} topic={info.channel?.topic} />
        </View>
        <ChannelActions serverId={serverId} channelId={channelId} name={info.name} isAnnouncement={info.isAnnouncement} />
      </View>
      <ChannelBody serverId={serverId} channelId={channelId} name={info.name} nsfw={!!info.channel?.is_nsfw} publishable={info.publishable} autoThreads={!!info.channel?.auto_threads} />
    </>
  )
}

const styles = StyleSheet.create({
  panel: { backgroundColor: colors.bg, zIndex: 10, elevation: 10 },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.xs,
    minHeight: 52,
    paddingHorizontal: spacing.xs,
    backgroundColor: colors.bgAlt,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: colors.border,
  },
})
