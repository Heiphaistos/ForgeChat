import { useEffect, useRef, useState, useCallback, useContext } from 'react'
import {
  Mic, MicOff, Video, VideoOff, PhoneOff, Monitor, MonitorOff,
  Volume2, VolumeX, Maximize2, X, Users, Hand, Radio,
  BarChart2, MessageSquare, Circle, Square, Grid2x2,
  Layout, Sparkles, Wifi, WifiOff, Music2, PenLine, ChevronLeft,
  Focus, GalleryHorizontal,
} from 'lucide-react'
import { useQuery } from '@tanstack/react-query'
import api, { mediaUrl } from '../api/client'
import { useVoice, type VoicePeer } from '../store/voice'
import { useAuth } from '../store/auth'
import { useWs } from '../store/ws'
import { useLocation } from 'react-router-dom'
import { useVoiceActivity, usePeersVoiceActivity } from '../hooks/useVoiceActivity'
import { useCaptions } from '../hooks/useCaptions'
import SpeakerStats from '../components/voice/SpeakerStats'
import VolumeSlider from '../components/voice/VolumeSlider'
import Soundboard from '../components/voice/Soundboard'
import VoiceActivityBar from '../components/voice/VoiceActivityBar'
import Whiteboard from '../components/voice/Whiteboard'
import FloatingReactions from '../components/voice/FloatingReactions'
import toast from 'react-hot-toast'
import { PeerTile, ScreenTile } from '../components/voice/CallTiles'
import CallStage, { type ViewMode, type StageTile, type RenderOpts } from '../components/voice/CallStage'
import { popOut } from '../lib/popout'
import { isNativeVoice, nativePopOut } from '../lib/nativeVoice'
import { MobileContext } from '../contexts/MobileContext'
import { useContextMenu } from '../components/ui/ContextMenu'
import { useMemberModeration } from '../components/chat/MemberModeration'


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
// Qualité mesurée par le SFU (perte, gigue, débit) : plus de sondage getStats().
// Le SFU dégrade aussi tout seul (simulcast + dynacast + contrôle de congestion),
// l'ancien divisé-par-deux manuel des débits n'a plus de raison d'être.
function CallQualityIndicator() {
  const status = useVoice(s => s.mediaStatus)
  const q = useVoice(s => s.mediaQuality)
  const view =
    status === 'connecting' ? { icon: <Wifi size={12} />, color: 'text-fc-muted', label: 'Connexion…' }
    : status === 'reconnecting' ? { icon: <WifiOff size={12} />, color: 'text-fc-yellow', label: 'Reconnexion…' }
    : status === 'failed' ? { icon: <WifiOff size={12} />, color: 'text-fc-red', label: 'Hors ligne' }
    : q === 'excellent' || q === 'good' ? { icon: <Wifi size={12} />, color: 'text-fc-green', label: q === 'excellent' ? 'Excellente' : 'Bonne' }
    : q === 'poor' ? { icon: <Wifi size={12} />, color: 'text-fc-yellow', label: 'Faible' }
    : q === 'lost' ? { icon: <WifiOff size={12} />, color: 'text-fc-red', label: 'Perdue' }
    : { icon: <Wifi size={12} />, color: 'text-fc-muted', label: '' }
  return (
    <div className={`flex items-center gap-1 text-xs ${view.color}`} title={`Connexion audio/vidéo : ${view.label || 'inconnue'}`} role="status">
      {view.icon}{view.label && <span>{view.label}</span>}
    </div>
  )
}

// ─── Fullscreen ───────────────────────────────────────────────────────────────
function FullscreenViewer({ stream, label, onClose }: { stream: MediaStream; label: string; onClose: () => void }) {
  const ref = useRef<HTMLVideoElement>(null)
  useEffect(() => { if (ref.current) ref.current.srcObject = stream }, [stream])
  // `muted` obligatoire : agrandir SA PROPRE tuile rejouait le micro local dans
  // les haut-parleurs (larsen immédiat), et agrandir celle d'un pair doublait son
  // audio par-dessus PersistentVoiceAudio.
  return (
    <div className="fixed inset-0 z-50 bg-black flex flex-col">
      <div className="flex items-center justify-between px-4 py-2 bg-black/60">
        <span className="text-white font-semibold text-sm">{label}</span>
        <button onClick={onClose} aria-label="Fermer le plein écran" className="p-1.5 rounded hover:bg-white/10 text-white min-w-[36px] min-h-[36px] flex items-center justify-center"><X size={18} aria-hidden /></button>
      </div>
      <video ref={ref} autoPlay playsInline muted className="flex-1 object-contain" />
    </div>
  )
}

// ─── Lobby (écran avant de rejoindre) ─────────────────────────────────────────
function VoiceLobby({
  channel, serverId, participantCount, voicePassword,
}: { channel: { id: string; name: string; type: string }; serverId: string; participantCount: number; voicePassword?: string }) {
  const { join, error } = useVoice()

  // La bannière d'erreur ci-dessous ne s'affiche qu'à l'écran de pré-connexion --
  // une erreur survenant APRÈS avoir rejoint (ex: shareScreen qui échoue) ne serait
  // sinon jamais visible, d'où le toast en complément (ne clear pas le store, la
  // bannière de pré-connexion garde son comportement existant).
  useEffect(() => {
    if (error) toast.error(error)
  }, [error])
  const [joining, setJoining] = useState(false)
  const [withVideo, setWithVideo] = useState(channel.type === 'video')
  const { openSidebar } = useContext(MobileContext)

  const handleJoin = async () => {
    setJoining(true)
    try {
      await join(channel.id, serverId, withVideo, voicePassword, channel.name)
    } finally {
      setJoining(false)
    }
  }

  return (
    <div className="flex flex-col h-full bg-fc-bg">
      {/* Header mobile */}
      <div className="flex items-center gap-2 px-4 py-2.5 border-b border-fc-bg flex-shrink-0 md:hidden">
        <button
          className="flex items-center justify-center p-1.5 rounded hover:bg-fc-hover text-fc-muted hover:text-white transition flex-shrink-0"
          onClick={openSidebar}
          aria-label="Retour aux canaux"
        >
          <ChevronLeft size={20} />
        </button>
        <span className="font-semibold text-white text-sm">{channel.name}</span>
      </div>
    <div className="flex flex-col items-center justify-center flex-1 gap-6">
      <div className="flex flex-col items-center gap-3">
        <div className="w-20 h-20 rounded-full bg-fc-accent/20 flex items-center justify-center">
          <Volume2 size={36} className="text-fc-accent" />
        </div>
        <h2 className="text-xl font-bold text-white">{channel.name}</h2>
        <p className="text-fc-muted text-sm">
          {participantCount > 0
            ? `${participantCount} participant${participantCount > 1 ? 's' : ''} dans ce canal`
            : 'Aucun participant pour le moment'}
        </p>
      </div>
      {error && (
        <div className="bg-red-500/10 border border-red-500/30 rounded-lg px-4 py-2 text-red-400 text-sm max-w-xs text-center">
          {error}
        </div>
      )}
      {channel.type === 'video' && (
        <label className="flex items-center gap-2 text-sm text-fc-text cursor-pointer select-none">
          <input type="checkbox" checked={withVideo} onChange={e => setWithVideo(e.target.checked)}
            className="w-4 h-4 rounded accent-fc-accent" />
          Activer la caméra à la connexion
        </label>
      )}
      <div className="flex gap-3">
        <button onClick={handleJoin} disabled={joining}
          className="flex items-center gap-2 px-6 py-3 bg-green-600 hover:bg-green-500 text-white rounded-xl font-semibold transition disabled:opacity-50 text-sm">
          <Mic size={16} />
          {joining ? 'Connexion...' : 'Rejoindre le vocal'}
        </button>
      </div>
      <p className="text-xs text-fc-muted">
        Votre navigateur peut demander l'accès au microphone
      </p>
    </div>
    </div>
  )
}

// ─── Main ─────────────────────────────────────────────────────────────────────
export default function VoiceVideoPage({ channel, serverId }: Props) {
  const { user } = useAuth()
  // Modération vocale (P2-2) : clic droit sur la tuile d'un participant.
  const tileMenu = useContextMenu()
  const moderation = useMemberModeration(serverId)
  const openTileMenu = (e: React.MouseEvent, userId: string) => {
    const items = moderation.voiceItemsFor(userId).filter(i => !('separator' in i && i.separator))
    if (items.length === 0) return
    e.preventDefault()
    tileMenu.open(e, items)
  }
  const { send, on } = useWs()
  const location = useLocation()
  const voicePassword: string | undefined = (location.state as any)?.voicePassword
  const {
    peers, localStream, localScreenStream, muted, deafened, videoEnabled, screenSharing,
    localVideoUrl, localScreenUrl, nativeSpeakers, autoWatchStreams, watchStream,
    leave, toggleMute, toggleDeafen, toggleVideo, shareScreen, stopScreenShare,
    userVolumes, setUserVolume, screenVolumes, setScreenVolume, joined, channelId: activeChannelId,
    roomParticipants, notice, clearNotice,
  } = useVoice()
  const isLocalSpeaking = useVoiceActivity(localStream)
  const remoteSpeaking = usePeersVoiceActivity(peers.map(p => ({ userId: p.userId, stream: p.stream })))
  const { isActive: captionsOn, isSupported: captionsSupported, captions, toggle: toggleCaptions } = useCaptions()
  // Map userId → speaking : local via AnalyserNode direct sur localStream, pairs
  // distants via un AnalyserNode par flux distant (usePeersVoiceActivity)
  const speakingMap: Record<string, number> = {
    ...(user ? { [user.id]: isLocalSpeaking ? 1 : 0 } : {}),
    ...remoteSpeaking,
    // Application Linux : orateurs actifs mesurés par le SFU (aucun flux local à analyser).
    ...Object.fromEntries(nativeSpeakers.map(id => [id, 1])),
  }

  // Accumulateur temps de parole pour SpeakerStats (sinon totalSpeakingMs restait
  // codé en dur à 0 — le panneau affichait toujours 0s pour tout le monde).
  // Ref pour éviter une closure obsolète dans l'intervalle (speakingMap est recalculé
  // à chaque render, pas une valeur stable).
  const speakingMapRef = useRef(speakingMap)
  speakingMapRef.current = speakingMap
  const speakingMsRef = useRef<Record<string, number>>({})
  useEffect(() => {
    const iv = setInterval(() => {
      for (const [uid, level] of Object.entries(speakingMapRef.current)) {
        if (level > 0.05) speakingMsRef.current[uid] = (speakingMsRef.current[uid] ?? 0) + 500
      }
    }, 500)
    return () => clearInterval(iv)
  }, [])

  const isInThisChannel = joined && activeChannelId === channel.id
  const participantsInChannel = (roomParticipants[channel.id] ?? []).length

  // Auto : galerie, et bascule d'elle-même en « stream en grand » dès qu'un écran est partagé.
  const [viewMode, setViewMode] = useState<ViewMode>('auto')
  const [spotlightTileKey, setSpotlightTileKey] = useState<string | null>(null)
  const [fullscreenStream, setFullscreenStream] = useState<{ stream: MediaStream; label: string } | null>(null)
  const [handRaised, setHandRaised] = useState(false)
  const [raisedHands, setRaisedHands] = useState<Record<string, boolean>>({})
  const [showStats, setShowStats] = useState(false)
  const [blurBackground, setBlurBackground] = useState(false)
  const [isRecording, setIsRecording] = useState(false)
  const [showCaptions, setShowCaptions] = useState(false)
  const [showSoundboard, setShowSoundboard] = useState(false)
  const [showWhiteboard, setShowWhiteboard] = useState(false)
  const [showEmojiBar, setShowEmojiBar] = useState(false)
  const [joinTime] = useState(Date.now())

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

  const sendReaction = (emoji: string) => {
    send({ type: 'VOICE_REACTION', channel_id: channel.id, emoji })
  }

  // WS: lecture soundboard des autres participants -- montée ici (toujours présente
  // pendant l'appel) plutôt que dans Soundboard.tsx (démonté quand le panneau est
  // fermé), sinon un son ne serait audible que si CHAQUE participant a son propre
  // panneau ouvert au moment de la lecture. `user_id` filtré pour ignorer l'écho de
  // notre propre clic (déjà joué localement en instantané dans Soundboard.tsx).
  const { data: soundboardSounds = [] } = useQuery<{ id: string; file_url: string }[]>({
    queryKey: ['soundboard', serverId],
    queryFn: () => api.get(`/servers/${serverId}/soundboard`).then(r => r.data),
    staleTime: 60_000,
  })
  useEffect(() => {
    const unsub = on('SOUNDBOARD_PLAY', (data: any) => {
      if (data.channel_id !== channel.id || data.user_id === user?.id) return
      const sound = soundboardSounds.find(s => s.id === data.sound_id)
      if (!sound) return
      const stored = localStorage.getItem('forgechat_soundboard_volume')
      const volume = stored ? Math.min(100, Math.max(0, parseInt(stored, 10))) : 80
      const audio = new Audio(mediaUrl(sound.file_url))
      audio.volume = volume / 100
      audio.play().catch(() => null)
    })
    return unsub
  }, [channel.id, on, user?.id, soundboardSounds])

  // Recording
  const recorderRef = useRef<MediaRecorder | null>(null)
  const recChunksRef = useRef<Blob[]>([])

  const startRecording = useCallback(() => {
    if (!localStream) return
    const mimeType = ['audio/webm;codecs=opus', 'audio/webm', 'audio/ogg', 'audio/mp4']
      .find(t => MediaRecorder.isTypeSupported(t)) ?? ''
    try {
      const recorder = new MediaRecorder(localStream, mimeType ? { mimeType } : undefined)
      recorder.ondataavailable = e => { if (e.data.size > 0) recChunksRef.current.push(e.data) }
      recorder.onstop = () => {
        const blob = new Blob(recChunksRef.current, { type: mimeType || 'audio/webm' })
        const url = URL.createObjectURL(blob)
        const a = document.createElement('a')
        a.href = url
        const ext = mimeType.includes('ogg') ? 'ogg' : mimeType.includes('mp4') ? 'mp4' : 'webm'
        a.download = `forgechat-recording-${new Date().toISOString().slice(0, 19).replace(/:/g, '-')}.${ext}`
        a.click()
        URL.revokeObjectURL(url)
        recChunksRef.current = []
      }
      recorder.start(1000)
      recorderRef.current = recorder
      setIsRecording(true)
      toast.success('Enregistrement démarré')
    } catch {
      toast.error("Impossible de démarrer l'enregistrement")
    }
  }, [localStream])

  const stopRecording = useCallback(() => {
    recorderRef.current?.stop()
    recorderRef.current = null
    setIsRecording(false)
  }, [])

  useEffect(() => () => { recorderRef.current?.stop() }, [])

  // Les raccourcis vocaux (caméra, partage, push-to-talk) sont montés au niveau
  // racine dans App.tsx : ici ils mouraient dès qu'on quittait la page d'appel,
  // et ils ignoraient les raccourcis configurés dans les Réglages.

  // Avertissements non bloquants du store (moteur de bruit indisponible, partage
  // de fenêtre sans son...) — sinon ils restaient invisibles.
  useEffect(() => {
    if (!notice) return
    toast(notice, { duration: 6000, icon: 'ℹ️' })
    clearNotice()
  }, [notice, clearNotice])

  // Volume par participant : état local de la popover
  const [volumeTarget, setVolumeTarget] = useState<{ userId: string; username: string; kind: 'voice' | 'screen' } | null>(null)

  if (!user) return null

  // Afficher le lobby si pas encore dans ce canal
  if (!isInThisChannel) {
    return <VoiceLobby channel={channel} serverId={serverId} participantCount={participantsInChannel} voicePassword={voicePassword} />
  }

  const allPeers = [
    { userId: user.id, username: user.username, avatar: user.avatar ?? undefined, stream: localStream, screenStream: screenSharing ? localScreenStream : null, videoUrl: localVideoUrl, screenUrl: localScreenUrl, muted, deafened: false, videoEnabled, screenSharing, isLocal: true },
    ...peers.map(p => ({ ...p, avatar: p.avatar ?? undefined, isLocal: false })),
  ]

  // Chaque participant contribue une tuile caméra + une tuile écran séparée s'il partage —
  // ainsi caméra et écran sont visibles simultanément dans TOUTES les dispositions, pas
  // seulement en mode Présentation/Focus.
  type Tile = { key: string; kind: 'camera' | 'screen'; peer: typeof allPeers[number]; stream: MediaStream | null; url?: string | null }
  const allTiles: Tile[] = allPeers.flatMap(p => {
    const tiles: Tile[] = [{ key: `${p.userId}-cam`, kind: 'camera', peer: p, stream: p.stream, url: p.videoUrl }]
    // Stream à la demande : la tuile existe dès que la personne partage, même non regardée.
    if (p.screenStream || p.screenUrl || (p.screenSharing && !p.isLocal)) tiles.push({ key: `${p.userId}-screen`, kind: 'screen', peer: p, stream: p.screenStream, url: p.screenUrl })
    return tiles
  })

  const statsParticipants = allPeers.map(p => ({
    userId: p.userId,
    username: p.username,
    avatar: p.avatar ?? undefined,
    audioLevel: speakingMap[p.userId] ?? 0,
    isMuted: p.muted,
    isSpeaking: (speakingMap[p.userId] ?? 0) > 0.05,
    totalSpeakingMs: speakingMsRef.current[p.userId] ?? 0,
  }))

  const peerById = new Map(allPeers.map(p => [p.userId, p]))
  const stageTiles: StageTile[] = allTiles.map(t => ({
    key: t.key, kind: t.kind, userId: t.peer.userId, username: t.peer.username, isLocal: t.peer.isLocal, stream: t.stream, url: t.url,
  }))
  const activeSpeakerId = allPeers.find(p => !p.isLocal && (speakingMap[p.userId] ?? 0) > 0.05)?.userId ?? null

  const detach = (userId: string, kind: 'camera' | 'screen', label: string, url?: string | null) => {
    if (isNativeVoice()) {
      // Linux : la vue web ne partage pas de flux entre fenêtres, la fenêtre relit le flux local.
      if (url) void nativePopOut(url, kind === 'screen' ? `Écran de ${label} — ForgeChat` : `${label} — ForgeChat`)
        .catch(e => toast.error(`Fenêtre impossible : ${String(e)}`))
      return
    }
    if (!popOut(userId, kind, label)) toast.error('Fenêtre bloquée : autorisez les fenêtres surgissantes pour ForgeChat.')
  }

  const renderTile = (t: StageTile, o: RenderOpts) => {
    const p = peerById.get(t.userId)
    if (!p) return null
    if (t.kind === 'screen') {
      return (
        <ScreenTile stream={t.stream} url={t.url} label={p.username} compact={o.compact}
          onWatch={p.isLocal ? undefined : () => watchStream(p.userId, true)}
          onStopWatching={p.isLocal || autoWatchStreams || !t.stream ? undefined : () => watchStream(p.userId, false)}
          onVolume={p.isLocal ? undefined : () => setVolumeTarget({ userId: p.userId, username: p.username, kind: 'screen' })}
          onPopOut={() => detach(p.userId, 'screen', p.username, t.url)}
          onExpand={o.expand ? () => setFullscreenStream({ stream: t.stream!, label: `Écran de ${p.username}` }) : undefined} />
      )
    }
    return (
      <PeerTile peer={p} stream={t.stream} videoUrl={t.url} muted={p.isLocal} compact={o.compact}
        isLocal={p.isLocal} speaking={(speakingMap[p.userId] ?? 0) > 0.05}
        handRaised={raisedHands[p.userId]} blurEnabled={blurBackground}
        connectionLost={(p as { connectionLost?: boolean }).connectionLost === true}
        onVolume={p.isLocal ? undefined : () => setVolumeTarget({ userId: p.userId, username: p.username, kind: 'voice' })}
        onPopOut={() => detach(p.userId, 'camera', p.username, t.url)}
        onContextMenu={e => openTileMenu(e, p.userId)}
        onExpand={o.expand && t.stream ? () => setFullscreenStream({ stream: t.stream!, label: p.username }) : undefined} />
    )
  }

  return (
    <div className="flex flex-col h-full bg-fc-bg relative">
      {/* Header */}
      <div className="flex items-center justify-between px-3 md:px-4 py-2 bg-fc-sidebar border-b border-fc-hover flex-shrink-0">
        <div className="flex items-center gap-2">
          <Volume2 size={16} className="text-fc-accent flex-shrink-0" />
          <span className="text-sm font-semibold text-white truncate max-w-[120px] md:max-w-none">{channel.name}</span>
          <MeetingTimer startTime={joinTime} />
          <CallQualityIndicator />
        </div>

        {/* View mode switcher — masqué sur mobile */}
        <div className="hidden md:flex items-center gap-1 bg-fc-channel rounded-lg p-1" role="group" aria-label="Disposition d'affichage">
          {([
            { mode: 'auto' as ViewMode, icon: <Sparkles size={14} />, label: 'Auto (le stream passe en grand)' },
            { mode: 'grid' as ViewMode, icon: <Grid2x2 size={14} />, label: 'Grille' },
            { mode: 'spotlight' as ViewMode, icon: <Maximize2 size={14} />, label: 'Spotlight' },
            { mode: 'sidebar' as ViewMode, icon: <Layout size={14} />, label: 'Barre latérale' },
            { mode: 'focus' as ViewMode, icon: <Focus size={14} />, label: 'Focus (suit l\'orateur)' },
            { mode: 'filmstrip' as ViewMode, icon: <GalleryHorizontal size={14} />, label: 'Bandeau' },
          ] as const).map(({ mode, icon, label }) => (
            <button
              key={mode}
              onClick={() => setViewMode(mode)}
              title={label}
              aria-label={label}
              aria-pressed={viewMode === mode}
              className={`p-1.5 rounded transition ${viewMode === mode ? 'bg-fc-accent text-white' : 'text-fc-muted hover:text-white'}`}
            >
              {icon}
            </button>
          ))}
        </div>

        <div className="flex items-center gap-2 flex-shrink-0">
          <span className="text-xs text-fc-muted hidden md:inline">{allPeers.length} participant{allPeers.length > 1 ? 's' : ''}</span>
          <Users size={14} className="text-fc-muted md:hidden" />
          <span className="text-xs text-fc-muted md:hidden">{allPeers.length}</span>
        </div>
      </div>

      {/* Main area */}
      <div className="flex-1 overflow-hidden relative">
        <CallStage tiles={stageTiles} mode={viewMode} featuredKey={spotlightTileKey}
          onFeature={setSpotlightTileKey} render={renderTile} activeSpeakerId={activeSpeakerId} />

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

      {/* Emoji bar */}
      {showEmojiBar && (
        <div className="flex items-center justify-center gap-2 px-4 py-2 bg-fc-sidebar border-t border-fc-hover flex-shrink-0">
          <div className="flex items-center gap-2 px-4 py-2 bg-fc-channel/80 backdrop-blur rounded-full shadow-lg">
            {(['👍', '❤️', '😂', '🔥', '👏', '😮', '🎉', '💯'] as const).map(emoji => (
              <button
                key={emoji}
                onClick={() => {
                  sendReaction(emoji)
                  setShowEmojiBar(false)
                }}
                className="text-2xl hover:scale-125 transition-transform"
              >
                {emoji}
              </button>
            ))}
          </div>
        </div>
      )}

      {/* Controls bar — responsive (mobile: contrôles essentiels seulement) */}
      <div className="flex items-center justify-between px-2 md:px-6 py-3 bg-fc-sidebar border-t border-fc-hover flex-shrink-0 gap-2">
        {/* Group 1: Info — masqué mobile */}
        <div className="hidden md:flex items-center gap-2 min-w-[120px]">
          <span className="text-xs text-fc-muted">{channel.name}</span>
        </div>

        {/* Group 2: Core media controls */}
        <div className="flex items-center gap-1 md:gap-2 flex-1 md:flex-none justify-center">
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
          {screenSharing && (
            <span className="hidden md:flex items-center gap-1 text-xs text-fc-green" title="Spectateurs de votre partage">
              <Users size={12} />{peers.length}
            </span>
          )}

          <div className="w-px h-8 bg-fc-hover mx-1 hidden md:block" />

          <button
            onClick={leave}
            title="Quitter l'appel"
            aria-label="Quitter l'appel"
            className="p-2.5 md:px-5 md:py-2 bg-fc-red hover:bg-fc-red/80 text-white rounded-xl font-medium text-sm flex items-center gap-2 transition"
          >
            <PhoneOff size={16} aria-hidden />
            <span className="hidden md:inline">Quitter</span>
          </button>
        </div>

        {/* Group 3: Extra features — masqué mobile sauf le bouton réaction */}
        <div className="flex items-center gap-1 justify-end">
          <div className="hidden md:flex items-center gap-1">
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
              active={showSoundboard} onClick={() => setShowSoundboard(v => !v)}
              activeIcon={<Music2 size={16} />} inactiveIcon={<Music2 size={16} />}
              activeClass="bg-fc-accent text-white" inactiveClass="bg-fc-hover text-fc-muted"
              label="Soundboard"
            />
            <CtrlBtn
              active={showStats} onClick={() => setShowStats(v => !v)}
              activeIcon={<BarChart2 size={16} />} inactiveIcon={<BarChart2 size={16} />}
              activeClass="bg-fc-accent text-white" inactiveClass="bg-fc-hover text-fc-muted"
              label="Statistiques orateurs"
            />
            <CtrlBtn
              active={showWhiteboard} onClick={() => setShowWhiteboard(v => !v)}
              activeIcon={<PenLine size={16} />} inactiveIcon={<PenLine size={16} />}
              activeClass="bg-fc-accent text-white" inactiveClass="bg-fc-hover text-fc-muted"
              label="Tableau blanc"
            />
          </div>
          <button
            onClick={() => setShowEmojiBar(p => !p)}
            className={`p-2.5 rounded-xl transition ${showEmojiBar ? 'bg-fc-accent text-white' : 'bg-fc-hover text-fc-muted'}`}
            title="Envoyer une réaction"
          >
            😄
          </button>
        </div>
      </div>

      {/* Whiteboard */}
      {showWhiteboard && (
        <Whiteboard
          channelId={channel.id}
          onClose={() => setShowWhiteboard(false)}
        />
      )}

      {/* Soundboard panel */}
      {showSoundboard && (
        <div className="absolute bottom-20 right-4 z-40">
          <Soundboard
            serverId={serverId}
            channelId={channel.id}
            onClose={() => setShowSoundboard(false)}
          />
        </div>
      )}

      {/* Voice activity bar */}
      <VoiceActivityBar
        participants={allPeers.map(p => ({
          user_id: p.userId,
          username: p.username,
          stream: p.stream ?? undefined,
        }))}
      />

      <FloatingReactions channelId={channel.id} />

      {volumeTarget && (
        <div className="absolute bottom-24 left-4 z-50">
          <VolumeSlider
            userId={volumeTarget.userId}
            username={volumeTarget.kind === 'screen' ? `Partage de ${volumeTarget.username}` : volumeTarget.username}
            initialVolume={volumeTarget.kind === 'screen'
              ? (screenVolumes[volumeTarget.userId] ?? 100)
              : (userVolumes[volumeTarget.userId] ?? 100)}
            onVolumeChange={v => volumeTarget.kind === 'screen'
              ? setScreenVolume(volumeTarget.userId, v)
              : setUserVolume(volumeTarget.userId, v)}
            onClose={() => setVolumeTarget(null)}
          />
        </div>
      )}

      {fullscreenStream && (
        <FullscreenViewer stream={fullscreenStream.stream} label={fullscreenStream.label} onClose={() => setFullscreenStream(null)} />
      )}
      {tileMenu.node}
      {moderation.node}
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
      aria-label={label}
      className={`p-2.5 rounded-xl transition ${active ? activeClass : inactiveClass}`}
    >
      {active ? activeIcon : inactiveIcon}
    </button>
  )
}
