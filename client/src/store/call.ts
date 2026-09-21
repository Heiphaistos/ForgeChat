import { create } from 'zustand'
import { useWs } from './ws'
import { useAuth } from './auth'
import api from '../api/client'
import toast from 'react-hot-toast'

export interface IncomingCallInfo {
  fromUserId: string
  fromUsername: string
  dmId: string
  callType: 'voice' | 'video'
}

export type DmCallState = 'idle' | 'calling' | 'ringing' | 'connected'

// Doit rester identique au fallback de store/voice.ts : deux listes STUN divergentes
// donnaient deux comportements différents derrière le même NAT selon qu'on était en
// DM ou en vocal de serveur (défaut N18).
const ICE_FALLBACK = [
  { urls: 'stun:stun.l.google.com:19302' },
  { urls: 'stun:stun1.l.google.com:19302' },
  { urls: 'stun:stun2.l.google.com:19302' },
]

let _iceCache: RTCIceServer[] | null = null
async function getIceServers(): Promise<RTCIceServer[]> {
  if (_iceCache) return _iceCache
  try {
    const res = await api.get('/voice/ice-config')
    _iceCache = res.data.ice_servers ?? ICE_FALLBACK
    return _iceCache!
  } catch {
    return ICE_FALLBACK
  }
}

interface CallStore {
  // ── Notification d'appel entrant (existant) ──────────────────────────────
  incomingCall: IncomingCallInfo | null
  pendingAccept: { fromUserId: string; callType: 'voice' | 'video' } | null
  setIncomingCall: (c: IncomingCallInfo | null) => void
  setPendingAccept: (a: { fromUserId: string; callType: 'voice' | 'video' } | null) => void

  // ── Appel DM actif — état persistant, indépendant de la page affichée ───
  // Avant cette migration, tout ceci vivait dans le hook useDmCall(), instancié
  // par DMPage : démonter DMPage (aller dans Paramètres, un autre canal...)
  // exécutait le cleanup du hook et RACCROCHAIT l'appel en cours, pas juste le
  // son. Migré en store Zustand + variables module-level (même pattern que
  // store/voice.ts) pour que l'appel survive à la navigation.
  dmId: string | null
  partnerId: string | null
  callState: DmCallState
  callType: 'voice' | 'video'
  localStream: MediaStream | null
  remoteStream: MediaStream | null
  micMuted: boolean
  camOff: boolean
  // Miroir du deafen du store vocal (voice.ts) : le bouton « casque coupé » doit aussi
  // couper l'audio d'un appel DM simultané (défaut A21). Poussé par
  // PersistentDmCallAudio, qui est le seul point où les deux stores se croisent.
  deafened: boolean
  // Timestamp de connexion — persiste dans le store (pas un état local de page) pour que
  // la durée affichée reste correcte si on quitte la conversation et qu'on y revient
  // pendant que l'appel est toujours actif, au lieu de repartir de 0.
  connectedAt: number | null

  initGlobalListeners: () => () => void
  startCall: (dmId: string, partnerId: string, type: 'voice' | 'video') => Promise<void>
  acceptCall: (dmId: string, fromUserId: string, type: 'voice' | 'video') => Promise<void>
  declineCall: (dmId: string, fromUserId: string) => void
  hangup: () => void
  toggleMic: () => void
  toggleCam: () => Promise<void>
  setDeafened: (v: boolean) => void
}

// ── État module-level de l'appel DM actif (persiste hors du cycle de vie de tout composant) ──
let _pc: RTCPeerConnection | null = null
let _pcPeer: string | null = null
let _pendingCandidates: RTCIceCandidateInit[] = []
let _callTimeout: ReturnType<typeof setTimeout> | null = null
let _callInFlight = false
let _reconnectTimer: ReturnType<typeof setTimeout> | null = null
// Sender vidéo suivi explicitement : une fois la caméra éteinte par replaceTrack(null),
// aucun `s.track.kind === 'video'` ne permet plus de le retrouver (cf. toggleCam).
let _camSender: RTCRtpSender | null = null
// Fenêtre de course de la négociation : `signalingState` est encore 'stable' entre
// createOffer() et setLocalDescription(). Sans ce drapeau, une offer distante arrivée
// dans cet intervalle est appliquée, puis notre setLocalDescription lève
// InvalidStateError et la PC reste figée (défaut V11/V7).
let _makingOffer = false
let _mySessionId: string | null = null

// Vidange de la file de candidats ICE reçus avant la remoteDescription. Doit être
// appelée dans les DEUX branches (offer ET answer) : côté appelant, seule la branche
// answer existe, et tous les candidats précoces étaient perdus (défaut V4).
async function _drainIce(pc: RTCPeerConnection) {
  const queued = _pendingCandidates
  _pendingCandidates = []
  for (const c of queued) {
    await pc.addIceCandidate(new RTCIceCandidate(c)).catch(() => {})
  }
}

function _cleanup(set: (fn: (s: CallStore) => Partial<CallStore>) => void) {
  _callInFlight = false
  _camSender = null
  _makingOffer = false
  if (_callTimeout) { clearTimeout(_callTimeout); _callTimeout = null }
  if (_reconnectTimer) { clearTimeout(_reconnectTimer); _reconnectTimer = null }
  _pc?.close()
  _pc = null
  _pcPeer = null
  _pendingCandidates = []
  set(s => {
    s.localStream?.getTracks().forEach(t => t.stop())
    return {
      dmId: null, partnerId: null, callState: 'idle',
      localStream: null, remoteStream: null, micMuted: false, camOff: false, connectedAt: null,
    }
  })
}

async function _buildPc(
  pid: string,
  set: (fn: (s: CallStore) => Partial<CallStore>) => void,
  get: () => CallStore,
): Promise<RTCPeerConnection> {
  const iceServers = await getIceServers()
  const pc = new RTCPeerConnection({ iceServers })
  pc.onicecandidate = e => {
    if (e.candidate) {
      useWs.getState().send({ type: 'VOICE_SIGNAL', to: pid, payload: { type: 'ice', candidate: e.candidate.toJSON() } })
    }
  }
  pc.ontrack = e => {
    if (!e.streams[0]) return
    // Respecter un deafen déjà actif : un flux arrivé après le clic sur « casque coupé »
    // doit rester muet (même logique que voice.ts:347)
    if (get().deafened) e.streams[0].getAudioTracks().forEach(t => { t.enabled = false })
    set(() => ({ remoteStream: e.streams[0] }))
  }
  pc.onconnectionstatechange = () => {
    const state_ = pc.connectionState
    if (state_ === 'connected') {
      if (_reconnectTimer) { clearTimeout(_reconnectTimer); _reconnectTimer = null }
      set(s => ({ callState: 'connected', connectedAt: s.connectedAt ?? Date.now() }))
    } else if (state_ === 'disconnected') {
      // Attendre 4s avant de raccrocher -- les coupures réseau temporaires récupèrent
      // souvent (même logique que store/voice.ts, absente ici jusqu'à présent : un DM
      // call raccrochait immédiatement au moindre aléa réseau alors qu'un vocal de
      // serveur survivait au même incident)
      _reconnectTimer = setTimeout(() => {
        if (pc.connectionState === 'disconnected' || pc.connectionState === 'failed') _cleanup(set)
      }, 4000)
    } else if (state_ === 'failed') {
      if (_reconnectTimer) { clearTimeout(_reconnectTimer); _reconnectTimer = null }
      // Tentative de renegotiation ICE restart avant de raccrocher
      pc.restartIce()
      setTimeout(async () => {
        if (pc.connectionState === 'failed') {
          try {
            _makingOffer = true
            const offer = await pc.createOffer({ iceRestart: true })
            await pc.setLocalDescription(offer)
            if (_pcPeer) useWs.getState().send({ type: 'VOICE_SIGNAL', to: _pcPeer, payload: { type: 'offer', sdp: offer } })
          } catch {
            _cleanup(set)
          } finally {
            _makingOffer = false
          }
        }
      }, 2000)
    } else if (state_ === 'closed') {
      _cleanup(set)
    }
  }
  _pc = pc
  _pcPeer = pid
  return pc
}

// Mêmes contraintes que store/voice.ts:567-580 : le micro et la caméra choisis dans
// Réglages étaient ignorés en DM, et aucun traitement (EC/NS/AGC) n'était demandé au
// navigateur — l'appel DM partait sur le périphérique par défaut, brut (défaut A7).
// ponytail: NS maison branchée dans le lot 4 (la chaîne WebAudio de voice.ts est en
// cours de réécriture ; la dupliquer ici créerait un second exemplaire à corriger).
function _audioConstraints(): MediaTrackConstraints {
  const savedMicId = localStorage.getItem('fc_audio_input') || undefined
  return {
    echoCancellation: true,
    noiseSuppression: true,
    autoGainControl: true,
    ...(savedMicId ? { deviceId: { exact: savedMicId } } : {}),
  }
}

function _videoConstraints(): MediaTrackConstraints {
  const savedCamId = localStorage.getItem('fc_video_input') || undefined
  return {
    width: { ideal: 1280 }, height: { ideal: 720 }, frameRate: { ideal: 30 },
    ...(savedCamId ? { deviceId: { exact: savedCamId } } : {}),
  }
}

// getUserMedia avec repli audio seul si la caméra est indisponible
async function _getCallMedia(type: 'voice' | 'video'): Promise<MediaStream> {
  const audio = _audioConstraints()
  try {
    return await navigator.mediaDevices.getUserMedia({ audio, video: type === 'video' ? _videoConstraints() : false })
  } catch {
    if (type === 'video') {
      try {
        const stream = await navigator.mediaDevices.getUserMedia({ audio })
        toast('Caméra indisponible — appel en audio seul', { icon: '🎤', duration: 4000 })
        return stream
      } catch { /* périphérique choisi introuvable : repli plus bas */ }
    }
    // Dernier repli : périphériques par défaut. Un `deviceId: { exact }` pointant sur un
    // micro débranché lève OverconstrainedError et rendrait tout appel DM impossible.
    return await navigator.mediaDevices.getUserMedia({ audio: true, video: type === 'video' })
  }
}

export const useCallStore = create<CallStore>((set, get) => ({
  incomingCall: null,
  pendingAccept: null,
  setIncomingCall: (incomingCall) => set({ incomingCall }),
  setPendingAccept: (pendingAccept) => set({ pendingAccept }),

  dmId: null,
  partnerId: null,
  callState: 'idle',
  callType: 'voice',
  localStream: null,
  remoteStream: null,
  micMuted: false,
  camOff: false,
  deafened: false,
  connectedAt: null,

  initGlobalListeners: () => {
    const ws = useWs.getState()

    const offSignal = ws.on('VOICE_SIGNAL', async (d: any) => {
      const pc = _pc
      if (!pc) return
      const payload = d.payload
      if (!payload?.type) return
      // Ignorer les signaux du vocal de serveur (format payload.data) — seul le format DM
      // (payload.sdp / payload.candidate) concerne ce store
      if (payload.data !== undefined && payload.sdp === undefined && payload.candidate === undefined) return
      // Ignorer les signaux d'un autre utilisateur que le pair de l'appel en cours
      if (d.from && _pcPeer && String(d.from) !== _pcPeer) return

      try {
        if (payload.type === 'offer') {
          const pid = d.from ? String(d.from) : get().partnerId
          // Glare : quand les deux pairs renégocient en même temps (typiquement deux ICE
          // restarts simultanés après une coupure réseau), chacun a une offer locale en
          // vol. Sans arbitrage, les deux offers entrantes sont appliquées à l'aveugle et
          // la PC ne revient jamais dans un état sain (défaut V11). Même tie-break que
          // voice.ts:683-706 : le pair « poli » (id lexicographiquement inférieur) annule
          // son offer et répond ; l'impoli ignore l'offer entrante, la sienne gagne.
          const collision = _makingOffer || pc.signalingState !== 'stable'
          if (collision) {
            const myId = String(useAuth.getState().user?.id ?? '')
            const polite = myId < String(pid ?? '')
            if (!polite) return
            await pc.setLocalDescription({ type: 'rollback' })
          }
          await pc.setRemoteDescription(new RTCSessionDescription(payload.sdp))
          await _drainIce(pc)
          const answer = await pc.createAnswer()
          await pc.setLocalDescription(answer)
          if (pid) ws.send({ type: 'VOICE_SIGNAL', to: pid, payload: { type: 'answer', sdp: answer } })
        } else if (payload.type === 'answer') {
          if (pc.signalingState === 'have-local-offer') {
            await pc.setRemoteDescription(new RTCSessionDescription(payload.sdp))
            // Côté appelant, c'est la SEULE branche qui pose une remoteDescription : sans
            // cette vidange, tous les candidats ICE arrivés avant l'answer étaient perdus
            // et l'appel restait muet en NAT strict (défaut V4).
            await _drainIce(pc)
          }
        } else if (payload.type === 'ice') {
          if (pc.remoteDescription) {
            await pc.addIceCandidate(new RTCIceCandidate(payload.candidate)).catch(() => {})
          } else {
            _pendingCandidates.push(payload.candidate)
          }
        }
      } catch (e) {
        // Signaux périmés fréquents, mais jamais muets : les bugs WebRTC du
        // 2026-07-14 se cachaient derrière des catch silencieux
        console.warn(`[dm-call] signal ${payload.type} de ${d.from} (état ${pc.signalingState})`, e)
      }
    })

    // Caller receives this when callee accepts → create WebRTC offer
    const offAccepted = ws.on('DM_CALL_ACCEPTED', async (d: any) => {
      if (d.dm_id !== get().dmId) return
      const pc = _pc
      if (!pc) return
      if (_callTimeout) { clearTimeout(_callTimeout); _callTimeout = null }
      try {
        _makingOffer = true
        const offer = await pc.createOffer()
        await pc.setLocalDescription(offer)
        const partnerId = get().partnerId
        if (partnerId) {
          ws.send({ type: 'VOICE_SIGNAL', to: partnerId, payload: { type: 'offer', sdp: offer } })
        }
        set({ callState: 'ringing' })
      } catch {
        _cleanup(set)
      } finally {
        _makingOffer = false
      }
    })

    const offEnded = ws.on('DM_CALL_ENDED', (d: any) => {
      if (d.dm_id !== get().dmId) return
      _cleanup(set)
    })

    const offDeclined = ws.on('DM_CALL_DECLINED', (d: any) => {
      if (d.dm_id !== get().dmId) return
      _cleanup(set)
    })

    // Erreur d'initiation (ex: destinataire hors ligne) : arrêter de sonner
    // immédiatement au lieu de laisser tourner la tonalité jusqu'au timeout 45s
    const offError = ws.on('DM_CALL_ERROR', (d: any) => {
      if (d.dm_id && get().dmId && String(d.dm_id) !== get().dmId) return
      _cleanup(set)
    })

    // Multi-onglet : l'appel entrant sonne dans TOUTES les sessions du compte.
    // Sans cet event, accepter dans un onglet laissait la modale ouverte (et la
    // sonnerie active) dans les autres.
    const offTaken = ws.on('DM_CALL_TAKEN', (d: any) => {
      if (d.session_id && d.session_id === _mySessionId) return
      if (get().incomingCall && get().incomingCall?.dmId === d.dm_id) set({ incomingCall: null })
    })

    const offSession = ws.on('SESSION_INIT', (d: any) => { _mySessionId = d.session_id ?? null })

    return () => { offSignal(); offAccepted(); offEnded(); offDeclined(); offError(); offTaken(); offSession() }
  },

  startCall: async (dmId, partnerId, type) => {
    // Garde anti-double-appel : callState (state React) ne se met à jour qu'après
    // l'await getUserMedia/buildPc ci-dessous — un double-clic rapide sur le bouton
    // d'appel écraserait _pc/localStream du 1er appel sans jamais le fermer ni couper
    // le flux média (micro/caméra restent actifs, connexion WebRTC orpheline).
    if (_callInFlight) return
    if (get().callState !== 'idle') return
    _callInFlight = true
    set({ dmId, partnerId, callType: type })
    try {
      const stream = await _getCallMedia(type)
      set({ localStream: stream })
      const pc = await _buildPc(partnerId, set, get)
      stream.getTracks().forEach(t => pc.addTrack(t, stream))
      useWs.getState().send({ type: 'DM_CALL_INIT', to: partnerId, dm_id: dmId, call_type: type })
      set({ callState: 'calling' })
      // Auto-annulation après 45 secondes sans réponse
      _callTimeout = setTimeout(() => {
        useWs.getState().send({ type: 'DM_CALL_HANGUP', to: partnerId, dm_id: dmId })
        _cleanup(set)
        toast(`Appel ${type === 'video' ? 'vidéo' : 'vocal'} — sans réponse`, { icon: '📵', duration: 5000 })
      }, 45_000)
    } catch {
      _cleanup(set)
      throw new Error('Accès micro/caméra refusé')
    }
  },

  acceptCall: async (dmId, fromUserId, type) => {
    if (_callInFlight) return
    _callInFlight = true
    set({ dmId, partnerId: fromUserId, callType: type })
    try {
      const stream = await _getCallMedia(type)
      set({ localStream: stream })
      const pc = await _buildPc(fromUserId, set, get)
      stream.getTracks().forEach(t => pc.addTrack(t, stream))
      useWs.getState().send({ type: 'DM_CALL_ACCEPT', to: fromUserId, dm_id: dmId })
      set({ callState: 'ringing' })
    } catch {
      // Micro inaccessible : décliner proprement pour que l'appelant ne sonne pas dans le vide
      useWs.getState().send({ type: 'DM_CALL_DECLINE', to: fromUserId, dm_id: dmId })
      toast.error('Impossible d\'accéder au microphone — appel refusé')
      _cleanup(set)
    }
  },

  declineCall: (dmId, fromUserId) => {
    useWs.getState().send({ type: 'DM_CALL_DECLINE', to: fromUserId, dm_id: dmId })
  },

  hangup: () => {
    const { partnerId, dmId } = get()
    if (partnerId && dmId) useWs.getState().send({ type: 'DM_CALL_HANGUP', to: partnerId, dm_id: dmId })
    _cleanup(set)
  },

  toggleMic: () => {
    const { localStream, micMuted } = get()
    const audioTrack = localStream?.getAudioTracks()[0]
    if (audioTrack) {
      audioTrack.enabled = micMuted // toggle : ré-active si actuellement muted
      set({ micMuted: !micMuted })
    }
  },

  // Couper la caméra doit RELÂCHER le périphérique (LED éteinte, caméra rendue aux autres
  // applications) : `enabled = false` laissait la capture tourner indéfiniment (défaut V5).
  // Même pattern que voice.ts:814-845 : stop + replaceTrack(null) à l'extinction,
  // ré-acquisition + replaceTrack à l'allumage, sans renégociation si le sender existe déjà.
  toggleCam: async () => {
    const { localStream, camOff } = get()
    if (!localStream) return

    if (!camOff) {
      const vt = localStream.getVideoTracks()[0]
      if (!vt) return
      if (!_camSender) _camSender = _pc?.getSenders().find(s => s.track === vt) ?? null
      try { await _camSender?.replaceTrack(null) } catch {}
      vt.stop()
      localStream.removeTrack(vt)
      set({ camOff: true })
      return
    }

    try {
      const vs = await navigator.mediaDevices.getUserMedia({ video: _videoConstraints() })
      const vt = vs.getVideoTracks()[0]
      localStream.addTrack(vt)
      if (_camSender) {
        await _camSender.replaceTrack(vt)
      } else if (_pc) {
        _camSender = _pc.addTrack(vt, localStream)
        // Aucun sender vidéo préexistant (appel démarré en vocal) : il faut renégocier
        try {
          _makingOffer = true
          const offer = await _pc.createOffer()
          await _pc.setLocalDescription(offer)
          if (_pcPeer) useWs.getState().send({ type: 'VOICE_SIGNAL', to: _pcPeer, payload: { type: 'offer', sdp: offer } })
        } catch (e) {
          console.warn('[dm-call] renégociation caméra', e)
        } finally {
          _makingOffer = false
        }
      }
      set({ camOff: false })
    } catch {
      toast.error('Impossible d\'accéder à la caméra.')
    }
  },

  setDeafened: (v) => {
    get().remoteStream?.getAudioTracks().forEach(t => { t.enabled = !v })
    set({ deafened: v })
  },
}))
