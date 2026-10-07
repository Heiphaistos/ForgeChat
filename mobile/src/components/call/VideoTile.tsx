import { Ionicons } from '@expo/vector-icons'
import type { ReactNode } from 'react'
import { Pressable, StyleSheet, Text, View, type StyleProp, type ViewStyle } from 'react-native'
import { RTCView, type MediaStream } from '@livekit/react-native-webrtc'
import { Avatar } from '@/components/Avatar'
import { UserName } from '@/components/UserName'
import type { TileInfo } from '@/features/calls/videoLayout'
import { useT } from '@/i18n'
import { callColors, colors, font, radius } from '@/theme'

/** Tuile d'appel affichable : caméra (ou avatar) d'un participant, ou écran partagé. */
export interface CallTile extends TileInfo {
  /** Nom affiché (déjà « Écran de … » pour un partage). */
  name: string
  avatar: string | null
  stream: MediaStream | null
  mirror?: boolean
  muted?: boolean
  speaking?: boolean
  /** Qualité de connexion du participant (excellent, good, poor, lost). */
  quality?: string | null
  /** Indicateurs propres à l'écran (main levée, enregistrement, réaction, volume…). */
  badges?: ReactNode
}

/** Icône de qualité : seulement quand elle se dégrade (rien à signaler sinon). */
export function QualityIcon({ quality, size = 12 }: { quality?: string | null; size?: number }) {
  const t = useT()
  if (quality !== 'poor' && quality !== 'lost') return null
  return (
    <Ionicons
      name={quality === 'lost' ? 'cloud-offline-outline' : 'cellular-outline'}
      size={size}
      color={quality === 'lost' ? colors.danger : colors.warning}
      accessibilityLabel={t(quality === 'lost' ? 'call.quality.lost' : 'call.quality.poor')}
    />
  )
}

export function VideoTile({
  tile,
  style,
  fit,
  compact,
  pinned,
  onPress,
  onLongPress,
  onPin,
  zOrder,
}: {
  tile: CallTile
  style?: StyleProp<ViewStyle>
  /** cover : remplit (caméras) ; contain : image entière (écrans partagés). */
  fit?: 'cover' | 'contain'
  /** Miniature du bandeau : avatar et textes réduits, pas de bouton d'épingle. */
  compact?: boolean
  pinned?: boolean
  onPress?: () => void
  onLongPress?: () => void
  onPin?: () => void
  zOrder?: number
}) {
  const t = useT()
  const video = tile.hasVideo && tile.stream
  const label = [
    tile.self ? t('voice.you', { name: tile.name }) : tile.name,
    tile.speaking ? t('call.speaking') : null,
    tile.muted ? t('call.micOff') : null,
  ]
    .filter(Boolean)
    .join(', ')
  return (
    <Pressable
      style={[styles.tile, compact && styles.compact, tile.speaking && styles.speaking, style]}
      onPress={onPress}
      onLongPress={onLongPress}
      disabled={!onPress && !onLongPress}
      accessibilityRole={onPress ? 'button' : undefined}
      accessibilityLabel={label}
      accessibilityHint={video && onPress ? t('call.fullscreen') : undefined}
    >
      {video ? (
        <RTCView
          streamURL={tile.stream!.toURL()}
          style={StyleSheet.absoluteFill}
          objectFit={fit ?? (tile.screen ? 'contain' : 'cover')}
          mirror={!!tile.mirror}
          zOrder={zOrder}
        />
      ) : (
        <Avatar uri={tile.avatar} name={tile.name} size={compact ? 40 : 72} />
      )}
      {tile.badges}
      <View style={[styles.label, compact && styles.labelCompact]} pointerEvents="none">
        {tile.screen ? <Ionicons name="tv-outline" size={12} color="#fff" /> : null}
        {!tile.screen && tile.muted ? <Ionicons name="mic-off" size={12} color={colors.danger} /> : null}
        <QualityIcon quality={tile.quality} />
        {tile.self || tile.screen ? (
          <Text style={[styles.name, compact && { fontSize: 10 }]} numberOfLines={1}>
            {tile.self ? t('voice.you', { name: tile.name }) : tile.name}
          </Text>
        ) : (
          <UserName userId={tile.userId} name={tile.name} style={[styles.name, compact && { fontSize: 10 }]} />
        )}
      </View>
      {onPin && !compact ? (
        <Pressable
          onPress={onPin}
          hitSlop={8}
          style={[styles.pin, pinned && { backgroundColor: '#f2f3f5' }]}
          accessibilityRole="button"
          accessibilityState={{ selected: !!pinned }}
          accessibilityLabel={t(pinned ? 'call.unpin' : 'call.pin', { name: tile.name })}
        >
          <Ionicons name={pinned ? 'pin' : 'pin-outline'} size={16} color={pinned ? '#111214' : '#fff'} />
        </Pressable>
      ) : null}
    </Pressable>
  )
}

const styles = StyleSheet.create({
  tile: {
    backgroundColor: callColors.tile,
    borderRadius: radius.lg,
    alignItems: 'center',
    justifyContent: 'center',
    overflow: 'hidden',
    borderWidth: 2,
    borderColor: 'transparent',
  },
  compact: { borderRadius: radius.md },
  speaking: { borderColor: colors.success },
  label: {
    position: 'absolute',
    left: 8,
    bottom: 8,
    maxWidth: '85%',
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    backgroundColor: 'rgba(0,0,0,0.55)',
    borderRadius: 6,
    paddingHorizontal: 6,
    paddingVertical: 2,
  },
  labelCompact: { left: 4, bottom: 4, paddingHorizontal: 4 },
  name: { color: '#fff', fontSize: font.xs, fontWeight: '700', flexShrink: 1 },
  pin: { position: 'absolute', top: 6, left: 6, width: 32, height: 32, borderRadius: 16, backgroundColor: 'rgba(0,0,0,0.5)', alignItems: 'center', justifyContent: 'center' },
})
