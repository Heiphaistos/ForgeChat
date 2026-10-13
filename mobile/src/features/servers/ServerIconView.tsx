import { Text, View } from 'react-native'
import { Image } from 'expo-image'
import { useT } from '@/i18n'
import { resolveMediaUrl } from '@/lib/links'
import { useAnimateAvatars } from '@/stores/settings'
import { colors } from '@/theme'

/** Icône d'un serveur avec la forme de son apparence (rayon calculé par serverLook.iconRadius). */
export function ServerIconView({ uri, name, size, radius, accent }: { uri: string | null | undefined; name: string; size: number; radius: number; accent?: string }) {
  const t = useT()
  const src = resolveMediaUrl(uri)
  const animate = useAnimateAvatars()
  return (
    <View style={{ width: size, height: size, borderRadius: radius, overflow: 'hidden' }} accessible accessibilityLabel={t('panel.avatar', { name })}>
      {src ? (
        <Image source={{ uri: src }} style={{ width: size, height: size, backgroundColor: colors.bgElevated }} contentFit="cover" cachePolicy="memory-disk" autoplay={animate} />
      ) : (
        <View style={{ flex: 1, alignItems: 'center', justifyContent: 'center', backgroundColor: accent ?? colors.primary }}>
          <Text style={{ color: '#fff', fontWeight: '700', fontSize: size * 0.4 }}>{(name[0] ?? '?').toUpperCase()}</Text>
        </View>
      )}
    </View>
  )
}
