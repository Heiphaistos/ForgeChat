import { Check, X } from 'lucide-react'
import { useT } from '../../i18n'
import { PERM, useServerPerms } from '../../hooks/useServerPerms'
import { useVoice } from '../../store/voice'
import { admitWaiting, useVoiceWaiting } from '../../store/voiceWaiting'

/** Salle d'attente : bandeau pour celui qui attend, liste « Faire entrer / Refuser » pour les modérateurs. */
export default function WaitingRoomPanel({ serverId, channelId }: { serverId: string; channelId: string }) {
  const t = useT()
  const waitingIn = useVoiceWaiting(s => s.waitingIn)
  const queue = useVoiceWaiting(s => s.queues[channelId]) ?? []
  const joined = useVoice(s => s.joined && s.channelId === channelId)
  const { has } = useServerPerms(serverId)

  if (joined && waitingIn === channelId) {
    return (
      <div role="status" className="px-3 py-2 bg-amber-500/90 text-black text-sm font-medium">
        ⏳ {t('voiceLot.waiting.self')}
      </div>
    )
  }
  if (!joined || !queue.length || !has(PERM.MOVE_MEMBERS)) return null
  return (
    <div className="px-3 py-2 bg-fc-sidebar border-b border-fc-hover space-y-1">
      <div className="text-xs font-semibold text-fc-muted uppercase">{t('voiceLot.waiting.title', { n: queue.length })}</div>
      {queue.map(u => (
        <div key={u.user_id} className="flex items-center gap-2 text-sm text-white">
          <span className="flex-1 truncate">{u.username}</span>
          <button onClick={() => admitWaiting(channelId, u.user_id, true)} aria-label={t('voiceLot.waiting.admit', { name: u.username })}
            className="flex items-center gap-1 px-2 py-0.5 rounded bg-fc-green/80 hover:bg-fc-green text-white text-xs">
            <Check size={12} aria-hidden /> {t('voiceLot.waiting.admitShort')}
          </button>
          <button onClick={() => admitWaiting(channelId, u.user_id, false)} aria-label={t('voiceLot.waiting.deny', { name: u.username })}
            className="flex items-center gap-1 px-2 py-0.5 rounded bg-fc-hover hover:bg-fc-red text-white text-xs">
            <X size={12} aria-hidden /> {t('voiceLot.waiting.denyShort')}
          </button>
        </div>
      ))}
    </div>
  )
}
