import { Ionicons } from '@expo/vector-icons'
import { useAudioPlayer, useAudioPlayerStatus } from 'expo-audio'
import { useVideoPlayer, VideoView } from 'expo-video'
import { ActivityIndicator, Pressable, StyleSheet, Text, View } from 'react-native'
import type { Attachment } from '@/types/models'
import { colors, font, radius, spacing } from '@/theme'
import { formatDuration } from './media'

/**
 * Lecteurs intégrés. `src` vient TOUJOURS de resolveMediaUrl (/uploads/ du serveur ou https) :
 * aucune autre source n'est passée aux lecteurs natifs.
 */

export function VideoAttachment({ src, attachment }: { src: string; attachment: Attachment }) {
  // Pas de lecture automatique : le lecteur ne charge la vidéo qu'à l'appui sur « lecture ».
  const player = useVideoPlayer(src)
  return (
    <View style={styles.video} accessibilityLabel={`Vidéo ${attachment.filename}`}>
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
  const label = voice ? 'Message vocal' : attachment.filename
  const player = useAudioPlayer(src)
  const status = useAudioPlayerStatus(player)
  const ended = !status.playing && status.duration > 0 && status.currentTime >= status.duration - 0.25
  const progress = status.duration > 0 ? Math.min(1, status.currentTime / status.duration) : 0

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
        accessibilityLabel={status.playing ? `Pause ${label}` : `Lire ${label}`}
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
          {voice ? '🎤 Message vocal' : attachment.filename}
        </Text>
        <View style={styles.track}>
          <View style={[styles.fill, { width: `${progress * 100}%` }]} />
        </View>
        <Text style={styles.time}>
          {formatDuration(status.currentTime)} / {formatDuration(status.duration)}
        </Text>
      </View>
    </View>
  )
}

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
  track: { height: 4, borderRadius: 2, backgroundColor: colors.bgHover, overflow: 'hidden' },
  fill: { height: 4, backgroundColor: colors.primary },
  time: { color: colors.textMuted, fontSize: font.xs },
})
