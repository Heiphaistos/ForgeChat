import { useMemo } from 'react'
import { useQuery } from '@tanstack/react-query'
import api from '../api/client'
import { useAuth } from '../store/auth'

/** Bits de permission (models/role.rs côté serveur). */
export const PERM = {
  SEND_MESSAGES: 1 << 1,
  MANAGE_MESSAGES: 1 << 3,
  MANAGE_CHANNELS: 1 << 4,
  KICK_MEMBERS: 1 << 6,
  BAN_MEMBERS: 1 << 7,
  MUTE_MEMBERS: 1 << 15,
  DEAFEN_MEMBERS: 1 << 16,
  MOVE_MEMBERS: 1 << 17,
  CREATE_CHANNELS: 1 << 19,
  EDIT_CHANNELS: 1 << 20,
  DELETE_CHANNELS: 1 << 21,
  DELETE_OWN_CHANNELS: 1 << 22,
  BAN_TEMP: 1 << 23,
  ADMINISTRATOR: 1 << 31,
} as const

export interface MemberRank {
  user_id: string
  is_owner?: boolean
  role_ids?: string[]
}

/**
 * Permissions de l'utilisateur sur un serveur, calculées depuis la réponse
 * `GET /servers/:id` déjà en cache (rôles + @everyone, propriétaire,
 * ADMINISTRATOR), et hiérarchie des rôles comme `require_outranks` côté
 * serveur. Sert à n'afficher que les actions réellement autorisées ; le
 * serveur reste seul juge.
 */
export function useServerPerms(serverId?: string) {
  const meId = useAuth(s => s.user?.id)
  const { data } = useQuery({
    queryKey: ['server', serverId],
    queryFn: () => api.get(`/servers/${serverId}`).then(r => r.data),
    enabled: !!serverId,
    staleTime: 60_000,
  })

  return useMemo(() => {
    const roles: any[] = data?.roles ?? []
    const mine = new Set<string>((data?.my_role_ids ?? []).map(String))
    const perms = roles
      .filter(r => r.is_everyone || mine.has(String(r.id)))
      .reduce((acc: number, r) => acc | Number(r.permissions), 0)
    const ownerId: string | undefined = data?.server?.owner_id
    const isOwner = !!meId && ownerId === meId
    const isAdmin = isOwner || (perms & PERM.ADMINISTRATOR) !== 0
    const has = (bit: number) => isAdmin || (perms & bit) !== 0
    const topPosition = (ids: Iterable<string>) => {
      const set = new Set([...ids].map(String))
      return roles.reduce((top: number, r) => (!r.is_everyone && set.has(String(r.id)) ? Math.max(top, Number(r.position)) : top), -1)
    }
    const myTop = topPosition(mine)
    /** Strictement au-dessus de la cible ; le propriétaire n'est jamais une cible. */
    const outranks = (target: MemberRank) => {
      if (target.is_owner || target.user_id === ownerId) return false
      return isOwner || myTop > topPosition(target.role_ids ?? [])
    }
    // MANAGE_CHANNELS vaut créer + modifier + supprimer (rôles existants).
    const canCreateChannels = has(PERM.MANAGE_CHANNELS | PERM.CREATE_CHANNELS)
    const canEditChannels = has(PERM.MANAGE_CHANNELS | PERM.EDIT_CHANNELS)
    /** Même règle que `deletion_refusal` (channel_access.rs) : ce que le
     *  propriétaire a créé n'est supprimable que par lui ou un administrateur. */
    const canDeleteChannel = (createdBy?: string | null) => {
      if (isAdmin) return true
      if (createdBy && createdBy === ownerId) return false
      if (has(PERM.MANAGE_CHANNELS | PERM.DELETE_CHANNELS)) return true
      return has(PERM.DELETE_OWN_CHANNELS) && !!createdBy && createdBy === meId
    }
    return {
      loaded: !!data, meId, isOwner, isAdmin, has, outranks,
      canCreateChannels, canEditChannels, canDeleteChannel,
      channels: (data?.channels ?? []) as any[],
    }
  }, [data, meId])
}
