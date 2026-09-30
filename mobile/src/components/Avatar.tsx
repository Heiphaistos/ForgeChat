import { Image } from 'expo-image'
import { StyleSheet, Text, View } from 'react-native'
import { resolveMediaUrl } from '@/lib/links'
import { usePresenceOf } from '@/stores/presence'
import { colors, statusColors } from '@/theme'

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
}: {
  uri: string | null | undefined
  name: string
  size?: number
  userId?: string
  status?: string
  showStatus?: boolean
  rounded?: boolean
}) {
  const live = usePresenceOf(showStatus ? userId : undefined, status)
  const src = resolveMediaUrl(uri)
  const r = rounded ? size / 2 : size * 0.3
  const dot = Math.max(10, size * 0.3)
  return (
    <View style={{ width: size, height: size }} accessible accessibilityLabel={`Avatar de ${name}`}>
      {src ? (
        <Image
          source={{ uri: src }}
          style={{ width: size, height: size, borderRadius: r, backgroundColor: colors.bgElevated }}
          contentFit="cover"
          cachePolicy="memory-disk"
          recyclingKey={src}
          transition={120}
        />
      ) : (
        <View style={[styles.fallback, { width: size, height: size, borderRadius: r, backgroundColor: colorFor(name) }]}>
          <Text style={{ color: '#fff', fontWeight: '700', fontSize: size * 0.4 }}>{(name[0] ?? '?').toUpperCase()}</Text>
        </View>
      )}
      {showStatus ? (
        <View
          style={[
            styles.dot,
            {
              width: dot,
              height: dot,
              borderRadius: dot / 2,
              backgroundColor: statusColors[live] ?? colors.textFaint,
            },
          ]}
        />
      ) : null}
    </View>
  )
}

const styles = StyleSheet.create({
  fallback: { alignItems: 'center', justifyContent: 'center' },
  dot: { position: 'absolute', right: -1, bottom: -1, borderWidth: 2.5, borderColor: colors.bgAlt },
})
