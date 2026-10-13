import { useState, type ReactNode } from 'react'
import { StyleSheet, View, type LayoutChangeEvent, type StyleProp, type ViewStyle } from 'react-native'
import { Image } from 'expo-image'
import { useT } from '@/i18n'
import { resolveMediaUrl } from '@/lib/links'
import { useAnimateAvatars } from '@/stores/settings'
import { colors, radius } from '@/theme'

/** Version fixe d'une image animée (`a_<id>.gif` → `a_<id>_s.gif`), comme le web. */
function stillUri(uri: string): string {
  const m = uri.match(/^(.*\/a_[0-9a-f-]+)\.(gif|png|webp)$/i)
  return m ? `${m[1]}_s.${m[2]}` : uri
}

/**
 * Bannière affichée EN ENTIER (profil, profil de serveur, liste des salons, réglages) :
 * hauteur = largeur ÷ proportions de l'image (lues au chargement), seulement bornée par
 * `minHeight` / `maxHeight` ; image en `contain`, jamais rognée. Les bandes éventuelles sont
 * remplies par la même image floutée (version fixe si animée). Animation selon le réglage
 * « animer les avatars et bannières ».
 */
export function FullBanner({
  uri, minHeight = 64, maxHeight = 220, focus, label, style, children,
}: {
  uri: string | null | undefined
  minHeight?: number
  maxHeight?: number
  /** Ancrage de l'image entière (0-100 %), apparence du serveur. */
  focus?: { x: number; y: number }
  label?: string
  style?: StyleProp<ViewStyle>
  children?: ReactNode
}) {
  const src = resolveMediaUrl(uri)
  const animate = useAnimateAvatars()
  const [ratio, setRatio] = useState<{ src: string; r: number } | null>(null)
  const [width, setWidth] = useState(0)
  if (!src) return null
  const r = ratio?.src === src ? ratio.r : 3
  const height = width ? Math.min(maxHeight, Math.max(minHeight, width / r)) : undefined
  return (
    <View
      style={[{ width: '100%', height, aspectRatio: height ? undefined : r, minHeight, maxHeight, overflow: 'hidden', backgroundColor: colors.bgElevated }, style]}
      onLayout={(e: LayoutChangeEvent) => setWidth(e.nativeEvent.layout.width)}
    >
      <Image source={{ uri: stillUri(src) }} style={[StyleSheet.absoluteFill, { transform: [{ scale: 1.1 }], opacity: 0.75 }]} contentFit="cover" blurRadius={18} accessible={false} />
      <Image
        source={{ uri: src }}
        style={StyleSheet.absoluteFill}
        contentFit="contain"
        contentPosition={focus ? { left: `${focus.x}%`, top: `${focus.y}%` } : 'center'}
        cachePolicy="memory-disk"
        autoplay={animate}
        accessible={!!label}
        accessibilityLabel={label}
        onLoad={(e) => {
          const { width: w, height: h } = e.source
          if (w && h) setRatio({ src, r: w / h })
        }}
      />
      {children}
    </View>
  )
}

/** Bannière de profil entière ; rien si l'utilisateur n'en a pas. */
export function ProfileBanner({ uri, name }: { uri: string | null | undefined; name: string }) {
  const t = useT()
  return <FullBanner uri={uri} minHeight={80} maxHeight={260} style={{ borderRadius: radius.lg }} label={t('settings.profile.bannerA11y', { name })} />
}
