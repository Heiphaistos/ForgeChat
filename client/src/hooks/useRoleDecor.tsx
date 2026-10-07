import { useCallback, useMemo, type CSSProperties } from 'react'
import { useQuery } from '@tanstack/react-query'
import api, { mediaUrl } from '../api/client'

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
  const { data: members = [] } = useQuery<{ user_id: string; role_ids?: string[] }[]>({
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
      if (!colored && !withIcon) continue
      out.set(m.user_id, {
        style: showColors && colored ? roleNameStyle(colored.color, colored.secondary_color) : undefined,
        icon: withIcon?.icon ?? undefined,
        iconTitle: withIcon?.name,
      })
    }
    return out
  }, [roles, members, showColors])

  return useCallback((userId: string): RoleDecor | undefined => map.get(userId), [map])
}

/** Icône de rôle : image téléversée ou emoji. */
export function RoleIcon({ icon, title }: { icon?: string | null; title?: string }) {
  if (!icon) return null
  return icon.startsWith('/uploads/')
    ? <img src={mediaUrl(icon)} alt={title ?? ''} title={title} className="w-4 h-4 inline-block object-contain flex-shrink-0 align-text-bottom" />
    : <span title={title} role="img" aria-label={title} className="text-sm leading-none flex-shrink-0">{icon}</span>
}
