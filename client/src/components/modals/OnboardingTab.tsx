import { useEffect, useState } from 'react'
import { Plus, Trash2 } from 'lucide-react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import api from '../../api/client'
import toast from 'react-hot-toast'
import type { OnboardingQuestion } from './OnboardingModal'
import { useT } from '../../i18n'

type Draft = Omit<OnboardingQuestion, 'id' | 'options'> & { id?: string; options: (Omit<OnboardingQuestion['options'][number], 'id'> & { id?: string })[] }

// Mêmes droits que `SAFE_PERMS` côté serveur (role_grantable) : un rôle donné par l'accueil ou
// débloqué par niveau ne modère ni n'administre.
const SAFE = (1n << 0n) | (1n << 1n) | (1n << 2n) | (1n << 10n) | (1n << 11n) | (1n << 12n) | (1n << 13n) | (1n << 14n) | (1n << 40n)
export const grantable = (r: { is_everyone?: boolean; permissions?: string | number | null }) => !r.is_everyone && (BigInt(r.permissions ?? 0) & ~SAFE) === 0n

const chip = (on: boolean) => `px-2 py-1 rounded text-xs border transition ${on ? 'bg-fc-accent border-fc-accent text-white' : 'border-fc-hover text-fc-muted hover:text-white'}`

/** Paramètres du serveur > Accueil : questions posées aux nouveaux membres (propriétaire). */
export default function OnboardingTab({ serverId, channels }: { serverId: string; channels: any[] }) {
  const t = useT()
  const qc = useQueryClient()
  const { data } = useQuery<{ questions: OnboardingQuestion[] }>({
    queryKey: ['onboarding', serverId],
    queryFn: () => api.get(`/servers/${serverId}/onboarding`).then(r => r.data),
  })
  const { data: roles = [] } = useQuery<any[]>({
    queryKey: ['roles', serverId],
    queryFn: () => api.get(`/servers/${serverId}/roles`).then(r => r.data),
  })
  const [draft, setDraft] = useState<Draft[]>([])
  useEffect(() => { if (data) setDraft(data.questions) }, [data])

  const save = useMutation({
    mutationFn: () => api.put(`/servers/${serverId}/onboarding`, { questions: draft }),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ['onboarding', serverId] }); qc.invalidateQueries({ queryKey: ['server', serverId] }); toast.success(t('onb.saved')) },
    onError: (e: any) => toast.error(e.response?.data?.error ?? t('onb.saveError')),
  })

  const setQ = (qi: number, patch: Partial<Draft>) => setDraft(d => d.map((q, i) => i === qi ? { ...q, ...patch } : q))
  const setO = (qi: number, oi: number, patch: Partial<Draft['options'][number]>) =>
    setQ(qi, { options: draft[qi].options.map((o, i) => i === oi ? { ...o, ...patch } : o) })
  const flip = (list: string[], id: string) => list.includes(id) ? list.filter(x => x !== id) : [...list, id]
  const textChannels = channels.filter(c => c.type !== 'category')
  const safeRoles = roles.filter(grantable)
  const input = 'px-3 py-2 bg-fc-input rounded text-white text-sm outline-none focus:ring-2 focus:ring-fc-accent'

  return (
    <div className="space-y-5">
      <div>
        <h3 className="text-base font-semibold text-white mb-1">{t('onb.title')}</h3>
        <p className="text-sm text-fc-muted">
          {t('onb.intro')}
        </p>
      </div>
      {draft.map((q, qi) => (
        <div key={q.id ?? `n${qi}`} className="bg-fc-bg/50 rounded-xl border border-fc-hover p-4 space-y-3">
          <div className="flex gap-2 items-center">
            <input value={q.title} onChange={e => setQ(qi, { title: e.target.value })} maxLength={100} placeholder={t('onb.question')} aria-label={t('onb.question')} className={`flex-1 min-w-0 ${input}`} />
            <label className="flex items-center gap-1 text-xs text-fc-muted whitespace-nowrap">
              <input type="checkbox" checked={q.multiple} onChange={e => setQ(qi, { multiple: e.target.checked })} /> {t('onb.multiple')}
            </label>
            <button onClick={() => setDraft(d => d.filter((_, i) => i !== qi))} aria-label={t('onb.deleteQuestion')} className="p-2 text-fc-muted hover:text-red-400"><Trash2 size={16} /></button>
          </div>
          {q.options.map((o, oi) => (
            <div key={o.id ?? `n${oi}`} className="ml-3 pl-3 border-l border-fc-hover space-y-2">
              <div className="flex gap-2">
                <input value={o.label} onChange={e => setO(qi, oi, { label: e.target.value })} maxLength={100} placeholder={t('onb.answer')} aria-label={t('onb.answer')} className={`flex-1 min-w-0 ${input}`} />
                <button onClick={() => setQ(qi, { options: q.options.filter((_, i) => i !== oi) })} aria-label={t('onb.deleteAnswer')} className="p-2 text-fc-muted hover:text-red-400"><Trash2 size={14} /></button>
              </div>
              {safeRoles.length > 0 && (
                <div className="flex flex-wrap gap-1 items-center"><span className="text-xs text-fc-muted mr-1">{t('onb.roles')}</span>
                  {safeRoles.map(r => <button key={r.id} type="button" aria-pressed={o.role_ids.includes(r.id)} onClick={() => setO(qi, oi, { role_ids: flip(o.role_ids, r.id) })} className={chip(o.role_ids.includes(r.id))}>@{r.name}</button>)}
                </div>
              )}
              <div className="flex flex-wrap gap-1 items-center"><span className="text-xs text-fc-muted mr-1">{t('onb.channels')}</span>
                {textChannels.map(c => <button key={c.id} type="button" aria-pressed={o.channel_ids.includes(c.id)} onClick={() => setO(qi, oi, { channel_ids: flip(o.channel_ids, c.id) })} className={chip(o.channel_ids.includes(c.id))}>#{c.name}</button>)}
              </div>
            </div>
          ))}
          {q.options.length < 10 && (
            <button onClick={() => setQ(qi, { options: [...q.options, { label: '', role_ids: [], channel_ids: [] }] })} className="ml-3 flex items-center gap-1 text-xs text-fc-accent hover:underline"><Plus size={12} /> {t('onb.addAnswer')}</button>
          )}
        </div>
      ))}
      <div className="flex gap-2">
        {draft.length < 10 && (
          <button onClick={() => setDraft(d => [...d, { title: '', multiple: false, options: [{ label: '', role_ids: [], channel_ids: [] }] }])}
            className="flex items-center gap-1 px-3 py-2 text-sm rounded-lg border border-fc-hover text-fc-muted hover:text-white"><Plus size={14} /> {t('onb.addQuestion')}</button>
        )}
        <button onClick={() => save.mutate()} disabled={save.isPending} className="ml-auto px-4 py-2 text-sm bg-fc-accent text-white rounded-lg hover:opacity-90 disabled:opacity-50">{t('common.record')}</button>
      </div>
    </div>
  )
}
