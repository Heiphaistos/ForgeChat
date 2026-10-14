// Panneau des membres d'un groupe privé : le propriétaire peut exclure un membre
// ou lui céder le groupe (P2-10), avec confirmation.
import { useState } from 'react'
import { useEscapeKey } from '../../hooks/useEscapeKey'
import { useMutation, useQueryClient } from '@tanstack/react-query'
import { Crown, UserMinus } from 'lucide-react'
import toast from 'react-hot-toast'
import { useT } from '../../i18n'
import api, { mediaUrl } from '../../api/client'
import { userMenuProps } from '../userMenu/store'

interface Member { id: string; username: string; avatar: string | null; status: string }
type Pending = { kind: 'remove' | 'owner'; member: Member } | null

export default function GroupMembersPanel({ groupId, ownerId, members, meId }: {
  groupId: string; ownerId: string; members: Member[]; meId?: string
}) {
  const t = useT()
  const qc = useQueryClient()
  const [pending, setPending] = useState<Pending>(null)
  const iAmOwner = !!meId && meId === ownerId
  useEscapeKey(() => setPending(null), !!pending)

  const act = useMutation({
    mutationFn: (p: NonNullable<Pending>) => p.kind === 'remove'
      ? api.delete(`/dms/groups/${groupId}/members/${p.member.id}`)
      : api.patch(`/dms/groups/${groupId}/owner`, { user_id: p.member.id }),
    onSuccess: (_, p) => {
      toast.success(t(p.kind === 'remove' ? 'hc.gm.removed' : 'hc.gm.owner', { name: p.member.username }))
      qc.invalidateQueries({ queryKey: ['group-dm', groupId] })
      qc.invalidateQueries({ queryKey: ['dms'] })
    },
    onError: (e: any) => toast.error(e.response?.data?.error ?? t('hc.gm.fail')),
    onSettled: () => setPending(null),
  })

  return (
    <div className="absolute right-0 inset-y-0 z-20 w-full md:relative md:inset-auto md:z-auto md:w-56 border-l border-fc-hover bg-fc-bg/20 flex-shrink-0 overflow-y-auto overscroll-contain py-3 panel-slide-right">
      <p className="text-[10px] text-fc-muted uppercase font-semibold tracking-wide px-3 mb-2">
        Membres ({members.length})
      </p>
      {members.map(m => (
        <div key={m.id} className="group flex items-center gap-2 px-3 py-1.5 hover:bg-fc-hover/40 transition"
          {...userMenuProps({ userId: m.id, username: m.username, avatar: m.avatar })}>
          <div className="relative flex-shrink-0">
            <div className="w-7 h-7 rounded-full bg-fc-channel flex items-center justify-center text-xs font-bold text-white overflow-hidden">
              {m.avatar
                ? <img src={mediaUrl(m.avatar)} alt="" loading="lazy" decoding="async" className="w-full h-full object-cover" />
                : m.username.charAt(0).toUpperCase()}
            </div>
            <span className={`absolute -bottom-0.5 -right-0.5 w-2.5 h-2.5 rounded-full border-2 border-fc-bg ${
              m.status === 'online' ? 'bg-green-400' : m.status === 'idle' ? 'bg-yellow-400' : m.status === 'dnd' ? 'bg-red-500' : 'bg-gray-500'
            }`} />
          </div>
          <span className={`flex-1 min-w-0 text-sm truncate ${m.id === meId ? 'text-fc-accent font-medium' : 'text-fc-text'}`}>
            {m.username}{m.id === meId ? t('hc.gm.me') : ''}
          </span>
          {m.id === ownerId && <span title={t('hc.gm.ownerTitle')}><Crown size={12} className="text-yellow-400 flex-shrink-0" aria-label={t('hc.gm.ownerShort')} /></span>}
          {iAmOwner && m.id !== meId && (
            <span className="flex gap-0.5 md:opacity-0 md:group-hover:opacity-100 md:focus-within:opacity-100">
              <button onClick={() => setPending({ kind: 'owner', member: m })} title={t('hc.gm.makeOwner')}
                aria-label={t('hc.gm.makeOwnerAria', { name: m.username })} className="p-1 text-fc-muted hover:text-yellow-400">
                <Crown size={13} />
              </button>
              <button onClick={() => setPending({ kind: 'remove', member: m })} title={t('hc.gm.removeTitle')}
                aria-label={t('hc.gm.removeAria', { name: m.username })} className="p-1 text-fc-muted hover:text-red-400">
                <UserMinus size={13} />
              </button>
            </span>
          )}
        </div>
      ))}

      {pending && (
        <div className="fixed inset-0 z-[200] flex items-center justify-center bg-black/60 px-4" onClick={() => setPending(null)}>
          <div className="bg-fc-sidebar rounded-xl shadow-2xl p-6 w-full max-w-sm" role="dialog" aria-modal="true" onClick={e => e.stopPropagation()}>
            <h3 className="text-lg font-bold text-white mb-2">
              {t(pending.kind === 'remove' ? 'hc.gm.confirmRemove' : 'hc.gm.confirmGive', { name: pending.member.username })}
            </h3>
            <p className="text-sm text-fc-muted mb-5">
              {pending.kind === 'remove'
                ? t('hc.gm.removeBody')
                : t('hc.gm.giveBody')}
            </p>
            <div className="flex gap-3 justify-end">
              <button onClick={() => setPending(null)} className="px-4 py-2 text-sm rounded-lg bg-fc-hover hover:bg-fc-input text-white transition">{t('hc.common.cancel')}</button>
              <button onClick={() => act.mutate(pending)} disabled={act.isPending}
                className="px-4 py-2 text-sm rounded-lg bg-red-500 hover:bg-red-600 text-white font-semibold transition disabled:opacity-50">
                {t('hc.common.confirm')}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
