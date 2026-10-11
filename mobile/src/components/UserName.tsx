import { useEffect } from 'react'
import { Platform, StyleSheet, Text, type StyleProp, type TextStyle } from 'react-native'
import { useServerDetail } from '@/features/servers/menus'
import { DEFAULT_BG, displayNameOf, gradientChars, parseHex, resolveNameStyle, type NameStyle, type ResolvedName } from '@/lib/nameStyle'
import { requestNameStyle, useNameStyles } from '@/stores/nameStyles'
import { colors, font, radius } from '@/theme'

/** Polices système, sans police embarquée (Android : familles génériques ; iOS : polices livrées). */
const FONTS: Record<string, TextStyle> = {
  serif: { fontFamily: Platform.select({ ios: 'Georgia', default: 'serif' }) },
  mono: { fontFamily: Platform.select({ ios: 'Courier', default: 'monospace' }) },
  cursive: { fontFamily: Platform.select({ ios: 'Snell Roundhand', default: 'cursive' }) },
  rounded: { fontFamily: Platform.select({ ios: 'Chalkboard SE', default: 'casual' }) },
  heavy: { fontWeight: '900' },
}

/** Fond du thème courant, pour l'éclaircissement des couleurs trop sombres. */
const BG = parseHex(colors.bg) ?? DEFAULT_BG

function effectStyle(effect: string, color: string | undefined): TextStyle | null {
  if (effect === 'glow') return { textShadowColor: color ?? colors.text, textShadowRadius: 8, textShadowOffset: { width: 0, height: 0 } }
  if (effect === 'outline') return { textShadowColor: 'rgba(0,0,0,0.9)', textShadowRadius: 2, textShadowOffset: { width: 1, height: 1 } }
  // ponytail: « shimmer » est statique sur mobile (léger reflet clair), pas d'animation par caractère.
  if (effect === 'shimmer') return { textShadowColor: 'rgba(255,255,255,0.45)', textShadowRadius: 4, textShadowOffset: { width: 0, height: 0 } }
  return null
}

/**
 * Pseudo rendu selon un style déjà résolu. Dégradé : une couleur par caractère (Text imbriqués),
 * l'angle du web est ignoré (pas de dégradé de texte natif sans dépendance).
 */
export function StyledName({
  text,
  resolved,
  style,
  tag,
  numberOfLines = 1,
  onPress,
  onLongPress,
}: {
  text: string
  resolved: ResolvedName | null
  style?: StyleProp<TextStyle>
  tag?: string | null
  numberOfLines?: number
  onPress?: () => void
  /** Menu de la personne (features/userMenu). */
  onLongPress?: () => void
}) {
  const cs = resolved?.colors ?? []
  const body = cs.length > 1 ? gradientChars(text, cs).map((c, i) => (
    <Text key={i} style={{ color: c.color }}>
      {c.ch}
    </Text>
  )) : text
  return (
    <>
      <Text
        style={[style, cs.length === 1 && { color: cs[0] }, resolved?.font ? FONTS[resolved.font] : null, resolved ? effectStyle(resolved.effect, cs[0]) : null]}
        numberOfLines={numberOfLines}
        onPress={onPress}
        onLongPress={onLongPress}
        accessibilityLabel={text}
      >
        {body}
      </Text>
      {tag ? (
        <Text style={styles.tag} numberOfLines={1}>
          {tag}
        </Text>
      ) : null}
    </>
  )
}

/** Style choisi dans l'éditeur, rendu sans contexte serveur (aperçu). */
export function previewName(style: NameStyle | null) {
  return resolveNameStyle({ style, bg: BG })
}

/**
 * Pseudo d'un utilisateur, partout où il apparaît : nom d'affichage, style perso (cache
 * stores/nameStyles) et couleur de rôle selon la priorité du serveur (lib/nameStyle).
 */
export function UserName({
  userId,
  name,
  nickname,
  roleColor,
  serverId,
  style,
  showTag,
  numberOfLines,
  onPress,
  onLongPress,
}: {
  userId?: string
  /** Nom connu du contexte (pseudo), affiché tant que le cache n'a rien. */
  name: string
  /** Surnom de serveur, s'il est déjà connu. */
  nickname?: string | null
  roleColor?: string | null
  /** Contexte serveur : la priorité rôle / perso dépend de son réglage. */
  serverId?: string
  style?: StyleProp<TextStyle>
  showTag?: boolean
  numberOfLines?: number
  onPress?: () => void
  onLongPress?: () => void
}) {
  const info = useNameStyles((s) => (userId ? s.byId[userId] : undefined))
  useEffect(() => requestNameStyle(userId), [userId])
  const detail = useServerDetail(serverId ?? '', !!serverId)
  const resolved = resolveNameStyle({
    style: info?.name_style,
    roleColor: serverId ? roleColor : null,
    roleOverrides: detail.data?.server.role_color_overrides_name,
    bg: BG,
  })
  return (
    <StyledName
      text={displayNameOf({ username: name, display_name: info?.display_name }, nickname)}
      resolved={resolved}
      style={style}
      tag={showTag ? info?.profile_tag : null}
      numberOfLines={numberOfLines}
      onPress={onPress}
      onLongPress={onLongPress}
    />
  )
}

/** Nom affiché d'un utilisateur déjà en cache (texte brut : mentions, libellés). */
export function cachedDisplayName(userId: string): string | null {
  return useNameStyles.getState().byId[userId]?.display_name?.trim() || null
}

const styles = StyleSheet.create({
  tag: {
    color: colors.textSecondary,
    backgroundColor: colors.bgElevated,
    fontSize: font.xs,
    fontWeight: '700',
    paddingHorizontal: 5,
    borderRadius: radius.sm,
    overflow: 'hidden',
  },
})
