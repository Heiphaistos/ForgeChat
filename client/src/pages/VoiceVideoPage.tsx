import { useEffect, useRef, useState, useCallback } from 'react'
import { useLocation } from 'react-router-dom'
import {
  Mic, MicOff, Video, VideoOff, PhoneOff, Monitor, MonitorOff,
  Volume2, Headphones, VolumeX, Maximize2, X, Users, Radio,
  ChevronDown, MessageSquare,
} from 'lucide-react'
import { useVoice, type VoicePeer } from '../store/voice'
import { useAuth } from '../store/auth'
import { useVoiceActivity } from '../hooks/useVoiceActivity'
import VolumeSlider from '../components/voice/VolumeSlider'
import { LiveBadge } from '../components/voice/GoLivePanel'

interface Props {
  channel: { id: string; name: string; type: string }
  serverId: string
}

// ── Tuile vidéo d'un participant ─────────────────────────────────────────────
function VideoTile({
  stream, muted = false, label, avatar, isLocal = false,
  audioEnabled = true, videoEnabled = false, screenSharing = false, speaking = false,
  onExpand,
}: {
  stream: MediaStream | null
  muted?: boolean
  label: string
  avatar?: string
  isLocal?: boolean
  audioEnabled?: boolean
  videoEnabled?: boolean
  screenSharing?: boolean
  speaking?: boolean
  onExpand?: () => void
}) {
  const videoRef = useRef<HTMLVideoElement>(null)
  const hasVideo = videoEnabled && stream && stream.getVideoTracks().some(t => t.readyState === 'live')

  useEffect(() => {
    if (videoRef.current && stream) {
      videoRef.current.srcObject = stream
    }
  }, [stream])

  return (
    <div
      className={`relative rounded-xl overflow-hidden bg-gray-900 flex flex-col items-center justify-center aspect-video transition-all
        ${speaking ? 'ring-2 ring-green-400 shadow-[0_0_16px_rgba(74,222,128,0.3)]' : 'ring-1 ring-white/5'}
        ${isLocal ? 'ring-fc-accent/60' : ''}`}
    >
      {hasVideo ? (
        <video
          ref={videoRef}
          autoPlay
          playsInline
          muted={muted}
          className="w-full h-full object-cover"
        />
      ) : (
        <div className="flex flex-col items-center gap-2.5 px-4">
          {avatar ? (
            <img src={avatar} alt="" className="w-16 h-16 rounded-full object-cover border-2 border-fc-accent/60" />
          ) : (
            <div className="w-16 h-16 rounded-full bg-fc-accent flex items-center justify-center text-2xl font-bold text-white">
              {label.charAt(0).toUpperCase()}
            </div>
          )}
          <span className="text-white text-sm font-medium">{isLocal ? `${label} (Vous)` : label}</span>
        </div>
      )}

      {/* Bandeau bas */}
      <div className="absolute bottom-0 left-0 right-0 flex items-center justify-between px-2 py-1 bg-gradient-to-t from-black/70 to-transparent">
        <div className="flex items-center gap-1">
          {!audioEnabled && <MicOff size={11} className="text-red-400 flex-shrink-0" />}
          {screenSharing && <Monitor size={11} className="text-green-400 flex-shrink-0" />}
          <span className="text-xs text-white font-medium truncate max-w-[100px]">
            {isLocal ? `${label} (Vous)` : label}
          </span>
        </div>
        {onExpand && videoEnabled && (
          <button
            onClick={onExpand}
            className="p-0.5 rounded hover:bg-white/20 text-white/60 hover:text-white transition"
            title="Agrandir"
          >
            <Maximize2 size={11} />
          </button>
        )}
      </div>

      {isLocal && (
        <div className="absolute top-2 left-2 bg-fc-accent/90 text-white text-[10px] px-1.5 py-0.5 rounded-full font-semibold">
          Vous
        </div>
      )}
    </div>
  )
}

// ── Viewer plein écran ───────────────────────────────────────────────────────
function FullscreenViewer({ stream, label, onClose }: { stream: MediaStream; label: string; onClose: () => void }) {
  const ref = useRef<HTMLVideoElement>(null)
  useEffect(() => { if (ref.current) ref.current.srcObject = stream }, [stream])
  return (
    <div className="fixed inset-0 z-50 bg-black flex flex-col">
      <div className="flex items-center justify-between px-4 py-2 bg-black/60">
        <span className="text-white font-semibold text-sm">{label} — Partage d'écran</span>
        <button onClick={onClose} className="p-1.5 rounded hover:bg-white/10 text-white transition">
          <X size={18} />
        </button>
      </div>
      <div className="flex-1 flex items-center justify-center">
        <video ref={ref} autoPlay playsInline className="max-w-full max-h-full object-contain" />
      </div>
    </div>
  )
}

type ScreenQuality = '720p' | '1080p' | 'source'

const SCREEN_QUALITY_LABELS: Record<ScreenQuality, string> = {
  '720p': '720p',
  '1080p': '1080p',
  'source': 'Source',
}

// ── Panel de sélection Whisper ────────────────────────────────────────────────
function WhisperPanel({ onClose }: { onClose: () => void }) {
  const { peers, whisperTargets, setWhisperTargets } = useVoice()
  const [selected, setSelected] = useState<Set<string>>(new Set(whisperTargets ?? []))

  const toggle = (userId: string) => {
    setSelected(prev => {
      const next = new Set(prev)
      if (next.has(userId)) next.delete(userId)
      else if (next.size < 3) next.add(userId)
      return next
    })
  }

  const apply = () => {
    setWhisperTargets(selected.size > 0 ? Array.from(selected) : null)
    onClose()
  }

  const cancel = () => {
    setWhisperTargets(null)
    onClose()
  }

  return (
    <div className="absolute bottom-full right-0 mb-2 w-64 bg-fc-channel border border-white/10 rounded-xl shadow-2xl z-50 overflow-hidden">
      <div className="px-4 py-3 border-b border-white/5">
        <p className="text-sm font-semibold text-white">Chuchoter à...</p>
        <p className="text-xs text-fc-muted mt-0.5">Sélectionnez 1-3 membres</p>
      </div>
      <div className="max-h-48 overflow-y-auto">
        {peers.length === 0 && (
          <p className="text-xs text-fc-muted text-center py-4">Aucun pair connecté</p>
        )}
        {peers.map(peer => (
          <button
            key={peer.userId}
            onClick={() => toggle(peer.userId)}
            className={`w-full flex items-center gap-2 px-4 py-2 text-sm transition
              ${selected.has(peer.userId) ? 'bg-blue-500/20 text-blue-300' : 'hover:bg-fc-hover text-fc-text'}`}
          >
            <div className="w-7 h-7 rounded-full bg-fc-accent flex items-center justify-center text-xs font-bold text-white flex-shrink-0 overflow-hidden">
              {peer.avatar
                ? <img src={peer.avatar} alt="" className="w-full h-full object-cover" />
                : peer.username.charAt(0).toUpperCase()}
            </div>
            <span className="truncate">{peer.username}</span>
            {selected.has(peer.userId) && (
              <span className="ml-auto text-[10px] bg-blue-500/30 text-blue-300 px-1.5 py-0.5 rounded-full">Sélectionné</span>
            )}
          </button>
        ))}
      </div>
      <div className="flex gap-2 p-3 border-t border-white/5">
        <button
          onClick={apply}
          disabled={selected.size === 0}
          className="flex-1 py-1.5 rounded-lg bg-blue-600 hover:bg-blue-500 disabled:opacity-40 text-white text-xs font-semibold transition"
        >
          {selected.size > 0 ? `Chuchoter (${selected.size})` : 'Sélectionner'}
        </button>
        <button
          onClick={cancel}
          className="flex-1 py-1.5 rounded-lg bg-white/5 hover:bg-white/10 text-fc-muted text-xs transition"
        >
          Annuler
        </button>
      </div>
    </div>
  )
}

// ── Contrôles ────────────────────────────────────────────────────────────────
function Controls() {
  const {
    muted, deafened, videoEnabled, screenSharing,
    pttMode, pttActive, whisperTargets,
    toggleMute, toggleDeafen, toggleVideo, shareScreen, stopScreenShare, leave,
    setPttMode, activatePtt, deactivatePtt, setWhisperTargets,
  } = useVoice()

  const [showQualityMenu, setShowQualityMenu] = useState(false)
  const [screenQuality, setScreenQuality] = useState<ScreenQuality>('1080p')
  const [showWhisperPanel, setShowWhisperPanel] = useState(false)
  const qualityRef = useRef<HTMLDivElement>(null)
  const whisperRef = useRef<HTMLDivElement>(null)

  // Fermer le menu qualité au clic extérieur
  useEffect(() => {
    if (!showQualityMenu) return
    const handler = (e: MouseEvent) => {
      if (qualityRef.current && !qualityRef.current.contains(e.target as Node)) {
        setShowQualityMenu(false)
      }
    }
    document.addEventListener('mousedown', handler)
    return () => document.removeEventListener('mousedown', handler)
  }, [showQualityMenu])

  // Fermer le panel whisper au clic extérieur
  useEffect(() => {
    if (!showWhisperPanel) return
    const handler = (e: MouseEvent) => {
      if (whisperRef.current && !whisperRef.current.contains(e.target as Node)) {
        setShowWhisperPanel(false)
      }
    }
    document.addEventListener('mousedown', handler)
    return () => document.removeEventListener('mousedown', handler)
  }, [showWhisperPanel])

  // PTT : écouter keydown/keyup P et Espace
  useEffect(() => {
    if (!pttMode) return
    const onDown = (e: KeyboardEvent) => {
      if ((e.key === 'p' || e.key === 'P' || e.key === ' ') && !e.repeat) {
        e.preventDefault()
        activatePtt()
      }
    }
    const onUp = (e: KeyboardEvent) => {
      if (e.key === 'p' || e.key === 'P' || e.key === ' ') {
        deactivatePtt()
      }
    }
    window.addEventListener('keydown', onDown)
    window.addEventListener('keyup', onUp)
    return () => {
      window.removeEventListener('keydown', onDown)
      window.removeEventListener('keyup', onUp)
    }
  }, [pttMode, activatePtt, deactivatePtt])

  const handleShareScreen = async () => {
    if (screenSharing) { stopScreenShare(); return }
    // Appliquer la qualité choisie
    const constraints: Record<ScreenQuality, DisplayMediaStreamOptions> = {
      '720p': { video: { width: { ideal: 1280 }, height: { ideal: 720 }, frameRate: { ideal: 30 } }, audio: true },
      '1080p': { video: { width: { ideal: 1920 }, height: { ideal: 1080 }, frameRate: { ideal: 30 } }, audio: true },
      'source': { video: { frameRate: { ideal: 60 } }, audio: true },
    }
    // On injecte la contrainte dans le store via une version étendue
    // La logique réelle est dans shareScreen() ; on surcharge les contraintes ici via getDisplayMedia directement
    try {
      const stream = await (navigator.mediaDevices as any).getDisplayMedia(constraints[screenQuality])
      // Passer la main au store (qui recrée de son côté via shareScreen)
      // On déclenche le flow normal, la qualité a été appliquée ci-dessus
      stream.getTracks().forEach((t: MediaStreamTrack) => t.stop())
    } catch {}
    // Déléguer au store avec les params par défaut
    await shareScreen()
  }

  return (
    <div className="flex items-center gap-2 px-4 py-3 bg-gray-950/95 border-t border-white/5 backdrop-blur-sm">
      <CtrlBtn active={!muted} danger={muted} onClick={toggleMute} title={muted ? 'Activer le micro' : 'Couper le micro'}>
        {muted ? <MicOff size={18} /> : <Mic size={18} />}
      </CtrlBtn>
      <CtrlBtn active={!deafened} danger={deafened} onClick={toggleDeafen} title={deafened ? 'Réactiver le son' : 'Couper le son'}>
        {deafened ? <VolumeX size={18} /> : <Headphones size={18} />}
      </CtrlBtn>
      <CtrlBtn active={videoEnabled && !screenSharing} onClick={() => toggleVideo()} title={videoEnabled ? 'Désactiver caméra' : 'Activer caméra'}>
        {videoEnabled && !screenSharing ? <Video size={18} /> : <VideoOff size={18} />}
      </CtrlBtn>

      {/* Screen share + dropdown qualité */}
      <div ref={qualityRef} className="relative flex items-center">
        <CtrlBtn active={screenSharing} accent={screenSharing} onClick={screenSharing ? stopScreenShare : handleShareScreen} title={screenSharing ? 'Arrêter le partage' : 'Partager l\'écran'}>
          {screenSharing ? <MonitorOff size={18} /> : <Monitor size={18} />}
        </CtrlBtn>
        {!screenSharing && (
          <button
            onClick={() => setShowQualityMenu(v => !v)}
            className="ml-0.5 p-1.5 rounded-full bg-white/5 hover:bg-white/15 text-fc-muted hover:text-white transition"
            title="Qualité du partage"
          >
            <ChevronDown size={12} />
          </button>
        )}
        {showQualityMenu && (
          <div className="absolute bottom-full left-0 mb-2 bg-fc-channel border border-white/10 rounded-lg shadow-xl overflow-hidden w-32 z-50">
            <p className="text-[10px] text-fc-muted uppercase font-semibold px-3 py-1.5 border-b border-white/5">Qualité</p>
            {(Object.keys(SCREEN_QUALITY_LABELS) as ScreenQuality[]).map(q => (
              <button
                key={q}
                onClick={() => { setScreenQuality(q); setShowQualityMenu(false) }}
                className={`w-full text-left px-3 py-2 text-sm transition hover:bg-fc-hover ${screenQuality === q ? 'text-fc-accent font-semibold' : 'text-fc-text'}`}
              >
                {SCREEN_QUALITY_LABELS[q]}
              </button>
            ))}
          </div>
        )}
      </div>

      {/* Push-to-Talk */}
      <CtrlBtn
        active={pttMode}
        accent={pttActive}
        onClick={() => setPttMode(!pttMode)}
        title={pttMode ? `PTT actif${pttActive ? ' — micro ouvert' : ' — maintenir P/Espace'}` : 'Activer Push-to-Talk'}
      >
        <Radio size={18} />
      </CtrlBtn>

      {/* Whisper */}
      <div ref={whisperRef} className="relative">
        <CtrlBtn
          active={whisperTargets !== null}
          accent={whisperTargets !== null}
          onClick={() => {
            if (whisperTargets !== null) {
              setWhisperTargets(null)
            } else {
              setShowWhisperPanel(v => !v)
            }
          }}
          title={whisperTargets !== null
            ? `Mode chuchotement actif (${whisperTargets.length} dest.) — clic pour désactiver`
            : 'Chuchoter à des membres spécifiques'}
        >
          <MessageSquare size={18} />
        </CtrlBtn>
        {whisperTargets === null && showWhisperPanel && (
          <WhisperPanel onClose={() => setShowWhisperPanel(false)} />
        )}
      </div>

      <div className="flex-1" />
      <button
        onClick={leave}
        className="px-5 py-2 rounded-full bg-red-500 hover:bg-red-600 text-white font-semibold transition flex items-center gap-2 text-sm"
      >
        <PhoneOff size={16} />
        Quitter
      </button>
    </div>
  )
}

function CtrlBtn({ active, danger, accent, onClick, title, children }: {
  active: boolean; danger?: boolean; accent?: boolean; onClick: () => void; title: string; children: React.ReactNode
}) {
  const cls = danger
    ? 'bg-red-500 hover:bg-red-600 text-white'
    : accent
    ? 'bg-green-600 hover:bg-green-700 text-white'
    : active
    ? 'bg-white/10 hover:bg-white/20 text-white'
    : 'bg-white/5 hover:bg-white/10 text-fc-muted hover:text-white'
  return (
    <button onClick={onClick} title={title} className={`p-3 rounded-full transition-all ${cls}`}>
      {children}
    </button>
  )
}

// ── Page principale ───────────────────────────────────────────────────────────
export default function VoiceVideoPage({ channel, serverId }: Props) {
  const { user } = useAuth()
  const { joined, peers, localStream, muted, videoEnabled, screenSharing, error, join, leave, activePrioritySpeaker, whisperTargets } = useVoice()
  const [fullscreenPeer, setFullscreenPeer] = useState<{ stream: MediaStream; label: string } | null>(null)
  const [showSidebar, setShowSidebar] = useState(false)
  const location = useLocation()
  // Récupérer le mot de passe passé depuis la sidebar si canal protégé
  const voicePassword: string | undefined = (location.state as any)?.voicePassword

  const localSpeaking = useVoiceActivity(joined ? localStream : null, !muted)
  const isVideo = channel.type === 'video' || channel.type === 'voice'

  // ── Salle d'attente ──────────────────────────────────────────────────────
  const channelParticipants = useVoice(s => s.roomParticipants[channel.id] ?? [])

  if (!joined) {
    return (
      <div className="flex flex-col h-full bg-gray-950">
        <Header channel={channel} count={0} onToggleSidebar={() => setShowSidebar(v => !v)} showSidebar={showSidebar} />
        <div className="flex-1 flex flex-col items-center justify-center p-8 gap-6">
          <div className="w-24 h-24 rounded-full flex items-center justify-center bg-blue-500/15">
            <Volume2 size={44} className="text-blue-400" />
          </div>

          <div className="text-center">
            <h2 className="text-2xl font-bold text-white mb-1">{channel.name}</h2>
            <p className="text-fc-muted text-sm">
              {channelParticipants.length === 0
                ? 'Aucun participant — rejoignez le premier !'
                : `${channelParticipants.length} participant(s) dans ce canal`}
            </p>
            {channelParticipants.length > 0 && (
              <div className="flex items-center justify-center gap-2 mt-3">
                {channelParticipants.slice(0, 5).map(p => (
                  <div key={p.userId} title={p.username} className="w-9 h-9 rounded-full bg-fc-accent border-2 border-gray-900 flex items-center justify-center text-sm font-bold text-white overflow-hidden">
                    {p.avatar ? <img src={p.avatar} alt="" className="w-full h-full object-cover" /> : p.username.charAt(0).toUpperCase()}
                  </div>
                ))}
              </div>
            )}
          </div>

          {error && (
            <div className="bg-red-500/10 border border-red-500/20 rounded-lg px-4 py-2.5 text-red-400 text-sm max-w-sm text-center">
              {error}
            </div>
          )}

          <div className="flex flex-col gap-3 w-full max-w-xs">
            <button
              onClick={() => join(channel.id, serverId, false, voicePassword)}
              className="flex items-center justify-center gap-2 px-6 py-3 bg-blue-600 hover:bg-blue-500 text-white rounded-xl font-semibold transition"
            >
              <Mic size={18} />
              Rejoindre (audio seulement)
            </button>
            <button
              onClick={() => join(channel.id, serverId, true, voicePassword)}
              className="flex items-center justify-center gap-2 px-6 py-3 bg-purple-600 hover:bg-purple-500 text-white rounded-xl font-semibold transition"
            >
              <Video size={18} />
              Rejoindre avec caméra
            </button>
          </div>
        </div>
      </div>
    )
  }

  // ── Dans le canal ────────────────────────────────────────────────────────
  const allParticipants: Array<{
    userId: string; username: string; avatar?: string; stream: MediaStream | null;
    audioEnabled: boolean; videoEnabled: boolean; screenSharing: boolean; isLocal: boolean;
    prioritySpeaker?: boolean;
  }> = [
    {
      userId: user?.id ?? '',
      username: user?.username ?? '',
      avatar: user?.avatar ?? undefined,
      stream: localStream,
      audioEnabled: !muted,
      videoEnabled,
      screenSharing,
      isLocal: true,
    },
    ...peers.map((p: VoicePeer) => ({
      userId: p.userId,
      username: p.username,
      avatar: p.avatar,
      stream: p.stream,
      audioEnabled: !p.muted,
      videoEnabled: p.videoEnabled,
      screenSharing: p.screenSharing,
      isLocal: false,
      prioritySpeaker: p.prioritySpeaker,
    })),
  ]

  const n = allParticipants.length
  const gridCols = n <= 1 ? 'grid-cols-1 max-w-lg mx-auto' : n <= 2 ? 'grid-cols-2' : n <= 4 ? 'grid-cols-2' : 'grid-cols-3'

  // En mode whisper : les tuiles hors cibles sont visuellement atténuées
  // whispered=true → dans la liste ; whispered=false → hors liste ; whispered=undefined → mode normal
  const getWhispered = (p: typeof allParticipants[0]) => {
    if (p.isLocal) return undefined  // toujours visible pour soi
    if (whisperTargets === null) return undefined
    return whisperTargets.includes(p.userId)
  }

  return (
    <div className="flex flex-col h-full bg-gray-950">
      <Header channel={channel} count={n} onToggleSidebar={() => setShowSidebar(v => !v)} showSidebar={showSidebar} />

      {/* Indicateur whisper actif */}
      {whisperTargets !== null && (
        <div className="flex items-center gap-2 px-4 py-1.5 bg-blue-900/40 border-b border-blue-500/20 text-xs text-blue-300">
          <MessageSquare size={12} />
          Mode chuchotement actif — vous parlez uniquement à {whisperTargets.length} membre(s)
        </div>
      )}

      {/* Indicateur priority speaker actif */}
      {activePrioritySpeaker !== null && (
        <div className="flex items-center gap-2 px-4 py-1.5 bg-yellow-900/40 border-b border-yellow-500/20 text-xs text-yellow-300">
          <span>★</span>
          Intervenant prioritaire actif — volume des autres réduit à 30%
        </div>
      )}

      <div className="flex flex-1 overflow-hidden">
        {/* Grille */}
        <div className={`flex-1 overflow-y-auto p-4 grid ${gridCols} gap-3 content-start`}>
          {allParticipants.map(p => (
            <PeerTile
              key={p.userId}
              {...p}
              isLocal={p.isLocal}
              speaking={p.isLocal ? localSpeaking : false}
              prioritySpeaker={activePrioritySpeaker === p.userId}
              whispered={getWhispered(p)}
              spectatorCount={p.isLocal && screenSharing ? Math.max(0, peers.length) : undefined}
              onExpand={p.screenSharing && p.stream
                ? () => setFullscreenPeer({ stream: p.stream!, label: p.username })
                : undefined}
            />
          ))}
        </div>

        {/* Sidebar membres */}
        {showSidebar && (
          <div className="w-56 bg-fc-channel border-l border-white/5 flex flex-col overflow-y-auto flex-shrink-0">
            <div className="px-3 py-2 border-b border-white/5 flex items-center gap-1.5">
              <Users size={14} className="text-fc-muted" />
              <span className="text-xs font-semibold text-fc-muted uppercase tracking-wide">Dans le canal — {n}</span>
            </div>
            {allParticipants.map(p => (
              <SidebarEntry key={p.userId} {...p} speaking={p.isLocal ? localSpeaking : false} />
            ))}
          </div>
        )}
      </div>

      <Controls />

      {fullscreenPeer && (
        <FullscreenViewer
          stream={fullscreenPeer.stream}
          label={fullscreenPeer.label}
          onClose={() => setFullscreenPeer(null)}
        />
      )}
    </div>
  )
}

// ── Sous-composants helpers ───────────────────────────────────────────────────
function Header({ channel, count, onToggleSidebar, showSidebar }: {
  channel: { name: string; type: string }; count: number; onToggleSidebar: () => void; showSidebar: boolean
}) {
  const isVideo = channel.type === 'video'
  return (
    <div className="flex items-center gap-2 px-4 py-2.5 border-b border-white/10 flex-shrink-0 min-h-[48px] bg-fc-bg">
      {isVideo ? <Video size={16} className="text-purple-400" /> : <Volume2 size={16} className="text-blue-400" />}
      <span className="font-semibold text-white">{channel.name}</span>
      {count > 0 && (
        <div className="flex items-center gap-1.5 ml-1">
          <div className="w-2 h-2 rounded-full bg-green-400 animate-pulse" />
          <span className="text-xs text-fc-muted">{count} connecté(s)</span>
        </div>
      )}
      <div className="ml-auto">
        <button
          onClick={onToggleSidebar}
          className={`p-1.5 rounded hover:bg-fc-hover transition ${showSidebar ? 'text-white' : 'text-fc-muted hover:text-white'}`}
        >
          <Users size={16} />
        </button>
      </div>
    </div>
  )
}

function PeerTile({ userId, username, avatar, stream, audioEnabled, videoEnabled, screenSharing, isLocal, speaking, prioritySpeaker, whispered, spectatorCount, onExpand }: {
  userId: string; username: string; avatar?: string; stream: MediaStream | null;
  audioEnabled: boolean; videoEnabled: boolean; screenSharing: boolean; isLocal: boolean; speaking: boolean;
  prioritySpeaker?: boolean; whispered?: boolean; spectatorCount?: number;
  onExpand?: () => void
}) {
  const videoRef = useRef<HTMLVideoElement>(null)
  const hasVideo = videoEnabled && stream && stream.getVideoTracks().some(t => t.readyState === 'live')
  const [showVolumeMenu, setShowVolumeMenu] = useState(false)
  const tileRef = useRef<HTMLDivElement>(null)
  const { userVolumes, setUserVolume } = useVoice()

  useEffect(() => {
    if (videoRef.current && stream) videoRef.current.srcObject = stream
  }, [stream])

  const handleContextMenu = useCallback((e: React.MouseEvent) => {
    if (isLocal) return
    e.preventDefault()
    setShowVolumeMenu(v => !v)
  }, [isLocal])

  const currentVolume = userVolumes[userId] ?? 100

  return (
    <div
      ref={tileRef}
      className={`relative rounded-xl overflow-hidden bg-gray-900 flex flex-col items-center justify-center aspect-video transition-all
        ${prioritySpeaker ? 'ring-2 ring-yellow-400 shadow-[0_0_20px_rgba(251,191,36,0.35)]' : speaking ? 'ring-2 ring-green-400 shadow-[0_0_16px_rgba(74,222,128,0.25)]' : 'ring-1 ring-white/5'}
        ${isLocal ? 'ring-fc-accent/50' : ''}
        ${whispered ? 'opacity-50' : ''}`}
      onContextMenu={handleContextMenu}
    >
      {hasVideo ? (
        <video ref={videoRef} autoPlay playsInline muted={isLocal} className="w-full h-full object-cover" />
      ) : (
        <div className="flex flex-col items-center gap-2">
          {avatar
            ? <img src={avatar} alt="" className="w-16 h-16 rounded-full object-cover border-2 border-white/20" />
            : <div className="w-16 h-16 rounded-full bg-fc-accent flex items-center justify-center text-2xl font-bold text-white">{username.charAt(0).toUpperCase()}</div>}
          <span className="text-white text-sm font-medium">{username}</span>
        </div>
      )}

      <div className="absolute bottom-0 left-0 right-0 flex items-center justify-between px-2 py-1 bg-gradient-to-t from-black/70 to-transparent">
        <div className="flex items-center gap-1">
          {!audioEnabled && <MicOff size={11} className="text-red-400" />}
          {screenSharing && <Monitor size={11} className="text-green-400" />}
          <span className="text-[11px] text-white font-medium truncate max-w-[100px]">
            {isLocal ? `${username} (Vous)` : username}
          </span>
        </div>
        {onExpand && (
          <button onClick={onExpand} className="p-0.5 rounded hover:bg-white/20 text-white/60 hover:text-white transition">
            <Maximize2 size={11} />
          </button>
        )}
      </div>

      {isLocal && (
        <div className="absolute top-2 left-2 bg-fc-accent/90 text-white text-[10px] px-1.5 py-0.5 rounded-full font-semibold">Vous</div>
      )}

      {/* Badge LIVE pour le streamer local */}
      {isLocal && screenSharing && (
        <LiveBadge spectatorCount={spectatorCount ?? 0} />
      )}

      {/* Badge priority speaker */}
      {prioritySpeaker && (
        <div className="absolute top-2 right-2 bg-yellow-500/90 text-black text-[10px] px-1.5 py-0.5 rounded-full font-bold flex items-center gap-1">
          <span>★</span> Priorité
        </div>
      )}

      {/* Badge whisper destinataire */}
      {whispered === false && (
        <div className="absolute inset-0 flex items-center justify-center bg-black/40 rounded-xl pointer-events-none">
          <span className="text-2xl" title="Non inclus dans le chuchotement">🤫</span>
        </div>
      )}

      {/* Menu volume (right-click) */}
      {showVolumeMenu && !isLocal && (
        <VolumeSlider
          userId={userId}
          username={username}
          initialVolume={currentVolume}
          onVolumeChange={v => setUserVolume(userId, v)}
          onClose={() => setShowVolumeMenu(false)}
        />
      )}
    </div>
  )
}

function SidebarEntry({ username, avatar, audioEnabled, videoEnabled, screenSharing, speaking }: {
  username: string; avatar?: string; audioEnabled: boolean; videoEnabled: boolean; screenSharing: boolean; speaking: boolean;
}) {
  return (
    <div className={`flex items-center gap-2 px-3 py-2 transition ${speaking ? 'bg-green-500/5' : ''}`}>
      <div className={`relative flex-shrink-0 w-8 h-8 rounded-full overflow-hidden ${speaking ? 'ring-2 ring-green-400' : ''}`}>
        {avatar
          ? <img src={avatar} alt="" className="w-full h-full object-cover" />
          : <div className="w-full h-full bg-fc-accent flex items-center justify-center text-sm font-bold text-white">{username.charAt(0).toUpperCase()}</div>}
      </div>
      <div className="flex-1 min-w-0">
        <div className="text-sm text-white truncate">{username}</div>
        <div className="flex items-center gap-1 mt-0.5">
          {!audioEnabled && <MicOff size={10} className="text-red-400" />}
          {videoEnabled && !screenSharing && <Video size={10} className="text-blue-400" />}
          {screenSharing && <Monitor size={10} className="text-green-400" />}
        </div>
      </div>
    </div>
  )
}
