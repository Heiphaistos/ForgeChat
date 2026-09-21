// Couche WebRTC du vocal de serveur (mesh P2P, une RTCPeerConnection par pair).
// Séparée du store pour garder les deux fichiers lisibles : ici la négociation,
// les pistes et les senders ; dans voice.ts l'état React et les actions UI.
//
// Points durs traités ici, tous constatés en production :
//  1. `onnegotiationneeded` : sans lui, un pair déjà en caméra ou en partage
//     d'écran n'était JAMAIS visible par un nouvel arrivant (l'arrivant était le
//     seul à émettre l'offer, et une answer ne peut pas ajouter de m-line).
//  2. Perfect negotiation complet (makingOffer + polite/impolite) : la fenêtre
//     entre createOffer() et setLocalDescription() laissait passer une offer
//     distante, puis notre setLocalDescription levait InvalidStateError et la
//     connexion restait figée sans retry.
//  3. `disconnected` prolongé : on relance ICE au lieu de supprimer le pair.
//  4. Identification caméra/écran signalée explicitement (msid annoncé), plus
//     devinée sur « le premier flux vu ».
import type { VoicePeer } from './voice'
import { useWs } from './ws'
import { useAuth } from './auth'
import api from '../api/client'

export function warn(ctx: string, e: unknown) {
  console.warn(`[voice] ${ctx}`, e)
}

export interface MeshCtx {
  get: () => any
  set: (fn: (s: any) => any) => void
}

// ── État média local ─────────────────────────────────────────────────────────
let _localStream: MediaStream | null = null          // ce qu'on envoie (micro traité + caméra)
let _rawMicTrack: MediaStreamTrack | null = null     // piste micro brute issue de getUserMedia
let _micTrack: MediaStreamTrack | null = null        // piste micro réellement envoyée
let _screenGroup: MediaStream | null = null          // msid commun aux pistes d'écran
let _screenVideoTrack: MediaStreamTrack | null = null
let _screenAudioTrack: MediaStreamTrack | null = null

export const getLocalStream = () => _localStream
export const getRawMicTrack = () => _rawMicTrack
export const getMicTrack = () => _micTrack
export const getScreenGroup = () => _screenGroup
export const getScreenVideoTrack = () => _screenVideoTrack

// ── Connexions ───────────────────────────────────────────────────────────────
const _pcs = new Map<string, RTCPeerConnection>()
const _creating = new Map<string, Promise<RTCPeerConnection>>()
const _iceQueues = new Map<string, RTCIceCandidateInit[]>()
const _camSenders = new Map<string, RTCRtpSender>()
const _screenSenders = new Map<string, RTCRtpSender>()
const _screenAudioSenders = new Map<string, RTCRtpSender>()
const _micSenders = new Map<string, RTCRtpSender>()
const _makingOffer = new Map<string, boolean>()
const _ignoreOffer = new Map<string, boolean>()
const _remoteScreenMsid = new Map<string, string>()
const _camStreamId = new Map<string, string>()
const _retryTimers = new Map<string, ReturnType<typeof setTimeout>>()

export const getPeerConnections = () => _pcs
// Exposé pour le diagnostic (console, harnais Playwright) : sans accès aux
// RTCPeerConnection, un appel qui coupe n'est analysable qu'à l'aveugle.
if (typeof window !== 'undefined') (window as any).__fcPcs = _pcs

// ── Config ICE ───────────────────────────────────────────────────────────────
const ICE_FALLBACK: RTCConfiguration = {
  iceServers: [
    { urls: 'stun:stun.l.google.com:19302' },
    { urls: 'stun:stun1.l.google.com:19302' },
    { urls: 'stun:stun2.l.google.com:19302' },
  ],
}

let _iceConfig: RTCConfiguration | null = null
let _iceExpiry = 0

export async function getIceConfig(): Promise<RTCConfiguration> {
  // Les identifiants TURN sont éphémères côté serveur : on recharge à expiration
  // au lieu de mettre en cache pour toute la session.
  if (_iceConfig && Date.now() < _iceExpiry) return _iceConfig
  try {
    const res = await api.get('/voice/ice-config')
    _iceConfig = { iceServers: res.data.ice_servers }
    const ttl = typeof res.data.ttl === 'number' ? res.data.ttl : 3600
    _iceExpiry = Date.now() + Math.max(60, ttl - 60) * 1000
    return _iceConfig
  } catch (e) {
    warn('récupération config ICE (repli STUN seul)', e)
    return ICE_FALLBACK
  }
}

const send = (msg: any) => useWs.getState().send(msg)
const myId = () => useAuth.getState().user?.id ?? ''

// ── Qualité d'émission ───────────────────────────────────────────────────────
export interface QualityPrefs {
  camMaxBitrate: number
  screenMaxBitrate: number
  screenContentHint: 'motion' | 'detail'
}

export function getQualityPrefs(): QualityPrefs {
  const cam = Number(localStorage.getItem('fc_cam_bitrate') ?? '1200000')
  const screen = Number(localStorage.getItem('fc_screen_bitrate') ?? '4000000')
  const hint = (localStorage.getItem('fc_screen_hint') as 'motion' | 'detail') ?? 'motion'
  return {
    camMaxBitrate: Number.isFinite(cam) && cam > 0 ? cam : 1200000,
    screenMaxBitrate: Number.isFinite(screen) && screen > 0 ? screen : 4000000,
    screenContentHint: hint === 'detail' ? 'detail' : 'motion',
  }
}

async function applySenderQuality(sender: RTCRtpSender, kind: 'camera' | 'screen') {
  try {
    const prefs = getQualityPrefs()
    const params = sender.getParameters()
    // Ne jamais fabriquer d'encodings : setParameters exige l'objet rendu par
    // getParameters, une liste reconstruite est rejetee (et peut couper l'emission).
    if (!params.encodings || params.encodings.length === 0) return
    params.encodings[0].maxBitrate = kind === 'camera' ? prefs.camMaxBitrate : prefs.screenMaxBitrate
    params.degradationPreference = kind === 'camera' ? 'balanced' : 'maintain-resolution'
    await sender.setParameters(params)
  } catch (e) {
    warn(`réglage qualité ${kind}`, e)
  }
}

export async function refreshAllSenderQuality() {
  for (const [peerId, pc] of _pcs) {
    const cam = _camSenders.get(peerId)
    if (cam?.track) await applySenderQuality(cam, 'camera')
    const scr = _screenSenders.get(peerId)
    if (scr?.track) await applySenderQuality(scr, 'screen')
    void pc
  }
}

// ── Négociation ──────────────────────────────────────────────────────────────
async function negotiate(peerId: string, pc: RTCPeerConnection) {
  if (pc.signalingState === 'closed') return
  try {
    _makingOffer.set(peerId, true)
    await pc.setLocalDescription()
    const ld = pc.localDescription
    if (!ld) return
    send({ type: 'VOICE_SIGNAL', to: peerId, payload: { type: 'offer', data: { type: ld.type, sdp: ld.sdp } } })
  } catch (e) {
    warn(`négociation vers ${peerId}`, e)
  } finally {
    _makingOffer.set(peerId, false)
  }
}

/** Renégocie explicitement (ICE restart, reprise après échec). */
export async function renegotiate(peerId: string) {
  const pc = _pcs.get(peerId)
  if (!pc) return
  await negotiate(peerId, pc)
}

function announceScreenMsid(peerId: string) {
  if (!_screenGroup) return
  send({ type: 'VOICE_SIGNAL', to: peerId, payload: { type: 'meta', data: { screen_msid: _screenGroup.id } } })
}

// ── Création d'un pair ───────────────────────────────────────────────────────
export async function createPC(peerId: string, info: Partial<VoicePeer>, ctx: MeshCtx): Promise<RTCPeerConnection> {
  const existing = _pcs.get(peerId)
  if (existing) return existing
  // Garde de réentrance AVANT tout await : deux déclencheurs concurrents
  // (VOICE_USER_JOINED + offer entrante) créaient deux PC, la première écrasée
  // dans la Map et jamais fermée — elle continuait d'émettre le micro.
  const pending = _creating.get(peerId)
  if (pending) return pending

  const promise = (async () => {
    const pc = new RTCPeerConnection(await getIceConfig())
    _pcs.set(peerId, pc)
    _iceQueues.set(peerId, [])
    _makingOffer.set(peerId, false)
    _ignoreOffer.set(peerId, false)

    if (_localStream && _localStream.getTracks().length > 0) {
      for (const t of _localStream.getTracks()) {
        const sender = pc.addTrack(t, _localStream)
        if (t.kind === 'video') { _camSenders.set(peerId, sender); void applySenderQuality(sender, 'camera') }
        else _micSenders.set(peerId, sender)
      }
    } else {
      // Écoute seule : sans transceiver explicite, notre offer serait vide.
      pc.addTransceiver('audio', { direction: 'recvonly' })
      pc.addTransceiver('video', { direction: 'recvonly' })
    }

    if (_screenVideoTrack && _screenGroup) {
      const sender = pc.addTrack(_screenVideoTrack, _screenGroup)
      _screenSenders.set(peerId, sender)
      void applySenderQuality(sender, 'screen')
      if (_screenAudioTrack) _screenAudioSenders.set(peerId, pc.addTrack(_screenAudioTrack, _screenGroup))
      announceScreenMsid(peerId)
    }

    pc.onicecandidate = (e) => {
      if (e.candidate) send({ type: 'VOICE_SIGNAL', to: peerId, payload: { type: 'ice', data: e.candidate.toJSON() } })
    }

    pc.onnegotiationneeded = () => { void negotiate(peerId, pc) }

    pc.ontrack = (e) => {
      const incoming = e.streams[0] ?? new MediaStream([e.track])
      const screenMsid = _remoteScreenMsid.get(peerId)
      const camId = _camStreamId.get(peerId)
      const isScreen = screenMsid !== undefined
        ? incoming.id === screenMsid
        : e.track.kind === 'video' && camId !== undefined && incoming.id !== camId

      if (!isScreen && !_camStreamId.has(peerId)) _camStreamId.set(peerId, incoming.id)

      if (isScreen) {
        ctx.set((s: any) => ({ peers: s.peers.map((p: VoicePeer) => p.userId === peerId ? { ...p, screenStream: incoming, screenSharing: true } : p) }))
        e.track.onended = () => {
          ctx.set((s: any) => ({ peers: s.peers.map((p: VoicePeer) => p.userId === peerId ? { ...p, screenStream: null, screenSharing: false } : p) }))
        }
      } else {
        if (e.track.kind === 'audio' && ctx.get().deafened) {
          incoming.getAudioTracks().forEach(t => { t.enabled = false })
        }
        ctx.set((s: any) => ({ peers: s.peers.map((p: VoicePeer) => p.userId === peerId ? { ...p, stream: incoming } : p) }))
      }
    }

    pc.onconnectionstatechange = () => {
      const st = pc.connectionState
      if (st === 'connected') {
        const t = _retryTimers.get(peerId)
        if (t) { clearTimeout(t); _retryTimers.delete(peerId) }
        ctx.set((s: any) => ({ peers: s.peers.map((p: VoicePeer) => p.userId === peerId ? { ...p, connectionLost: false } : p) }))
        return
      }
      if (st !== 'disconnected' && st !== 'failed') return

      ctx.set((s: any) => ({ peers: s.peers.map((p: VoicePeer) => p.userId === peerId ? { ...p, connectionLost: true } : p) }))
      if (_retryTimers.has(peerId)) return

      // Reprise progressive : ICE restart à 4 s, nouvel essai à 12 s, abandon à 25 s.
      // Avant, un `disconnected` de plus de 4 s supprimait définitivement le pair
      // pour cette session — plus aucune image ni son, sans moyen de récupérer.
      const attempt = (delay: number, next: (() => void) | null) => {
        const timer = setTimeout(async () => {
          _retryTimers.delete(peerId)
          const cur = pc.connectionState
          if (cur === 'connected' || cur === 'closed') return
          try {
            pc.restartIce()
            await negotiate(peerId, pc)
          } catch (e) { warn(`reprise ICE ${peerId}`, e) }
          if (next) next()
        }, delay)
        _retryTimers.set(peerId, timer)
      }
      attempt(4000, () => attempt(8000, () => {
        const timer = setTimeout(() => {
          _retryTimers.delete(peerId)
          if (pc.connectionState === 'connected') return
          teardownPeer(peerId, ctx)
        }, 13000)
        _retryTimers.set(peerId, timer)
      }))
    }

    ctx.set((s: any) => ({
      peers: s.peers.some((p: VoicePeer) => p.userId === peerId)
        ? s.peers.map((p: VoicePeer) => p.userId === peerId ? { ...p, ...info } : p)
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
            screenSharing: info.screenSharing ?? false,
            connectionLost: false,
          }],
    }))

    return pc
  })()

  _creating.set(peerId, promise)
  try {
    return await promise
  } finally {
    _creating.delete(peerId)
  }
}

export function teardownPeer(peerId: string, ctx: MeshCtx) {
  const pc = _pcs.get(peerId)
  pc?.close()
  _pcs.delete(peerId)
  _iceQueues.delete(peerId)
  _camSenders.delete(peerId)
  _micSenders.delete(peerId)
  _screenSenders.delete(peerId)
  _screenAudioSenders.delete(peerId)
  _camStreamId.delete(peerId)
  _remoteScreenMsid.delete(peerId)
  _makingOffer.delete(peerId)
  _ignoreOffer.delete(peerId)
  const t = _retryTimers.get(peerId)
  if (t) { clearTimeout(t); _retryTimers.delete(peerId) }
  ctx.set((s: any) => ({ peers: s.peers.filter((p: VoicePeer) => p.userId !== peerId) }))
}

export function teardownAll(ctx: MeshCtx) {
  for (const peerId of [..._pcs.keys()]) teardownPeer(peerId, ctx)
  _pcs.clear()
  _creating.clear()
  _retryTimers.forEach(t => clearTimeout(t))
  _retryTimers.clear()
}

// ── Signalisation entrante ───────────────────────────────────────────────────
async function drainIce(peerId: string) {
  const pc = _pcs.get(peerId)
  const queue = _iceQueues.get(peerId) ?? []
  if (!pc || queue.length === 0) return
  _iceQueues.set(peerId, [])
  for (const c of queue) {
    try { await pc.addIceCandidate(new RTCIceCandidate(c)) } catch (e) { warn(`candidat ICE en file (${peerId})`, e) }
  }
}

export async function handleSignal(from: string, payload: any, ctx: MeshCtx) {
  if (payload?.type === 'meta') {
    if (typeof payload.data?.screen_msid === 'string') _remoteScreenMsid.set(from, payload.data.screen_msid)
    return
  }
  if (payload?.type === 'offer' && !_pcs.has(from)) {
    await createPC(from, { username: from }, ctx)
  }
  const pc = _pcs.get(from)
  if (!pc) return

  try {
    if (payload.type === 'offer') {
      const polite = myId() < from
      const collision = _makingOffer.get(from) === true || pc.signalingState !== 'stable'
      _ignoreOffer.set(from, !polite && collision)
      if (_ignoreOffer.get(from)) return
      // Rollback UNIQUEMENT depuis have-local-offer : appele en 'stable' (cas
      // makingOffer=true, ou createOffer pas encore applique) il leve
      // InvalidStateError, l'offer distante n'est jamais repondue et le pair
      // reste fige -- c'etait la cause des echecs intermittents du glare.
      if (pc.signalingState === 'have-local-offer') {
        await pc.setLocalDescription({ type: 'rollback' } as RTCLocalSessionDescriptionInit)
      }
      await pc.setRemoteDescription(new RTCSessionDescription(payload.data))
      await drainIce(from)
      await pc.setLocalDescription()
      const ld = pc.localDescription
      if (ld) send({ type: 'VOICE_SIGNAL', to: from, payload: { type: 'answer', data: { type: ld.type, sdp: ld.sdp } } })
      if (_screenGroup) announceScreenMsid(from)
    } else if (payload.type === 'answer') {
      if (pc.signalingState === 'have-local-offer') {
        await pc.setRemoteDescription(new RTCSessionDescription(payload.data))
        await drainIce(from)
      } else {
        // Une answer hors état était jetée sans trace : le pair pouvait rester
        // bloqué en have-local-offer indéfiniment.
        warn(`answer ignorée de ${from} (état ${pc.signalingState})`, null)
        if (pc.signalingState === 'stable') void negotiate(from, pc)
      }
    } else if (payload.type === 'ice' && payload.data) {
      if (pc.remoteDescription) {
        try { await pc.addIceCandidate(new RTCIceCandidate(payload.data)) } catch (e) {
          if (!_ignoreOffer.get(from)) warn(`candidat ICE de ${from}`, e)
        }
      } else {
        const q = _iceQueues.get(from) ?? []
        q.push(payload.data)
        _iceQueues.set(from, q)
      }
    }
  } catch (e) {
    warn(`signal ${payload?.type} de ${from} (état ${pc.signalingState})`, e)
  }
}

// ── Pistes locales ───────────────────────────────────────────────────────────
export function setLocalStream(stream: MediaStream | null, rawMic: MediaStreamTrack | null) {
  _localStream = stream
  _rawMicTrack = rawMic
  _micTrack = stream?.getAudioTracks()[0] ?? null
}

/** Remplace la piste micro envoyée à tous les pairs et réapplique l'état mute. */
export async function replaceMicTrack(track: MediaStreamTrack, micEnabled: boolean) {
  _micTrack = track
  track.enabled = micEnabled
  if (_localStream) {
    _localStream.getAudioTracks().forEach(t => { if (t !== track) _localStream!.removeTrack(t) })
    if (!_localStream.getAudioTracks().includes(track)) _localStream.addTrack(track)
  }
  for (const [peerId, pc] of _pcs) {
    const sender = _micSenders.get(peerId) ?? pc.getSenders().find(s => s.track?.kind === 'audio' && s !== _screenAudioSenders.get(peerId))
    if (!sender) continue
    _micSenders.set(peerId, sender)
    try { await sender.replaceTrack(track) } catch (e) { warn(`remplacement micro vers ${peerId}`, e) }
  }
}

/** Source unique de vérité pour l'ouverture du micro (mute, PTT). */
export function applyMicEnabled(enabled: boolean) {
  if (_micTrack) _micTrack.enabled = enabled
  // La piste brute reste active : elle alimente la chaîne de traitement, c'est la
  // piste de sortie qui est coupée.
  if (_rawMicTrack) _rawMicTrack.enabled = true
}

/**
 * Chuchotement : on coupe l'émission PAR SENDER (replaceTrack(null)), jamais via
 * `track.enabled` — tous les senders partagent le même MediaStreamTrack, donc
 * l'ancienne implémentation coupait le micro pour tout le monde.
 */
export async function setWhisper(targets: string[] | null, micTrack: MediaStreamTrack | null) {
  const track = micTrack ?? _micTrack
  for (const [peerId] of _pcs) {
    const sender = _micSenders.get(peerId)
    if (!sender) continue
    const shouldSend = targets === null || targets.includes(peerId)
    try { await sender.replaceTrack(shouldSend ? track : null) } catch (e) { warn(`chuchotement vers ${peerId}`, e) }
  }
}

export async function addCameraTrack(track: MediaStreamTrack) {
  if (!_localStream) return
  _localStream.getVideoTracks().forEach(t => { if (t !== track) { t.stop(); _localStream!.removeTrack(t) } })
  _localStream.addTrack(track)
  for (const [peerId, pc] of _pcs) {
    const tracked = _camSenders.get(peerId)
    const sender = tracked && pc.getSenders().includes(tracked) ? tracked : null
    if (sender) {
      try { await sender.replaceTrack(track) } catch (e) { warn(`caméra vers ${peerId}`, e) }
      await applySenderQuality(sender, 'camera')
    } else {
      const created = pc.addTrack(track, _localStream)
      _camSenders.set(peerId, created)
      await applySenderQuality(created, 'camera')
      // pas de createOffer ici : onnegotiationneeded s'en charge
    }
  }
}

export async function removeCameraTrack() {
  if (!_localStream) return
  _localStream.getVideoTracks().forEach(t => { t.stop(); _localStream!.removeTrack(t) })
  for (const [peerId] of _pcs) {
    const sender = _camSenders.get(peerId)
    if (sender) try { await sender.replaceTrack(null) } catch (e) { warn(`extinction caméra vers ${peerId}`, e) }
  }
}

export async function replaceCameraTrack(track: MediaStreamTrack) {
  await addCameraTrack(track)
}

export async function startScreenTracks(video: MediaStreamTrack, audio: MediaStreamTrack | null, hint: 'motion' | 'detail') {
  _screenVideoTrack = video
  _screenAudioTrack = audio
  try { (video as any).contentHint = hint } catch { /* contentHint non supporté */ }
  if (audio) { try { (audio as any).contentHint = 'music' } catch { /* idem */ } }
  if (!_screenGroup) _screenGroup = new MediaStream()
  _screenGroup.getTracks().forEach(t => _screenGroup!.removeTrack(t))
  _screenGroup.addTrack(video)
  if (audio) _screenGroup.addTrack(audio)

  for (const [peerId, pc] of _pcs) {
    announceScreenMsid(peerId)
    const existing = _screenSenders.get(peerId)
    if (existing) {
      try { await existing.replaceTrack(video) } catch (e) { warn(`partage vers ${peerId}`, e) }
      await applySenderQuality(existing, 'screen')
    } else {
      const sender = pc.addTrack(video, _screenGroup)
      _screenSenders.set(peerId, sender)
      await applySenderQuality(sender, 'screen')
    }
    if (audio) {
      const existingAudio = _screenAudioSenders.get(peerId)
      if (existingAudio) {
        try { await existingAudio.replaceTrack(audio) } catch (e) { warn(`audio du partage vers ${peerId}`, e) }
      } else {
        _screenAudioSenders.set(peerId, pc.addTrack(audio, _screenGroup))
      }
    }
  }
}

export async function stopScreenTracks() {
  _screenVideoTrack?.stop()
  _screenAudioTrack?.stop()
  _screenVideoTrack = null
  _screenAudioTrack = null
  for (const [peerId, pc] of _pcs) {
    const sender = _screenSenders.get(peerId)
    if (sender) {
      _screenSenders.delete(peerId)
      try { pc.removeTrack(sender) } catch (e) { warn(`arrêt partage vers ${peerId}`, e) }
    }
    const audioSender = _screenAudioSenders.get(peerId)
    if (audioSender) {
      _screenAudioSenders.delete(peerId)
      try { pc.removeTrack(audioSender) } catch (e) { warn(`arrêt audio partage vers ${peerId}`, e) }
    }
  }
  _screenGroup = null
}

export function clearLocalMedia() {
  _localStream = null
  _rawMicTrack = null
  _micTrack = null
  _screenGroup = null
  _screenVideoTrack = null
  _screenAudioTrack = null
}
