import { create } from 'zustand'
import { useWs } from './ws'
import { useAuth } from './auth'
import api from '../api/client'

export interface VoicePeer {
  userId: string
  username: string
  avatar?: string
  discriminator?: string
  stream: MediaStream | null       // audio micro + vidéo caméra
  screenStream: MediaStream | null // vidéo écran partagé — distinct de stream, actif simultanément
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
  localScreenStream: MediaStream | null
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
  setNoiseSuppressionEnabled(enabled: boolean): Promise<void>
  // Whisper
  setWhisperTargets(targets: string[] | null): void
}

// Trace des échecs de signaling — les deux vrais bugs WebRTC de 2026-07-14 se
// cachaient derrière des catch muets ; ne jamais avaler ces erreurs en silence.
function _warn(ctx: string, e: unknown) {
  console.warn(`[voice] ${ctx}`, e)
}

// ── Singletons non-réactifs ──────────────────────────────────────────────────
const _pcs = new Map<string, RTCPeerConnection>()
export const getPeerConnections = () => _pcs
const _iceQueues = new Map<string, RTCIceCandidateInit[]>()
let _localStream: MediaStream | null = null
let _rawAudioTrack: MediaStreamTrack | null = null  // piste audio brute (avant noise suppression)
let _processedStream: MediaStream | null = null     // stream après traitement noise suppression
let _noiseAudioCtx: AudioContext | null = null       // AudioContext dédié noise suppression
let _screenTrack: MediaStreamTrack | null = null
let _screenAudioTrack: MediaStreamTrack | null = null // audio système capturé pendant le partage (mixé au micro)
let _localScreenStream: MediaStream | null = null
let _micMixCtx: AudioContext | null = null
let _micTrackBeforeMix: MediaStreamTrack | null = null // piste micro à restaurer sur le sender après le partage
let _mixedAudioTrack: MediaStreamTrack | null = null // piste mixée courante (micro+audio système), si un mix est actif
// Stream dédié (sans piste locale) utilisé uniquement pour donner à la piste écran un
// msid distinct de _localStream — permet au récepteur de séparer caméra vs écran sans
// signalisation additionnelle (cf. _createPC/ontrack : 1er stream vu = groupe caméra,
// tout stream avec un id différent = écran).
let _localScreenGroupStream: MediaStream | null = null
const _screenSenders = new Map<string, RTCRtpSender>()
// Sender de NOTRE caméra par pair — sans ceci, camSender() retombait sur n'importe quel
// sender track===null, y compris le sender recvonly auto-créé par le navigateur quand le
// pair distant active sa propre caméra en premier. replaceTrack() sur ce sender-là marche
// (aperçu local OK) mais ne renégocie jamais et le pair ne reçoit jamais rien : caméra
// bidirectionnelle silencieusement cassée si le distant a activé la sienne avant nous.
const _camSenders = new Map<string, RTCRtpSender>()
const _camStreamId = new Map<string, string>() // peerId -> id du MediaStream distant groupant micro+caméra
let _offFns: Array<() => void> = []

// Cache de la config ICE — fetchée une seule fois par session
let _iceConfigCache: RTCConfiguration | null = null


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
// Highpass 85Hz → Lowpass 8kHz → Noise gate (AudioWorklet) → Compressor 12:1 → Gain output
// Le gate attaque un point que les filtres statiques ne couvrent pas : ils façonnent
// le spectre mais laissent passer le bruit constant (ventilateur, hum) sous le niveau
// de la voix. Le gate coupe ce bruit pendant les silences/creux, filtres avant lui.
let _noiseGain: GainNode | null = null
let _noiseWorkletModule: Promise<void> | null = null

async function _ensureNoiseWorklet(ctx: AudioContext): Promise<boolean> {
  if (!_noiseWorkletModule) {
    _noiseWorkletModule = ctx.audioWorklet.addModule('/noise-gate-worklet.js')
  }
  try {
    await _noiseWorkletModule
    return true
  } catch (e) {
    _warn('chargement noise-gate-worklet', e)
    _noiseWorkletModule = null
    return false
  }
}

async function _buildNoiseChain(ctx: AudioContext, source: MediaStreamAudioSourceNode): Promise<MediaStreamAudioDestinationNode> {
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

  const gateReady = await _ensureNoiseWorklet(ctx)
  source.connect(highpass)
  highpass.connect(lowpass)

  if (gateReady) {
    const gate = new AudioWorkletNode(ctx, 'noise-gate-processor')
    lowpass.connect(gate)
    gate.connect(compressor)
  } else {
    // Worklet indisponible (vieux navigateur/contexte non sécurisé) — filtres statiques seuls
    lowpass.connect(compressor)
  }

  compressor.connect(outputGain)
  outputGain.connect(dest)
  return dest
}

async function _applyNoiseSuppression(inputStream: MediaStream): Promise<MediaStream> {
  try {
    // Réutiliser le contexte existant — évite la fuite mémoire sur rejoin
    if (!_noiseAudioCtx || _noiseAudioCtx.state === 'closed') {
      _noiseAudioCtx = new AudioContext({ sampleRate: 48000 })
    }
    const ctx = _noiseAudioCtx
    // Resume AudioContext — browsers may suspend it outside a user gesture
    if (ctx.state === 'suspended') {
      await ctx.resume().catch(() => {})
    }

    const source = ctx.createMediaStreamSource(inputStream)
    const dest = await _buildNoiseChain(ctx, source)

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

// ── Mixage audio système + micro pendant le partage d'écran ──────────────────
// Un seul sender audio existe par PC (le micro) — on y remplace la piste par ce
// mix plutôt que d'ouvrir un 2e sender, pour rester compatible avec le reste du
// code qui suppose un seul flux audio par peer.
function _mixSystemAudioWithMic(systemTrack: MediaStreamTrack, micTrack: MediaStreamTrack): MediaStreamTrack {
  try {
    if (!_micMixCtx || _micMixCtx.state === 'closed') _micMixCtx = new AudioContext()
    const ctx = _micMixCtx
    if (ctx.state === 'suspended') ctx.resume().catch(() => {})
    const dest = ctx.createMediaStreamDestination()
    ctx.createMediaStreamSource(new MediaStream([micTrack])).connect(dest)
    ctx.createMediaStreamSource(new MediaStream([systemTrack])).connect(dest)
    return dest.stream.getAudioTracks()[0]
  } catch (e) {
    _warn('mixage audio système+micro', e)
    return micTrack
  }
}

function _cleanupMicMix() {
  if (_micMixCtx && _micMixCtx.state !== 'closed') {
    _micMixCtx.close()
    _micMixCtx = null
  }
}

// Pousse une piste micro (brute ou traitée NS) vers tous les senders audio — si un
// partage d'écran avec audio système est en cours, re-mixe d'abord avec cette
// nouvelle piste au lieu d'écraser le mix (cf. toggle NS pendant un partage).
function _pushMicTrackToSenders(micTrack: MediaStreamTrack) {
  let outTrack = micTrack
  if (_screenAudioTrack) {
    _micTrackBeforeMix = micTrack
    outTrack = _mixSystemAudioWithMic(_screenAudioTrack, micTrack)
  }
  _mixedAudioTrack = _screenAudioTrack ? outTrack : null
  _pcs.forEach(async (pc) => {
    const sender = pc.getSenders().find(s => s.track?.kind === 'audio')
    if (sender) try { await sender.replaceTrack(outTrack) } catch (e) { _warn('mise à jour piste audio', e) }
  })
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

  // Ajouter toutes les pistes locales (peer qui rejoint après coup avec caméra déjà active)
  if (_localStream) {
    _localStream.getTracks().forEach(t => {
      const sender = pc.addTrack(t, _localStream!)
      if (t.kind === 'video') _camSenders.set(peerId, sender)
    })
  }
  // Si un partage d'écran est déjà en cours (peer rejoint après coup), lui envoyer
  // aussi la piste écran — sender séparé, groupé sous _localScreenGroupStream
  if (_screenTrack && _localScreenGroupStream) {
    const sender = pc.addTrack(_screenTrack, _localScreenGroupStream)
    _screenSenders.set(peerId, sender)
  }
  // Si un mix micro+audio système est déjà actif, ce peer doit recevoir le mix — pas
  // juste le micro brut ajouté par la boucle ci-dessus (sinon il n'entend jamais le
  // son du partage d'écran, contrairement aux peers déjà connectés)
  if (_mixedAudioTrack) {
    const audioSender = pc.getSenders().find(s => s.track?.kind === 'audio')
    if (audioSender) audioSender.replaceTrack(_mixedAudioTrack).catch(() => {})
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
    const incoming = e.streams[0] ?? new MediaStream([e.track])
    const camId = _camStreamId.get(peerId)
    // Piste audio ou 1er flux vidéo vu pour ce peer → groupe micro+caméra (msid de référence)
    // Piste vidéo d'un flux avec un msid différent → écran partagé (cf. shareScreen)
    const isScreenVideo = e.track.kind === 'video' && camId !== undefined && incoming.id !== camId

    if (!isScreenVideo && !_camStreamId.has(peerId)) {
      _camStreamId.set(peerId, incoming.id)
    }

    if (isScreenVideo) {
      set(s => ({ peers: s.peers.map(p => p.userId === peerId ? { ...p, screenStream: incoming, screenSharing: true } : p) }))
      e.track.onended = () => {
        set(s => ({ peers: s.peers.map(p => p.userId === peerId ? { ...p, screenStream: null, screenSharing: false } : p) }))
      }
    } else {
      // Respecter le deafen actif : couper l'audio des flux arrivés après activation
      if (e.track.kind === 'audio' && get().deafened) {
        incoming.getAudioTracks().forEach(t => { t.enabled = false })
      }
      set(s => ({ peers: s.peers.map(p => p.userId === peerId ? { ...p, stream: incoming } : p) }))
    }
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
          _camStreamId.delete(peerId)
          _screenSenders.delete(peerId)
          _camSenders.delete(peerId)
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
            _camStreamId.delete(peerId)
            _screenSenders.delete(peerId)
            _camSenders.delete(peerId)
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
          screenStream: null,
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
  localScreenStream: null,
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

        // Mise à jour du priority speaker actif
        let newActivePriority = s.activePrioritySpeaker
        if (isPriority && !d.muted) {
          newActivePriority = d.user_id
        } else if (s.activePrioritySpeaker === d.user_id && (d.muted || !isPriority)) {
          newActivePriority = null
        }

        // Le duck (atténuation des autres pairs pendant qu'un priority speaker parle) est
        // appliqué réactivement par PersistentVoiceAudio à partir de activePrioritySpeaker
        // ci-dessous (HTMLMediaElement.volume) — pas ici. Avant ce fix, le duck créait son
        // propre gain node Web Audio connecté à ctx.createMediaStreamDestination() (un flux
        // qui ne joue nulle part), donc l'atténuation n'avait jamais d'effet audible ; le
        // volume réel venait toujours du <audio> natif de PeerTile, inchangé.

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
              ? { ...p, muted: d.muted, videoEnabled: d.video, screenSharing: d.screen, prioritySpeaker: isPriority, screenStream: d.screen ? p.screenStream : null }
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
    // Sauvegarder la piste audio brute — nécessaire pour restaurer quand NS désactivée
    _rawAudioTrack = stream.getAudioTracks()[0] ?? null

    // Appliquer la noise suppression si activée dans les préférences
    const noiseSuppressionEnabled = localStorage.getItem('fc_noise_suppression') !== 'false'
    if (noiseSuppressionEnabled) {
      _processedStream = await _applyNoiseSuppression(stream)
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
      localScreenStream: null,
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
        } catch (e) { _warn(`offer initiale vers ${peer.user_id}`, e) }
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
      _camStreamId.delete(d.user_id)
      _screenSenders.delete(d.user_id)
      _camSenders.delete(d.user_id)
      set(s => ({ peers: s.peers.filter(p => p.userId !== d.user_id) }))
    })

    const offSignal = ws.on('VOICE_SIGNAL', async (d: any) => {
      const { from, payload } = d
      // Ignorer les signaux d'appel DM (format payload.sdp/candidate) — seul le format
      // vocal de serveur (payload.data) concerne ce store
      if (!payload || payload.data === undefined) return
      // Si on reçoit une offer pour un peer inconnu, créer le PC
      if (payload.type === 'offer' && !_pcs.has(from)) {
        await _createPC(from, { username: from }, get, set)
      }
      const pc = _pcs.get(from)
      if (!pc) return
      try {
        if (payload.type === 'offer') {
          // Glare (offers croisées quand les deux pairs renégocient en même temps) :
          // le pair "poli" (id lexicographiquement inférieur) abandonne son offer
          // locale (rollback) et répond ; l'autre ignore l'offer entrante — la sienne
          // gagne, et le poli re-proposera sa modification une fois stable.
          let rolledBack = false
          if (pc.signalingState === 'have-local-offer') {
            const myId = useAuth.getState().user?.id ?? ''
            const polite = myId < from
            if (!polite) return
            await pc.setLocalDescription({ type: 'rollback' })
            rolledBack = true
          }
          await pc.setRemoteDescription(new RTCSessionDescription(payload.data))
          await _drainIce(from)
          const answer = await pc.createAnswer()
          await pc.setLocalDescription(answer)
          ws.send({ type: 'VOICE_SIGNAL', to: from, payload: { type: 'answer', data: { type: answer.type, sdp: answer.sdp } } })
          // Re-proposer la modification abandonnée par le rollback (ex: notre caméra)
          if (rolledBack && pc.signalingState === 'stable') {
            const offer = await pc.createOffer()
            await pc.setLocalDescription(offer)
            ws.send({ type: 'VOICE_SIGNAL', to: from, payload: { type: 'offer', data: { type: offer.type, sdp: offer.sdp } } })
          }
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
      } catch (e) { _warn(`signal ${payload?.type} de ${from} (état ${pc.signalingState})`, e) }
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
    _camStreamId.clear()
    _screenSenders.clear()
    _camSenders.clear()

    // Stopper toutes les pistes des deux streams (raw + processed)
    const allTracks = new Set<MediaStreamTrack>()
    _localStream?.getTracks().forEach(t => allTracks.add(t))
    _processedStream?.getTracks().forEach(t => allTracks.add(t))
    _localScreenStream?.getTracks().forEach(t => allTracks.add(t))
    allTracks.forEach(t => t.stop())

    _cleanupNoiseSuppression()
    _localStream = null
    _rawAudioTrack = null
    _screenTrack?.stop()
    _screenTrack = null
    _screenAudioTrack?.stop()
    _screenAudioTrack = null
    _micTrackBeforeMix = null
    _mixedAudioTrack = null
    _cleanupMicMix()
    _localScreenStream = null
    _localScreenGroupStream = null

    _offFns.forEach(off => off())
    _offFns = []

    set({ joined: false, channelId: null, channelName: null, serverId: null, localStream: null, localScreenStream: null, peers: [], muted: false, deafened: false, videoEnabled: false, screenSharing: false, error: null, pttActive: false, pttMode: false, userVolumes: {}, activePrioritySpeaker: null, whisperTargets: null, activeStreams: {} })
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
    const { videoEnabled, joined } = get()
    if (!joined || !_localStream) return

    // Sender caméra = NOTRE sender vidéo suivi explicitement (cf. _camSenders) — un simple
    // `track === null` matcherait aussi le sender recvonly auto-créé par le navigateur en
    // recevant la caméra du pair distant, cassant la renégociation (voir commentaire _camSenders).
    const camSender = (pc: RTCPeerConnection, peerId: string) => {
      const tracked = _camSenders.get(peerId)
      if (tracked && pc.getSenders().includes(tracked)) return tracked
      const screenSender = _screenSenders.get(peerId)
      return pc.getSenders().find(s => s.track?.kind === 'video' && s !== screenSender)
    }

    if (videoEnabled) {
      // Désactiver
      _localStream.getVideoTracks().forEach(t => { t.stop(); _localStream!.removeTrack(t) })
      for (const [peerId, pc] of _pcs) {
        const sender = camSender(pc, peerId)
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
          const sender = camSender(pc, peerId)
          if (sender) {
            await sender.replaceTrack(vt)
          } else {
            const newSender = pc.addTrack(vt, _localStream)
            _camSenders.set(peerId, newSender)
            try {
              const offer = await pc.createOffer()
              await pc.setLocalDescription(offer)
              useWs.getState().send({ type: 'VOICE_SIGNAL', to: peerId, payload: { type: 'offer', data: { type: offer.type, sdp: offer.sdp } } })
            } catch (e) { _warn(`renégociation caméra vers ${peerId}`, e) }
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
  // Caméra et écran voyagent sur deux pistes vidéo distinctes (deux senders) —
  // partager l'écran n'arrête plus la caméra, les deux sont visibles simultanément
  // chez les pairs (cf. pc.ontrack : le stream écran a un msid distinct de _localStream).
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
      if (!_localScreenGroupStream) _localScreenGroupStream = new MediaStream()

      // Audio système capturé (ex: onglet avec du son) — mixé au micro sur le même
      // sender audio, le micro n'est plus jamais coupé pendant un partage avec son
      const sat = screenStream.getAudioTracks()[0]
      if (sat) {
        const micTrack = _localStream.getAudioTracks()[0]
        if (micTrack) {
          _screenAudioTrack = sat
          _pushMicTrackToSenders(micTrack)
        } else {
          sat.stop()
        }
      }

      // Ajouter/remplacer la piste écran dans tous les PC — sender dédié, séparé de la caméra
      for (const [peerId, pc] of _pcs) {
        const existingSender = _screenSenders.get(peerId)
        if (existingSender) {
          await existingSender.replaceTrack(svt)
        } else {
          const sender = pc.addTrack(svt, _localScreenGroupStream)
          _screenSenders.set(peerId, sender)
          try {
            const offer = await pc.createOffer()
            await pc.setLocalDescription(offer)
            useWs.getState().send({ type: 'VOICE_SIGNAL', to: peerId, payload: { type: 'offer', data: { type: offer.type, sdp: offer.sdp } } })
          } catch (e) { _warn(`renégociation partage d'écran vers ${peerId}`, e) }
        }
      }

      // Aperçu local de l'écran — flux séparé, la caméra locale n'est pas touchée
      _localScreenStream = new MediaStream([svt])

      set({ screenSharing: true, localScreenStream: _localScreenStream })
      _broadcastState(get)

      // Arrêt auto quand l'utilisateur clique "Arrêter" dans le navigateur
      svt.onended = () => { get().stopScreenShare() }
    } catch {
      // L'utilisateur a annulé
    }
  },

  // ── Stop screen share ─────────────────────────────────────────────────────
  stopScreenShare: async () => {
    _screenTrack?.stop()
    _screenTrack = null
    _localScreenStream = null

    // Restaurer le micro seul sur le sender audio (retire le mix avec l'audio système)
    _screenAudioTrack?.stop()
    _screenAudioTrack = null
    _mixedAudioTrack = null
    if (_micTrackBeforeMix) {
      const micTrack = _micTrackBeforeMix
      _micTrackBeforeMix = null
      for (const [, pc] of _pcs) {
        const audioSender = pc.getSenders().find(s => s.track?.kind === 'audio')
        if (audioSender) try { await audioSender.replaceTrack(micTrack) } catch (e) { _warn('restauration micro post-partage', e) }
      }
      _cleanupMicMix()
    }

    for (const [peerId, pc] of _pcs) {
      const sender = _screenSenders.get(peerId)
      if (!sender) continue
      _screenSenders.delete(peerId)
      try {
        pc.removeTrack(sender)
        const offer = await pc.createOffer()
        await pc.setLocalDescription(offer)
        useWs.getState().send({ type: 'VOICE_SIGNAL', to: peerId, payload: { type: 'offer', data: { type: offer.type, sdp: offer.sdp } } })
      } catch (e) { _warn(`arrêt partage d'écran vers ${peerId}`, e) }
    }

    set({ screenSharing: false, localScreenStream: null })
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
  // Le volume réel est appliqué réactivement par PersistentVoiceAudio (HTMLMediaElement.volume)
  // à partir de userVolumes ci-dessous — pas de Web Audio ici.
  setUserVolume: (userId, volume) => {
    set(s => ({ userVolumes: { ...s.userVolumes, [userId]: volume } }))
  },

  // ── Noise suppression toggle — appliqué en temps réel si en appel ───────────
  setNoiseSuppressionEnabled: async (enabled) => {
    localStorage.setItem('fc_noise_suppression', enabled ? 'true' : 'false')

    if (!get().joined || !_localStream) return

    if (enabled && !_noiseGain) {
      // Activer NS sur la piste brute sauvegardée
      if (!_rawAudioTrack) {
        _rawAudioTrack = _localStream?.getAudioTracks()[0] ?? null
      }
      if (!_rawAudioTrack) return
      // Construire le stream brut pour _applyNoiseSuppression
      const rawStreamForNS = new MediaStream([
        _rawAudioTrack,
        ...(_localStream?.getVideoTracks() ?? []),
      ])
      const processed = await _applyNoiseSuppression(rawStreamForNS)
      _processedStream = processed
      _localStream = processed
      // Remplacer la piste audio dans tous les PC existants
      const audioTrack = processed.getAudioTracks()[0]
      if (audioTrack) _pushMicTrackToSenders(audioTrack)
      set(() => ({ localStream: new MediaStream(processed.getTracks()) }))
    } else if (!enabled && _noiseGain) {
      // Désactiver : revenir à la piste audio BRUTE (pas la piste du stream traité)
      const rawTrack = _rawAudioTrack
      if (rawTrack) _pushMicTrackToSenders(rawTrack)
      const videoTracks = _localStream?.getVideoTracks() ?? []
      _cleanupNoiseSuppression()
      // Reconstruire le stream local avec la piste brute + pistes vidéo originales
      _localStream = new MediaStream([
        ...(_rawAudioTrack ? [_rawAudioTrack] : []),
        ...videoTracks,
      ])
      set(() => ({ localStream: _localStream }))
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



