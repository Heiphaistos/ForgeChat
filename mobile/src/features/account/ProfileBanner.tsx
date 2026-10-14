import { useState, type ReactNode } from 'react'
import { StyleSheet, View, type LayoutChangeEvent, type StyleProp, type ViewStyle } from 'react-native'
import { Image } from 'expo-image'
import { useT } from '@/i18n'
import type { ProfileCard } from '@/features/account/profileCard'
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
  uri, minHeight = 64, maxHeight = 220, focus, label, style, blur, children,
}: {
  uri: string | null | undefined
  minHeight?: number
  maxHeight?: number
  /** Ancrage de l'image entière (0-100 %), apparence du serveur. */
  focus?: { x: number; y: number }
  label?: string
  style?: StyleProp<ViewStyle>
  /** Flou de l'image (carte de profil, effet « blur »). */
  blur?: number
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
        blurRadius={blur}
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

/** Bannière de profil entière ; rien si l'utilisateur n'en a pas. `card` : carte de profil
 *  (point focal vertical, hauteur selon la mise en page, effet) ; effets approchés par calques :
 *  flou natif, voile sombre, fondu par bandes vers `fadeTo`, bichromie = voile de `tint`. */
export function ProfileBanner({
  uri, name, card, tint, fadeTo,
}: {
  uri: string | null | undefined
  name: string
  card?: Pick<ProfileCard, 'banner_y' | 'banner_fx' | 'layout'>
  tint?: string
  fadeTo?: string
}) {
  const t = useT()
  const fx = card?.banner_fx ?? 'none'
  const maxHeight = card?.layout === 'compact' ? 140 : card?.layout === 'wide' ? 320 : 260
  return (
    <FullBanner
      uri={uri}
      minHeight={80}
      maxHeight={maxHeight}
      focus={card ? { x: 50, y: card.banner_y } : undefined}
      blur={fx === 'blur' ? 12 : undefined}
      style={{ borderRadius: radius.lg }}
      label={t('settings.profile.bannerA11y', { name })}
    >
      {fx === 'dim' ? <View pointerEvents="none" style={[StyleSheet.absoluteFill, { backgroundColor: 'rgba(0,0,0,0.45)' }]} /> : null}
      {fx === 'duotone' ? <View pointerEvents="none" style={[StyleSheet.absoluteFill, { backgroundColor: tint ?? colors.primary, opacity: 0.45 }]} /> : null}
      {fx === 'fade' ? (
        <View pointerEvents="none" style={styles.fade}>
          {[0.15, 0.3, 0.45, 0.6, 0.75, 0.9].map((o) => (
            <View key={o} style={{ flex: 1, backgroundColor: fadeTo ?? colors.bg, opacity: o }} />
          ))}
        </View>
      ) : null}
    </FullBanner>
  )
}

const styles = StyleSheet.create({
  fade: { position: 'absolute', left: 0, right: 0, bottom: 0, height: '55%' },
})
