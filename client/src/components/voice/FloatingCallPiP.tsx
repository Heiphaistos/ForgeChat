import { useLocation, useNavigate } from 'react-router-dom'
import { Mic, MicOff, Video, VideoOff, PhoneOff, Maximize2 } from 'lucide-react'
import { useVoice } from '../../store/voice'
import { useCallStore } from '../../store/call'

/**
 * Mini-fenêtre vidéo flottante façon Discord : visible quand un appel vidéo (salon
 * vocal serveur ou appel DM) est actif mais qu'on n'est PAS sur sa page — sinon
 * l'appel devenait invisible dès qu'on naviguait ailleurs (Paramètres, un autre
 * canal...), même si le son continuait de jouer (voir PersistentVoiceAudio /
 * PersistentDmCallAudio). Rien à afficher si l'appel est audio-only : le son seul
 * suffit, pas besoin d'un encart visuel vide.
 */
export default function FloatingCallPiP() {
  const location = useLocation()
  const nav = useNavigate()

  // ── Salon vocal serveur ──────────────────────────────────────────────────
  const voiceJoined = useVoice(s => s.joined)
  const voiceChannelId = useVoice(s => s.channelId)
  const voiceServerId = useVoice(s => s.serverId)
  const voiceChannelName = useVoice(s => s.channelName)
  const voicePeers = useVoice(s => s.peers)
  const voiceLocalStream = useVoice(s => s.localStream)
  const voiceLocalScreenStream = useVoice(s => s.localScreenStream)
  const voiceVideoEnabled = useVoice(s => s.videoEnabled)
  const voiceScreenSharing = useVoice(s => s.screenSharing)
  const voiceMuted = useVoice(s => s.muted)
  const toggleVoiceMute = useVoice(s => s.toggleMute)
  const toggleVoiceVideo = useVoice(s => s.toggleVideo)
  const leaveVoice = useVoice(s => s.leave)

  // ── Appel DM ──────────────────────────────────────────────────────────────
  const dmCallState = useCallStore(s => s.callState)
  const dmId = useCallStore(s => s.dmId)
  const dmCallType = useCallStore(s => s.callType)
  const dmLocalStream = useCallStore(s => s.localStream)
  const dmRemoteStream = useCallStore(s => s.remoteStream)
  const dmMicMuted = useCallStore(s => s.micMuted)
  const dmCamOff = useCallStore(s => s.camOff)
  const toggleDmMic = useCallStore(s => s.toggleMic)
  const toggleDmCam = useCallStore(s => s.toggleCam)
  const hangupDm = useCallStore(s => s.hangup)

  const onDmPage = dmCallState !== 'idle' && location.pathname === `/dms/${dmId}`
  const onVoicePage = voiceJoined && location.pathname === `/servers/${voiceServerId}/channels/${voiceChannelId}`

  // Priorité à l'appel DM s'il est actif et pas affiché (un seul à la fois possible
  // côté DM ; le vocal serveur peut coexister mais l'appel DM est plus "urgent")
  if (dmCallState !== 'idle' && !onDmPage) {
    if (dmCallType !== 'video') return null // audio-only : le son suffit, pas de PiP
    const stream = dmRemoteStream ?? dmLocalStream
    return (
      <Widget
        stream={stream}
        label="Appel vidéo"
        onExpand={() => nav(`/dms/${dmId}`)}
        micMuted={dmMicMuted}
        onToggleMic={toggleDmMic}
        videoEnabled={!dmCamOff}
        onToggleVideo={toggleDmCam}
        onHangup={hangupDm}
      />
    )
  }

  if (voiceJoined && !onVoicePage) {
    const hasAnyVideo = voiceVideoEnabled || voiceScreenSharing
      || voicePeers.some(p => p.videoEnabled || p.screenSharing)
    if (!hasAnyVideo) return null
    const screenPeer = voicePeers.find(p => p.screenSharing && p.screenStream)
    const stream = voiceScreenSharing && voiceLocalScreenStream
      ? voiceLocalScreenStream
      : screenPeer?.screenStream
        ?? (voiceVideoEnabled ? voiceLocalStream : voicePeers.find(p => p.videoEnabled && p.stream)?.stream)
        ?? null
    return (
      <Widget
        stream={stream}
        label={voiceChannelName ?? 'Salon vocal'}
        onExpand={() => { if (voiceServerId && voiceChannelId) nav(`/servers/${voiceServerId}/channels/${voiceChannelId}`) }}
        micMuted={voiceMuted}
        onToggleMic={toggleVoiceMute}
        videoEnabled={voiceVideoEnabled}
        onToggleVideo={() => toggleVoiceVideo()}
        onHangup={leaveVoice}
      />
    )
  }

  return null
}

function Widget({
  stream, label, onExpand, micMuted, onToggleMic, videoEnabled, onToggleVideo, onHangup,
}: {
  stream: MediaStream | null
  label: string
  onExpand: () => void
  micMuted: boolean
  onToggleMic: () => void
  videoEnabled: boolean
  onToggleVideo: () => void
  onHangup: () => void
}) {
  return (
    <div className="fixed bottom-4 right-4 z-[150] w-56 rounded-xl overflow-hidden shadow-2xl ring-1 ring-white/10 bg-black select-none">
      <div className="relative aspect-video bg-gray-900 cursor-pointer" onClick={onExpand}>
        {stream ? (
          <video
            ref={el => { if (el && el.srcObject !== stream) el.srcObject = stream }}
            autoPlay
            playsInline
            muted
            className="w-full h-full object-cover"
          />
        ) : (
          <div className="w-full h-full flex items-center justify-center text-white/60 text-xs px-2 text-center">{label}</div>
        )}
        <button
          onClick={e => { e.stopPropagation(); onExpand() }}
          aria-label="Agrandir l'appel"
          title="Agrandir l'appel"
          className="absolute top-1.5 right-1.5 p-1 rounded bg-black/50 hover:bg-black/70 text-white"
        >
          <Maximize2 size={12} />
        </button>
        <span className="absolute bottom-1.5 left-1.5 px-1.5 py-0.5 rounded bg-black/50 text-white text-[10px] font-medium truncate max-w-[85%]">
          {label}
        </span>
      </div>
      <div className="flex items-center justify-center gap-1 px-2 py-1.5 bg-[#232629]">
        <button
          onClick={onToggleMic}
          aria-label={micMuted ? 'Activer le micro' : 'Couper le micro'}
          title={micMuted ? 'Activer le micro' : 'Couper le micro'}
          className={`p-2 rounded transition ${micMuted ? 'text-red-400 bg-red-500/20' : 'text-white hover:bg-white/10'}`}
        >
          {micMuted ? <MicOff size={14} /> : <Mic size={14} />}
        </button>
        <button
          onClick={onToggleVideo}
          aria-label={videoEnabled ? 'Désactiver la caméra' : 'Activer la caméra'}
          title={videoEnabled ? 'Désactiver la caméra' : 'Activer la caméra'}
          className={`p-2 rounded transition ${videoEnabled ? 'text-white hover:bg-white/10' : 'text-white/50 hover:bg-white/10'}`}
        >
          {videoEnabled ? <Video size={14} /> : <VideoOff size={14} />}
        </button>
        <button
          onClick={onHangup}
          aria-label="Quitter l'appel"
          title="Quitter l'appel"
          className="p-2 rounded text-red-400 hover:bg-red-500/20"
        >
          <PhoneOff size={14} />
        </button>
      </div>
    </div>
  )
}
