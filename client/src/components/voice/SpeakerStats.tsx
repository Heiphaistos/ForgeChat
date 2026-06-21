import { useMemo } from 'react'
import { Mic, MicOff, Volume2 } from 'lucide-react'

interface Participant {
  userId: string
  username: string
  avatar?: string
  audioLevel: number // 0.0–1.0
  isMuted: boolean
  isSpeaking: boolean
  totalSpeakingMs: number
}

interface Props {
  participants: Participant[]
  onClose: () => void
}

function formatDuration(ms: number) {
  const s = Math.floor(ms / 1000)
  const m = Math.floor(s / 60)
  if (m > 0) return `${m}m ${s % 60}s`
  return `${s}s`
}

function Avatar({ participant }: { participant: Participant }) {
  return (
    <div className="w-8 h-8 rounded-full bg-fc-accent flex items-center justify-center text-sm font-bold text-white overflow-hidden flex-shrink-0">
      {participant.avatar
        ? <img src={participant.avatar} alt="" className="w-full h-full object-cover" />
        : participant.username.charAt(0).toUpperCase()}
    </div>
  )
}

export default function SpeakerStats({ participants, onClose }: Props) {
  const sorted = useMemo(
    () => [...participants].sort((a, b) => b.totalSpeakingMs - a.totalSpeakingMs),
    [participants]
  )

  const maxMs = sorted[0]?.totalSpeakingMs || 1

  return (
    <div className="absolute bottom-20 right-4 w-72 bg-fc-sidebar/95 backdrop-blur-sm rounded-2xl border border-fc-hover shadow-xl overflow-hidden">
      <div className="flex items-center justify-between px-4 py-3 border-b border-fc-hover">
        <div className="flex items-center gap-2 text-sm font-semibold text-white">
          <Volume2 size={14} className="text-fc-accent" /> Statistiques orateurs
        </div>
        <button onClick={onClose} className="text-fc-muted hover:text-white transition text-xs">✕</button>
      </div>

      <div className="p-3 space-y-2 max-h-72 overflow-y-auto">
        {sorted.length === 0 ? (
          <p className="text-center text-fc-muted text-sm py-4">Aucun participant</p>
        ) : sorted.map((p, idx) => (
          <div key={p.userId} className="space-y-1">
            <div className="flex items-center gap-2">
              <span className="text-xs text-fc-muted w-4 text-right">{idx + 1}</span>
              <Avatar participant={p} />
              <div className="flex-1 min-w-0">
                <div className="flex items-center justify-between">
                  <span className={`text-sm font-medium truncate ${p.isSpeaking ? 'text-fc-green' : 'text-white'}`}>
                    {p.username}
                  </span>
                  <div className="flex items-center gap-1.5 flex-shrink-0">
                    {p.isMuted
                      ? <MicOff size={12} className="text-fc-red" />
                      : <Mic size={12} className={p.isSpeaking ? 'text-fc-green' : 'text-fc-muted'} />}
                    <span className="text-xs text-fc-muted">{formatDuration(p.totalSpeakingMs)}</span>
                  </div>
                </div>
              </div>
            </div>

            {/* Barre de durée */}
            <div className="ml-10 h-1 bg-fc-hover rounded-full overflow-hidden">
              <div
                className={`h-full rounded-full transition-all ${p.isSpeaking ? 'bg-fc-green' : 'bg-fc-accent/60'}`}
                style={{ width: `${(p.totalSpeakingMs / maxMs) * 100}%` }}
              />
            </div>

            {/* Niveau audio en temps réel */}
            {p.isSpeaking && !p.isMuted && (
              <div className="ml-10 flex gap-0.5 items-end h-3">
                {Array.from({ length: 12 }).map((_, i) => (
                  <div
                    key={i}
                    className="w-1 rounded-full bg-fc-green transition-all"
                    style={{
                      height: `${Math.min(100, (p.audioLevel * 100) * (1 - i / 18 + Math.random() * 0.3))}%`,
                      opacity: i / 12 > p.audioLevel ? 0.3 : 1,
                    }}
                  />
                ))}
              </div>
            )}
          </div>
        ))}
      </div>

      <div className="px-4 py-2 border-t border-fc-hover text-xs text-fc-muted text-center">
        {participants.filter(p => p.isSpeaking).length} / {participants.length} participants actifs
      </div>
    </div>
  )
}
