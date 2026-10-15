import { Eye, X } from 'lucide-react'
import { useLocalNotices } from '../../store/localNotices'
import { useT } from '../../i18n'

const NONE: never[] = []

/** Réponses éphémères de commandes : message système local, visible de moi seul. */
export default function LocalNotices({ channelId }: { channelId: string }) {
  const t = useT()
  const notices = useLocalNotices(s => s.byChannel[channelId]) ?? NONE
  const dismiss = useLocalNotices(s => s.dismiss)
  if (notices.length === 0) return null
  return (
    <div className="mx-4 mb-2 space-y-1.5 max-h-48 overflow-y-auto" role="log" aria-live="polite" aria-label={t('cmd.local.region')}>
      {notices.map(n => (
        <div key={n.id} className="flex items-start gap-2 px-3 py-2 rounded-lg bg-fc-input/60 border-l-2 border-fc-accent text-sm text-fc-text">
          <Eye size={14} className="mt-0.5 flex-shrink-0 text-fc-accent" aria-hidden />
          <div className="min-w-0 flex-1">
            <div className="text-[11px] text-fc-muted">{t('cmd.local.onlyYou', { cmd: n.command })}</div>
            <div className="whitespace-pre-wrap break-words">{n.content}</div>
          </div>
          <button type="button" onClick={() => dismiss(channelId, n.id)} aria-label={t('common.close')}
            className="p-1 text-fc-muted hover:text-white flex-shrink-0">
            <X size={14} aria-hidden />
          </button>
        </div>
      ))}
    </div>
  )
}
