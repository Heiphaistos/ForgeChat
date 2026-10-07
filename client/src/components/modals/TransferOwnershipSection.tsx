import { useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import toast from 'react-hot-toast'
import api from '../../api/client'
import { useAuth } from '../../store/auth'
import { useT } from '../../i18n'

interface Member { user_id: string; username: string; nickname: string | null; is_owner: boolean }

/**
 * Transfert de propriété (propriétaire uniquement). Confirmation forte comme Discord :
 * choisir le membre, retaper son nom, puis son propre mot de passe (vérifié par le serveur).
 */
export default function TransferOwnershipSection({ serverId, ownerId }: { serverId: string; ownerId: string }) {
  const t = useT()
  const me = useAuth(s => s.user)
  const qc = useQueryClient()
  const [target, setTarget] = useState('')
  const [confirmName, setConfirmName] = useState('')
  const [password, setPassword] = useState('')

  const isOwner = !!me && me.id === ownerId
  const { data: members = [] } = useQuery<Member[]>({
    queryKey: ['members', serverId],
    queryFn: () => api.get(`/servers/${serverId}/members`).then(r => r.data),
    enabled: isOwner,
  })

  const transfer = useMutation({
    mutationFn: () => api.post(`/servers/${serverId}/transfer`, { user_id: target, password }),
    onSuccess: () => {
      toast.success(t('transfer.done'))
      setTarget(''); setConfirmName(''); setPassword('')
      qc.invalidateQueries({ queryKey: ['server', serverId] })
      qc.invalidateQueries({ queryKey: ['servers'] })
    },
    onError: (e: any) => toast.error(e.response?.data?.error ?? t('common.error')),
  })

  if (!isOwner) return null
  const chosen = members.find(m => m.user_id === target)
  const ready = !!chosen && confirmName === chosen.username && password.length > 0

  return (
    <div className="p-4 bg-fc-channel/50 rounded-lg border border-fc-red/40 space-y-2">
      <div className="text-xs font-semibold text-fc-muted uppercase tracking-wide">{t('transfer.title')}</div>
      <p className="text-sm text-fc-muted">
        {t('transfer.warn')}
      </p>
      <select value={target} onChange={e => { setTarget(e.target.value); setConfirmName('') }}
        aria-label={t('transfer.newOwner')}
        className="w-full px-3 py-2 bg-fc-input rounded text-white outline-none text-sm focus:ring-2 focus:ring-fc-red">
        <option value="">{t('transfer.choose')}</option>
        {members.filter(m => !m.is_owner).map(m => (
          <option key={m.user_id} value={m.user_id}>{m.nickname ? `${m.nickname} (${m.username})` : m.username}</option>
        ))}
      </select>
      {chosen && (
        <>
          <input value={confirmName} onChange={e => setConfirmName(e.target.value)}
            placeholder={t('transfer.retype', { name: chosen.username })} aria-label={t('transfer.confirmName')}
            className="w-full px-3 py-2 bg-fc-input rounded text-white outline-none text-sm focus:ring-2 focus:ring-fc-red" />
          <input type="password" value={password} onChange={e => setPassword(e.target.value)}
            placeholder={t('transfer.password')} aria-label={t('transfer.password')} autoComplete="current-password"
            className="w-full px-3 py-2 bg-fc-input rounded text-white outline-none text-sm focus:ring-2 focus:ring-fc-red" />
          <button onClick={() => transfer.mutate()} disabled={!ready || transfer.isPending}
            className="px-4 py-2 bg-fc-red hover:bg-red-600 text-white rounded text-sm font-medium transition disabled:opacity-50">
            {transfer.isPending ? t('forward.sending') : t('transfer.submit', { name: chosen.username })}
          </button>
        </>
      )}
    </div>
  )
}
