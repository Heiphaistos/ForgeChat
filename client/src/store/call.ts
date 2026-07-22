import { create } from 'zustand'
import { useWs } from './ws'
import api from '../api/client'
import toast from 'react-hot-toast'

export interface IncomingCallInfo {
  fromUserId: string
  fromUsername: string
  dmId: string
  callType: 'voice' | 'video'
}

export type DmCallState = 'idle' | 'calling' | 'ringing' | 'connected'

const ICE_FALLBACK = [
  { urls: 'stun:stun.l.google.com:19302' },
  { urls: 'stun:stun1.l.google.com:19302' },
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
  toggleCam: () => void
}

// ── État module-level de l'appel DM actif (persiste hors du cycle de vie de tout composant) ──
let _pc: RTCPeerConnection | null = null
let _pcPeer: string | null = null
let _pendingCandidates: RTCIceCandidateInit[] = []
let _callTimeout: ReturnType<typeof setTimeout> | null = null
let _callInFlight = false

function _cleanup(set: (fn: (s: CallStore) => Partial<CallStore>) => void) {
  _callInFlight = false
  if (_callTimeout) { clearTimeout(_callTimeout); _callTimeout = null }
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
    if (e.streams[0]) set(() => ({ remoteStream: e.streams[0] }))
  }
  pc.onconnectionstatechange = () => {
    if (pc.connectionState === 'connected') {
      set(s => ({ callState: 'connected', connectedAt: s.connectedAt ?? Date.now() }))
    }
    if (['disconnected', 'failed', 'closed'].includes(pc.connectionState)) _cleanup(set)
  }
  _pc = pc
  _pcPeer = pid
  void get
  return pc
}

// getUserMedia avec repli audio seul si la caméra est indisponible
async function _getCallMedia(type: 'voice' | 'video'): Promise<MediaStream> {
  try {
    return await navigator.mediaDevices.getUserMedia({ audio: true, video: type === 'video' })
  } catch (err) {
    if (type !== 'video') throw err
    const stream = await navigator.mediaDevices.getUserMedia({ audio: true })
    toast('Caméra indisponible — appel en audio seul', { icon: '🎤', duration: 4000 })
    return stream
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
          await pc.setRemoteDescription(new RTCSessionDescription(payload.sdp))
          for (const c of _pendingCandidates) {
            await pc.addIceCandidate(new RTCIceCandidate(c)).catch(() => {})
          }
          _pendingCandidates = []
          const answer = await pc.createAnswer()
          await pc.setLocalDescription(answer)
          const pid = d.from ? String(d.from) : get().partnerId
          if (pid) ws.send({ type: 'VOICE_SIGNAL', to: pid, payload: { type: 'answer', sdp: answer } })
        } else if (payload.type === 'answer') {
          if (pc.signalingState === 'have-local-offer') {
            await pc.setRemoteDescription(new RTCSessionDescription(payload.sdp))
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
        const offer = await pc.createOffer()
        await pc.setLocalDescription(offer)
        const partnerId = get().partnerId
        if (partnerId) {
          ws.send({ type: 'VOICE_SIGNAL', to: partnerId, payload: { type: 'offer', sdp: offer } })
        }
        set({ callState: 'ringing' })
      } catch {
        _cleanup(set)
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

    return () => { offSignal(); offAccepted(); offEnded(); offDeclined(); offError() }
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

  toggleCam: () => {
    const { localStream, camOff } = get()
    const videoTrack = localStream?.getVideoTracks()[0]
    if (videoTrack) {
      videoTrack.enabled = camOff // toggle : ré-active si actuellement off
      set({ camOff: !camOff })
    }
  },
}))
