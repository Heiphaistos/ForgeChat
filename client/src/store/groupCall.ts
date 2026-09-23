// Appel vocal/vidéo de groupe privé (P2-4) : salle LiveKit `gdm-<id>`, jeton délivré
// par le serveur aux seuls membres du groupe. Comme store/call.ts, l'état vit hors des
// composants pour que l'appel survive à la navigation.
import { create } from 'zustand'
import { Room, RoomEvent, Track, DisconnectReason, type RemoteParticipant, type RemoteTrack } from 'livekit-client'
import toast from 'react-hot-toast'
import api from '../api/client'
import { useWs } from './ws'
import { useCallStore } from './call'
import { webrtcMissing } from '../lib/webrtcSupport'

export interface GroupRing { groupId: string; fromUsername: string; callType: 'voice' | 'video'; expiresAt: number }

interface GroupCallStore {
  groupId: string | null
  status: 'idle' | 'connecting' | 'connected'
  localStream: MediaStream | null
  /** identité (user_id) → flux caméra + micro du participant. */
  remotes: Record<string, MediaStream | null>
  micMuted: boolean
  camOff: boolean
  activeSpeakerId: string | null
  /** group_id → participants de l'appel en cours (GROUP_CALL_UPDATE). */
  active: Record<string, string[]>
  ring: GroupRing | null

  initGlobalListeners: () => () => void
  setActive: (groupId: string, participants: string[]) => void
  dismissRing: () => void
  join: (groupId: string, type: 'voice' | 'video') => Promise<void>
  leave: () => void
  toggleMic: () => void
  toggleCam: () => Promise<void>
}

let _room: Room | null = null
let _mySessionId: string | null = null
const _audioEls = new Map<string, HTMLMediaElement>()

type Set = (p: Partial<GroupCallStore> | ((s: GroupCallStore) => Partial<GroupCallStore>)) => void

function _streamOf(p: RemoteParticipant): MediaStream | null {
  const tracks: MediaStreamTrack[] = []
  p.trackPublications.forEach(pub => {
    const t = pub.isSubscribed && pub.source !== Track.Source.ScreenShare ? pub.track?.mediaStreamTrack : undefined
    if (t && t.readyState !== 'ended') tracks.push(t)
  })
  return tracks.length ? new MediaStream(tracks) : null
}

function _refresh(p: RemoteParticipant, set: Set) {
  set(s => ({ remotes: { ...s.remotes, [p.identity]: _streamOf(p) } }))
}

function _cleanup(set: Set) {
  const room = _room
  _room = null
  void room?.disconnect(true)
  _audioEls.forEach(el => el.remove())
  _audioEls.clear()
  set(s => {
    s.localStream?.getTracks().forEach(t => t.stop())
    return { groupId: null, status: 'idle', localStream: null, remotes: {}, micMuted: false, camOff: false, activeSpeakerId: null }
  })
}

async function _connect(lk: { url: string; token: string }, set: Set, get: () => GroupCallStore) {
  if (_room) return
  const room = new Room({ adaptiveStream: true, dynacast: true, disconnectOnPageLeave: true, stopLocalTrackOnUnpublish: false })
  _room = room
  room
    .on(RoomEvent.TrackSubscribed, (track: RemoteTrack, pub, rp) => {
      // Son joué par un <audio> hors de tout composant : il continue quand on change de page.
      if (track.kind === Track.Kind.Audio) {
        const el = track.attach()
        el.dataset.groupCall = '1'
        document.body.appendChild(el)
        _audioEls.set(pub.trackSid, el)
      }
      _refresh(rp, set)
    })
    .on(RoomEvent.TrackUnsubscribed, (track: RemoteTrack, pub, rp) => {
      track.detach().forEach(el => el.remove())
      _audioEls.delete(pub.trackSid)
      _refresh(rp, set)
    })
    .on(RoomEvent.ParticipantConnected, rp => _refresh(rp, set))
    .on(RoomEvent.ParticipantDisconnected, rp => set(s => {
      const remotes = { ...s.remotes }
      delete remotes[rp.identity]
      return { remotes }
    }))
    .on(RoomEvent.ActiveSpeakersChanged, sp => set({ activeSpeakerId: sp[0]?.identity ?? null }))
    .on(RoomEvent.Disconnected, reason => {
      if (_room !== room) return
      if (reason === DisconnectReason.PARTICIPANT_REMOVED) toast('Vous avez quitté l\'appel de groupe.')
      else if (reason !== DisconnectReason.CLIENT_INITIATED) toast.error('Appel interrompu : connexion au serveur audio/vidéo perdue.')
      useWs.getState().send({ type: 'GROUP_CALL_LEAVE', group_id: get().groupId })
      _cleanup(set)
    })
  try {
    const res = await api.get('/voice/ice-config').catch(() => null)
    await room.connect(lk.url, lk.token, { autoSubscribe: true, rtcConfig: res ? { iceServers: res.data.ice_servers } : undefined })
  } catch {
    if (_room === room) {
      toast.error('Impossible de joindre le serveur audio/vidéo.')
      useWs.getState().send({ type: 'GROUP_CALL_LEAVE', group_id: get().groupId })
      _cleanup(set)
    }
    return
  }
  if (_room !== room) return
  const local = get().localStream
  const mic = local?.getAudioTracks()[0]
  const cam = local?.getVideoTracks()[0]
  try {
    if (mic) await room.localParticipant.publishTrack(mic, { source: Track.Source.Microphone })
    if (cam) await room.localParticipant.publishTrack(cam, { source: Track.Source.Camera, simulcast: true })
  } catch (e) {
    console.warn('[group-call] publication', e)
  }
  room.remoteParticipants.forEach(rp => _refresh(rp, set))
  set({ status: 'connected' })
}

export const useGroupCall = create<GroupCallStore>((set, get) => ({
  groupId: null,
  status: 'idle',
  localStream: null,
  remotes: {},
  micMuted: false,
  camOff: false,
  activeSpeakerId: null,
  active: {},
  ring: null,

  initGlobalListeners: () => {
    const ws = useWs.getState()
    const offSession = ws.on('SESSION_INIT', (d: any) => { _mySessionId = d.session_id ?? null })
    const offMedia = ws.on('GROUP_CALL_MEDIA', async (d: any) => {
      if (d.group_id !== get().groupId || get().status !== 'connecting') return
      if (d.session_id && _mySessionId && d.session_id !== _mySessionId) return
      if (!d.livekit?.url || !d.livekit?.token) { toast.error('Serveur audio/vidéo indisponible.'); _cleanup(set); return }
      await _connect(d.livekit, set, get)
    })
    const offUpdate = ws.on('GROUP_CALL_UPDATE', (d: any) => {
      get().setActive(d.group_id, Array.isArray(d.participants) ? d.participants : [])
    })
    const offRing = ws.on('GROUP_CALL_RING', (d: any) => {
      if (get().groupId === d.group_id) return
      set({ ring: {
        groupId: d.group_id, fromUsername: d.from_username ?? '',
        callType: d.call_type === 'video' ? 'video' : 'voice',
        expiresAt: Date.now() + (Number(d.ring_timeout_ms) || 45_000),
      } })
    })
    const offError = ws.on('GROUP_CALL_ERROR', (d: any) => {
      if (d.group_id !== get().groupId) return
      toast.error(d.reason === 'unavailable' ? 'Serveur audio/vidéo indisponible.' : 'Appel de groupe refusé.')
      _cleanup(set)
    })
    return () => { offSession(); offMedia(); offUpdate(); offRing(); offError() }
  },

  setActive: (groupId, participants) => set(s => {
    const ring = s.ring?.groupId === groupId && participants.length === 0 ? null : s.ring
    return { active: { ...s.active, [groupId]: participants }, ring }
  }),

  dismissRing: () => set({ ring: null }),

  join: async (groupId, type) => {
    if (get().groupId === groupId) return
    if (useCallStore.getState().callState !== 'idle') { toast.error('Terminez d\'abord l\'appel en cours.'); return }
    // ponytail: pas de vocal natif Linux pour les groupes (le 1:1 l'a) ; l'app propose le navigateur.
    if (webrtcMissing()) { toast.error('Appels de groupe indisponibles ici : ouvrez ForgeChat dans votre navigateur.'); return }
    if (get().groupId) get().leave()
    set({ groupId, status: 'connecting', ring: null, camOff: type !== 'video' })
    try {
      const stream = await navigator.mediaDevices.getUserMedia({
        audio: { echoCancellation: true, noiseSuppression: true, autoGainControl: true },
        video: type === 'video' ? { width: { ideal: 1280 }, height: { ideal: 720 } } : false,
      })
      if (get().groupId !== groupId) { stream.getTracks().forEach(t => t.stop()); return }
      set({ localStream: stream })
      useWs.getState().send({ type: 'GROUP_CALL_JOIN', group_id: groupId, call_type: type })
    } catch {
      toast.error('Accès au micro refusé')
      _cleanup(set)
    }
  },

  leave: () => {
    const { groupId } = get()
    if (groupId) useWs.getState().send({ type: 'GROUP_CALL_LEAVE', group_id: groupId })
    _cleanup(set)
  },

  toggleMic: () => {
    const next = !get().micMuted
    get().localStream?.getAudioTracks().forEach(t => { t.enabled = !next })
    const pub = _room?.localParticipant.getTrackPublication(Track.Source.Microphone)
    if (pub) void (next ? pub.mute() : pub.unmute()).catch(() => {})
    set({ micMuted: next })
  },

  toggleCam: async () => {
    const { localStream, camOff } = get()
    if (!localStream) return
    if (!camOff) {
      const vt = localStream.getVideoTracks()[0]
      if (vt && _room) await _room.localParticipant.unpublishTrack(vt, false).catch(() => {})
      vt?.stop()
      set({ camOff: true, localStream: new MediaStream(localStream.getAudioTracks()) })
      return
    }
    try {
      const vs = await navigator.mediaDevices.getUserMedia({ video: { width: { ideal: 1280 }, height: { ideal: 720 } } })
      const vt = vs.getVideoTracks()[0]
      if (!vt) return
      if (_room?.state === 'connected') await _room.localParticipant.publishTrack(vt, { source: Track.Source.Camera, simulcast: true })
      set({ camOff: false, localStream: new MediaStream([...localStream.getAudioTracks(), vt]) })
    } catch {
      toast.error("Impossible d'accéder à la caméra.")
    }
  },
}))
