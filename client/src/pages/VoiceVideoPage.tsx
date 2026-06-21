import { useEffect, useRef, useState, useCallback } from 'react'
import {
  Mic, MicOff, Video, VideoOff, PhoneOff, Monitor, MonitorOff,
  Volume2, VolumeX, Maximize2, X, Users, Hand, Radio,
  BarChart2, MessageSquare, Circle, Square, Grid2x2,
  LayoutTemplate, Layout, Wifi, WifiOff,
} from 'lucide-react'
import { useVoice, type VoicePeer } from '../store/voice'
import { useAuth } from '../store/auth'
import { useWs } from '../store/ws'
import { useVoiceActivity } from '../hooks/useVoiceActivity'
import { useCaptions } from '../hooks/useCaptions'
import SpeakerStats from '../components/voice/SpeakerStats'
import VolumeSlider from '../components/voice/VolumeSlider'
import toast from 'react-hot-toast'

type ViewMode = 'grid' | 'spotlight' | 'sidebar' | 'presentation'

interface Props {
  channel: { id: string; name: string; type: string }
  serverId: string
}

// ─── Meeting Timer ────────────────────────────────────────────────────────────
function MeetingTimer({ startTime }: { startTime: number }) {
  const [elapsed, setElapsed] = useState(0)
  useEffect(() => {
    const id = setInterval(() => setElapsed(Math.floor((Date.now() - startTime) / 1000)), 1000)
    return () => clearInterval(id)
  }, [startTime])
  const h = Math.floor(elapsed / 3600)
  const m = Math.floor((elapsed % 3600) / 60)
  const s = elapsed % 60
  return (
    <span className="text-xs text-fc-muted font-mono">
      {h > 0 ? `${h}:` : ''}{String(m).padStart(2, '0')}:{String(s).padStart(2, '0')}
    </span>
  )
}

// ─── Call Quality ─────────────────────────────────────────────────────────────
function CallQualityIndicator({ pcs }: { pcs: Map<string, RTCPeerConnection> }) {
  const [quality, setQuality] = useState<'good' | 'ok' | 'poor' | 'unknown'>('unknown')

  useEffect(() => {
    const check = async () => {
      if (pcs.size === 0) { setQuality('unknown'); return }
      let totalLoss = 0; let count = 0
      for (const pc of pcs.values()) {
        try {
          const stats = await pc.getStats()
          stats.forEach((r: RTCStats) => {
            if (r.type === 'remote-inbound-rtp') {
              const s = r as any
              if (typeof s.fractionLost === 'number') {
                totalLoss += s.fractionLost; count++
              }
            }
          })
        } catch {}
      }
      if (count === 0) { setQuality('unknown'); return }
      const avg = totalLoss / count
      if (avg < 0.02) setQuality('good')
      else if (avg < 0.08) setQuality('ok')
      else setQuality('poor')
    }
    check()
    const id = setInterval(check, 5000)
    return () => clearInterval(id)
  }, [pcs])

  const map = { good: { icon: <Wifi size={12} />, color: 'text-fc-green', label: 'Bonne' }, ok: { icon: <Wifi size={12} />, color: 'text-fc-yellow', label: 'Moyenne' }, poor: { icon: <WifiOff size={12} />, color: 'text-fc-red', label: 'Mauvaise' }, unknown: { icon: <Wifi size={12} />, color: 'text-fc-muted', label: '' } }
  const { icon, color, label } = map[quality]
  return (
    <div className={`flex items-center gap-1 text-xs ${color}`} title={`Qualité : ${label}`}>
      {icon}{label && <span>{label}</span>}
    </div>
  )
}

// ─── Peer Tile ─────────────────────────────────────────────────────────────────
function PeerTile({
  peer, stream, muted = false, isLocal = false, speaking = false,
  handRaised = false, blurEnabled = false, onExpand,
}: {
  peer: { username: string; avatar?: string; muted: boolean; videoEnabled: boolean; screenSharing: boolean }
  stream: MediaStream | null; muted?: boolean; isLocal?: boolean; speaking?: boolean
  handRaised?: boolean; blurEnabled?: boolean; onExpand?: () => void
}) {
  const videoRef = useRef<HTMLVideoElement>(null)
  const hasVideo = peer.videoEnabled && stream && stream.getVideoTracks().some(t => t.readyState === 'live')

  useEffect(() => {
    if (videoRef.current && stream) videoRef.current.srcObject = stream
  }, [stream])

  return (
    <div className={`relative rounded-xl overflow-hidden bg-gray-900 flex flex-col items-center justify-center aspect-video transition-all
      ${speaking ? 'ring-2 ring-fc-green shadow-[0_0_16px_rgba(74,222,128,0.25)]' : 'ring-1 ring-white/5'}
      ${isLocal ? 'ring-fc-accent/50' : ''}`}>
      {hasVideo ? (
        <video ref={videoRef} autoPlay playsInline muted={muted}
          className="w-full h-full object-cover"
          style={blurEnabled && isLocal ? { filter: 'blur(8px)' } : undefined} />
      ) : (
        <div className="flex flex-col items-center gap-2">
          {peer.avatar
            ? <img src={peer.avatar} alt="" className="w-16 h-16 rounded-full object-cover border-2 border-fc-accent/50" />
            : <div className="w-16 h-16 rounded-full bg-fc-accent flex items-center justify-center text-2xl font-bold text-white">
                {peer.username.charAt(0).toUpperCase()}
              </div>}
          <span className="text-sm text-white font-medium">{isLocal ? `${peer.username} (Vous)` : peer.username}</span>
        </div>
      )}

      <div className="absolute bottom-0 left-0 right-0 flex items-center justify-between px-2 py-1 bg-gradient-to-t from-black/70 to-transparent">
        <div className="flex items-center gap-1">
          {peer.muted ? <MicOff size={11} className="text-fc-red" /> : null}
          {peer.screenSharing ? <Monitor size={11} className="text-fc-green" /> : null}
          <span className="text-xs text-white truncate max-w-[100px]">{isLocal ? `${peer.username} (Vous)` : peer.username}</span>
        </div>
        {onExpand && hasVideo && (
          <button onClick={onExpand} className="p-0.5 rounded hover:bg-white/20 text-white/60 hover:text-white">
            <Maximize2 size={11} />
          </button>
        )}
      </div>

      {isLocal && <div className="absolute top-2 left-2 bg-fc-accent/90 text-white text-[10px] px-1.5 py-0.5 rounded-full font-semibold">Vous</div>}
      {handRaised && (
        <div className="absolute top-2 right-2 bg-fc-yellow/90 text-white text-xs px-1.5 py-0.5 rounded-full animate-bounce">✋</div>
      )}
    </div>
  )
}

// ─── Grid Layout ──────────────────────────────────────────────────────────────
function getGridClass(n: number) {
  if (n <= 1) return 'grid-cols-1'
  if (n <= 2) return 'grid-cols-2'
  if (n <= 4) return 'grid-cols-2'
  if (n <= 6) return 'grid-cols-3'
  if (n <= 9) return 'grid-cols-3'
  return 'grid-cols-4'
}

// ─── Fullscreen ───────────────────────────────────────────────────────────────
function FullscreenViewer({ stream, label, onClose }: { stream: MediaStream; label: string; onClose: () => void }) {
  const ref = useRef<HTMLVideoElement>(null)
  useEffect(() => { if (ref.current) ref.current.srcObject = stream }, [stream])
  return (
    <div className="fixed inset-0 z-50 bg-black flex flex-col">
      <div className="flex items-center justify-between px-4 py-2 bg-black/60">
        <span className="text-white font-semibold text-sm">{label}</span>
        <button onClick={onClose} className="p-1.5 rounded hover:bg-white/10 text-white"><X size={18} /></button>
      </div>
      <video ref={ref} autoPlay playsInline className="flex-1 object-contain" />
    </div>
  )
}

// ─── Main ─────────────────────────────────────────────────────────────────────
export default function VoiceVideoPage({ channel, serverId }: Props) {
  const { user } = useAuth()
  const { send, on } = useWs()
  const {
    peers, localStream, muted, deafened, videoEnabled, screenSharing,
    leave, toggleMute, toggleDeafen, toggleVideo, shareScreen, stopScreenShare,
    userVolumes, setUserVolume,
  } = useVoice()
  const isLocalSpeaking = useVoiceActivity(localStream)
  const { isActive: captionsOn, isSupported: captionsSupported, captions, toggle: toggleCaptions } = useCaptions()
  // Map userId → speaking (local only — peers tracked via WS SPEAKING events)
  const speakingMap: Record<string, number> = user ? { [user.id]: isLocalSpeaking ? 1 : 0 } : {}

  const [viewMode, setViewMode] = useState<ViewMode>('grid')
  const [spotlightUser, setSpotlightUser] = useState<string | null>(null)
  const [fullscreenStream, setFullscreenStream] = useState<{ stream: MediaStream; label: string } | null>(null)
  const [handRaised, setHandRaised] = useState(false)
  const [raisedHands, setRaisedHands] = useState<Record<string, boolean>>({})
  const [showStats, setShowStats] = useState(false)
  const [blurBackground, setBlurBackground] = useState(false)
  const [isRecording, setIsRecording] = useState(false)
  const [showCaptions, setShowCaptions] = useState(false)
  const [joinTime] = useState(Date.now())
  // RTCPeerConnections ref pour CallQualityIndicator
  const pcsRef = useRef<Map<string, RTCPeerConnection>>(new Map())

  // WS: hand raise
  useEffect(() => {
    const unsub = on('HAND_RAISE', (data: any) => {
      if (data.channel_id !== channel.id) return
      setRaisedHands(prev => ({ ...prev, [data.user_id]: data.raised }))
      if (data.raised && data.user_id !== user?.id) {
        toast(`✋ ${data.username} a levé la main`, { duration: 3000 })
      }
    })
    return unsub
  }, [channel.id, on, user?.id])

  const toggleHandRaise = () => {
    const newVal = !handRaised
    setHandRaised(newVal)
    setRaisedHands(prev => ({ ...prev, [user!.id]: newVal }))
    send({ type: 'HAND_RAISE', channel_id: channel.id, user_id: user!.id, username: user!.username, raised: newVal })
  }

  // Recording
  const recorderRef = useRef<MediaRecorder | null>(null)
  const recChunksRef = useRef<Blob[]>([])

  const startRecording = useCallback(() => {
    if (!localStream) return
    const recorder = new MediaRecorder(localStream, { mimeType: 'audio/webm;codecs=opus' })
    recorder.ondataavailable = e => { if (e.data.size > 0) recChunksRef.current.push(e.data) }
    recorder.onstop = () => {
      const blob = new Blob(recChunksRef.current, { type: 'audio/webm' })
      const url = URL.createObjectURL(blob)
      const a = document.createElement('a')
      a.href = url; a.download = `forgechat-recording-${Date.now()}.webm`; a.click()
      URL.revokeObjectURL(url)
      recChunksRef.current = []
    }
    recorder.start(500)
    recorderRef.current = recorder
    setIsRecording(true)
  }, [localStream])

  const stopRecording = useCallback(() => {
    recorderRef.current?.stop()
    recorderRef.current = null
    setIsRecording(false)
  }, [])

  useEffect(() => () => { recorderRef.current?.stop() }, [])

  if (!user) return null

  const allPeers = [
    { userId: user.id, username: user.username, avatar: user.avatar ?? undefined, stream: localStream, muted, deafened: false, videoEnabled, screenSharing, isLocal: true },
    ...peers.map(p => ({ ...p, avatar: p.avatar ?? undefined, isLocal: false })),
  ]

  const statsParticipants = allPeers.map(p => ({
    userId: p.userId,
    username: p.username,
    avatar: p.avatar ?? undefined,
    audioLevel: speakingMap[p.userId] ?? 0,
    isMuted: p.muted,
    isSpeaking: (speakingMap[p.userId] ?? 0) > 0.05,
    totalSpeakingMs: 0,
  }))

  const spotlightPeer = allPeers.find(p => p.userId === spotlightUser) ?? allPeers[0]

  return (
    <div className="flex flex-col h-full bg-fc-bg relative">
      {/* Header */}
      <div className="flex items-center justify-between px-4 py-2 bg-fc-sidebar border-b border-fc-hover flex-shrink-0">
        <div className="flex items-center gap-3">
          <Volume2 size={16} className="text-fc-accent" />
          <span className="text-sm font-semibold text-white">{channel.name}</span>
          <MeetingTimer startTime={joinTime} />
          <CallQualityIndicator pcs={pcsRef.current} />
        </div>

        {/* View mode switcher */}
        <div className="flex items-center gap-1 bg-fc-channel rounded-lg p-1">
          {([
            { mode: 'grid' as ViewMode, icon: <Grid2x2 size={14} />, label: 'Grille' },
            { mode: 'spotlight' as ViewMode, icon: <Maximize2 size={14} />, label: 'Spotlight' },
            { mode: 'sidebar' as ViewMode, icon: <Layout size={14} />, label: 'Barre latérale' },
            { mode: 'presentation' as ViewMode, icon: <LayoutTemplate size={14} />, label: 'Présentation' },
          ] as const).map(({ mode, icon, label }) => (
            <button
              key={mode}
              onClick={() => setViewMode(mode)}
              title={label}
              className={`p-1.5 rounded transition ${viewMode === mode ? 'bg-fc-accent text-white' : 'text-fc-muted hover:text-white'}`}
            >
              {icon}
            </button>
          ))}
        </div>

        <div className="flex items-center gap-2">
          <span className="text-xs text-fc-muted">{allPeers.length} participant{allPeers.length > 1 ? 's' : ''}</span>
        </div>
      </div>

      {/* Main area */}
      <div className="flex-1 overflow-hidden relative">
        {/* Grid view */}
        {viewMode === 'grid' && (
          <div className={`grid ${getGridClass(allPeers.length)} gap-2 p-3 h-full auto-rows-fr`}>
            {allPeers.map(p => (
              <PeerTile key={p.userId} peer={p} stream={p.stream} muted={p.isLocal}
                isLocal={p.isLocal} speaking={(speakingMap[p.userId] ?? 0) > 0.05}
                handRaised={raisedHands[p.userId]} blurEnabled={blurBackground}
                onExpand={p.stream ? () => setFullscreenStream({ stream: p.stream!, label: p.username }) : undefined} />
            ))}
          </div>
        )}

        {/* Spotlight view */}
        {viewMode === 'spotlight' && (
          <div className="flex flex-col h-full p-3 gap-3">
            <div className="flex-1 rounded-xl overflow-hidden">
              <PeerTile peer={spotlightPeer} stream={spotlightPeer.stream} muted={spotlightPeer.isLocal}
                isLocal={spotlightPeer.isLocal} speaking={(speakingMap[spotlightPeer.userId] ?? 0) > 0.05}
                handRaised={raisedHands[spotlightPeer.userId]} blurEnabled={blurBackground} />
            </div>
            <div className="flex gap-2 overflow-x-auto pb-1">
              {allPeers.filter(p => p.userId !== spotlightPeer.userId).map(p => (
                <div key={p.userId} className="w-32 flex-shrink-0 cursor-pointer" onClick={() => setSpotlightUser(p.userId)}>
                  <PeerTile peer={p} stream={p.stream} muted={p.isLocal}
                    isLocal={p.isLocal} speaking={(speakingMap[p.userId] ?? 0) > 0.05}
                    handRaised={raisedHands[p.userId]} blurEnabled={blurBackground} />
                </div>
              ))}
            </div>
          </div>
        )}

        {/* Sidebar view */}
        {viewMode === 'sidebar' && (
          <div className="flex h-full">
            <div className="flex-1 p-3">
              <PeerTile peer={spotlightPeer} stream={spotlightPeer.stream} muted={spotlightPeer.isLocal}
                isLocal={spotlightPeer.isLocal} speaking={(speakingMap[spotlightPeer.userId] ?? 0) > 0.05}
                handRaised={raisedHands[spotlightPeer.userId]} blurEnabled={blurBackground} />
            </div>
            <div className="w-48 flex flex-col gap-2 p-2 overflow-y-auto border-l border-fc-hover bg-fc-sidebar/50">
              {allPeers.map(p => (
                <div key={p.userId} className="cursor-pointer" onClick={() => setSpotlightUser(p.userId)}>
                  <PeerTile peer={p} stream={p.stream} muted={p.isLocal}
                    isLocal={p.isLocal} speaking={(speakingMap[p.userId] ?? 0) > 0.05}
                    handRaised={raisedHands[p.userId]} blurEnabled={blurBackground} />
                </div>
              ))}
            </div>
          </div>
        )}

        {/* Presentation view: screen shares first */}
        {viewMode === 'presentation' && (() => {
          const screensharing = allPeers.find(p => p.screenSharing && p.stream)
          const presenter = screensharing ?? spotlightPeer
          return (
            <div className="flex flex-col h-full p-3 gap-3">
              <div className="flex-1 flex items-center justify-center bg-black rounded-xl overflow-hidden">
                {presenter.stream
                  ? <video autoPlay playsInline muted={presenter.isLocal}
                      ref={el => { if (el && presenter.stream) el.srcObject = presenter.stream }}
                      className="max-h-full max-w-full object-contain" />
                  : <div className="text-fc-muted text-sm">Aucun partage d'écran actif</div>}
              </div>
              <div className="flex gap-2 overflow-x-auto">
                {allPeers.filter(p => !p.screenSharing).map(p => (
                  <div key={p.userId} className="w-28 flex-shrink-0">
                    <PeerTile peer={p} stream={p.stream} muted={p.isLocal}
                      isLocal={p.isLocal} speaking={(speakingMap[p.userId] ?? 0) > 0.05}
                      handRaised={raisedHands[p.userId]} blurEnabled={blurBackground} />
                  </div>
                ))}
              </div>
            </div>
          )
        })()}

        {/* Captions overlay */}
        {showCaptions && captions.length > 0 && (
          <div className="absolute bottom-2 left-1/2 -translate-x-1/2 w-3/4 max-w-2xl pointer-events-none">
            {captions.slice(-2).map((c, i) => (
              <div key={c.id} className={`bg-black/80 text-white text-sm text-center rounded-lg px-4 py-2 mb-1 ${!c.isFinal ? 'opacity-70' : ''}`}>
                {c.text}
              </div>
            ))}
          </div>
        )}

        {/* Speaker stats panel */}
        {showStats && (
          <SpeakerStats participants={statsParticipants} onClose={() => setShowStats(false)} />
        )}
      </div>

      {/* Controls bar — Google Meet style */}
      <div className="flex items-center justify-between px-6 py-3 bg-fc-sidebar border-t border-fc-hover flex-shrink-0">
        {/* Group 1: Info */}
        <div className="flex items-center gap-2 min-w-[120px]">
          <span className="text-xs text-fc-muted">{channel.name}</span>
        </div>

        {/* Group 2: Core media controls */}
        <div className="flex items-center gap-2">
          <CtrlBtn
            active={!muted} onClick={toggleMute}
            activeIcon={<Mic size={18} />} inactiveIcon={<MicOff size={18} />}
            activeClass="bg-fc-hover text-white" inactiveClass="bg-fc-red text-white"
            label={muted ? 'Activer le micro' : 'Désactiver le micro'}
          />
          <CtrlBtn
            active={!deafened} onClick={toggleDeafen}
            activeIcon={<Volume2 size={18} />} inactiveIcon={<VolumeX size={18} />}
            activeClass="bg-fc-hover text-white" inactiveClass="bg-fc-red text-white"
            label={deafened ? 'Activer le son' : 'Couper le son'}
          />
          <CtrlBtn
            active={videoEnabled} onClick={() => toggleVideo()}
            activeIcon={<Video size={18} />} inactiveIcon={<VideoOff size={18} />}
            activeClass="bg-fc-hover text-white" inactiveClass="bg-fc-hover text-fc-muted"
            label={videoEnabled ? 'Désactiver la caméra' : 'Activer la caméra'}
          />
          <CtrlBtn
            active={screenSharing} onClick={screenSharing ? stopScreenShare : () => shareScreen()}
            activeIcon={<Monitor size={18} />} inactiveIcon={<MonitorOff size={18} />}
            activeClass="bg-fc-green text-white" inactiveClass="bg-fc-hover text-fc-muted"
            label={screenSharing ? 'Arrêter le partage' : 'Partager l\'écran'}
          />

          <div className="w-px h-8 bg-fc-hover mx-1" />

          <button
            onClick={leave}
            className="px-5 py-2 bg-fc-red hover:bg-fc-red/80 text-white rounded-xl font-medium text-sm flex items-center gap-2 transition"
          >
            <PhoneOff size={16} /> Quitter
          </button>
        </div>

        {/* Group 3: Extra features */}
        <div className="flex items-center gap-1 min-w-[120px] justify-end">
          <CtrlBtn
            active={handRaised} onClick={toggleHandRaise}
            activeIcon={<Hand size={16} />} inactiveIcon={<Hand size={16} />}
            activeClass="bg-fc-yellow text-white" inactiveClass="bg-fc-hover text-fc-muted"
            label="Lever/baisser la main"
          />
          <CtrlBtn
            active={blurBackground} onClick={() => setBlurBackground(v => !v)}
            activeIcon={<span className="text-xs font-bold">BG</span>}
            inactiveIcon={<span className="text-xs">BG</span>}
            activeClass="bg-fc-accent text-white" inactiveClass="bg-fc-hover text-fc-muted"
            label="Flou d'arrière-plan"
          />
          {captionsSupported && (
            <CtrlBtn
              active={captionsOn} onClick={() => { toggleCaptions(); setShowCaptions(v => !v) }}
              activeIcon={<MessageSquare size={16} />} inactiveIcon={<MessageSquare size={16} />}
              activeClass="bg-fc-accent text-white" inactiveClass="bg-fc-hover text-fc-muted"
              label="Sous-titres automatiques"
            />
          )}
          <CtrlBtn
            active={isRecording} onClick={isRecording ? stopRecording : startRecording}
            activeIcon={<Square size={14} className="fill-current" />}
            inactiveIcon={<Circle size={14} />}
            activeClass="bg-fc-red text-white animate-pulse" inactiveClass="bg-fc-hover text-fc-muted"
            label={isRecording ? 'Arrêter l\'enregistrement' : 'Enregistrer'}
          />
          <CtrlBtn
            active={showStats} onClick={() => setShowStats(v => !v)}
            activeIcon={<BarChart2 size={16} />} inactiveIcon={<BarChart2 size={16} />}
            activeClass="bg-fc-accent text-white" inactiveClass="bg-fc-hover text-fc-muted"
            label="Statistiques orateurs"
          />
        </div>
      </div>

      {fullscreenStream && (
        <FullscreenViewer stream={fullscreenStream.stream} label={fullscreenStream.label} onClose={() => setFullscreenStream(null)} />
      )}
    </div>
  )
}

// ─── Control button helper ─────────────────────────────────────────────────────
function CtrlBtn({
  active, onClick, activeIcon, inactiveIcon, activeClass, inactiveClass, label,
}: {
  active: boolean; onClick: () => void
  activeIcon: React.ReactNode; inactiveIcon: React.ReactNode
  activeClass: string; inactiveClass: string; label: string
}) {
  return (
    <button
      onClick={onClick}
      title={label}
      className={`p-2.5 rounded-xl transition ${active ? activeClass : inactiveClass}`}
    >
      {active ? activeIcon : inactiveIcon}
    </button>
  )
}
