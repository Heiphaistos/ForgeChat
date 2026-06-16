import { useEffect, useRef } from 'react'
import {
  Mic, MicOff, Video, VideoOff, PhoneOff,
  Monitor, Volume2, Users, AlertCircle,
} from 'lucide-react'
import { useWebRTC, VoicePeer } from '../hooks/useWebRTC'
import { useAuth } from '../store/auth'

interface Props {
  channel: { id: string; name: string; type: string }
  serverId: string
}

// Composant d'une tuile vidéo
function VideoTile({
  stream,
  muted = false,
  label,
  avatar,
  isLocal = false,
  audioEnabled = true,
  videoEnabled = false,
}: {
  stream: MediaStream | null
  muted?: boolean
  label: string
  avatar?: string
  isLocal?: boolean
  audioEnabled?: boolean
  videoEnabled?: boolean
}) {
  const videoRef = useRef<HTMLVideoElement>(null)

  useEffect(() => {
    if (videoRef.current && stream) {
      videoRef.current.srcObject = stream
    }
  }, [stream])

  const hasVideo = videoEnabled && stream && stream.getVideoTracks().some(t => t.enabled && !t.muted)

  return (
    <div className={`relative rounded-xl overflow-hidden bg-gray-900 border-2 flex flex-col items-center justify-center aspect-video
      ${isLocal ? 'border-fc-accent' : 'border-white/10'}`}>
      {hasVideo ? (
        <video
          ref={videoRef}
          autoPlay
          playsInline
          muted={muted}
          className="w-full h-full object-cover"
        />
      ) : (
        <div className="flex flex-col items-center gap-2">
          {avatar ? (
            <img src={avatar} alt="" className="w-16 h-16 rounded-full object-cover border-2 border-fc-accent" />
          ) : (
            <div className="w-16 h-16 rounded-full bg-fc-accent flex items-center justify-center text-2xl font-bold text-white border-2 border-white/20">
              {label.charAt(0).toUpperCase()}
            </div>
          )}
          <span className="text-white text-sm font-medium">{label}</span>
        </div>
      )}

      {/* Indicateurs en bas de la tuile */}
      <div className="absolute bottom-2 left-2 right-2 flex items-center justify-between">
        <div className="flex items-center gap-1 bg-black/60 backdrop-blur-sm rounded px-2 py-0.5">
          {!audioEnabled && <MicOff size={12} className="text-red-400" />}
          <span className="text-xs text-white font-medium truncate max-w-[120px]">
            {isLocal ? `${label} (Vous)` : label}
          </span>
        </div>
        {!audioEnabled && (
          <div className="bg-red-500/80 rounded p-0.5">
            <MicOff size={12} className="text-white" />
          </div>
        )}
      </div>

      {isLocal && (
        <div className="absolute top-2 right-2 bg-fc-accent text-white text-xs px-2 py-0.5 rounded-full font-medium">
          Vous
        </div>
      )}
    </div>
  )
}

// Contrôles flottants
function Controls({
  audioEnabled,
  videoEnabled,
  onToggleAudio,
  onToggleVideo,
  onShareScreen,
  onLeave,
}: {
  audioEnabled: boolean
  videoEnabled: boolean
  onToggleAudio: () => void
  onToggleVideo: () => void
  onShareScreen: () => void
  onLeave: () => void
}) {
  return (
    <div className="flex items-center gap-2 px-4 py-3 bg-gray-950/90 backdrop-blur-sm border-t border-white/5">
      <button
        onClick={onToggleAudio}
        title={audioEnabled ? 'Couper le micro' : 'Activer le micro'}
        className={`p-3 rounded-full transition-all ${
          audioEnabled
            ? 'bg-white/10 hover:bg-white/20 text-white'
            : 'bg-red-500 hover:bg-red-600 text-white'
        }`}
      >
        {audioEnabled ? <Mic size={20} /> : <MicOff size={20} />}
      </button>

      <button
        onClick={onToggleVideo}
        title={videoEnabled ? 'Désactiver la caméra' : 'Activer la caméra'}
        className={`p-3 rounded-full transition-all ${
          videoEnabled
            ? 'bg-white/10 hover:bg-white/20 text-white'
            : 'bg-red-500 hover:bg-red-600 text-white'
        }`}
      >
        {videoEnabled ? <Video size={20} /> : <VideoOff size={20} />}
      </button>

      <button
        onClick={onShareScreen}
        title="Partager l'écran"
        className="p-3 rounded-full bg-white/10 hover:bg-white/20 text-white transition"
      >
        <Monitor size={20} />
      </button>

      <div className="flex-1" />

      <button
        onClick={onLeave}
        title="Quitter"
        className="px-5 py-2.5 rounded-full bg-red-500 hover:bg-red-600 text-white font-semibold transition flex items-center gap-2"
      >
        <PhoneOff size={18} />
        <span className="text-sm">Quitter</span>
      </button>
    </div>
  )
}

export default function VoiceVideoPage({ channel }: Props) {
  const { user } = useAuth()
  const {
    joined, peers, localStream, audioEnabled, videoEnabled, error,
    join, leave, toggleAudio, toggleVideo, shareScreen,
  } = useWebRTC(channel.id)

  const isVideo = channel.type === 'video'

  // Vue "salle d'attente" avant de rejoindre
  if (!joined) {
    return (
      <div className="flex flex-col h-full bg-gray-950">
        {/* Header */}
        <div className="flex items-center gap-2 px-4 py-2.5 border-b border-white/10 flex-shrink-0 min-h-[48px] bg-fc-bg">
          {isVideo ? <Video size={18} className="text-purple-400" /> : <Volume2 size={18} className="text-blue-400" />}
          <span className="font-semibold text-white">{channel.name}</span>
          <span className={`text-xs px-2 py-0.5 rounded-full font-medium ml-1
            ${isVideo ? 'bg-purple-500/20 text-purple-400' : 'bg-blue-500/20 text-blue-400'}`}>
            {isVideo ? 'Vidéo' : 'Vocal'}
          </span>
        </div>

        <div className="flex-1 flex flex-col items-center justify-center p-8 gap-6">
          <div className={`w-24 h-24 rounded-full flex items-center justify-center
            ${isVideo ? 'bg-purple-500/20' : 'bg-blue-500/20'}`}>
            {isVideo ? <Video size={44} className="text-purple-400" /> : <Volume2 size={44} className="text-blue-400" />}
          </div>

          <div className="text-center">
            <h2 className="text-2xl font-bold text-white mb-2">{channel.name}</h2>
            <p className="text-fc-muted text-sm">
              {peers.length === 0
                ? 'Aucun participant — rejoignez le premier !'
                : `${peers.length} participant(s) dans le canal`}
            </p>
          </div>

          {error && (
            <div className="flex items-center gap-2 bg-red-500/10 border border-red-500/20 rounded-lg px-4 py-2.5 text-red-400 text-sm max-w-sm text-center">
              <AlertCircle size={16} className="flex-shrink-0" />
              {error}
            </div>
          )}

          <div className="flex flex-col gap-3 w-full max-w-xs">
            <button
              onClick={() => join(false)}
              className="flex items-center justify-center gap-2 px-6 py-3 bg-blue-600 hover:bg-blue-500 text-white rounded-xl font-semibold transition"
            >
              <Mic size={18} />
              Rejoindre (audio uniquement)
            </button>
            <button
              onClick={() => join(true)}
              className={`flex items-center justify-center gap-2 px-6 py-3 rounded-xl font-semibold transition text-white
                ${isVideo ? 'bg-purple-600 hover:bg-purple-500' : 'bg-white/10 hover:bg-white/20'}`}
            >
              <Video size={18} />
              Rejoindre avec caméra
            </button>
          </div>
        </div>
      </div>
    )
  }

  // Vue "dans le canal"
  const allParticipants = [
    {
      userId: user?.id ?? '',
      username: user?.username ?? '',
      avatar: user?.avatar,
      stream: localStream,
      audioEnabled,
      videoEnabled,
      isLocal: true,
    },
    ...peers.map((p: VoicePeer) => ({ ...p, isLocal: false })),
  ]

  const gridCols = allParticipants.length <= 1
    ? 'grid-cols-1 max-w-lg mx-auto'
    : allParticipants.length <= 2
    ? 'grid-cols-2'
    : allParticipants.length <= 4
    ? 'grid-cols-2'
    : 'grid-cols-3'

  return (
    <div className="flex flex-col h-full bg-gray-950">
      {/* Header */}
      <div className="flex items-center gap-2 px-4 py-2.5 border-b border-white/10 flex-shrink-0 min-h-[48px] bg-fc-bg">
        {isVideo ? <Video size={18} className="text-purple-400" /> : <Volume2 size={18} className="text-blue-400" />}
        <span className="font-semibold text-white">{channel.name}</span>
        <div className="flex items-center gap-1.5 ml-2">
          <div className="w-2 h-2 rounded-full bg-fc-green animate-pulse" />
          <span className="text-xs text-fc-muted">{allParticipants.length} connecté(s)</span>
        </div>
      </div>

      {/* Grille des participants */}
      <div className={`flex-1 overflow-y-auto p-4 grid ${gridCols} gap-3 content-start`}>
        {allParticipants.map(p => (
          <VideoTile
            key={p.userId}
            stream={p.stream}
            muted={p.isLocal}
            label={p.username}
            avatar={p.avatar}
            isLocal={p.isLocal}
            audioEnabled={p.isLocal ? audioEnabled : p.audioEnabled}
            videoEnabled={p.isLocal ? videoEnabled : p.videoEnabled}
          />
        ))}
      </div>

      {/* Barre de contrôles */}
      <Controls
        audioEnabled={audioEnabled}
        videoEnabled={videoEnabled}
        onToggleAudio={toggleAudio}
        onToggleVideo={toggleVideo}
        onShareScreen={shareScreen}
        onLeave={leave}
      />
    </div>
  )
}
