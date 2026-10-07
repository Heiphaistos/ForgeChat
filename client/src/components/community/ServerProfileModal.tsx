// Page de présentation d'un serveur public de l'annuaire (GET /explore/:id).
import { useQuery } from '@tanstack/react-query'
import { Activity, Calendar, Hash, Tag, Users, X } from 'lucide-react'
import api, { mediaUrl } from '../../api/client'
import { useEscapeKey } from '../../hooks/useEscapeKey'
import { intlLocale, useT, type Key } from '../../i18n'

export interface DirectoryServer {
  id: string
  name: string
  icon: string | null
  banner: string | null
  description: string | null
  member_count: number
  online_count?: number
  activity?: number
  invite_code: string | null
  tags: string[] | null
  category: string | null
  created_at?: string
}

interface Profile extends DirectoryServer { channel_count: number; upcoming_events: number }

export default function ServerProfileModal({ serverId, onClose, onJoin, joining, onTag }: {
  serverId: string
  onClose: () => void
  onJoin: (s: DirectoryServer) => void
  joining: boolean
  onTag: (tag: string) => void
}) {
  const t = useT()
  useEscapeKey(onClose)
  const { data: s } = useQuery<Profile>({
    queryKey: ['explore_profile', serverId],
    queryFn: () => api.get(`/explore/${serverId}`).then(r => r.data),
  })
  const fmt = (n: number | undefined) => (n ?? 0).toLocaleString(intlLocale())
  return (
    <div className="fixed inset-0 bg-black/70 flex items-center justify-center z-50 p-4" onClick={onClose} role="dialog" aria-modal="true" aria-label={s?.name ?? t('common.loading')}>
      <div className="bg-fc-channel rounded-2xl w-full max-w-lg max-h-[90dvh] overflow-y-auto shadow-2xl" onClick={e => e.stopPropagation()}>
        <div className="relative h-32 bg-gradient-to-br from-fc-bg to-fc-accent/40">
          {s?.banner && <img src={mediaUrl(s.banner)} alt="" className="w-full h-full object-cover" />}
          <button onClick={onClose} aria-label={t('common.close')} className="absolute top-2 right-2 p-2 rounded-full bg-black/40 text-white"><X size={16} /></button>
          <div className="absolute -bottom-8 left-5 w-16 h-16 rounded-2xl bg-fc-bg border-4 border-fc-channel overflow-hidden flex items-center justify-center text-2xl font-bold text-white">
            {s?.icon ? <img src={mediaUrl(s.icon)} alt="" className="w-full h-full object-cover" /> : s?.name[0]?.toUpperCase()}
          </div>
        </div>
        {s ? (
          <div className="p-5 pt-11 space-y-4">
            <div>
              <h2 className="text-xl font-bold text-white">{s.name}</h2>
              {s.category && <span className="text-xs text-fc-accent">{t(`community.directory.cat.${s.category}` as Key)}</span>}
            </div>
            {s.description && <p className="text-sm text-fc-text whitespace-pre-wrap break-words">{s.description}</p>}
            {!!s.tags?.length && (
              <div className="flex flex-wrap gap-1.5">
                {s.tags.map(tag => (
                  <button key={tag} onClick={() => { onTag(tag); onClose() }} className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs bg-fc-accent/15 text-fc-accent">
                    <Tag size={10} aria-hidden />{tag}
                  </button>
                ))}
              </div>
            )}
            <dl className="grid grid-cols-2 gap-2 text-sm">
              <div className="p-3 bg-fc-input rounded-lg"><dt className="text-fc-muted text-xs flex items-center gap-1"><Users size={11} />{t('community.directory.members')}</dt><dd className="text-white font-semibold">{fmt(s.member_count)} · {t('community.directory.online', { n: fmt(s.online_count) })}</dd></div>
              <div className="p-3 bg-fc-input rounded-lg"><dt className="text-fc-muted text-xs flex items-center gap-1"><Activity size={11} />{t('community.directory.activity')}</dt><dd className="text-white font-semibold">{t('community.directory.activityValue', { n: fmt(s.activity) })}</dd></div>
              <div className="p-3 bg-fc-input rounded-lg"><dt className="text-fc-muted text-xs flex items-center gap-1"><Hash size={11} />{t('community.directory.channels')}</dt><dd className="text-white font-semibold">{fmt(s.channel_count)}</dd></div>
              <div className="p-3 bg-fc-input rounded-lg"><dt className="text-fc-muted text-xs flex items-center gap-1"><Calendar size={11} />{t('community.directory.events')}</dt><dd className="text-white font-semibold">{fmt(s.upcoming_events)}</dd></div>
            </dl>
            {s.created_at && <p className="text-xs text-fc-muted">{t('community.directory.since', { date: new Date(s.created_at).toLocaleDateString(intlLocale()) })}</p>}
            <button onClick={() => onJoin(s)} disabled={joining || !s.invite_code}
              className="w-full py-2.5 bg-fc-accent hover:bg-indigo-500 text-white rounded-lg font-semibold disabled:opacity-50">
              {t('community.directory.join')}
            </button>
          </div>
        ) : (
          <div className="p-10 text-center text-fc-muted text-sm">{t('common.loading')}</div>
        )}
      </div>
    </div>
  )
}
