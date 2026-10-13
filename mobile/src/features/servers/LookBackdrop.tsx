import { StyleSheet, View } from 'react-native'
import { Image } from 'expo-image'
import { resolveMediaUrl } from '@/lib/links'
import { hex, type LookBackground } from './serverLook'

/**
 * Fond de l'apparence d'un serveur (liste des salons, zone des messages), posé sous le contenu.
 * Couleur ; dégradé et motif approchés (pas de module de dégradé natif) par la couleur et un
 * voile de la seconde couleur ; image envoyée au serveur, figée (version fixe), floutée et
 * atténuée selon les réglages.
 */
export function LookBackdrop({ bg }: { bg: LookBackground | undefined }) {
  if (!bg) return null
  const opacity = bg.opacity / 100
  if (bg.kind === 'image') {
    const src = resolveMediaUrl(bg.image?.replace(/^(.*\/a_[0-9a-f-]+)\.(gif|png|webp)$/i, '$1_s.$2'))
    if (!src) return null
    return <Image source={{ uri: src }} style={[StyleSheet.absoluteFill, { opacity }]} contentFit="cover" blurRadius={bg.blur} accessible={false} pointerEvents="none" />
  }
  if (bg.color == null) return null
  const pattern = bg.kind === 'pattern'
  return (
    <View pointerEvents="none" style={[StyleSheet.absoluteFill, { opacity }]}>
      <View style={[StyleSheet.absoluteFill, { backgroundColor: pattern ? (bg.color2 != null ? hex(bg.color2) : 'transparent') : hex(bg.color) }]} />
      {bg.kind === 'gradient' && bg.color2 != null ? (
        <View style={{ position: 'absolute', left: 0, right: 0, bottom: 0, height: '60%', backgroundColor: hex(bg.color2), opacity: 0.6 }} />
      ) : null}
      {pattern ? <View style={[StyleSheet.absoluteFill, { backgroundColor: hex(bg.color), opacity: 0.25 }]} /> : null}
    </View>
  )
}
