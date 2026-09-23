import { create } from 'zustand'
import { useWs } from './ws'
import api from '../api/client'
import { webrtcMissing, openInBrowser, NO_WEBRTC_MESSAGE } from '../lib/webrtcSupport'
import {
  isNativeVoice, nativeConnect, nativeDisconnect, nativeSetMic, nativeSetDeafen, nativeSetCamera,
} from '../lib/nativeVoice'
import {
  Room, RoomEvent, Track, DisconnectReason,
  type LocalTrackPublication, type RemoteParticipant,
} from 'livekit-client'
import toast from 'react-hot-toast'

export interface IncomingCallInfo {
  fromUserId: string
  fromUsername: string
  dmId: string
  callType: 'voice' | 'video'
}

export type DmCallState = 'idle' | 'calling' | 'ringing' | 'connected'

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
  /** Application Linux : vidéo du correspondant et aperçu local en vidéo local. */
  remoteVideoUrl: string | null
  localVideoUrl: string | null
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
// Le média passe par le SFU LiveKit, comme le vocal de serveur : l'ancien
// pair-à-pair échouait entre deux machines du même réseau local.
let _room: Room | null = null
let _callTimeout: ReturnType<typeof setTimeout> | null = null
let _partnerGoneTimer: ReturnType<typeof setTimeout> | null = null
let _callInFlight = false
let _camPub: LocalTrackPublication | null = null
let _micPub: LocalTrackPublication | null = null
let _mySessionId: string | null = null
/** Appel porté par le vocal natif Linux. */
let _native = false

type SetFn = (fn: (s: CallStore) => Partial<CallStore>) => void

function _cleanup(set: SetFn) {
  _callInFlight = false
  if (_callTimeout) { clearTimeout(_callTimeout); _callTimeout = null }
  if (_partnerGoneTimer) { clearTimeout(_partnerGoneTimer); _partnerGoneTimer = null }
  const room = _room
  _room = null
  _camPub = _micPub = null
  void room?.disconnect(true)
  if (_native) { _native = false; void nativeDisconnect() }
  set(s => {
    s.localStream?.getTracks().forEach(t => t.stop())
    return {
      dmId: null, partnerId: null, callState: 'idle',
      localStream: null, remoteStream: null, remoteVideoUrl: null, localVideoUrl: null,
      micMuted: false, camOff: false, connectedAt: null,
    }
  })
}

function _rebuildRemote(p: RemoteParticipant, set: SetFn, get: () => CallStore) {
  const tracks: MediaStreamTrack[] = []
  p.trackPublications.forEach(pub => {
    const t = pub.isSubscribed ? pub.track?.mediaStreamTrack : undefined
    if (t && t.readyState !== 'ended') tracks.push(t)
  })
  // Respecter un deafen déjà actif : une piste arrivée après le clic reste muette.
  if (get().deafened) tracks.forEach(t => { if (t.kind === 'audio') t.enabled = false })
  set(() => ({ remoteStream: tracks.length ? new MediaStream(tracks) : null }))
}

/** Connexion au SFU avec le jeton délivré par le serveur à l'acceptation. */
/** Application Linux : le processus natif porte micro, caméra et son. */
async function _connectNative(lk: { url: string; token: string }, set: SetFn, get: () => CallStore) {
  if (_native) return
  _native = true
  const partner = () => get().partnerId
  const res = await api.get('/voice/ice-config').catch(() => null)
  try {
    await nativeConnect(lk.url, lk.token, res?.data.ice_servers ?? [], true, !get().micMuted, {
      onTrack: e => {
        if (e.identity !== partner()) return
        if (e.source === 'camera') set(() => ({ remoteVideoUrl: e.active ? e.url : null }))
        if (e.active) set(s => ({ callState: 'connected', connectedAt: s.connectedAt ?? Date.now() }))
      },
      onSpeakers: () => {},
      onState: e => {
        if (e.status === 'disconnected' && _native) {
          toast.error('Appel interrompu : connexion au serveur audio/vidéo perdue.')
          _cleanup(set)
        }
      },
    })
    if (get().callType === 'video') {
      const url = await nativeSetCamera(true).catch(() => null)
      set(() => ({ localVideoUrl: url, camOff: !url }))
    }
    if (get().deafened) void nativeSetDeafen(true)
  } catch (e) {
    toast.error(`Appel impossible : ${String(e)}`)
    _cleanup(set)
  }
}

async function _connect(lk: { url: string; token: string }, set: SetFn, get: () => CallStore) {
  if (isNativeVoice()) return _connectNative(lk, set, get)
  if (_room) return
  const room = new Room({ adaptiveStream: false, dynacast: true, disconnectOnPageLeave: true, stopLocalTrackOnUnpublish: false })
  _room = room
  const partner = () => get().partnerId
  room
    .on(RoomEvent.TrackSubscribed, (_t, _p, rp) => { if (rp.identity === partner()) _rebuildRemote(rp, set, get) })
    .on(RoomEvent.TrackUnsubscribed, (_t, _p, rp) => { if (rp.identity === partner()) _rebuildRemote(rp, set, get) })
    .on(RoomEvent.ParticipantConnected, rp => {
      if (rp.identity !== partner()) return
      if (_partnerGoneTimer) { clearTimeout(_partnerGoneTimer); _partnerGoneTimer = null }
      set(s => ({ callState: 'connected', connectedAt: s.connectedAt ?? Date.now() }))
    })
    .on(RoomEvent.ParticipantDisconnected, rp => {
      if (rp.identity !== partner()) return
      // Coupure du correspondant (réseau, onglet fermé) : 20 s pour revenir, sinon fin.
      _partnerGoneTimer = setTimeout(() => { if (_room === room) _cleanup(set) }, 20_000)
    })
    .on(RoomEvent.Disconnected, reason => {
      if (_room !== room) return
      if (reason !== DisconnectReason.CLIENT_INITIATED) {
        toast.error('Appel interrompu : connexion au serveur audio/vidéo perdue.')
        _cleanup(set)
      }
    })

  try {
    const res = await api.get('/voice/ice-config').catch(() => null)
    await room.connect(lk.url, lk.token, { autoSubscribe: true, rtcConfig: res ? { iceServers: res.data.ice_servers } : undefined })
  } catch (e) {
    console.warn('[dm-call] connexion SFU', e)
    if (_room === room) { toast.error('Impossible de joindre le serveur audio/vidéo.'); _cleanup(set) }
    return
  }
  if (_room !== room) return

  const local = get().localStream
  const mic = local?.getAudioTracks()[0]
  const cam = local?.getVideoTracks()[0]
  try {
    if (mic) {
      _micPub = await room.localParticipant.publishTrack(mic, { source: Track.Source.Microphone })
      if (get().micMuted) await _micPub.mute()
    }
    if (cam) _camPub = await room.localParticipant.publishTrack(cam, { source: Track.Source.Camera, simulcast: true })
  } catch (e) {
    console.warn('[dm-call] publication', e)
  }
  const pid = partner()
  const rp = pid ? room.remoteParticipants.get(pid) : undefined
  if (rp) {
    _rebuildRemote(rp, set, get)
    set(s => ({ callState: 'connected', connectedAt: s.connectedAt ?? Date.now() }))
  }
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
  remoteVideoUrl: null,
  localVideoUrl: null,
  micMuted: false,
  camOff: false,
  deafened: false,
  connectedAt: null,

  initGlobalListeners: () => {
    const ws = useWs.getState()

    // Appelant : le correspondant a décroché, le serveur joint l'accès au SFU.
    const offAccepted = ws.on('DM_CALL_ACCEPTED', async (d: any) => {
      if (d.dm_id !== get().dmId) return
      if (_callTimeout) { clearTimeout(_callTimeout); _callTimeout = null }
      set({ callState: 'ringing' })
      if (!d.livekit?.url || !d.livekit?.token) { toast.error('Serveur audio/vidéo indisponible.'); _cleanup(set); return }
      await _connect(d.livekit, set, get)
    })

    // Appelé : accès au SFU envoyé en réponse à notre DM_CALL_ACCEPT (à la seule session qui a décroché).
    const offMedia = ws.on('DM_CALL_MEDIA', async (d: any) => {
      if (d.dm_id !== get().dmId || !_callInFlight) return
      if (d.session_id && _mySessionId && d.session_id !== _mySessionId) return
      if (!d.livekit?.url || !d.livekit?.token) { toast.error('Serveur audio/vidéo indisponible.'); _cleanup(set); return }
      await _connect(d.livekit, set, get)
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

    return () => { offAccepted(); offMedia(); offEnded(); offDeclined(); offError(); offTaken(); offSession() }
  },

  startCall: async (dmId, partnerId, type) => {
    // Garde anti-double-appel : callState (state React) ne se met à jour qu'après
    // l'await getUserMedia/buildPc ci-dessous — un double-clic rapide sur le bouton
    // d'appel écraserait la salle/localStream du 1er appel sans jamais le fermer ni couper
    // le flux média (micro/caméra restent actifs, connexion WebRTC orpheline).
    if (_callInFlight) return
    if (get().callState !== 'idle') return
    if (webrtcMissing() && !isNativeVoice()) {
      toast.error((await openInBrowser(`/dms/${dmId}`)) ? NO_WEBRTC_MESSAGE : 'Appels indisponibles ici : ouvrez ForgeChat dans votre navigateur.', { duration: 9000 })
      return
    }
    _callInFlight = true
    set({ dmId, partnerId, callType: type })
    try {
      // Linux natif : micro et caméra capturés par le processus Rust.
      const stream = isNativeVoice() ? null : await _getCallMedia(type)
      set({ localStream: stream })
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
    if (webrtcMissing() && !isNativeVoice()) {
      // Laisser sonner : l'appel peut être décroché dans le navigateur ouvert.
      toast.error((await openInBrowser(`/dms/${dmId}`)) ? NO_WEBRTC_MESSAGE : 'Appels indisponibles ici : ouvrez ForgeChat dans votre navigateur.', { duration: 9000 })
      return
    }
    _callInFlight = true
    set({ dmId, partnerId: fromUserId, callType: type })
    try {
      // Linux natif : micro et caméra capturés par le processus Rust.
      const stream = isNativeVoice() ? null : await _getCallMedia(type)
      set({ localStream: stream })
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
    if (_native) {
      const next = !get().micMuted
      void nativeSetMic(!next).catch(() => {})
      set({ micMuted: next })
      return
    }
    const { localStream, micMuted } = get()
    const audioTrack = localStream?.getAudioTracks()[0]
    if (!audioTrack) return
    const next = !micMuted
    audioTrack.enabled = !next
    if (_micPub) void (next ? _micPub.mute() : _micPub.unmute()).catch(() => {})
    set({ micMuted: next })
  },

  // Couper la caméra RELÂCHE le périphérique (LED éteinte, caméra rendue aux autres
  // applications) : `enabled = false` laissait la capture tourner (défaut V5).
  toggleCam: async () => {
    if (_native) {
      try {
        const url = await nativeSetCamera(get().camOff)
        set({ camOff: !url, localVideoUrl: url })
      } catch {
        toast.error("Impossible d'accéder à la caméra.")
      }
      return
    }
    const { localStream, camOff } = get()
    if (!localStream) return
    if (!camOff) {
      const vt = localStream.getVideoTracks()[0]
      if (!vt) return
      if (_camPub?.track && _room) await _room.localParticipant.unpublishTrack(_camPub.track, false).catch(() => {})
      _camPub = null
      vt.stop()
      set({ camOff: true, localStream: new MediaStream(localStream.getAudioTracks()) })
      return
    }
    try {
      const vs = await navigator.mediaDevices.getUserMedia({ video: _videoConstraints() })
      const vt = vs.getVideoTracks()[0]
      if (!vt) return
      if (_room?.state === 'connected') _camPub = await _room.localParticipant.publishTrack(vt, { source: Track.Source.Camera, simulcast: true })
      set({ camOff: false, localStream: new MediaStream([...localStream.getAudioTracks(), vt]) })
    } catch {
      toast.error("Impossible d'accéder à la caméra.")
    }
  },

  setDeafened: (v) => {
    if (_native) void nativeSetDeafen(v).catch(() => {})
    get().remoteStream?.getAudioTracks().forEach(t => { t.enabled = !v })
    set({ deafened: v })
  },
}))
