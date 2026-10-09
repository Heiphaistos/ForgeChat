import { Ionicons } from '@expo/vector-icons'
import { useEffect, useMemo, useState } from 'react'
import { useAudioPlayer, useAudioPlayerStatus } from 'expo-audio'
import { useVideoPlayer, VideoView } from 'expo-video'
import { ActivityIndicator, PanResponder, Pressable, StyleSheet, Text, View } from 'react-native'
import { useT } from '@/i18n'
import type { Attachment } from '@/types/models'
import { colors, font, radius, spacing } from '@/theme'
import { formatDuration } from './media'

/**
 * Lecteurs intégrés. `src` vient TOUJOURS de resolveMediaUrl (/uploads/ du serveur ou https) :
 * aucune autre source n'est passée aux lecteurs natifs.
 */

export function VideoAttachment({ src, label }: { src: string; label: string }) {
  // Pas de lecture automatique : le lecteur ne charge la vidéo qu'à l'appui sur « lecture ».
  const player = useVideoPlayer(src)
  return (
    <View style={styles.video} accessibilityLabel={label}>
      <VideoView player={player} nativeControls contentFit="contain" fullscreenOptions={{ enable: true }} style={StyleSheet.absoluteFill} />
    </View>
  )
}

export function AudioAttachment({
  src,
  attachment,
  voice,
  onLongPress,
}: {
  src: string
  attachment: Attachment
  voice?: boolean
  onLongPress?: () => void
}) {
  const t = useT()
  const label = voice ? t('panel.att.voice') : attachment.filename
  const player = useAudioPlayer(src)
  const status = useAudioPlayerStatus(player)
  const ended = !status.playing && status.duration > 0 && status.currentTime >= status.duration - 0.25
  // Barre manipulable : toucher ou glisser place la lecture ; l'aperçu suit le doigt jusqu'au relâchement.
  const [scrub, setScrub] = useState<number | null>(null)
  const [width, setWidth] = useState(1)
  const duration = status.duration
  const pan = useMemo(() => {
    const ratioAt = (x: number) => Math.max(0, Math.min(1, x / width))
    return PanResponder.create({
      onStartShouldSetPanResponder: () => duration > 0,
      onMoveShouldSetPanResponder: () => duration > 0,
      onPanResponderGrant: (e) => setScrub(ratioAt(e.nativeEvent.locationX)),
      onPanResponderMove: (e) => setScrub(ratioAt(e.nativeEvent.locationX)),
      onPanResponderRelease: (e) => {
        void player.seekTo(ratioAt(e.nativeEvent.locationX) * duration)
        setScrub(null)
      },
      onPanResponderTerminate: () => setScrub(null),
    })
  }, [player, width, duration])
  const progress = scrub ?? (status.duration > 0 ? Math.min(1, status.currentTime / status.duration) : 0)
  // Vitesse 1× à 3× (plafond relevé à 3 par patches/expo-audio+57.0.5.patch), voix non déformée.
  const [speed, setSpeed] = useState(0)
  const rate = SPEEDS[speed] ?? 1
  useEffect(() => { if (status.isLoaded) player.setPlaybackRate(rate, 'high') }, [player, rate, status.isLoaded])

  const toggle = () => {
    if (status.playing) {
      player.pause()
      return
    }
    if (ended) void player.seekTo(0)
    player.play()
  }

  return (
    <View style={styles.audio}>
      <Pressable
        onPress={toggle}
        onLongPress={onLongPress}
        delayLongPress={300}
        disabled={!status.isLoaded}
        style={styles.playButton}
        accessibilityRole="button"
        accessibilityLabel={t(status.playing ? 'panel.att.pause' : 'panel.att.play', { label })}
        hitSlop={6}
      >
        {!status.isLoaded ? (
          <ActivityIndicator color="#fff" size="small" />
        ) : (
          <Ionicons name={status.playing ? 'pause' : 'play'} size={20} color="#fff" />
        )}
      </Pressable>
      <View style={{ flex: 1, gap: 4 }}>
        <Text style={styles.name} numberOfLines={1}>
          {voice ? t('panel.att.voiceTitle') : attachment.filename}
        </Text>
        <View
          style={styles.trackHit}
          onLayout={(e) => setWidth(Math.max(1, e.nativeEvent.layout.width))}
          accessibilityRole="adjustable"
          accessibilityLabel={t('panel.att.position')}
          accessibilityValue={{ min: 0, max: Math.round(status.duration), now: Math.round(status.currentTime) }}
          {...pan.panHandlers}
        >
          <View style={styles.track}>
            <View style={[styles.fill, { width: `${progress * 100}%` }]} />
          </View>
          <View style={[styles.thumb, { left: `${progress * 100}%` }]} />
        </View>
        <Text style={styles.time}>
          {formatDuration(scrub !== null ? scrub * status.duration : status.currentTime)} / {formatDuration(status.duration)}
        </Text>
      </View>
      <Pressable
        onPress={() => void player.seekTo(Math.max(0, status.currentTime - 5))}
        disabled={!status.isLoaded}
        style={styles.speed}
        accessibilityRole="button"
        accessibilityLabel={t('panel.att.back5')}
        hitSlop={8}
      >
        <Text style={styles.speedText}>−5 s</Text>
      </Pressable>
      <Pressable
        onPress={() => setSpeed((speed + 1) % SPEEDS.length)}
        style={styles.speed}
        accessibilityRole="button"
        accessibilityLabel={t('panel.att.speed', { rate: String(rate) })}
        hitSlop={8}
      >
        <Text style={styles.speedText}>{String(rate).replace('.', ',')}×</Text>
      </Pressable>
    </View>
  )
}

const SPEEDS = [1, 1.25, 1.5, 2, 3] as const

const styles = StyleSheet.create({
  video: { width: 260, height: 180, borderRadius: radius.md, overflow: 'hidden', backgroundColor: '#000' },
  audio: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.md,
    backgroundColor: colors.bgAlt,
    borderColor: colors.border,
    borderWidth: 1,
    borderRadius: radius.md,
    padding: spacing.md,
    maxWidth: 320,
  },
  playButton: { width: 40, height: 40, borderRadius: 20, backgroundColor: colors.primary, alignItems: 'center', justifyContent: 'center' },
  name: { color: colors.text, fontSize: font.sm, fontWeight: '600' },
  trackHit: { height: 20, justifyContent: 'center' },
  track: { height: 4, borderRadius: 2, backgroundColor: colors.bgHover, overflow: 'hidden' },
  thumb: { position: 'absolute', width: 12, height: 12, marginLeft: -6, borderRadius: 6, backgroundColor: colors.primary },
  fill: { height: 4, backgroundColor: colors.primary },
  time: { color: colors.textMuted, fontSize: font.xs },
  speed: { minWidth: 44, paddingHorizontal: spacing.sm, paddingVertical: 4, borderRadius: radius.md, backgroundColor: colors.bgHover, alignItems: 'center' },
  speedText: { color: colors.text, fontSize: font.xs, fontWeight: '700' },
})
