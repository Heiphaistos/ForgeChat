import { useCallback, useMemo, type CSSProperties } from 'react'
import { useQuery } from '@tanstack/react-query'
import api, { mediaUrl } from '../api/client'
import { useUxPrefs } from '../lib/uxPrefs'
import type { MemberClanTag } from '../components/ui/UserName'
import { useServerAppearance } from './useServerAppearance'

interface DecorRole {
  id: string
  name: string
  color: number
  secondary_color?: number | null
  icon?: string | null
  position: number
  is_everyone: boolean
}

/** Habillage du pseudo d'un membre : couleur/dégradé du rôle et icône du rôle. */
export interface RoleDecor {
  style?: CSSProperties
  icon?: string
  iconTitle?: string
  /** Réglage du serveur : la couleur du rôle remplace la couleur perso du pseudo. */
  overridesName?: boolean
  /** Profil de serveur : anneau d'avatar (components/ui/AvatarRing.tsx). */
  ring?: unknown
  /** Profil de serveur : style du pseudo propre au serveur. */
  nameStyle?: unknown
  /** Marques de clan du membre. */
  tags?: MemberClanTag[]
  /** Apparence du serveur : couleur du rôle montrée en pastille ou en badge (au lieu du pseudo). */
  mark?: { kind: 'dot' | 'badge'; color: number; name: string }
}

const hex = (c: number) => '#' + (c >>> 0).toString(16).padStart(6, '0')

/** Couleur du rôle, ou dégradé (fond découpé à la forme du texte) si une seconde couleur existe. */
export function roleNameStyle(color?: number | null, secondary?: number | null): CSSProperties | undefined {
  if (!color) return undefined
  if (secondary == null) return { color: hex(color) }
  return {
    backgroundImage: `linear-gradient(90deg, ${hex(color)}, ${hex(secondary)})`,
    WebkitBackgroundClip: 'text',
    backgroundClip: 'text',
    color: 'transparent',
  }
}

/**
 * Habillage par membre d'un serveur, depuis les caches ['roles'] et ['members'] :
 * couleur du rôle coloré le plus haut, icône du rôle à icône le plus haut (comme
 * Discord). Respecte le réglage « Afficher la couleur des rôles ».
 */
export function useRoleDecor(serverId?: string) {
  const enabled = !!serverId
  const { data: roles = [] } = useQuery<DecorRole[]>({
    queryKey: ['roles', serverId],
    queryFn: () => api.get(`/servers/${serverId}/roles`).then(r => r.data),
    enabled,
    staleTime: 60_000,
  })
  const { data: members = [] } = useQuery<{ user_id: string; role_ids?: string[]; server_avatar_ring?: unknown; server_name_style?: unknown; tags?: MemberClanTag[] }[]>({
    queryKey: ['members', serverId],
    queryFn: () => api.get(`/servers/${serverId}/members`).then(r => r.data),
    enabled,
    staleTime: 5 * 60_000,
  })
  const { data: settings } = useQuery<Record<string, unknown>>({
    queryKey: ['user-settings'],
    queryFn: () => api.get('/user/settings').then(r => r.data),
    staleTime: 300_000,
  })
  const showColors = settings?.show_role_colors !== false
  // Même clé et même requête que ChannelSidebar : servi depuis le cache.
  const { data: server } = useQuery<{ server?: { role_color_overrides_name?: boolean } }>({
    queryKey: ['server', serverId],
    queryFn: () => api.get(`/servers/${serverId}`).then(r => r.data),
    enabled,
    staleTime: 60_000,
  })
  const overridesName = server?.server?.role_color_overrides_name !== false
  // Affichage des couleurs de rôle choisi dans l'apparence du serveur (pseudo, pastille, badge).
  const roleDisplay = useServerAppearance(serverId)?.role_display ?? 'name'

  const map = useMemo(() => {
    const byId = new Map(roles.map(r => [r.id, r]))
    const out = new Map<string, RoleDecor>()
    for (const m of members) {
      const mine = (m.role_ids ?? [])
        .map(id => byId.get(id))
        .filter((r): r is DecorRole => !!r && !r.is_everyone)
        .sort((a, b) => b.position - a.position)
      const colored = mine.find(r => r.color)
      const withIcon = mine.find(r => r.icon)
      const tags = Array.isArray(m.tags) && m.tags.length ? m.tags : undefined
      if (!colored && !withIcon && !m.server_avatar_ring && !m.server_name_style && !tags) continue
      const asMark = roleDisplay !== 'name' && showColors && !!colored
      out.set(m.user_id, {
        style: showColors && colored && !asMark ? roleNameStyle(colored.color, colored.secondary_color) : undefined,
        mark: asMark ? { kind: roleDisplay, color: colored.color, name: colored.name } : undefined,
        icon: withIcon?.icon ?? undefined,
        iconTitle: withIcon?.name,
        overridesName,
        ring: m.server_avatar_ring ?? undefined,
        nameStyle: m.server_name_style ?? undefined,
        tags,
      })
    }
    return out
  }, [roles, members, showColors, overridesName, roleDisplay])

  return useCallback((userId: string): RoleDecor | undefined => map.get(userId), [map])
}

/** Couleur du rôle en pastille ou en badge (apparence du serveur), à côté du pseudo. */
export function RoleMark({ mark }: { mark?: RoleDecor['mark'] }) {
  if (!mark) return null
  const c = hex(mark.color)
  return mark.kind === 'dot'
    ? <span title={mark.name} role="img" aria-label={mark.name} className="inline-block w-2.5 h-2.5 rounded-full flex-shrink-0 align-middle" style={{ backgroundColor: c }} />
    : (
      <span
        title={mark.name}
        className="inline-flex items-center px-1.5 rounded text-[10px] font-semibold leading-4 flex-shrink-0 max-w-[8rem] truncate align-middle"
        style={{ backgroundColor: `${c}33`, color: c, border: `1px solid ${c}66` }}
      >
        {mark.name}
      </span>
    )
}

/** Icône de rôle : image téléversée ou emoji (masquable : Accessibilité > icônes des rôles). */
export function RoleIcon({ icon, title }: { icon?: string | null; title?: string }) {
  const show = useUxPrefs(s => s.roleIcons)
  if (!icon || !show) return null
  return icon.startsWith('/uploads/')
    ? <img src={mediaUrl(icon)} alt={title ?? ''} title={title} className="w-4 h-4 inline-block object-contain flex-shrink-0 align-text-bottom" />
    : <span title={title} role="img" aria-label={title} className="text-sm leading-none flex-shrink-0">{icon}</span>
}
