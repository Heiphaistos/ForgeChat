import { Mic, MicOff, Headphones, VolumeX, Video, VideoOff, Monitor, MonitorOff, PhoneOff, Volume2 } from 'lucide-react'
import { useNavigate } from 'react-router-dom'
import { useVoice } from '../../store/voice'
import { useVoiceActivity } from '../../hooks/useVoiceActivity'

export default function VoiceBar() {
  const nav = useNavigate()
  const {
    joined, channelId, channelName, serverId,
    muted, deafened, videoEnabled, screenSharing, localStream,
    toggleMute, toggleDeafen, toggleVideo, shareScreen, stopScreenShare, leave,
  } = useVoice()

  const speaking = useVoiceActivity(joined ? localStream : null, !muted)

  if (!joined) return null

  const goToChannel = () => {
    if (serverId && channelId) nav(`/servers/${serverId}/channels/${channelId}`)
  }

  return (
    <div className="bg-[#232629] border-t border-black/40 flex-shrink-0">
      {/* Bandeau connecté */}
      <div className="flex items-center gap-2 px-3 pt-2 pb-1">
        <div className={`w-2.5 h-2.5 rounded-full flex-shrink-0 transition-colors ${speaking ? 'bg-green-400' : 'bg-green-600'}`} />
        <div className="flex-1 min-w-0">
          <div className="text-xs font-semibold text-green-400 leading-tight">Vocal connecté</div>
          <button
            onClick={goToChannel}
            className="text-[11px] text-fc-muted hover:text-white transition truncate block max-w-full text-left"
          >
            <Volume2 size={10} className="inline mr-0.5 -mt-0.5" />
            {channelName ?? 'retour au canal'}
          </button>
        </div>
        {/* Quitter */}
        <button
          onClick={leave}
          title="Quitter le vocal"
          className="p-1 rounded hover:bg-red-500/20 text-fc-muted hover:text-red-400 transition flex-shrink-0"
        >
          <PhoneOff size={14} />
        </button>
      </div>

      {/* Contrôles rapides */}
      <div className="flex items-center px-1 pb-1.5 gap-0.5">
        <VoiceBarBtn
          active={!muted}
          activeIcon={<Mic size={14} />}
          inactiveIcon={<MicOff size={14} />}
          onClick={toggleMute}
          danger={muted}
          title={muted ? 'Réactiver le micro' : 'Couper le micro'}
        />
        <VoiceBarBtn
          active={!deafened}
          activeIcon={<Headphones size={14} />}
          inactiveIcon={<VolumeX size={14} />}
          onClick={toggleDeafen}
          danger={deafened}
          title={deafened ? 'Réactiver le son' : 'Couper le son'}
        />
        <VoiceBarBtn
          active={videoEnabled && !screenSharing}
          activeIcon={<Video size={14} />}
          inactiveIcon={<VideoOff size={14} />}
          onClick={() => toggleVideo()}
          title={videoEnabled ? 'Désactiver la caméra' : 'Activer la caméra'}
        />
        <VoiceBarBtn
          active={screenSharing}
          activeIcon={<Monitor size={14} />}
          inactiveIcon={<MonitorOff size={14} />}
          onClick={screenSharing ? stopScreenShare : shareScreen}
          accent={screenSharing}
          title={screenSharing ? 'Arrêter le partage' : 'Partager l\'écran'}
        />
      </div>
    </div>
  )
}

function VoiceBarBtn({
  active, activeIcon, inactiveIcon, onClick, danger = false, accent = false, title,
}: {
  active: boolean
  activeIcon: React.ReactNode
  inactiveIcon: React.ReactNode
  onClick: () => void
  danger?: boolean
  accent?: boolean
  title?: string
}) {
  const base = 'flex-1 flex items-center justify-center p-1.5 rounded transition'
  const cls = danger
    ? `${base} text-red-400 hover:bg-red-500/20`
    : accent
    ? `${base} text-green-400 hover:bg-green-500/20`
    : active
    ? `${base} text-fc-muted hover:bg-fc-hover hover:text-white`
    : `${base} text-fc-muted/50 hover:bg-fc-hover hover:text-white`

  return (
    <button className={cls} onClick={onClick} title={title}>
      {active ? activeIcon : inactiveIcon}
    </button>
  )
}
