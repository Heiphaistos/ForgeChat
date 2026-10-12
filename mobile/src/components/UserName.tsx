import { useEffect } from 'react'
import { Text, type StyleProp, type TextStyle } from 'react-native'
import { useServerDetail } from '@/features/servers/menus'
import { DEFAULT_BG, cleanNameStyle, displayNameOf, gradientChars, parseHex, resolveNameStyle, type MemberClanTag, type NameStyle, type ResolvedName, type TagStyle } from '@/lib/nameStyle'
import { requestNameStyle, useNameStyles } from '@/stores/nameStyles'
import { colors } from '@/theme'
import { ClanTag } from './ClanTag'
import { nameFontStyle } from './nameFonts'

/** Fond du thème courant, pour l'éclaircissement des couleurs trop sombres. */
const BG = parseHex(colors.bg) ?? DEFAULT_BG

const shadow = (color: string, r: number, x = 0, y = 0): TextStyle => ({ textShadowColor: color, textShadowRadius: r, textShadowOffset: { width: x, height: y } })

/**
 * Effets du web en version statique (React Native n'a ni animation CSS ni texte découpé dans
 * un dégradé) : une ombre de texte proche du rendu web, les palettes (arc-en-ciel, feu, givre,
 * holo, chrome) en une couleur par caractère. Couleurs : constantes ou « #rrggbb » résolus.
 */
function effectStyle(effect: string, color: string | undefined): TextStyle | null {
  const c = color ?? colors.text
  switch (effect) {
    case 'glow':
    case 'pulse':
      return shadow(c, 8)
    case 'outline':
      return shadow('rgba(0,0,0,0.9)', 2, 1, 1)
    case 'shimmer':
    case 'chrome':
      return shadow('rgba(255,255,255,0.45)', 4)
    case 'neon':
      return shadow(c, 12)
    case 'shadow3d':
      return shadow('rgba(0,0,0,0.55)', 0.5, 2, 2)
    case 'retro':
      return shadow('#ff2bd6', 0.5, 2, 2)
    case 'fire':
      return shadow('rgba(255,109,0,0.8)', 5)
    case 'frost':
      return shadow('rgba(127,211,255,0.9)', 5)
    case 'holo':
      return shadow('rgba(208,168,255,0.7)', 4)
    case 'glitch':
      return shadow('rgba(0,229,255,0.7)', 0.5, -1.5, 0)
    default:
      return null
  }
}

/** Contour choisi : React Native n'a pas de trait de texte, une ombre serrée l'approche. */
function outlineStyle(o: ResolvedName['outline']): TextStyle | null {
  return o ? shadow(o.color, Math.max(1, o.width), 0, 0) : null
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
  tagStyle,
  clanTags,
  numberOfLines = 1,
  onPress,
  onLongPress,
}: {
  text: string
  resolved: ResolvedName | null
  style?: StyleProp<TextStyle>
  tag?: string | null
  /** Style de l'étiquette perso (name_style.tag). */
  tagStyle?: TagStyle | null
  /** Marques de clan du serveur. */
  clanTags?: MemberClanTag[]
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
        style={[
          style,
          cs.length === 1 && { color: cs[0] },
          nameFontStyle(resolved?.font),
          resolved ? effectStyle(resolved.effect, cs[0]) : null,
          // Le contour passe devant l'ombre de l'effet (une seule ombre de texte en natif).
          outlineStyle(resolved?.outline),
        ]}
        numberOfLines={numberOfLines}
        onPress={onPress}
        onLongPress={onLongPress}
        accessibilityLabel={text}
      >
        {body}
      </Text>
      {tag ? <ClanTag name={tag} style={tagStyle} fallback="soft" /> : null}
      {clanTags?.map((tg) => <ClanTag key={tg.id} name={tg.name} color={tg.color} style={tg.style} />)}
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
  serverStyle,
  clanTags,
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
  /** Style du pseudo propre au serveur (profil de serveur), prioritaire sur celui du compte. */
  serverStyle?: unknown
  /** Marques de clan du serveur, affichées après le pseudo. */
  clanTags?: MemberClanTag[]
  numberOfLines?: number
  onPress?: () => void
  onLongPress?: () => void
}) {
  const info = useNameStyles((s) => (userId ? s.byId[userId] : undefined))
  useEffect(() => requestNameStyle(userId), [userId])
  const detail = useServerDetail(serverId ?? '', !!serverId)
  const own = cleanNameStyle(serverStyle) ?? cleanNameStyle(info?.name_style)
  const resolved = resolveNameStyle({
    style: own,
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
      tagStyle={cleanNameStyle(info?.name_style)?.tag}
      clanTags={clanTags}
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
