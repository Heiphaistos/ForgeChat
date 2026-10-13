import { BarChart3 } from 'lucide-react'
import { useT } from '../../i18n'
import { tally, voteToggles, type EncPoll, type Reaction } from '../../lib/encPoll'

/** Sondage chiffré (amélioration n° 35) : votes = réactions 1️⃣…🔟 sur le message. */
export default function EncryptedPoll({ poll, reactions, onToggle }: { poll: EncPoll; reactions: Reaction[] | undefined; onToggle: (emoji: string) => void }) {
  const t = useT()
  const { counts, mine, total } = tally(poll, reactions)
  return (
    <div className="mt-1 rounded-lg border border-fc-hover bg-fc-channel p-3 max-w-md">
      <div className="flex items-center gap-2 text-white font-medium text-sm mb-2">
        <BarChart3 size={16} className="text-fc-accent" aria-hidden /> {poll.q}
      </div>
      <ul className="space-y-1.5">
        {poll.o.map((label, i) => {
          const pct = total ? Math.round((counts[i] / total) * 100) : 0
          return (
            <li key={i}>
              <button type="button" aria-pressed={mine[i]} onClick={() => voteToggles(poll, mine, i).forEach(onToggle)}
                className={`relative w-full text-left rounded px-2 py-1.5 text-sm overflow-hidden border ${mine[i] ? 'border-fc-accent' : 'border-fc-hover'}`}>
                <span className="absolute inset-y-0 left-0 bg-fc-accent/20" style={{ width: `${pct}%` }} aria-hidden />
                <span className="relative flex justify-between gap-2 text-fc-text">
                  <span>{label}</span><span className="text-fc-muted">{counts[i]} · {pct} %</span>
                </span>
              </button>
            </li>
          )
        })}
      </ul>
      <p className="text-[11px] text-fc-muted mt-2">{t(poll.m ? 'encpoll.multi' : 'encpoll.single')} · {t('encpoll.private')}</p>
    </div>
  )
}
