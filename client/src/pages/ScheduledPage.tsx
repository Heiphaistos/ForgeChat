// « À envoyer » : tous mes messages programmés (salons). Le texte reste chiffré côté
// serveur ; il est déchiffré ici, modifié puis rechiffré avant d'être renvoyé.
import { useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { CalendarClock, ChevronLeft, Pencil, Send, Trash2 } from 'lucide-react'
import toast from 'react-hot-toast'
import api from '../api/client'
import { useMobile } from '../contexts/MobileContext'
import { usePageTitle } from '../hooks/usePageTitle'
import { useFormatDate } from '../hooks/useFormatDate'
import { useT } from '../i18n'
import { openMessage, type RawMsg } from '../e2e/conversations'
import { channelSendError, sendChannel } from '../e2e/channels'

interface Scheduled extends RawMsg {
  channel_id: string
  user_id: string
  send_at: string
  channel_name: string
  server_id: string
  server_name: string
  e2e?: 'ok' | 'locked'
}

/** Valeur d'un champ datetime-local (heure locale) pour une date ISO. */
const localInput = (iso: string) => {
  const d = new Date(iso)
  return new Date(d.getTime() - d.getTimezoneOffset() * 60_000).toISOString().slice(0, 16)
}

const SCHEDULED_KEY = ['scheduled_all'] as const

function Item({ m }: { m: Scheduled }) {
  const t = useT()
  const qc = useQueryClient()
  const nav = useNavigate()
  const { formatShortDate } = useFormatDate()
  const [editing, setEditing] = useState(false)
  const [text, setText] = useState(m.content ?? '')
  const [at, setAt] = useState(localInput(m.send_at))
  const refresh = () => {
    qc.invalidateQueries({ queryKey: SCHEDULED_KEY })
    qc.invalidateQueries({ queryKey: ['scheduled_messages'] })
  }
  const fail = (e: any) => toast.error(channelSendError(e, e?.response?.data?.error ?? t('sched.failed')))

  const save = useMutation({
    mutationFn: async () => {
      const send_at = new Date(at).toISOString()
      const changed = text.trim() !== (m.content ?? '').trim()
      if (!changed || m.e2e === 'locked') return api.patch(`/scheduled/${m.id}`, { send_at })
      // Texte modifié : rechiffré (AutoMod, aperçu de lien) avec l'id client du message programmé.
      return sendChannel(m.channel_id, text.trim(), body => api.patch(`/scheduled/${m.id}`, {
        send_at, enc: body.enc, client_msg_id: body.client_msg_id,
      }), { serverId: m.server_id, clientMsgId: m.client_msg_id, preview: true, edit: true })
    },
    onSuccess: () => { toast.success(t('sched.saved')); setEditing(false); refresh() },
    onError: fail,
  })
  const sendNow = useMutation({
    mutationFn: () => api.post(`/scheduled/${m.id}/send`),
    onSuccess: () => { toast.success(t('sched.sentNow')); refresh() },
    onError: fail,
  })
  const cancel = useMutation({
    mutationFn: () => api.delete(`/scheduled/${m.id}`),
    onSuccess: () => { toast.success(t('input.scheduleCancelled')); refresh() },
    onError: () => toast.error(t('input.cancelFailed')),
  })
  const busy = save.isPending || sendNow.isPending || cancel.isPending

  return (
    <li className="bg-fc-channel border border-fc-hover rounded-xl p-3 space-y-2">
      <div className="flex items-center gap-2 text-xs text-fc-muted flex-wrap">
        <button type="button" className="hover:text-white hover:underline truncate max-w-full"
          onClick={() => nav(`/servers/${m.server_id}/channels/${m.channel_id}`)}>
          {t('sched.where', { server: m.server_name, channel: m.channel_name })}
        </button>
        <span className="ml-auto inline-flex items-center gap-1"><CalendarClock size={12} aria-hidden />{formatShortDate(m.send_at)}</span>
      </div>
      {editing ? (
        <div className="space-y-2">
          <textarea value={text} onChange={e => setText(e.target.value)} maxLength={4000} rows={3}
            disabled={m.e2e === 'locked'} aria-label={t('sched.edit')}
            className="w-full fc-input text-sm resize-y" />
          <input type="datetime-local" value={at} onChange={e => setAt(e.target.value)}
            min={localInput(new Date(Date.now() + 60_000).toISOString())}
            aria-label={t('sched.when')} className="w-full fc-input text-sm" />
          <div className="flex gap-2 justify-end">
            <button type="button" onClick={() => setEditing(false)} className="px-3 py-1.5 text-sm text-fc-muted hover:text-white">{t('common.cancel')}</button>
            <button type="button" disabled={busy || !text.trim() || !at} onClick={() => save.mutate()}
              className="btn-primary text-sm disabled:opacity-40">{t('sched.save')}</button>
          </div>
        </div>
      ) : (
        <p className={`text-sm whitespace-pre-wrap break-words ${m.e2e === 'locked' ? 'text-fc-muted italic' : 'text-fc-text'}`}>{m.content}</p>
      )}
      {!editing && (
        <div className="flex gap-1 justify-end">
          <button type="button" disabled={busy} onClick={() => setEditing(true)}
            className="inline-flex items-center gap-1 px-2 py-1 text-xs rounded text-fc-muted hover:text-white hover:bg-fc-hover disabled:opacity-40">
            <Pencil size={12} aria-hidden />{t('sched.edit')}
          </button>
          <button type="button" disabled={busy} onClick={() => sendNow.mutate()}
            className="inline-flex items-center gap-1 px-2 py-1 text-xs rounded text-fc-muted hover:text-white hover:bg-fc-hover disabled:opacity-40">
            <Send size={12} aria-hidden />{t('sched.sendNow')}
          </button>
          <button type="button" disabled={busy} onClick={() => cancel.mutate()}
            className="inline-flex items-center gap-1 px-2 py-1 text-xs rounded text-fc-muted hover:text-fc-red hover:bg-fc-hover disabled:opacity-40">
            <Trash2 size={12} aria-hidden />{t('common.cancel')}
          </button>
        </div>
      )}
    </li>
  )
}

export default function ScheduledPage() {
  const t = useT()
  usePageTitle(t('sched.page'))
  const { openSidebar } = useMobile()
  const { data = [], isLoading } = useQuery({
    queryKey: SCHEDULED_KEY,
    queryFn: async () => {
      const list = (await api.get<Scheduled[]>('/scheduled')).data
      // Auteur du message programmé = moi (`user_id`) : même AAD qu'un message du salon.
      return Promise.all(list.map(m => openMessage('channel', m.channel_id, m)))
    },
    refetchInterval: 60_000,
  })

  return (
    <div className="flex-1 flex flex-col overflow-hidden bg-fc-bg">
      <div className="px-4 py-4 border-b border-fc-hover flex items-center gap-3">
        <button className="md:hidden flex items-center justify-center min-w-[44px] min-h-[44px] p-1.5 rounded hover:bg-fc-hover text-fc-muted hover:text-white transition flex-shrink-0"
          onClick={openSidebar} aria-label={t('common.back')}>
          <ChevronLeft size={20} />
        </button>
        <CalendarClock size={20} className="text-fc-accent" aria-hidden />
        <h1 className="text-lg font-bold text-white">{t('sched.page')}</h1>
        {data.length > 0 && <span className="text-xs text-fc-muted bg-fc-hover px-2 py-0.5 rounded-full">{data.length}</span>}
      </div>
      <div className="flex-1 overflow-y-auto overscroll-contain px-4 py-4">
        <p className="text-xs text-fc-muted mb-4">{t('sched.pageDesc')}</p>
        {isLoading ? null : data.length === 0 ? (
          <p className="text-sm text-fc-muted text-center py-12">{t('sched.none')}</p>
        ) : (
          <ul className="space-y-3 max-w-2xl">
            {data.map(m => <Item key={m.id} m={m} />)}
          </ul>
        )}
      </div>
    </div>
  )
}
