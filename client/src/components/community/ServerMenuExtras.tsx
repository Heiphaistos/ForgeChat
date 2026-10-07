// Entrées du menu d'un serveur : tickets, classement des niveaux, verrouillage en un clic.
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { useNavigate } from 'react-router-dom'
import { Lock, Ticket, Trophy, Unlock } from 'lucide-react'
import toast from 'react-hot-toast'
import api from '../../api/client'
import { useServerPerms } from '../../hooks/useServerPerms'
import { useT } from '../../i18n'

/** Staff : MANAGE_MESSAGES | MANAGE_SERVER | KICK_MEMBERS (automod::STAFF côté serveur). */
export const STAFF_BITS = (1 << 3) | (1 << 8) | (1 << 6)

const itemCls = 'w-full flex items-center gap-2 px-3 py-2 rounded hover:bg-fc-hover text-fc-muted hover:text-white text-sm transition'

export default function ServerMenuExtras({ serverId, lockdown, onDone }: { serverId?: string; lockdown: boolean; onDone: () => void }) {
  const t = useT()
  const nav = useNavigate()
  const qc = useQueryClient()
  const staff = useServerPerms(serverId).has(STAFF_BITS)
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
  if (!serverId) return null
  const go = (path: string) => { nav(`/servers/${serverId}/${path}`); onDone() }
  return (
    <>
      {(tickets?.enabled || tickets?.is_staff) && (
        <button onClick={() => go('tickets')} className={itemCls}><Ticket size={16} aria-hidden /> {t('community.tickets.menu')}</button>
      )}
      {levels?.enabled && (
        <button onClick={() => go('leaderboard')} className={itemCls}><Trophy size={16} aria-hidden /> {t('community.levels.menu')}</button>
      )}
      {staff && (
        <button onClick={() => { lock.mutate(); onDone() }} className={`${itemCls} ${lockdown ? '' : '!text-fc-red'}`}>
          {lockdown ? <Unlock size={16} aria-hidden /> : <Lock size={16} aria-hidden />} {t(lockdown ? 'community.lockdown.lift' : 'community.lockdown.enable')}
        </button>
      )}
    </>
  )
}
