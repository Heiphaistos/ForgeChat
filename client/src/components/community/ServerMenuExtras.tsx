// Entrées du menu d'un serveur : tickets, classement des niveaux, verrouillage en un clic.
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { useNavigate } from 'react-router-dom'
import { Lock, Ticket, Trophy, Unlock } from 'lucide-react'
import toast from 'react-hot-toast'
import api from '../../api/client'
import { useServerPerms } from '../../hooks/useServerPerms'
import { useT } from '../../i18n'
import type { ContextMenuItem } from '../ui/ContextMenu'

/** Staff : MANAGE_MESSAGES | MANAGE_SERVER | KICK_MEMBERS (automod::STAFF côté serveur). */
export const STAFF_BITS = (1 << 3) | (1 << 8) | (1 << 6)
/** Lever un verrouillage : gestion du serveur seulement (le serveur refuse les autres). */
const MANAGE_SERVER = 1 << 8

/** Entrées du menu du serveur : tickets, classement, verrouillage (selon réglages et droits). */
export function useServerMenuExtras(serverId: string | undefined, lockdown: boolean, onDone: () => void): ContextMenuItem[] {
  const t = useT()
  const nav = useNavigate()
  const qc = useQueryClient()
  const perms = useServerPerms(serverId)
  const staff = perms.has(STAFF_BITS)
  const canToggle = lockdown ? perms.has(MANAGE_SERVER) : staff
  const { data: tickets } = useQuery<{ enabled: boolean; is_staff: boolean }>({
    queryKey: ['community', serverId, 'tickets/settings'],
    queryFn: () => api.get(`/servers/${serverId}/tickets/settings`).then(r => r.data),
    enabled: !!serverId,
    staleTime: 60_000,
  })
  const { data: levels } = useQuery<{ enabled: boolean }>({
    queryKey: ['community', serverId, 'levels'],
    queryFn: () => api.get(`/servers/${serverId}/levels`).then(r => r.data),
    enabled: !!serverId,
    staleTime: 60_000,
  })
  const lock = useMutation({
    mutationFn: () => api.put(`/servers/${serverId}/lockdown`, { enabled: !lockdown }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['server', serverId] })
      toast.success(t(lockdown ? 'community.lockdown.lifted' : 'community.lockdown.enabled'))
    },
    onError: (e: any) => toast.error(e?.response?.data?.error ?? t('common.error')),
  })
  if (!serverId) return []
  const go = (path: string) => { nav(`/servers/${serverId}/${path}`); onDone() }
  return [
    ...(tickets?.enabled || tickets?.is_staff ? [{ label: t('community.tickets.menu'), icon: <Ticket size={16} />, onClick: () => go('tickets') }] : []),
    ...(levels?.enabled ? [{ label: t('community.levels.menu'), icon: <Trophy size={16} />, onClick: () => go('leaderboard') }] : []),
    ...(canToggle ? [{
      label: t(lockdown ? 'community.lockdown.lift' : 'community.lockdown.enable'),
      icon: lockdown ? <Unlock size={16} /> : <Lock size={16} />,
      danger: !lockdown,
      onClick: () => { lock.mutate(); onDone() },
    }] : []),
  ]
}
