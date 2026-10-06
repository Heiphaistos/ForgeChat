import { Image } from 'expo-image'
import { resolveMediaUrl } from '@/lib/links'
import { colors, radius } from '@/theme'

/** Bannière de profil (16:5, comme le web) ; rien si l'utilisateur n'en a pas. */
export function ProfileBanner({ uri, name }: { uri: string | null | undefined; name: string }) {
  const src = resolveMediaUrl(uri)
  if (!src) return null
  return (
    <Image
      source={{ uri: src }}
      style={{ width: '100%', aspectRatio: 16 / 5, borderRadius: radius.lg, backgroundColor: colors.bgElevated }}
      contentFit="cover"
      cachePolicy="memory-disk"
      accessibilityLabel={`Bannière de ${name}`}
    />
  )
}
