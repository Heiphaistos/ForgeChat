import { create } from 'zustand'
import { useWs } from './ws'
import api from '../api/client'

export interface VoicePeer {
  userId: string
  username: string
  avatar?: string
  discriminator?: string
  stream: MediaStream | null
  muted: boolean
  deafened: boolean
  videoEnabled: boolean
  screenSharing: boolean
  prioritySpeaker?: boolean
}

export interface VoiceRoomParticipant {
  userId: string
  username: string
  avatar?: string
  muted: boolean
  video: boolean
  screen: boolean
}

interface VoiceStore {
  channelId: string | null
  channelName: string | null
  serverId: string | null
  joined: boolean
  peers: VoicePeer[]
  localStream: MediaStream | null
  muted: boolean
  deafened: boolean
  videoEnabled: boolean
  screenSharing: boolean
  error: string | null
  // Participants par canal (pour la sidebar â€” tous serveurs)
  roomParticipants: Record<string, VoiceRoomParticipant[]>
  // Push-to-talk
  pttActive: boolean
  pttMode: boolean
  // Volume par utilisateur (0-200, 100 = normal)
  userVolumes: Record<string, number>
  // Priority speaker actif (userId ou null)
  activePrioritySpeaker: string | null
  // Whisper : liste des userId Ã  qui on chuchote (null = mode normal)
  whisperTargets: string[] | null
  // Streams actifs Go Live : userId → {userId, username, channelId}
  activeStreams: Record<string, { userId: string; username: string; channelId: string }>

  join(channelId: string, serverId: string, withVideo?: boolean, password?: string, channelName?: string): Promise<void>
  leave(): void
  toggleMute(): void
  toggleDeafen(): void
  toggleVideo(): Promise<void>
  shareScreen(): Promise<void>
  stopScreenShare(): void
  clearError(): void
  // AppelÃ© par App pour Ã©couter les events globaux (joins/leaves)
  initGlobalListeners(): () => void
  // Push-to-talk
  setPttMode(enabled: boolean): void
  activatePtt(): void
  deactivatePtt(): void
  // Volume par utilisateur
  setUserVolume(userId: string, volume: number): void
  // Noise suppression toggle
  setNoiseSuppressionEnabled(enabled: boolean): void
  // Whisper
  setWhisperTargets(targets: string[] | null): void
}

// â”€â”€ Singletons non-rÃ©actifs â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
const _pcs = new Map<string, RTCPeerConnection>()
const _iceQueues = new Map<string, RTCIceCandidateInit[]>()
const _gainNodes = new Map<string, GainNode>()
let _audioCtx: AudioContext | null = null
let _localStream: MediaStream | null = null
let _processedStream: MediaStream | null = null     // stream aprÃ¨s traitement noise suppression
let _noiseAudioCtx: AudioContext | null = null       // AudioContext dÃ©diÃ© noise suppression
let _screenTrack: MediaStreamTrack | null = null
let _offFns: Array<() => void> = []
let _pttMuted = false // Ã©tat mute "rÃ©el" avant PTT

// Cache de la config ICE â€” fetchÃ©e une seule fois par session
let _iceConfigCache: RTCConfiguration | null = null

function _getAudioCtx(): AudioContext {
  if (!_audioCtx || _audioCtx.state === 'closed') {
    _audioCtx = new AudioContext()
  }
  return _audioCtx
}

// Fallback ICE config (STUN seulement) utilisÃ© si le fetch Ã©choue
const ICE_FALLBACK: RTCConfiguration = {
  iceServers: [
    { urls: 'stun:stun.l.google.com:19302' },
    { urls: 'stun:stun1.l.google.com:19302' },
    { urls: 'stun:stun2.l.google.com:19302' },
  ],
}

async function _getIceConfig(): Promise<RTCConfiguration> {
  if (_iceConfigCache) return _iceConfigCache
  try {
    const res = await api.get('/voice/ice-config')
    _iceConfigCache = { iceServers: res.data.ice_servers }
    return _iceConfigCache
  } catch {
    // En cas d'erreur rÃ©seau, fallback STUN seulement
    return ICE_FALLBACK
  }
}

// â”€â”€ Noise Suppression via Web Audio API â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
function _applyNoiseSuppression(inputStream: MediaStream): MediaStream {
  try {
    if (_noiseAudioCtx && _noiseAudioCtx.state !== 'closed') {
      _noiseAudioCtx.close()
    }
    _noiseAudioCtx = new AudioContext()
    const ctx = _noiseAudioCtx

    const source = ctx.createMediaStreamSource(inputStream)

    // Highpass filter : coupe les frÃ©quences < 80 Hz (bruits de ventilateur, vibrations)
    const highpass = ctx.createBiquadFilter()
    highpass.type = 'highpass'
    highpass.frequency.value = 80

    // Dynamics compressor : attÃ©nue les sons faibles (bruit de fond ambiant)
    const compressor = ctx.createDynamicsCompressor()
    compressor.threshold.value = -50
    compressor.knee.value = 40
    compressor.ratio.value = 12
    compressor.attack.value = 0
    compressor.release.value = 0.25

    const dest = ctx.createMediaStreamDestination()

    source.connect(highpass)
    highpass.connect(compressor)
    compressor.connect(dest)

    // Conserver les pistes vidÃ©o du stream original
    const outputStream = dest.stream
    inputStream.getVideoTracks().forEach(t => outputStream.addTrack(t))

    return outputStream
  } catch {
    // Si Web Audio Ã©choue (ex: navigateur non supportÃ©), retourner le stream original
    return inputStream
  }
}

function _cleanupNoiseSuppression() {
  if (_noiseAudioCtx && _noiseAudioCtx.state !== 'closed') {
    _noiseAudioCtx.close()
    _noiseAudioCtx = null
  }
  _processedStream = null
}

// â”€â”€ Helpers â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
async function _createPC(
  peerId: string,
  info: Partial<VoicePeer>,
  get: () => VoiceStore,
  set: (fn: (s: VoiceStore) => Partial<VoiceStore>) => void,
) {
  if (_pcs.has(peerId)) return _pcs.get(peerId)!
  const iceConfig = await _getIceConfig()
  const pc = new RTCPeerConnection(iceConfig)
  _pcs.set(peerId, pc)
  _iceQueues.set(peerId, [])

  // Ajouter toutes les pistes locales
  if (_localStream) {
    _localStream.getTracks().forEach(t => pc.addTrack(t, _localStream!))
  }

  pc.onicecandidate = (e) => {
    if (e.candidate) {
      useWs.getState().send({
        type: 'VOICE_SIGNAL',
        to: peerId,
        payload: { type: 'ice', data: e.candidate.toJSON() },
      })
    }
  }

  pc.ontrack = (e) => {
    const stream = e.streams[0]
    if (!stream) return
    set(s => ({ peers: s.peers.map(p => p.userId === peerId ? { ...p, stream } : p) }))
  }

  pc.onconnectionstatechange = () => {
    if (pc.connectionState === 'failed' || pc.connectionState === 'disconnected') {
      pc.close()
      _pcs.delete(peerId)
      _iceQueues.delete(peerId)
      set(s => ({ peers: s.peers.filter(p => p.userId !== peerId) }))
    }
  }

  set(s => ({
    peers: s.peers.some(p => p.userId === peerId)
      ? s.peers
      : [...s.peers, {
          userId: peerId,
          username: info.username ?? peerId,
          avatar: info.avatar,
          discriminator: info.discriminator,
          stream: null,
          muted: info.muted ?? false,
          deafened: false,
          videoEnabled: info.videoEnabled ?? false,
          screenSharing: false,
        }],
  }))

  return pc
}

async function _drainIce(peerId: string) {
  const pc = _pcs.get(peerId)
  const queue = _iceQueues.get(peerId) ?? []
  if (!pc || queue.length === 0) return
  _iceQueues.set(peerId, [])
  for (const c of queue) {
    try { await pc.addIceCandidate(new RTCIceCandidate(c)) } catch {}
  }
}

function _broadcastState(get: () => VoiceStore) {
  const s = get()
  if (!s.channelId) return
  useWs.getState().send({
    type: 'VOICE_STATE',
    channel_id: s.channelId,
    muted: s.muted,
    deafened: s.deafened,
    video: s.videoEnabled,
    screen: s.screenSharing,
  })
}

function _refreshLocalStream(set: (fn: (s: VoiceStore) => Partial<VoiceStore>) => void) {
  set(() => ({ localStream: _localStream ? new MediaStream(_localStream.getTracks()) : null }))
}

// â”€â”€ Store â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
export const useVoice = create<VoiceStore>((set, get) => ({
  channelId: null,
  channelName: null,
  serverId: null,
  joined: false,
  peers: [],
  localStream: null,
  muted: false,
  deafened: false,
  videoEnabled: false,
  screenSharing: false,
  error: null,
  roomParticipants: {},
  pttActive: false,
  pttMode: false,
  userVolumes: {},
  activePrioritySpeaker: null,
  whisperTargets: null,
  activeStreams: {},

  // â”€â”€ Listeners globaux (joins/leaves de tout le monde pour la sidebar) â”€â”€â”€â”€â”€â”€
  initGlobalListeners: () => {
    const ws = useWs.getState()
    const offJoined = ws.on('VOICE_USER_JOINED', (d: any) => {
      set(s => {
        const current = s.roomParticipants[d.channel_id] ?? []
        return {
          roomParticipants: {
            ...s.roomParticipants,
            [d.channel_id]: [
              ...current.filter(p => p.userId !== d.user_id),
              { userId: d.user_id, username: d.username, avatar: d.avatar, muted: false, video: false, screen: false },
            ],
          },
        }
      })
    })
    const offLeft = ws.on('VOICE_USER_LEFT', (d: any) => {
      set(s => {
        const current = s.roomParticipants[d.channel_id] ?? []
        return {
          roomParticipants: {
            ...s.roomParticipants,
            [d.channel_id]: current.filter(p => p.userId !== d.user_id),
          },
        }
      })
    })
    const offVoiceState = ws.on('VOICE_STATE_UPDATE', (d: any) => {
      const isPriority = d.priority_speaker === true

      set(s => {
        const current = s.roomParticipants[d.channel_id] ?? []
        const prevPriority = s.activePrioritySpeaker

        // Mise Ã  jour du priority speaker actif
        let newActivePriority = s.activePrioritySpeaker
        if (isPriority && !d.muted) {
          newActivePriority = d.user_id
        } else if (s.activePrioritySpeaker === d.user_id && (d.muted || !isPriority)) {
          newActivePriority = null
        }

        // Duck audio : si un priority speaker vient de commencer Ã  parler
        const duckStarted = newActivePriority !== null && prevPriority === null
        const duckEnded = newActivePriority === null && prevPriority !== null

        if (duckStarted || duckEnded) {
          // Appliquer/retirer l'attÃ©nuation sur tous les peers sauf le priority speaker
          const ctx = _getAudioCtx()
          s.peers.forEach(peer => {
            if (peer.userId === d.user_id) return
            let gainNode = _gainNodes.get(peer.userId)
            if (!gainNode && peer.stream) {
              const source = ctx.createMediaStreamSource(peer.stream)
              gainNode = ctx.createGain()
              const dest = ctx.createMediaStreamDestination()
              source.connect(gainNode)
              gainNode.connect(dest)
              _gainNodes.set(peer.userId, gainNode)
            }
            if (gainNode) {
              const targetGain = duckStarted ? 0.3 : (s.userVolumes[peer.userId] ?? 100) / 100
              gainNode.gain.setTargetAtTime(targetGain, ctx.currentTime, 0.05)
            }
          })
        }

        return {
          activePrioritySpeaker: newActivePriority,
          roomParticipants: {
            ...s.roomParticipants,
            [d.channel_id]: current.map(p =>
              p.userId === d.user_id
                ? { ...p, muted: d.muted, video: d.video, screen: d.screen }
                : p
            ),
          },
          // Mettre Ã  jour le peer si on est dans la mÃªme room
          peers: s.peers.map(p =>
            p.userId === d.user_id
              ? { ...p, muted: d.muted, videoEnabled: d.video, screenSharing: d.screen, prioritySpeaker: isPriority }
              : p
          ),
        }
      })
    })
    const offStreamStart = ws.on('STREAM_START', (d: any) => {
      set(s => ({
        activeStreams: {
          ...s.activeStreams,
          [d.user_id]: { userId: d.user_id, username: d.username, channelId: d.channel_id },
        },
      }))
    })
    const offStreamEnd = ws.on('STREAM_END', (d: any) => {
      set(s => {
        const next = { ...s.activeStreams }
        delete next[d.user_id]
        return { activeStreams: next }
      })
    })
    return () => { offJoined(); offLeft(); offVoiceState(); offStreamStart(); offStreamEnd() }
  },

  // â”€â”€ Join â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
  join: async (channelId, serverId, withVideo = false, password, channelName) => {
    const cur = get()
    if (cur.joined && cur.channelId === channelId) return
    if (cur.joined) get().leave()

    set({ error: null })

    let stream: MediaStream
    try {
      stream = await navigator.mediaDevices.getUserMedia({
        audio: { echoCancellation: true, noiseSuppression: true, autoGainControl: true },
        video: withVideo ? { width: { ideal: 1280 }, height: { ideal: 720 }, frameRate: { ideal: 30 } } : false,
      })
    } catch {
      if (withVideo) {
        try {
          stream = await navigator.mediaDevices.getUserMedia({
            audio: { echoCancellation: true, noiseSuppression: true, autoGainControl: true },
          })
        } catch {
          set({ error: 'Impossible d\'accÃ©der au microphone. VÃ©rifiez les permissions du navigateur.' })
          return
        }
      } else {
        set({ error: 'Impossible d\'accÃ©der au microphone. VÃ©rifiez les permissions du navigateur.' })
        return
      }
    }

    _localStream = stream

    // Appliquer la noise suppression si activÃ©e dans les prÃ©fÃ©rences
    const noiseSuppressionEnabled = localStorage.getItem('fc_noise_suppression') !== 'false'
    if (noiseSuppressionEnabled) {
      _processedStream = _applyNoiseSuppression(stream)
      // Le stream envoyÃ© aux peers est le stream traitÃ© (audio filtrÃ© + vidÃ©o originale)
      _localStream = _processedStream
    }

    const hasVideo = stream.getVideoTracks().length > 0

    set({
      joined: true,
      channelId,
      channelName: channelName ?? null,
      serverId,
      localStream: stream,
      videoEnabled: hasVideo,
      muted: false,
      deafened: false,
      screenSharing: false,
      peers: [],
    })

    const ws = useWs.getState()

    const offExisting = ws.on('VOICE_EXISTING_PEERS', async (d: any) => {
      if (d.channel_id !== channelId) return
      // Initialiser roomParticipants avec les peers existants
      set(s => ({
        roomParticipants: {
          ...s.roomParticipants,
          [channelId]: (d.peers ?? []).map((p: any) => ({
            userId: p.user_id, username: p.username, avatar: p.avatar,
            muted: p.muted ?? false, video: p.video ?? false, screen: p.screen ?? false,
          })),
        },
      }))
      for (const peer of (d.peers ?? [])) {
        const pc = await _createPC(peer.user_id, {
          username: peer.username, avatar: peer.avatar,
          discriminator: peer.discriminator, muted: peer.muted,
        }, get, set)
        try {
          const offer = await pc.createOffer()
          await pc.setLocalDescription(offer)
          ws.send({ type: 'VOICE_SIGNAL', to: peer.user_id, payload: { type: 'offer', data: { type: offer.type, sdp: offer.sdp } } })
        } catch {}
      }
    })

    const offJoined = ws.on('VOICE_USER_JOINED', (d: any) => {
      if (d.channel_id !== channelId) return
      _createPC(d.user_id, { username: d.username, avatar: d.avatar, discriminator: d.discriminator }, get, set)
    })

    const offLeft = ws.on('VOICE_USER_LEFT', (d: any) => {
      if (d.channel_id !== channelId) return
      const pc = _pcs.get(d.user_id)
      pc?.close()
      _pcs.delete(d.user_id)
      _iceQueues.delete(d.user_id)
      set(s => ({ peers: s.peers.filter(p => p.userId !== d.user_id) }))
    })

    const offSignal = ws.on('VOICE_SIGNAL', async (d: any) => {
      const { from, payload } = d
      // Si on reÃ§oit une offer pour un peer inconnu, crÃ©er le PC
      if (payload.type === 'offer' && !_pcs.has(from)) {
        await _createPC(from, { username: from }, get, set)
      }
      const pc = _pcs.get(from)
      if (!pc) return
      try {
        if (payload.type === 'offer') {
          await pc.setRemoteDescription(new RTCSessionDescription(payload.data))
          await _drainIce(from)
          const answer = await pc.createAnswer()
          await pc.setLocalDescription(answer)
          ws.send({ type: 'VOICE_SIGNAL', to: from, payload: { type: 'answer', data: { type: answer.type, sdp: answer.sdp } } })
        } else if (payload.type === 'answer') {
          if (pc.signalingState === 'have-local-offer') {
            await pc.setRemoteDescription(new RTCSessionDescription(payload.data))
            await _drainIce(from)
          }
        } else if (payload.type === 'ice') {
          if (payload.data) {
            if (pc.remoteDescription) {
              try { await pc.addIceCandidate(new RTCIceCandidate(payload.data)) } catch {}
            } else {
              const q = _iceQueues.get(from) ?? []
              q.push(payload.data)
              _iceQueues.set(from, q)
            }
          }
        }
      } catch {}
    })

    _offFns = [offExisting, offJoined, offLeft, offSignal]

    ws.send({ type: 'VOICE_JOIN', channel_id: channelId, ...(password ? { password } : {}) })

    // Broadcast Ã©tat initial
    setTimeout(() => {
      ws.send({ type: 'VOICE_STATE', channel_id: channelId, muted: false, deafened: false, video: hasVideo, screen: false })
    }, 200)
  },

  // â”€â”€ Leave â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
  leave: () => {
    const { channelId, joined } = get()
    if (!joined) return

    useWs.getState().send({ type: 'VOICE_LEAVE', channel_id: channelId })

    _pcs.forEach(pc => pc.close())
    _pcs.clear()
    _iceQueues.clear()
    _gainNodes.clear()

    // Stopper le stream brut original (pas _localStream qui peut pointer vers processedStream)
    const rawStream = _processedStream
      ? (get().localStream ?? _localStream)
      : _localStream
    rawStream?.getTracks().forEach(t => t.stop())

    _cleanupNoiseSuppression()
    _localStream = null
    _screenTrack?.stop()
    _screenTrack = null

    _offFns.forEach(off => off())
    _offFns = []

    set({ joined: false, channelId: null, channelName: null, serverId: null, localStream: null, peers: [], muted: false, deafened: false, videoEnabled: false, screenSharing: false, error: null, pttActive: false, pttMode: false, userVolumes: {}, activePrioritySpeaker: null, whisperTargets: null, activeStreams: {} })
  },

  // â”€â”€ Toggle mute â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
  toggleMute: () => {
    const { muted } = get()
    const next = !muted
    _localStream?.getAudioTracks().forEach(t => { t.enabled = !next })
    set({ muted: next })
    _broadcastState(get)
  },

  // â”€â”€ Toggle deafen â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
  toggleDeafen: () => {
    const { deafened } = get()
    const next = !deafened
    // Couper/rÃ©tablir l'audio de tous les pairs
    get().peers.forEach(peer => {
      peer.stream?.getAudioTracks().forEach(t => { t.enabled = !next })
    })
    set({ deafened: next })
    _broadcastState(get)
  },

  // â”€â”€ Toggle vidÃ©o â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
  toggleVideo: async () => {
    const { videoEnabled, joined, screenSharing } = get()
    if (!joined || !_localStream || screenSharing) return

    if (videoEnabled) {
      // DÃ©sactiver
      _localStream.getVideoTracks().forEach(t => { t.stop(); _localStream!.removeTrack(t) })
      for (const [, pc] of _pcs) {
        const sender = pc.getSenders().find(s => s.track?.kind === 'video')
        if (sender) try { await sender.replaceTrack(null) } catch {}
      }
      set({ videoEnabled: false })
      _refreshLocalStream(set)
    } else {
      // Activer la camÃ©ra + renegociation
      try {
        const vs = await navigator.mediaDevices.getUserMedia({
          video: { width: { ideal: 1280 }, height: { ideal: 720 }, frameRate: { ideal: 30 } },
        })
        const vt = vs.getVideoTracks()[0]
        _localStream.addTrack(vt)
        for (const [peerId, pc] of _pcs) {
          const sender = pc.getSenders().find(s => s.track?.kind === 'video')
          if (sender) {
            await sender.replaceTrack(vt)
          } else {
            pc.addTrack(vt, _localStream)
            try {
              const offer = await pc.createOffer()
              await pc.setLocalDescription(offer)
              useWs.getState().send({ type: 'VOICE_SIGNAL', to: peerId, payload: { type: 'offer', data: { type: offer.type, sdp: offer.sdp } } })
            } catch {}
          }
        }
        set({ videoEnabled: true })
        _refreshLocalStream(set)
      } catch {
        set({ error: 'Impossible d\'accÃ©der Ã  la camÃ©ra.' })
      }
    }
    _broadcastState(get)
  },

  // â”€â”€ Screen share â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
  shareScreen: async () => {
    const { joined } = get()
    if (!joined || !_localStream) return

    try {
      const screenStream = await (navigator.mediaDevices as any).getDisplayMedia({
        video: { width: { ideal: 1920 }, height: { ideal: 1080 }, frameRate: { ideal: 30 } },
        audio: true,
      })

      const svt = screenStream.getVideoTracks()[0]
      _screenTrack = svt

      // Remplacer/ajouter la piste vidÃ©o dans tous les PC
      for (const [peerId, pc] of _pcs) {
        const sender = pc.getSenders().find(s => s.track?.kind === 'video')
        if (sender) {
          await sender.replaceTrack(svt)
        } else {
          pc.addTrack(svt, _localStream)
          try {
            const offer = await pc.createOffer()
            await pc.setLocalDescription(offer)
            useWs.getState().send({ type: 'VOICE_SIGNAL', to: peerId, payload: { type: 'offer', data: { type: offer.type, sdp: offer.sdp } } })
          } catch {}
        }
      }

      // Mettre Ã  jour le stream local (preview)
      _localStream.getVideoTracks().forEach(t => { t.stop(); _localStream!.removeTrack(t) })
      _localStream.addTrack(svt)

      // GÃ©rer l'audio systÃ¨me si capturÃ©
      if (screenStream.getAudioTracks().length > 0) {
        const sat = screenStream.getAudioTracks()[0]
        _localStream.addTrack(sat)
        for (const [peerId, pc] of _pcs) {
          try { pc.addTrack(sat, _localStream) } catch {}
        }
      }

      set({ screenSharing: true, videoEnabled: true })
      _refreshLocalStream(set)
      _broadcastState(get)

      // ArrÃªt auto quand l'utilisateur clique "ArrÃªter" dans le navigateur
      svt.onended = () => { get().stopScreenShare() }
    } catch {
      // L'utilisateur a annulÃ©
    }
  },

  // â”€â”€ Stop screen share â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
  stopScreenShare: () => {
    if (!_localStream) return
    _screenTrack?.stop()
    _screenTrack = null

    _localStream.getVideoTracks().forEach(t => { t.stop(); _localStream!.removeTrack(t) })
    for (const [, pc] of _pcs) {
      const sender = pc.getSenders().find(s => s.track?.kind === 'video')
      if (sender) sender.replaceTrack(null).catch(() => {})
    }

    set({ screenSharing: false, videoEnabled: false })
    _refreshLocalStream(set)
    _broadcastState(get)
  },

  clearError: () => set({ error: null }),

  // â”€â”€ Push-to-talk â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
  setPttMode: (enabled) => {
    set({ pttMode: enabled })
    if (!enabled) {
      // Quand on dÃ©sactive PTT, on restaure le vrai Ã©tat mute
      const { muted } = get()
      _localStream?.getAudioTracks().forEach(t => { t.enabled = !muted })
    }
  },

  activatePtt: () => {
    const { pttMode, joined } = get()
    if (!pttMode || !joined) return
    // Ouvrir le micro pendant PTT (sans changer l'Ã©tat muted persistant)
    _localStream?.getAudioTracks().forEach(t => { t.enabled = true })
    set({ pttActive: true })
  },

  deactivatePtt: () => {
    const { pttMode, muted, joined } = get()
    if (!pttMode || !joined) return
    // Remettre l'Ã©tat de mute d'avant
    _localStream?.getAudioTracks().forEach(t => { t.enabled = !muted })
    set({ pttActive: false })
  },

  // â”€â”€ Volume par utilisateur â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
  setUserVolume: (userId, volume) => {
    set(s => ({ userVolumes: { ...s.userVolumes, [userId]: volume } }))

    // Appliquer via GainNode WebAudio si le peer a un stream
    const peer = get().peers.find(p => p.userId === userId)
    if (!peer?.stream) return

    const ctx = _getAudioCtx()
    let gainNode = _gainNodes.get(userId)

    if (!gainNode) {
      const source = ctx.createMediaStreamSource(peer.stream)
      gainNode = ctx.createGain()
      const dest = ctx.createMediaStreamDestination()
      source.connect(gainNode)
      gainNode.connect(dest)
      _gainNodes.set(userId, gainNode)
    }

    gainNode.gain.setTargetAtTime(volume / 100, ctx.currentTime, 0.01)
  },

  // â”€â”€ Noise suppression toggle (persistÃ© en localStorage) â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
  setNoiseSuppressionEnabled: (enabled) => {
    localStorage.setItem('fc_noise_suppression', enabled ? 'true' : 'false')
    // Si on est en appel, on ne peut pas re-traiter le stream en temps rÃ©el
    // (il faudrait quit/rejoin) â€” on avertit juste l'utilisateur via un rechargement
    // du store. En pratique, le changement s'applique au prochain join().
  },

  // â”€â”€ Whisper : parler uniquement Ã  certains peers â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
  setWhisperTargets: (targets) => {
    set({ whisperTargets: targets })

    // Activer/dÃ©sactiver les tracks audio vers chaque peer
    for (const [peerId, pc] of _pcs) {
      const isWhisperTarget = targets === null || targets.includes(peerId)
      const senders = pc.getSenders().filter(s => s.track?.kind === 'audio')
      senders.forEach(sender => {
        if (sender.track) {
          sender.track.enabled = isWhisperTarget
        }
      })
    }
  },
}))



