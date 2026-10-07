// Messages éphémères d'une conversation : indicateur dans l'en-tête et choix de la durée.
// MP et groupes : tout membre (GET/PUT /disappearing/:kind/:id) ; salon : droit de
// modifier les salons (PUT …/messaging), valeur lue dans l'objet du salon.
import { useEffect, useState } from 'react'
import { Timer, Check } from 'lucide-react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import toast from 'react-hot-toast'
import api from '../../api/client'
import { useWs } from '../../store/ws'
import { useT, type Key } from '../../i18n'

export type DisappearKind = 'dm' | 'group' | 'channel'

/** null = désactivé, 0 = après lecture (MP et groupes), sinon secondes. */
const OPTIONS: { value: number | null; label: Key; short?: Key }[] = [
  { value: null, label: 'disappear.off' },
  { value: 3600, label: 'disappear.1h', short: 'disappear.short.1h' },
  { value: 86_400, label: 'disappear.24h', short: 'disappear.short.24h' },
  { value: 604_800, label: 'disappear.7d', short: 'disappear.short.7d' },
  { value: 0, label: 'disappear.afterRead', short: 'disappear.short.afterRead' },
]

export const disappearOption = (v: number | null | undefined) => OPTIONS.find(o => o.value === (v ?? null)) ?? OPTIONS[0]

/** Réglage d'un MP ou d'un groupe, tenu à jour par DISAPPEARING_UPDATE. */
export function useDisappearing(kind: 'dm' | 'group', id: string | undefined): number | null {
  const qc = useQueryClient()
  const on = useWs(s => s.on)
  const { data } = useQuery({
    queryKey: ['disappearing', kind, id],
    queryFn: () => api.get<{ seconds: number | null }>(`/disappearing/${kind}/${id}`).then(r => r.data.seconds),
    enabled: !!id,
    staleTime: 5 * 60_000,
  })
  useEffect(() => on('DISAPPEARING_UPDATE', (d: any) => {
    if (d?.conv_kind && d.conv_id) qc.setQueryData(['disappearing', d.conv_kind, d.conv_id], d.seconds ?? null)
  }), [on, qc])
  return data ?? null
}

interface Props {
  kind: DisappearKind
  id: string
  /** Salon : serveur, valeur courante et droit de la changer. */
  serverId?: string
  value?: number | null
  canEdit?: boolean
}

export default function DisappearingControl({ kind, id, serverId, value, canEdit = true }: Props) {
  const t = useT()
  const qc = useQueryClient()
  const [open, setOpen] = useState(false)
  const privateValue = useDisappearing(kind === 'channel' ? 'dm' : kind, kind === 'channel' ? undefined : id)
  const current = kind === 'channel' ? value ?? null : privateValue
  const opt = disappearOption(current)
  const save = useMutation({
    mutationFn: async (seconds: number | null) => {
      if (kind === 'channel') await api.put(`/servers/${serverId}/channels/${id}/messaging`, { disappear_seconds: seconds })
      else await api.put(`/disappearing/${kind}/${id}`, { seconds })
    },
    onSuccess: (_r, seconds) => {
      if (kind === 'channel') qc.invalidateQueries({ queryKey: ['server', serverId] })
      else qc.setQueryData(['disappearing', kind, id], seconds)
      setOpen(false)
    },
    onError: (e: any) => toast.error(e?.response?.data?.error ?? t('disappear.failed')),
  })
  if (!canEdit && current === null) return null
  const label = current === null ? t('disappear.title') : t('disappear.active', { d: t(opt.label) })
  const choices = OPTIONS.filter(o => kind !== 'channel' || o.value !== 0)

  return (
    <div className="relative">
      <button
        type="button"
        onClick={() => canEdit && setOpen(o => !o)}
        aria-haspopup={canEdit ? 'menu' : undefined}
        aria-expanded={canEdit ? open : undefined}
        aria-label={label}
        title={label}
        className={`min-w-[44px] min-h-[44px] md:min-w-0 md:min-h-0 flex items-center justify-center gap-1 p-1.5 rounded transition ${current !== null ? 'text-fc-accent' : 'text-fc-muted hover:text-white hover:bg-fc-hover'} ${canEdit ? '' : 'cursor-default'}`}
      >
        <Timer size={18} aria-hidden />
        {opt.short && <span className="text-[11px] font-semibold leading-none" aria-hidden>{t(opt.short)}</span>}
      </button>
      {open && (
        <>
          <div className="fixed inset-0 z-40" aria-hidden onClick={() => setOpen(false)} />
          <div role="menu" aria-label={t('disappear.title')}
            className="absolute right-0 top-full mt-2 z-50 w-72 max-w-[calc(100vw-2rem)] bg-fc-channel border border-fc-hover rounded-xl shadow-2xl p-2">
            <div className="px-2 py-1.5 text-sm font-semibold text-white">{t('disappear.title')}</div>
            {choices.map(o => (
              <button
                key={String(o.value)}
                type="button"
                role="menuitemradio"
                aria-checked={o.value === current}
                disabled={save.isPending}
                onClick={() => save.mutate(o.value)}
                className="w-full flex items-center justify-between px-2 py-2 rounded text-sm text-fc-text hover:bg-fc-hover disabled:opacity-50"
              >
                {t(o.label)}
                {o.value === current && <Check size={14} className="text-fc-accent" aria-hidden />}
              </button>
            ))}
            <p className="px-2 pt-2 text-xs text-fc-muted">{t('disappear.hint')}</p>
            {kind !== 'channel' && <p className="px-2 pt-1 text-xs text-fc-muted">{t('disappear.afterReadHint')}</p>}
          </div>
        </>
      )}
    </div>
  )
}
