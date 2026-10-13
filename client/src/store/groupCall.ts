// Appel vocal/vidéo de groupe privé (P2-4) : salle LiveKit `gdm-<id>`, jeton délivré
// par le serveur aux seuls membres du groupe. Comme store/call.ts, l'état vit hors des
// composants pour que l'appel survive à la navigation.
import { create } from 'zustand'
import { Room, RoomEvent, Track, DisconnectReason, type RemoteParticipant, type RemoteTrack } from 'livekit-client'
import toast from 'react-hot-toast'
import api from '../api/client'
import { useWs } from './ws'
import { useCallStore, callAudioConstraints, callVideoConstraints } from './call'
import { useVoice } from './voice'
import { hasUxPref, useUxPrefs } from './uxPrefs'
import { routeAudio, dropPlayback } from '../lib/voicePlayback'
import { processCallMicStream } from '../lib/audio'
import { camPublishOptions, useAvPrefs } from '../lib/avPrefs'
import { maybeBlur } from '../utils/backgroundBlur'
import { clampVolumePct } from '../lib/voiceMix'
import { webrtcMissing } from '../lib/webrtcSupport'
import { t } from '../i18n'
import { e2eeClaim, enableMediaE2EE, mediaE2EEError, openMediaE2EE, watchOutdated } from '../e2e/media'

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
  /** Médias chiffrés de bout en bout (§5) ; participants dont l'appli ne chiffre pas. */
  e2ee: boolean
  e2eeOutdated: string[]

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
/** trackSid → lecture d'une voix (volume par personne, mono centré : lib/voicePlayback). */
const _audioEls = new Map<string, { el: HTMLAudioElement; who: string; stream: MediaStream }>()

function _play(sid: string, a: { el: HTMLAudioElement; who: string; stream: MediaStream }) {
  const v = useVoice.getState()
  const volume = hasUxPref('voiceMuted', a.who) ? 0 : clampVolumePct(v.userVolumes[a.who] ?? 100) / 100
  routeAudio(a.el, `group:${sid}`, a.stream, 'voice', volume, null, false)
  a.el.muted = v.deafened
}

function _dropAudio(sid: string) {
  const a = _audioEls.get(sid)
  if (!a) return
  a.el.srcObject = null
  a.el.remove()
  dropPlayback(`group:${sid}`)
  _audioEls.delete(sid)
}

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
  ;[..._audioEls.keys()].forEach(_dropAudio)
  set(s => {
    s.localStream?.getTracks().forEach(t => t.stop())
    return { groupId: null, status: 'idle', localStream: null, remotes: {}, micMuted: false, camOff: false, activeSpeakerId: null, e2ee: false, e2eeOutdated: [] }
  })
}

async function _connect(lk: { url: string; token: string; e2ee?: boolean }, set: Set, get: () => GroupCallStore) {
  if (_room) return
  const groupId = get().groupId
  // Salle chiffrée : jamais de connexion en clair, même si la clé manque.
  let e2ee = null
  if (lk.e2ee && groupId) {
    try {
      e2ee = await openMediaE2EE('group', groupId)
    } catch (e) {
      toast.error(t(mediaE2EEError(e)))
      useWs.getState().send({ type: 'GROUP_CALL_LEAVE', group_id: groupId })
      _cleanup(set)
      return
    }
    if (_room || get().groupId !== groupId) { e2ee.stop(); return }
  }
  const room = new Room({
    adaptiveStream: true, dynacast: true, disconnectOnPageLeave: true, stopLocalTrackOnUnpublish: false,
    ...(e2ee ? { encryption: e2ee.encryption } : {}),
  })
  _room = room
  set({ e2ee: !!e2ee })
  if (e2ee) {
    await enableMediaE2EE(room, e2ee)
    watchOutdated(room, ids => set({ e2eeOutdated: ids }))
  }
  room
    .on(RoomEvent.TrackSubscribed, (track: RemoteTrack, pub, rp) => {
      // Son joué par un <audio> hors de tout composant : il continue quand on change de page.
      if (track.kind === Track.Kind.Audio) {
        _dropAudio(pub.trackSid)
        const el = new Audio()
        el.autoplay = true
        el.dataset.groupCall = '1'
        // data-fc-call : la sortie choisie dans Réglages s'applique aussi ici.
        el.dataset.fcCall = '1'
        document.body.appendChild(el)
        const a = { el, who: rp.identity, stream: new MediaStream([track.mediaStreamTrack]) }
        _audioEls.set(pub.trackSid, a)
        _play(pub.trackSid, a)
        void el.play().catch(() => {})
      }
      _refresh(rp, set)
    })
    .on(RoomEvent.TrackUnsubscribed, (_track: RemoteTrack, pub, rp) => {
      _dropAudio(pub.trackSid)
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
      // Même compte rejoint depuis un autre appareil : c'est lui qui est dans
      // l'appel désormais, un GROUP_CALL_LEAVE l'en sortirait.
      if (reason === DisconnectReason.DUPLICATE_IDENTITY) {
        toast('Appel de groupe repris sur un autre appareil.')
        _cleanup(set)
        return
      }
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
    if (mic) await room.localParticipant.publishTrack(mic, { source: Track.Source.Microphone, forceStereo: false })
    if (cam) await room.localParticipant.publishTrack(cam, { source: Track.Source.Camera, ...camPublishOptions(get().e2ee) })
  } catch (e) {
    console.warn('[group-call] publication', e)
  }
  room.remoteParticipants.forEach(rp => _refresh(rp, set))
  set({ status: 'connected' })
}

// Sourdine globale (bouton casque) et volume par personne : appliqués aussi à l'appel de groupe.
useVoice.subscribe((s, prev) => {
  if (s.deafened !== prev.deafened || s.userVolumes !== prev.userVolumes) _audioEls.forEach((a, sid) => _play(sid, a))
})
// « Rendre muet » pour moi seulement (menu utilisateur).
useUxPrefs.subscribe(() => _audioEls.forEach((a, sid) => _play(sid, a)))
// Volume général et sortie mono (Réglages > Voix).
useAvPrefs.subscribe((s, prev) => {
  if (s.outputVolume !== prev.outputVolume || s.monoOutput !== prev.monoOutput) _audioEls.forEach((a, sid) => _play(sid, a))
})

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
  e2ee: false,
  e2eeOutdated: [],

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
      // Micro et caméra choisis dans Réglages (ils étaient ignorés), repli sur
      // les périphériques par défaut si celui mémorisé est débranché.
      const raw = await navigator.mediaDevices.getUserMedia({
        audio: callAudioConstraints(),
        video: type === 'video' ? callVideoConstraints() : false,
      }).catch(() => navigator.mediaDevices.getUserMedia({ audio: true, video: type === 'video' }))
      // Volume d'entrée et seuil du micro, fond virtuel et réglages d'image de la caméra.
      const withMic = await processCallMicStream(raw)
      const cam = withMic.getVideoTracks()[0]
      const stream = cam ? new MediaStream([...withMic.getAudioTracks(), await maybeBlur(cam)]) : withMic
      if (get().groupId !== groupId) { stream.getTracks().forEach(t => t.stop()); return }
      set({ localStream: stream })
      useWs.getState().send({ type: 'GROUP_CALL_JOIN', group_id: groupId, call_type: type, ...e2eeClaim() })
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
      const vs = await navigator.mediaDevices.getUserMedia({ video: callVideoConstraints() })
      const rawCam = vs.getVideoTracks()[0]
      if (!rawCam) return
      const vt = await maybeBlur(rawCam)
      if (_room?.state === 'connected') await _room.localParticipant.publishTrack(vt, { source: Track.Source.Camera, ...camPublishOptions(get().e2ee) })
      set({ camOff: false, localStream: new MediaStream([...localStream.getAudioTracks(), vt]) })
    } catch {
      toast.error("Impossible d'accéder à la caméra.")
    }
  },
}))
