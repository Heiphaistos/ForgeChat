// Bandeau « Tu as raté N messages — Résumer » : résumé extractif des non-lus calculé
// sur l'appareil (src/ai/summary.ts), sans modèle ni réseau. Clic sur un extrait =
// saut vers le message.
import { useMemo, useState } from 'react'
import { Sparkles, X } from 'lucide-react'
import { useT } from '../../i18n'
import { useAiSettings } from '../../ai/engine'
import { summarize } from '../../ai/summary'
import type { ChatMessage } from '../../store/chat'

const MIN_UNREAD = 5

interface Props { messages: ChatMessage[]; fromId: string | null; meId?: string }

export default function UnreadSummary({ messages, fromId, meId }: Props) {
  const t = useT()
  const enabled = useAiSettings(s => s.summary)
  const [open, setOpen] = useState(false)
  const [closedFor, setClosedFor] = useState<string | null>(null)
  const idx = fromId ? messages.findIndex(m => m.id === fromId) : -1
  const unread = idx >= 0 ? messages.slice(idx) : []
  const summary = useMemo(() => open ? summarize(unread.map(m => ({
    id: m.id,
    author: m.author_username,
    text: m.e2e === 'locked' ? '' : m.content ?? '',
    reactions: m.reactions?.reduce((n, r) => n + r.count, 0) ?? 0,
    mentionsMe: !!meId && !!m.content?.includes(`<@${meId}>`),
    attachments: m.attachments?.length ?? 0,
  }))) : null, [open, unread.length, fromId])

  if (!enabled || unread.length < MIN_UNREAD || closedFor === fromId) return null
  const jump = (id: string) => document.getElementById(`msg-${id}`)?.scrollIntoView({ block: 'center', behavior: 'smooth' })

  return (
    <div className="absolute top-2 left-1/2 -translate-x-1/2 z-20 w-[min(92%,36rem)] rounded-lg border border-fc-hover bg-fc-channel/95 shadow-lg backdrop-blur-sm text-sm">
      <div className="flex items-center gap-2 px-3 py-2">
        <Sparkles size={14} className="text-fc-accent flex-shrink-0" aria-hidden />
        <span className="flex-1 truncate text-fc-text">{t('ai.summary.missed', { n: unread.length })}</span>
        {!open && (
          <button type="button" onClick={() => setOpen(true)} className="px-2 py-1 rounded bg-fc-accent/15 text-fc-accent text-xs font-medium hover:bg-fc-accent/25">
            {t('ai.summary')}
          </button>
        )}
        <button type="button" onClick={() => setClosedFor(fromId)} aria-label={t('ai.summary.close')} className="p-1 rounded text-fc-muted hover:text-white hover:bg-fc-hover">
          <X size={14} aria-hidden />
        </button>
      </div>
      {open && summary && (
        <div className="px-3 pb-3 space-y-2 max-h-72 overflow-y-auto">
          <p className="text-xs text-fc-muted">
            {t('ai.summary.from', { names: summary.authors.slice(0, 4).map(a => `${a.name} (${a.count})`).join(', ') })}
            {summary.keywords.length > 0 && <> · {t('ai.summary.topics', { words: summary.keywords.join(', ') })}</>}
          </p>
          {summary.highlights.length === 0 ? (
            <p className="text-xs text-fc-muted">{t('ai.summary.empty')}</p>
          ) : (
            <ul className="space-y-1">
              {summary.highlights.map(h => (
                <li key={h.id}>
                  <button type="button" onClick={() => jump(h.id)} className="w-full text-left px-2 py-1 rounded hover:bg-fc-hover">
                    <span className="font-medium text-fc-text">{h.author}</span>
                    <span className="text-fc-muted"> — {h.text}</span>
                  </button>
                </li>
              ))}
            </ul>
          )}
        </div>
      )}
    </div>
  )
}
