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
  // Participants par canal (pour la sidebar — tous serveurs)
  roomParticipants: Record<string, VoiceRoomParticipant[]>
  // Push-to-talk
  pttActive: boolean
  pttMode: boolean
  // Volume par utilisateur (0-200, 100 = normal)
  userVolumes: Record<string, number>
  // Priority speaker actif (userId ou null)
  activePrioritySpeaker: string | null
  // Whisper : liste des userId à qui on chuchote (null = mode normal)
  whisperTargets: string[] | null
  // Streams actifs Go Live : userId ? {userId, username, channelId}
  activeStreams: Record<string, { userId: string; username: string; channelId: string }>

  join(channelId: string, serverId: string, withVideo?: boolean, password?: string, channelName?: string): Promise<void>
  leave(): void
  toggleMute(): void
  toggleDeafen(): void
  toggleVideo(): Promise<void>
  shareScreen(): Promise<void>
  stopScreenShare(): Promise<void>
  clearError(): void
  // Appelé par App pour écouter les events globaux (joins/leaves)
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

// ── Singletons non-réactifs ──────────────────────────────────────────────────
const _pcs = new Map<string, RTCPeerConnection>()
export const getPeerConnections = () => _pcs
const _iceQueues = new Map<string, RTCIceCandidateInit[]>()
const _gainNodes = new Map<string, GainNode>()
let _audioCtx: AudioContext | null = null
let _localStream: MediaStream | null = null
let _processedStream: MediaStream | null = null     // stream après traitement noise suppression
let _noiseAudioCtx: AudioContext | null = null       // AudioContext dédié noise suppression
let _screenTrack: MediaStreamTrack | null = null
let _cameraTrackBeforeShare: MediaStreamTrack | null = null
let _offFns: Array<() => void> = []
let _pttMuted = false // état mute "réel" avant PTT

// Cache de la config ICE — fetchée une seule fois par session
let _iceConfigCache: RTCConfiguration | null = null

function _getAudioCtx(): AudioContext {
  if (!_audioCtx || _audioCtx.state === 'closed') {
    _audioCtx = new AudioContext()
  }
  return _audioCtx
}

// Fallback ICE config (STUN seulement) utilisé si le fetch échoue
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
    // En cas d'erreur réseau, fallback STUN seulement
    return ICE_FALLBACK
  }
}

// ── Noise Suppression (chaîne Web Audio "Krisp-like") ────────────────────────
// Highpass 85Hz → Lowpass 8kHz → Compressor 12:1 → Gain output
let _noiseGain: GainNode | null = null

function _buildNoiseChain(ctx: AudioContext, source: MediaStreamAudioSourceNode): MediaStreamAudioDestinationNode {
  const highpass = ctx.createBiquadFilter()
  highpass.type = 'highpass'
  highpass.frequency.value = 85
  highpass.Q.value = 0.5

  const lowpass = ctx.createBiquadFilter()
  lowpass.type = 'lowpass'
  lowpass.frequency.value = 8000
  lowpass.Q.value = 0.5

  const compressor = ctx.createDynamicsCompressor()
  compressor.threshold.value = -55
  compressor.knee.value = 30
  compressor.ratio.value = 12
  compressor.attack.value = 0.003
  compressor.release.value = 0.15

  const outputGain = ctx.createGain()
  outputGain.gain.value = 1.4
  _noiseGain = outputGain

  const dest = ctx.createMediaStreamDestination()
  source.connect(highpass)
  highpass.connect(lowpass)
  lowpass.connect(compressor)
  compressor.connect(outputGain)
  outputGain.connect(dest)
  return dest
}

function _applyNoiseSuppression(inputStream: MediaStream): MediaStream {
  try {
    // Réutiliser le contexte existant — évite la fuite mémoire sur rejoin
    if (!_noiseAudioCtx || _noiseAudioCtx.state === 'closed') {
      _noiseAudioCtx = new AudioContext({ sampleRate: 48000 })
    }
    const ctx = _noiseAudioCtx
    // Resume AudioContext� browsers may suspend it outside a user gesture
    if (ctx.state === 'suspended') {
      ctx.resume().catch(() => {})
    }

    const source = ctx.createMediaStreamSource(inputStream)
    const dest = _buildNoiseChain(ctx, source)

    const outputStream = dest.stream
    inputStream.getVideoTracks().forEach(t => outputStream.addTrack(t))
    return outputStream
  } catch {
    return inputStream
  }
}

function _cleanupNoiseSuppression() {
  _noiseGain = null
  if (_noiseAudioCtx && _noiseAudioCtx.state !== 'closed') {
    _noiseAudioCtx.close()
    _noiseAudioCtx = null
  }
  _processedStream = null
}

// ── Helpers ──────────────────────────────────────────────────────────────────
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
    const stream = e.streams[0] ?? new MediaStream([e.track])
    set(s => ({ peers: s.peers.map(p => p.userId === peerId ? { ...p, stream } : p) }))
  }

  let _reconnectTimer: ReturnType<typeof setTimeout> | null = null

  pc.onconnectionstatechange = () => {
    const state_ = pc.connectionState
    if (state_ === 'disconnected') {
      // Attendre 4s avant de fermer — les coupures réseau temporaires récupèrent souvent
      _reconnectTimer = setTimeout(() => {
        if (pc.connectionState === 'disconnected' || pc.connectionState === 'failed') {
          pc.close()
          _pcs.delete(peerId)
          _iceQueues.delete(peerId)
          set(s => ({ peers: s.peers.filter(p => p.userId !== peerId) }))
        }
      }, 4000)
    } else if (state_ === 'failed') {
      if (_reconnectTimer) { clearTimeout(_reconnectTimer); _reconnectTimer = null }
      // Tentative de renegotiation ICE restart avant de supprimer le peer
      pc.restartIce()
      setTimeout(async () => {
        if (pc.connectionState === 'failed') {
          try {
            const offer = await pc.createOffer({ iceRestart: true })
            await pc.setLocalDescription(offer)
            useWs.getState().send({ type: 'VOICE_SIGNAL', to: peerId, payload: { type: 'offer', data: { type: offer.type, sdp: offer.sdp } } })
          } catch {
            pc.close()
            _pcs.delete(peerId)
            _iceQueues.delete(peerId)
            set(s => ({ peers: s.peers.filter(p => p.userId !== peerId) }))
          }
        }
      }, 2000)
    } else if (state_ === 'connected') {
      if (_reconnectTimer) { clearTimeout(_reconnectTimer); _reconnectTimer = null }
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

// ── Store ─────────────────────────────────────────────────────────────────────
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

  // ── Listeners globaux (joins/leaves de tout le monde pour la sidebar) ──────
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

        // Mise à jour du priority speaker actif
        let newActivePriority = s.activePrioritySpeaker
        if (isPriority && !d.muted) {
          newActivePriority = d.user_id
        } else if (s.activePrioritySpeaker === d.user_id && (d.muted || !isPriority)) {
          newActivePriority = null
        }

        // Duck audio : si un priority speaker vient de commencer à parler
        const duckStarted = newActivePriority !== null && prevPriority === null
        const duckEnded = newActivePriority === null && prevPriority !== null

        if (duckStarted || duckEnded) {
          // Appliquer/retirer l'atténuation sur tous les peers sauf le priority speaker
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
          // Mettre à jour le peer si on est dans la même room
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

  // ── Join ──────────────────────────────────────────────────────────────────
  join: async (channelId, serverId, withVideo = false, password, channelName) => {
    const cur = get()
    if (cur.joined && cur.channelId === channelId) return
    if (cur.joined) get().leave()

    set({ error: null })

    const savedMicId = localStorage.getItem('fc_audio_input') || undefined
    const audioConstraints: MediaTrackConstraints = {
      echoCancellation: true,
      noiseSuppression: true,
      autoGainControl: true,
      ...(savedMicId ? { deviceId: { exact: savedMicId } } : {}),
    }

    let stream: MediaStream
    try {
      stream = await navigator.mediaDevices.getUserMedia({
        audio: audioConstraints,
        video: withVideo ? { width: { ideal: 1280 }, height: { ideal: 720 }, frameRate: { ideal: 30 } } : false,
      })
    } catch {
      if (withVideo) {
        try {
          stream = await navigator.mediaDevices.getUserMedia({
            audio: audioConstraints,
          })
        } catch {
          set({ error: 'Impossible d\'accéder au microphone. Vérifiez les permissions du navigateur.' })
          return
        }
      } else {
        set({ error: 'Impossible d\'accéder au microphone. Vérifiez les permissions du navigateur.' })
        return
      }
    }

    _localStream = stream

    // Appliquer la noise suppression si activée dans les préférences
    const noiseSuppressionEnabled = localStorage.getItem('fc_noise_suppression') !== 'false'
    if (noiseSuppressionEnabled) {
      _processedStream = _applyNoiseSuppression(stream)
      // Le stream envoyé aux peers est le stream traité (audio filtré + vidéo originale)
      _localStream = _processedStream
    }

    const hasVideo = stream.getVideoTracks().length > 0

    set({
      joined: true,
      channelId,
      channelName: channelName ?? null,
      serverId,
      localStream: _localStream,
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
      // Si on reçoit une offer pour un peer inconnu, créer le PC
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

    // Broadcast état initial
    setTimeout(() => {
      ws.send({ type: 'VOICE_STATE', channel_id: channelId, muted: false, deafened: false, video: hasVideo, screen: false })
    }, 200)
  },

  // ── Leave ─────────────────────────────────────────────────────────────────
  leave: () => {
    const { channelId, joined } = get()
    if (!joined) return

    useWs.getState().send({ type: 'VOICE_LEAVE', channel_id: channelId })

    _pcs.forEach(pc => pc.close())
    _pcs.clear()
    _iceQueues.clear()
    // Déconnecter tous les GainNodes avant de les supprimer
    _gainNodes.forEach(g => { try { g.disconnect() } catch {} })
    _gainNodes.clear()

    // Stopper toutes les pistes des deux streams (raw + processed)
    const allTracks = new Set<MediaStreamTrack>()
    _localStream?.getTracks().forEach(t => allTracks.add(t))
    _processedStream?.getTracks().forEach(t => allTracks.add(t))
    allTracks.forEach(t => t.stop())

    _cleanupNoiseSuppression()
    _localStream = null
    _screenTrack?.stop()
    _screenTrack = null

    _offFns.forEach(off => off())
    _offFns = []

    set({ joined: false, channelId: null, channelName: null, serverId: null, localStream: null, peers: [], muted: false, deafened: false, videoEnabled: false, screenSharing: false, error: null, pttActive: false, pttMode: false, userVolumes: {}, activePrioritySpeaker: null, whisperTargets: null, activeStreams: {} })
  },

  // ── Toggle mute ───────────────────────────────────────────────────────────
  toggleMute: () => {
    const { muted } = get()
    const next = !muted
    _localStream?.getAudioTracks().forEach(t => { t.enabled = !next })
    set({ muted: next })
    _broadcastState(get)
  },

  // ── Toggle deafen ─────────────────────────────────────────────────────────
  toggleDeafen: () => {
    const { deafened } = get()
    const next = !deafened
    // Couper/rétablir l'audio de tous les pairs
    get().peers.forEach(peer => {
      peer.stream?.getAudioTracks().forEach(t => { t.enabled = !next })
    })
    set({ deafened: next })
    _broadcastState(get)
  },

  // ── Toggle vidéo ──────────────────────────────────────────────────────────
  toggleVideo: async () => {
    const { videoEnabled, joined, screenSharing } = get()
    if (!joined || !_localStream || screenSharing) return

    if (videoEnabled) {
      // Désactiver
      _localStream.getVideoTracks().forEach(t => { t.stop(); _localStream!.removeTrack(t) })
      for (const [, pc] of _pcs) {
        const sender = pc.getSenders().find(s => s.track?.kind === 'video')
        if (sender) try { await sender.replaceTrack(null) } catch {}
      }
      set({ videoEnabled: false })
      _refreshLocalStream(set)
    } else {
      // Activer la caméra + renegociation
      try {
        const savedCamId = localStorage.getItem('fc_video_input') || undefined
        const vs = await navigator.mediaDevices.getUserMedia({
          video: {
            width: { ideal: 1280 }, height: { ideal: 720 }, frameRate: { ideal: 30 },
            ...(savedCamId ? { deviceId: { exact: savedCamId } } : {}),
          },
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
        set({ error: 'Impossible d\'accéder à la caméra.' })
      }
    }
    _broadcastState(get)
  },

  // ── Screen share ──────────────────────────────────────────────────────────
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

      // Remplacer/ajouter la piste vidéo dans tous les PC
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

      // Mettre à jour le stream local (preview)
      // M�moriser la piste cam�ra active (non-screen) pour restaurer apr�s share
      const existingVideoTrack = _localStream?.getVideoTracks()[0] ?? null
      _cameraTrackBeforeShare = existingVideoTrack

      _localStream.getVideoTracks().forEach(t => { t.stop(); _localStream!.removeTrack(t) })
      _localStream.addTrack(svt)

      // Gérer l'audio système si capturé (sans dupliquer la piste)
      if (screenStream.getAudioTracks().length > 0) {
        const sat = screenStream.getAudioTracks()[0]
        // Ajouter au stream local UNIQUEMENT si pas déjà présent
        if (!_localStream.getTrackById(sat.id)) {
          _localStream.addTrack(sat)
        }
        for (const [peerId, pc] of _pcs) {
          try {
            // Remplacer la piste audio existante plutôt que d'en ajouter une nouvelle
            const audioSender = pc.getSenders().find(s => s.track?.kind === 'audio')
            if (audioSender) {
              await audioSender.replaceTrack(sat)
            } else {
              pc.addTrack(sat, _localStream)
              const offer = await pc.createOffer()
              await pc.setLocalDescription(offer)
              useWs.getState().send({ type: 'VOICE_SIGNAL', to: peerId, payload: { type: 'offer', data: { type: offer.type, sdp: offer.sdp } } })
            }
          } catch (e) {
            console.warn('[Voice] Screen audio track error:', e)
          }
        }
      }

      set({ screenSharing: true, videoEnabled: true })
      _refreshLocalStream(set)
      _broadcastState(get)

      // Arrêt auto quand l'utilisateur clique "Arrêter" dans le navigateur
      svt.onended = () => { get().stopScreenShare() }
    } catch {
      // L'utilisateur a annulé
    }
  },

  // ── Stop screen share ─────────────────────────────────────────────────────
  stopScreenShare: async () => {
    if (!_localStream) return
    _screenTrack?.stop()
    _screenTrack = null

    _localStream.getVideoTracks().forEach(t => { t.stop(); _localStream!.removeTrack(t) })
    for (const [, pc] of _pcs) {
      const sender = pc.getSenders().find(s => s.track?.kind === 'video')
      if (sender) sender.replaceTrack(null).catch(() => {})
    }

    // Restaurer la cam�ra si elle �tait active avant le screen share
    if (_cameraTrackBeforeShare && _cameraTrackBeforeShare.readyState !== 'ended') {
      _localStream?.addTrack(_cameraTrackBeforeShare)
      for (const [peerId, pc] of _pcs) {
        const sender = pc.getSenders().find(s => s.track?.kind === 'video')
        if (sender) {
          try { await sender.replaceTrack(_cameraTrackBeforeShare) } catch {}
        }
      }
      _cameraTrackBeforeShare = null
      set({ screenSharing: false, videoEnabled: true })
    } else {
      _cameraTrackBeforeShare = null
      set({ screenSharing: false, videoEnabled: false })
    }

    _refreshLocalStream(set)
    _broadcastState(get)
  },

  clearError: () => set({ error: null }),

  // ── Push-to-talk ──────────────────────────────────────────────────────────
  setPttMode: (enabled) => {
    set({ pttMode: enabled })
    if (!enabled) {
      // Quand on désactive PTT, on restaure le vrai état mute
      const { muted } = get()
      _localStream?.getAudioTracks().forEach(t => { t.enabled = !muted })
    }
  },

  activatePtt: () => {
    const { pttMode, joined } = get()
    if (!pttMode || !joined) return
    // Ouvrir le micro pendant PTT (sans changer l'état muted persistant)
    _localStream?.getAudioTracks().forEach(t => { t.enabled = true })
    set({ pttActive: true })
  },

  deactivatePtt: () => {
    const { pttMode, muted, joined } = get()
    if (!pttMode || !joined) return
    // Remettre l'état de mute d'avant
    _localStream?.getAudioTracks().forEach(t => { t.enabled = !muted })
    set({ pttActive: false })
  },

  // ── Volume par utilisateur ─────────────────────────────────────────────────
  setUserVolume: (userId, volume) => {
    set(s => ({ userVolumes: { ...s.userVolumes, [userId]: volume } }))

    const peer = get().peers.find(p => p.userId === userId)
    if (!peer?.stream) return

    const ctx = _getAudioCtx()
    let gainNode = _gainNodes.get(userId)

    if (!gainNode) {
      const source = ctx.createMediaStreamSource(peer.stream)
      gainNode = ctx.createGain()
      source.connect(gainNode)
      gainNode.connect(ctx.destination)
      _gainNodes.set(userId, gainNode)
    }

    gainNode.gain.setTargetAtTime(volume / 100, ctx.currentTime, 0.01)
  },

  // ── Noise suppression toggle — appliqué en temps réel si en appel ───────────
  setNoiseSuppressionEnabled: (enabled) => {
    localStorage.setItem('fc_noise_suppression', enabled ? 'true' : 'false')

    if (!get().joined || !_localStream) return

    if (enabled && !_noiseGain) {
      // Activer la chaîne sur le stream brut existant
      const rawStream = get().localStream
      if (!rawStream) return
      const processed = _applyNoiseSuppression(rawStream)
      _processedStream = processed
      // Remplacer la piste audio dans tous les PC existants
      const audioTrack = processed.getAudioTracks()[0]
      if (audioTrack) {
        _pcs.forEach(async (pc) => {
          const sender = pc.getSenders().find(s => s.track?.kind === 'audio')
          if (sender) try { await sender.replaceTrack(audioTrack) } catch {}
        })
      }
    } else if (!enabled && _noiseGain) {
      // Désactiver : revenir à la piste audio brute
      const rawTrack = get().localStream?.getAudioTracks()[0]
      if (rawTrack) {
        _pcs.forEach(async (pc) => {
          const sender = pc.getSenders().find(s => s.track?.kind === 'audio')
          if (sender) try { await sender.replaceTrack(rawTrack) } catch {}
        })
      }
      _cleanupNoiseSuppression()
    }
  },

  // ── Whisper : parler uniquement à certains peers ──────────────────────────
  setWhisperTargets: (targets) => {
    set({ whisperTargets: targets })

    // Activer/désactiver les tracks audio vers chaque peer
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



