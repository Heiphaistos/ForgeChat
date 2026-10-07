import { Image } from 'expo-image'
import { StyleSheet, Text, View } from 'react-native'
import { useT } from '@/i18n'
import { resolveMediaUrl } from '@/lib/links'
import { usePresenceOf } from '@/stores/presence'
import { useAnimateAvatars } from '@/stores/settings'
import { statusColor, statusHollow, statusLabel } from '@/lib/status'
import { colors } from '@/theme'
import { AvatarDecoration } from './ProfileDecor'

const PALETTE = ['#5865f2', '#3ba55c', '#faa61a', '#ed4245', '#eb459e', '#9b59b6', '#1abc9c']

function colorFor(seed: string) {
  let h = 0
  for (let i = 0; i < seed.length; i++) h = (h * 31 + seed.charCodeAt(i)) | 0
  return PALETTE[Math.abs(h) % PALETTE.length]!
}

export function Avatar({
  uri,
  name,
  size = 40,
  userId,
  status,
  showStatus,
  rounded = true,
  decoration,
}: {
  uri: string | null | undefined
  name: string
  size?: number
  userId?: string
  status?: string
  showStatus?: boolean
  rounded?: boolean
  /** Décoration d'avatar (catalogue features/account/profileDecor). */
  decoration?: string | null
}) {
  const live = usePresenceOf(showStatus ? userId : undefined, status)
  const t = useT()
  const src = resolveMediaUrl(uri)
  const animate = useAnimateAvatars()
  const r = rounded ? size / 2 : size * 0.3
  const dot = Math.max(10, size * 0.3)
  const body = (
    <View
      style={{ width: size, height: size }}
      accessible
      accessibilityLabel={showStatus ? t('panel.avatarStatus', { name, status: statusLabel(live) }) : t('panel.avatar', { name })}
    >
      {src ? (
        <Image
          source={{ uri: src }}
          style={{ width: size, height: size, borderRadius: r, backgroundColor: colors.bgElevated }}
          contentFit="cover"
          cachePolicy="memory-disk"
          recyclingKey={src}
          transition={120}
          autoplay={animate}
        />
      ) : (
        <View style={[styles.fallback, { width: size, height: size, borderRadius: r, backgroundColor: colorFor(name) }]}>
          <Text style={{ color: '#fff', fontWeight: '700', fontSize: size * 0.4 }}>{(name[0] ?? '?').toUpperCase()}</Text>
        </View>
      )}
      {showStatus ? <StatusDot status={live} size={dot} /> : null}
    </View>
  )
  return decoration ? (
    <AvatarDecoration id={decoration} size={size}>
      {body}
    </AvatarDecoration>
  ) : (
    body
  )
}

/** Pastille de présence : couleur du web ; hors ligne / invisible en anneau creux. */
export function StatusDot({ status, size = 12, ringColor = colors.bgAlt, inline }: { status: string | null | undefined; size?: number; ringColor?: string; inline?: boolean }) {
  const c = statusColor(status)
  const hollow = statusHollow(status)
  return (
    <View
      style={[
        inline ? null : styles.dot,
        {
          width: size,
          height: size,
          borderRadius: size / 2,
          borderColor: inline ? c : ringColor,
          backgroundColor: c,
          borderWidth: inline ? 0 : 2.5,
        },
      ]}
    >
      {hollow ? <View style={{ flex: 1, margin: inline ? size * 0.22 : size * 0.12, borderRadius: size, backgroundColor: inline ? colors.bgAlt : ringColor }} /> : null}
    </View>
  )
}

const styles = StyleSheet.create({
  fallback: { alignItems: 'center', justifyContent: 'center' },
  dot: { position: 'absolute', right: -1, bottom: -1 },
})
