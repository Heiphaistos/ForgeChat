import { Eye, Radio, X } from 'lucide-react'
import { useVoice } from '../../store/voice'
import { useNavigate, useParams } from 'react-router-dom'

interface ActiveStream {
  userId: string
  username: string
  channelId: string
}

interface GoLivePanelProps {
  /** Affichage dans la sidebar : streams actifs d'un canal donné */
  channelId?: string
  /** Affichage dans la tuile streamer (VoiceVideoPage) */
  isStreamer?: boolean
  /** Nombre de spectateurs (participants - 1) */
  spectatorCount?: number
  onStopStream?: () => void
}

/** Badge pulsant LIVE affiché sur la tuile du streamer */
export function LiveBadge({ spectatorCount, onStop }: { spectatorCount: number; onStop?: () => void }) {
  return (
    <div className="absolute top-2 right-2 flex items-center gap-1.5 z-10">
      <div className="flex items-center gap-1 bg-red-600 rounded-full px-2 py-0.5 shadow-lg animate-pulse">
        <span className="w-1.5 h-1.5 bg-white rounded-full" />
        <span className="text-white text-[10px] font-bold tracking-wide">LIVE</span>
      </div>
      {spectatorCount > 0 && (
        <div className="flex items-center gap-0.5 bg-black/60 rounded-full px-1.5 py-0.5">
          <Eye size={9} className="text-white/80" />
          <span className="text-white text-[10px] font-semibold">{spectatorCount}</span>
        </div>
      )}
      {onStop && (
        <button
          onClick={onStop}
          className="p-0.5 rounded-full bg-black/60 hover:bg-red-600/80 text-white/70 hover:text-white transition"
          title="Arrêter le stream"
        >
          <X size={10} />
        </button>
      )}
    </div>
  )
}

/** Entrée de stream sous un canal vocal dans la sidebar */
export function SidebarStreamEntry({ stream }: { stream: ActiveStream }) {
  const nav = useNavigate()
  const { serverId } = useParams()

  return (
    <button
      onClick={() => nav(`/servers/${serverId}/channels/${stream.channelId}`)}
      className="ml-5 mb-1 flex items-center gap-1.5 px-2 py-1 rounded hover:bg-fc-hover/60 w-full text-left group transition"
      title={`Rejoindre le live de ${stream.username}`}
    >
      <span className="flex items-center gap-1 text-red-400 flex-shrink-0">
        <Radio size={9} className="animate-pulse" />
        <span className="text-[10px] font-bold">LIVE</span>
      </span>
      <span className="text-[11px] text-fc-text truncate flex-1">
        {stream.username} est en live
      </span>
    </button>
  )
}

/** Panel Go Live complet (non utilisé directement, logique dans les composants) */
export default function GoLivePanel({ channelId, isStreamer, spectatorCount = 0, onStopStream }: GoLivePanelProps) {
  const activeStreams = useVoice(s => s.activeStreams)

  if (isStreamer) {
    return (
      <LiveBadge spectatorCount={spectatorCount} onStop={onStopStream} />
    )
  }

  if (!channelId) return null

  const streams = Object.values(activeStreams).filter(s => s.channelId === channelId)
  if (streams.length === 0) return null

  return (
    <div>
      {streams.map(s => (
        <SidebarStreamEntry key={s.userId} stream={s} />
      ))}
    </div>
  )
}
