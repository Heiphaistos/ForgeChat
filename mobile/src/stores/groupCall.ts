import { create } from 'zustand'
import type { MediaStream } from '@livekit/react-native-webrtc'
import { DisconnectReason, Room, RoomEvent, Track, type RemoteParticipant } from 'livekit-client'
import { voiceApi } from '@/api/voice'
import { logger } from '@/lib/logger'
import { realtime } from '@/lib/realtime'
import { callAudio, leaveRoom, liveKitAccess, streamOf, CAMERA_RESOLUTION } from '@/services/livekit'
import { ensureMediaPermissions, ringtones } from '@/services/media'
import { t } from '@/i18n'
import { registerSignOutHook } from './auth'
import { E2EE_CLAIM, enableMediaE2EE, mediaE2EEError, openMediaE2EE, watchOutdated, type MediaE2EE } from '@/e2e/media'
import { audioCaptureDefaults, watchCameraEffect } from '@/services/voiceFx'

/**
 * Appels vocaux/vidéo de groupe privé — server/src/handlers/group_calls.rs et le client web
 * (client/src/store/groupCall.ts) : salle LiveKit `gdm-<id>`, jeton délivré aux seuls membres.
 *
 *   GROUP_CALL_JOIN { group_id, call_type } ─▶ GROUP_CALL_MEDIA { livekit, session_id } (cette session)
 *                                              GROUP_CALL_RING (autres membres, à l'ouverture de l'appel)
 *                                              GROUP_CALL_UPDATE { participants } (tous les membres)
 *   GROUP_CALL_LEAVE { group_id }
 *
 * L'appel vit tant qu'il a des participants ; on le rejoint et le quitte à tout moment.
 */

export type GroupCallType = 'voice' | 'video'

export interface GroupRing {
  groupId: string
  fromUsername: string
  callType: GroupCallType
}

interface GroupCallState {
  groupId: string | null
  groupName: string | null
  status: 'idle' | 'connecting' | 'connected' | 'reconnecting'
  /** Caméra de chaque participant (id utilisateur → flux, null sans caméra). */
  remotes: Record<string, MediaStream | null>
  localVideo: MediaStream | null
  micMuted: boolean
  camOff: boolean
  speaker: boolean
  speaking: string[]
  /** Participants au micro coupé (id utilisateur → true). */
  mutedPeers: Record<string, boolean>
  /** Qualité de connexion de chaque participant (excellent, good, poor, lost). */
  qualities: Record<string, string>
  /** group_id → participants de l'appel en cours (GROUP_CALL_UPDATE). */
  active: Record<string, string[]>
  ring: GroupRing | null
  error: string | null
  /** Médias chiffrés de bout en bout (§5) ; participants dont l'appli ne chiffre pas. */
  e2ee: boolean
  e2eeOutdated: string[]
  join: (groupId: string, type: GroupCallType, groupName?: string) => Promise<void>
  leave: () => void
  dismissRing: () => void
  toggleMic: () => void
  toggleCam: () => Promise<void>
  switchCamera: () => void
  toggleSpeaker: () => void
}

let room: Room | null = null
let mySessionId: string | null = null
let ringTimer: ReturnType<typeof setTimeout> | null = null
/** Incrémenté à chaque leave() : détecte une continuation async périmée. */
let generation = 0

const isId = (v: unknown): v is string => typeof v === 'string' && /^[0-9a-f-]{36}$/i.test(v)
const CAMERA_OPTIONS = { facingMode: 'user' as const, resolution: CAMERA_RESOLUTION }

export const useGroupCall = create<GroupCallState>((set, get) => {
  const stopRing = () => {
    if (ringTimer) clearTimeout(ringTimer)
    ringTimer = null
    if (get().ring) ringtones.stopRinging()
    set({ ring: null })
  }

  const refresh = (p: RemoteParticipant) => {
    const cam = p.getTrackPublication(Track.Source.Camera)
    set((s) => ({
      remotes: { ...s.remotes, [p.identity]: cam?.isSubscribed && !cam.isMuted ? streamOf(cam.track) : null },
      mutedPeers: { ...s.mutedPeers, [p.identity]: !p.isMicrophoneEnabled },
    }))
  }

  const refreshLocal = () => {
    const cam = room?.localParticipant.getTrackPublication(Track.Source.Camera)
    set({ localVideo: !get().camOff && cam && !cam.isMuted ? streamOf(cam.track) : null })
  }

  const cleanup = (error: string | null = null) => {
    generation++
    const r = room
    room = null
    if (r) void leaveRoom(r)
    if (get().status !== 'idle') void callAudio.stop()
    set({ groupId: null, groupName: null, status: 'idle', remotes: {}, localVideo: null, micMuted: false, camOff: false, speaking: [], mutedPeers: {}, qualities: {}, error, e2ee: false, e2eeOutdated: [] })
  }

  const connect = async (raw: unknown) => {
    const res = liveKitAccess(raw)
    const groupId = get().groupId
    if ('error' in res) {
      if (groupId) realtime.send({ type: 'GROUP_CALL_LEAVE', group_id: groupId })
      cleanup(res.error)
      return
    }
    if (room) return
    const gen = generation
    // Salle chiffrée : jamais de connexion en clair, même si la clé manque.
    let e2ee: MediaE2EE | null = null
    if (res.access.e2ee && groupId) {
      try {
        e2ee = await openMediaE2EE('group', groupId)
      } catch (err) {
        if (gen !== generation) return
        realtime.send({ type: 'GROUP_CALL_LEAVE', group_id: groupId })
        cleanup(t(mediaE2EEError(err)))
        return
      }
      if (gen !== generation || room) {
        e2ee.stop()
        return
      }
    }
    const r = new Room({ adaptiveStream: false, dynacast: true, audioCaptureDefaults: audioCaptureDefaults(), ...(e2ee ? { encryption: e2ee.encryption } : {}) })
    watchCameraEffect(r)
    room = r
    set({ e2ee: !!e2ee })
    if (e2ee) {
      await enableMediaE2EE(r, e2ee)
      watchOutdated(r, (ids) => set({ e2eeOutdated: ids }))
    }
    r.on(RoomEvent.TrackSubscribed, (_t, _pub, p) => refresh(p))
      .on(RoomEvent.TrackUnsubscribed, (_t, _pub, p) => refresh(p))
      .on(RoomEvent.TrackMuted, (_pub, p) => p !== r.localParticipant && refresh(p as RemoteParticipant))
      .on(RoomEvent.TrackUnmuted, (_pub, p) => p !== r.localParticipant && refresh(p as RemoteParticipant))
      .on(RoomEvent.ParticipantConnected, (p) => refresh(p))
      .on(RoomEvent.ParticipantDisconnected, (p) =>
        set((s) => {
          const remotes = { ...s.remotes }
          delete remotes[p.identity]
          return { remotes }
        }),
      )
      .on(RoomEvent.LocalTrackPublished, refreshLocal)
      .on(RoomEvent.LocalTrackUnpublished, refreshLocal)
      .on(RoomEvent.ActiveSpeakersChanged, (sp) => set({ speaking: sp.map((p) => p.identity) }))
      .on(RoomEvent.ConnectionQualityChanged, (q, p) => set((s) => ({ qualities: { ...s.qualities, [p.identity]: q } })))
      .on(RoomEvent.Reconnecting, () => set({ status: 'reconnecting' }))
      .on(RoomEvent.Reconnected, () => set({ status: 'connected' }))
      .on(RoomEvent.Disconnected, (reason) => {
        if (room !== r) return
        const id = get().groupId
        if (id) realtime.send({ type: 'GROUP_CALL_LEAVE', group_id: id })
        cleanup(
          reason === DisconnectReason.PARTICIPANT_REMOVED
            ? t('store.groupCall.left')
            : reason !== DisconnectReason.CLIENT_INITIATED
              ? t('store.groupCall.mediaLost')
              : null,
        )
      })
    try {
      await callAudio.start(get().speaker, get().groupName ? t('store.groupCall.title', { name: get().groupName ?? '' }) : t('call.group'))
      const turn = await voiceApi.turnServers()
      await r.connect(res.access.url, res.access.token, { autoSubscribe: true, ...(turn.length ? { rtcConfig: { iceServers: turn } } : {}) })
    } catch (err) {
      logger.warn('group-call', 'connexion LiveKit', err)
      if (gen === generation) {
        if (groupId) realtime.send({ type: 'GROUP_CALL_LEAVE', group_id: groupId })
        cleanup(t('store.groupCall.mediaUnreachable'))
      }
      return
    }
    if (gen !== generation || room !== r) {
      void r.disconnect().catch(() => undefined)
      return
    }
    set({ status: 'connected' })
    r.remoteParticipants.forEach((p) => refresh(p))
    try {
      await r.localParticipant.setMicrophoneEnabled(!get().micMuted)
      if (!get().camOff) await r.localParticipant.setCameraEnabled(true, CAMERA_OPTIONS)
    } catch (err) {
      logger.warn('group-call', 'publication', err)
      set({ error: t('store.groupCall.mediaBlocked') })
    }
    refreshLocal()
  }

  realtime.on('SESSION_INIT', (e) => {
    mySessionId = typeof e.session_id === 'string' ? e.session_id : null
  })

  realtime.on('GROUP_CALL_MEDIA', (e) => {
    if (e.group_id !== get().groupId || get().status !== 'connecting') return
    if (typeof e.session_id === 'string' && mySessionId && e.session_id !== mySessionId) return
    void connect(e.livekit)
  })

  realtime.on('GROUP_CALL_UPDATE', (e) => {
    if (!isId(e.group_id)) return
    const groupId = e.group_id
    const participants = Array.isArray(e.participants) ? e.participants.filter(isId) : []
    set((s) => ({ active: { ...s.active, [groupId]: participants } }))
    // Appel terminé avant qu'on décroche : la sonnerie s'arrête.
    if (get().ring?.groupId === groupId && participants.length === 0) stopRing()
  })

  realtime.on('GROUP_CALL_RING', (e) => {
    if (!isId(e.group_id) || get().groupId === e.group_id || get().ring) return
    set({
      ring: {
        groupId: e.group_id,
        fromUsername: typeof e.from_username === 'string' ? e.from_username.slice(0, 64) : 'Un membre',
        callType: e.call_type === 'video' ? 'video' : 'voice',
      },
    })
    ringtones.startRinging()
    const ms = Number(e.ring_timeout_ms)
    ringTimer = setTimeout(stopRing, ms > 0 && ms <= 120_000 ? ms : 45_000)
  })

  realtime.on('GROUP_CALL_ERROR', (e) => {
    if (e.group_id !== get().groupId) return
    cleanup(t(e.reason === 'unavailable' ? 'store.groupCall.mediaUnavailable' : 'store.groupCall.refused'))
  })

  return {
    groupId: null,
    groupName: null,
    status: 'idle',
    remotes: {},
    localVideo: null,
    micMuted: false,
    camOff: false,
    speaker: true,
    speaking: [],
    mutedPeers: {},
    qualities: {},
    active: {},
    ring: null,
    error: null,
    e2ee: false,
    e2eeOutdated: [],

    join: async (groupId, type, groupName) => {
      if (get().groupId === groupId) return
      if (get().groupId) get().leave()
      if (!realtime.isOpen) throw new Error(t('store.realtimeDown'))
      if (get().ring?.groupId === groupId) stopRing()
      const gen = ++generation
      set({ groupId, groupName: groupName ?? null, status: 'connecting', camOff: type !== 'video', micMuted: false, speaker: true, error: null })
      let video = type === 'video'
      if (!(await ensureMediaPermissions(video))) {
        video = false
        if (type !== 'video' || !(await ensureMediaPermissions(false))) {
          if (gen === generation) cleanup(t('store.micDenied'))
          throw new Error(t('store.micDenied'))
        }
      }
      if (gen !== generation) return
      set({ camOff: !video })
      realtime.send({ type: 'GROUP_CALL_JOIN', group_id: groupId, call_type: video ? 'video' : 'voice', ...E2EE_CLAIM })
    },

    leave: () => {
      const { groupId } = get()
      if (!groupId) return
      realtime.send({ type: 'GROUP_CALL_LEAVE', group_id: groupId })
      cleanup()
    },

    dismissRing: stopRing,

    toggleMic: () => {
      const micMuted = !get().micMuted
      set({ micMuted })
      void room?.localParticipant.setMicrophoneEnabled(!micMuted).catch((e: unknown) => logger.warn('group-call', 'micro', e))
    },

    toggleCam: async () => {
      const r = room
      if (!r) return
      if (!get().camOff) {
        set({ camOff: true, localVideo: null })
        const track = r.localParticipant.getTrackPublication(Track.Source.Camera)?.track
        if (track) await r.localParticipant.unpublishTrack(track, true).catch(() => undefined)
        return
      }
      if (!(await ensureMediaPermissions(true))) {
        set({ error: t('store.cameraDenied') })
        return
      }
      set({ camOff: false })
      await r.localParticipant.setCameraEnabled(true, CAMERA_OPTIONS).catch((e: unknown) => {
        logger.warn('group-call', 'caméra', e)
        set({ camOff: true, error: t('store.cameraUnavailable') })
      })
      refreshLocal()
    },

    switchCamera: () => {
      const track = room?.localParticipant.getTrackPublication(Track.Source.Camera)?.track?.mediaStreamTrack as { _switchCamera?: () => void } | undefined
      track?._switchCamera?.()
    },

    toggleSpeaker: () => {
      const speaker = !get().speaker
      set({ speaker })
      void callAudio.setSpeaker(speaker)
    },
  }
})

registerSignOutHook(() => {
  const s = useGroupCall.getState()
  s.dismissRing()
  s.leave()
})
