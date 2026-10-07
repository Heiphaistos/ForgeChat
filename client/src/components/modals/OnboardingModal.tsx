import { useEffect, useState } from 'react'
import { createPortal } from 'react-dom'
import { Sparkles, X } from 'lucide-react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import api from '../../api/client'
import toast from 'react-hot-toast'
import { useEscapeKey } from '../../hooks/useEscapeKey'

export interface OnboardingOption { id: string; label: string; role_ids: string[]; channel_ids: string[] }
export interface OnboardingQuestion { id: string; title: string; multiple: boolean; options: OnboardingOption[] }
interface Onboarding { questions: OnboardingQuestion[]; selected: string[] }

/** Questions d'accueil d'un serveur. Sans `onClose` : arrivée d'un nouveau membre
 *  (« Passer » enregistre une réponse vide) ; avec : modification des réponses. */
export default function OnboardingModal({ serverId, serverName, onClose }: { serverId: string; serverName: string; onClose?: () => void }) {
  useEscapeKey(onClose ?? (() => {}))
  const qc = useQueryClient()
  const { data } = useQuery<Onboarding>({
    queryKey: ['onboarding', serverId],
    queryFn: () => api.get(`/servers/${serverId}/onboarding`).then(r => r.data),
  })
  const [selected, setSelected] = useState<Set<string>>(new Set())
  useEffect(() => { if (data) setSelected(new Set(data.selected)) }, [data])

  const save = useMutation({
    mutationFn: (ids: string[]) => api.put(`/servers/${serverId}/onboarding/answers`, { option_ids: ids }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['onboarding', serverId] })
      qc.invalidateQueries({ queryKey: ['server', serverId] })
      onClose?.()
    },
    onError: (e: any) => toast.error(e.response?.data?.error ?? 'Enregistrement impossible'),
  })

  const toggle = (q: OnboardingQuestion, optId: string) => setSelected(prev => {
    const next = new Set(prev)
    if (next.has(optId)) next.delete(optId)
    else {
      if (!q.multiple) q.options.forEach(o => next.delete(o.id))
      next.add(optId)
    }
    return next
  })

  return createPortal(
    <div className="fixed inset-0 bg-black/80 flex items-center justify-center z-50 px-3">
      <div className="bg-fc-channel rounded-xl p-6 w-full max-w-[520px] max-h-[90dvh] flex flex-col shadow-2xl" role="dialog" aria-modal="true" aria-labelledby="onboarding-title">
        <div className="flex items-center justify-between mb-4">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-full bg-fc-accent/20 flex items-center justify-center"><Sparkles size={20} className="text-fc-accent" aria-hidden /></div>
            <div>
              <h2 id="onboarding-title" className="text-white font-bold text-lg">Bienvenue !</h2>
              <p className="text-fc-muted text-xs">{serverName}</p>
            </div>
          </div>
          {onClose && (
            <button onClick={onClose} aria-label="Fermer" className="text-fc-muted hover:text-white p-2 rounded hover:bg-fc-hover"><X size={18} aria-hidden /></button>
          )}
        </div>
        <p className="text-fc-muted text-sm mb-4">Réponds à quelques questions pour obtenir les rôles et salons qui te concernent.</p>
        <div className="flex-1 overflow-y-auto space-y-5 mb-5">
          {!data ? <p className="text-sm text-fc-muted">Chargement…</p> : data.questions.length === 0 ? (
            <p className="text-sm text-fc-muted">Aucune question pour l'instant.</p>
          ) : data.questions.map(q => (
            <fieldset key={q.id}>
              <legend className="text-white text-sm font-semibold mb-2">
                {q.title} <span className="text-xs text-fc-muted font-normal">{q.multiple ? '(plusieurs choix)' : '(un seul choix)'}</span>
              </legend>
              <div className="flex flex-wrap gap-2">
                {q.options.map(o => {
                  const on = selected.has(o.id)
                  return (
                    <button key={o.id} type="button" onClick={() => toggle(q, o.id)} aria-pressed={on}
                      className={`px-3 py-2 rounded-lg text-sm border transition ${on ? 'bg-fc-accent border-fc-accent text-white' : 'border-fc-hover text-fc-text hover:bg-fc-hover'}`}>
                      {o.label}
                    </button>
                  )
                })}
              </div>
            </fieldset>
          ))}
        </div>
        <div className="flex justify-end gap-2">
          {onClose ? (
            <button onClick={onClose} className="px-4 py-2 text-sm text-fc-muted hover:text-white">Annuler</button>
          ) : (
            <button onClick={() => save.mutate([])} disabled={save.isPending} className="px-4 py-2 text-sm text-fc-muted hover:text-white">Passer</button>
          )}
          <button onClick={() => save.mutate([...selected])} disabled={save.isPending || !data}
            className="px-4 py-2 text-sm bg-fc-accent text-white rounded-lg hover:opacity-90 disabled:opacity-50">Valider</button>
        </div>
      </div>
    </div>,
    document.body,
  )
}
