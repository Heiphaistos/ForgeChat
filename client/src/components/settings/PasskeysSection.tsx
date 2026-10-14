import { useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { formatDistanceToNow } from 'date-fns'
import { KeyRound, Trash2 } from 'lucide-react'
import toast from 'react-hot-toast'
import api from '../../api/client'
import { dateLocale, useT } from '../../i18n'
import { createPasskey, passkeySupported } from '../../lib/passkey'
import { confirm } from '../ui/ConfirmModal'
import TextPromptDialog from '../ui/TextPromptDialog'

interface Passkey { id: string; name: string; created_at: string; last_used_at: string | null }

/** Clés d'accès (amélioration n° 3) : en plus du code TOTP, qui reste le secours. */
export default function PasskeysSection() {
  const t = useT()
  const qc = useQueryClient()
  const supported = passkeySupported()
  const { data: keys = [] } = useQuery<Passkey[]>({
    queryKey: ['passkeys'],
    queryFn: () => api.get('/auth/passkeys').then(r => r.data),
    staleTime: 60_000,
  })
  const [naming, setNaming] = useState(false)
  // Ré-authentification (code TOTP) exigée avant d'ajouter ou de retirer une clé.
  const [ask, setAsk] = useState<{ add: string } | { del: string } | null>(null)
  const add = useMutation({
    mutationFn: async ({ name, code }: { name: string; code: string }) => {
      const options = (await api.post('/auth/passkeys/register/start', { code })).data
      const created = await createPasskey(options)
      return api.post('/auth/passkeys/register/finish', { name, ...created })
    },
    onSuccess: () => {
      toast.success(t('guard.passkey.added'))
      qc.invalidateQueries({ queryKey: ['passkeys'] })
    },
    onError: (e: any) => toast.error(e.response?.data?.error ?? t('guard.passkey.failed')),
  })
  const remove = useMutation({
    mutationFn: ({ id, code }: { id: string; code: string }) => api.delete(`/auth/passkeys/${id}`, { data: { code } }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['passkeys'] }),
    onError: (e: any) => toast.error(e.response?.data?.error ?? t('guard.passkey.removeFailed')),
  })

  return (
    <div className="p-4 bg-fc-channel rounded-xl border border-fc-hover space-y-3">
      <div className="flex items-center gap-3">
        <KeyRound size={20} className={keys.length ? 'text-fc-green' : 'text-fc-muted'} />
        <p className="text-sm font-medium text-white">{t('guard.passkey.title')}</p>
      </div>
      <p className="text-xs text-fc-muted">{t('guard.passkey.intro')}</p>
      {keys.length === 0 && <p className="text-xs text-fc-muted">{t('guard.passkey.none')}</p>}
      <ul className="space-y-2">
        {keys.map(k => (
          <li key={k.id} className="flex items-center gap-3 p-2 bg-fc-hover/40 rounded-lg">
            <div className="flex-1 min-w-0">
              <p className="text-sm text-white truncate">{k.name}</p>
              <p className="text-xs text-fc-muted">
                {k.last_used_at
                  ? t('guard.passkey.lastUsed', { when: formatDistanceToNow(new Date(k.last_used_at), { addSuffix: true, locale: dateLocale() }) })
                  : t('guard.passkey.neverUsed')}
              </p>
            </div>
            <button
              onClick={() => { void confirm({ message: t('guard.passkey.removeConfirm'), danger: true, confirmLabel: t('guard.passkey.remove') }).then(ok => { if (ok) setAsk({ del: k.id }) }) }}
              className="p-1.5 text-fc-muted hover:text-fc-red rounded-lg hover:bg-fc-red/10"
              aria-label={t('guard.passkey.remove')}
              title={t('guard.passkey.remove')}
            >
              <Trash2 size={14} />
            </button>
          </li>
        ))}
      </ul>
      {supported
        ? (
          <button
            onClick={() => setNaming(true)}
            disabled={add.isPending}
            className="px-3 py-1.5 bg-fc-accent rounded-lg text-white text-sm font-medium disabled:opacity-50"
          >
            {t('guard.passkey.add')}
          </button>
        )
        : <p className="text-xs text-fc-muted">{t('guard.passkey.unsupported')}</p>}
      {naming && (
        <TextPromptDialog title={t('guard.passkey.add')} label={t('guard.passkey.namePrompt')} maxLength={64}
          submitLabel={t('guard.passkey.continue')}
          onSubmit={name => { setNaming(false); setAsk({ add: name }) }} onClose={() => setNaming(false)} />
      )}
      {ask && (
        <TextPromptDialog title={t('guard.passkey.title')} label={t('guard.passkey.codePrompt')} maxLength={32}
          placeholder="123456" submitLabel={t('guard.passkey.continue')}
          onSubmit={code => { const a = ask; setAsk(null); if ('add' in a) add.mutate({ name: a.add, code }); else remove.mutate({ id: a.del, code }) }}
          onClose={() => setAsk(null)} />
      )}
    </div>
  )
}
