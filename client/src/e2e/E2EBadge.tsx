// En-tête d'un MP ou d'un groupe : cadenas « chiffré de bout en bout », codes de
// sécurité des membres et alerte « la clé de X a changé ».
import { useEffect, useMemo, useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { Lock, LockOpen, ShieldAlert, X } from 'lucide-react'
import { useAuth } from '../store/auth'
import { useT } from '../i18n'
import { acceptKeys, getMembers, keyChanges, type ConvKind } from './conversations'
import { SafetyCode } from './E2ESettings'

/** Vrai quand tous les membres ont une clé : la conversation est chiffrée. */
export function useConvEncrypted(kind: ConvKind, id: string | undefined) {
  const { data } = useQuery({
    queryKey: ['e2e_members', kind, id],
    queryFn: () => getMembers(kind, id!),
    enabled: !!id,
    staleTime: 60_000,
  })
  return { members: data ?? [], encrypted: !!data?.length && data.every(m => !!m.public) }
}

export function E2EBadge({ kind, id }: { kind: ConvKind; id: string }) {
  const t = useT()
  const me = useAuth(s => s.user?.id)
  const { members, encrypted } = useConvEncrypted(kind, id)
  const [open, setOpen] = useState(false)
  const [dismissed, setDismissed] = useState(0)
  const changed = useMemo(() => keyChanges(members), [members, dismissed])
  // Première rencontre : on retient les empreintes sans alerter.
  useEffect(() => { if (members.length && !changed.length) acceptKeys(members) }, [members, changed.length])
  const others = members.filter(m => m.user_id !== me)
  const missing = others.filter(m => !m.public).map(m => m.username)

  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(o => !o)}
        title={encrypted ? t('e2e.conv.encrypted') : t('e2e.conv.notYet', { names: missing.join(', ') })}
        aria-label={encrypted ? t('e2e.conv.encrypted') : t('e2e.conv.notYetShort')}
        aria-expanded={open}
        className={`min-w-[44px] min-h-[44px] md:min-w-0 md:min-h-0 flex items-center justify-center p-1.5 rounded transition ${
          encrypted ? 'text-green-400 hover:bg-green-900/30' : 'text-fc-muted hover:text-white hover:bg-fc-hover'
        }`}
      >
        {encrypted ? <Lock size={18} /> : <LockOpen size={18} />}
      </button>
      {changed.length > 0 && (
        <div role="alert" className="fixed top-14 right-4 z-40 max-w-sm bg-fc-channel border border-fc-yellow/50 rounded-lg p-3 shadow-xl flex gap-2">
          <ShieldAlert size={18} className="text-fc-yellow flex-shrink-0 mt-0.5" aria-hidden />
          <div className="text-xs text-fc-text">
            <p>{t('e2e.conv.keyChanged', { names: changed.map(m => m.username).join(', ') })}</p>
            <button type="button" onClick={() => { acceptKeys(members); setDismissed(n => n + 1) }}
              className="mt-2 px-2 py-1 bg-fc-hover rounded text-white">{t('e2e.conv.keyChangedOk')}</button>
          </div>
        </div>
      )}
      {open && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 px-4" onClick={() => setOpen(false)}>
          <div role="dialog" aria-modal="true" aria-label={t('e2e.conv.title')} onClick={e => e.stopPropagation()}
            className="bg-fc-bg rounded-xl p-5 w-full max-w-md max-h-[85vh] overflow-y-auto">
            <div className="flex items-center justify-between mb-2">
              <h2 className="text-white font-semibold flex items-center gap-2">
                {encrypted ? <Lock size={16} className="text-green-400" aria-hidden /> : <LockOpen size={16} aria-hidden />}
                {t('e2e.conv.title')}
              </h2>
              <button type="button" onClick={() => setOpen(false)} aria-label={t('common.close')} className="p-1 text-fc-muted hover:text-white">
                <X size={16} />
              </button>
            </div>
            <p className="text-xs text-fc-muted">
              {encrypted ? t('e2e.conv.desc') : t('e2e.conv.notYet', { names: missing.join(', ') })}
            </p>
            {others.filter(m => m.public).map(m => (
              <div key={m.user_id}>
                <p className="text-sm text-white mt-4">{m.username}</p>
                <SafetyCode userId={m.user_id} />
              </div>
            ))}
          </div>
        </div>
      )}
    </>
  )
}
