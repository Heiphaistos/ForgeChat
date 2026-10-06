import { create } from 'zustand'
import type { MediaStream } from '@livekit/react-native-webrtc'
import { DisconnectReason, Room, RoomEvent, Track, type RemoteParticipant } from 'livekit-client'
import { voiceApi } from '@/api/voice'
import type { LiveKitAccess } from '@/config/livekitUrl'
import { canShareInCall } from '@/features/calls/screenShareLogic'
import { logger } from '@/lib/logger'
import { realtime, type RealtimeEvent } from '@/lib/realtime'
import { callAudio, leaveRoom, liveKitAccess, stopScreenShare, streamOf } from '@/services/livekit'
import { ensureMediaPermissions, ringtones } from '@/services/media'
import { registerSignOutHook } from './auth'
import { useVoice } from './voice'

/**
 * Appels privés 1:1 (audio/vidéo) — protocole du serveur ForgeChat ≥ 3.251 et du client web
 * (client/src/store/call.ts) : la sonnerie passe par le WebSocket, le média par le SFU LiveKit.
 *
 *   A: DM_CALL_INIT ─────────────▶ B: DM_CALL_INCOMING (toutes ses sessions)
 *   A ◀── DM_CALL_ACCEPTED{livekit} ── B: DM_CALL_ACCEPT
 *                                   B ◀── DM_CALL_MEDIA{livekit, session_id} (seule session qui décroche)
 *                                   autres sessions de B ◀── DM_CALL_TAKEN
 *   A et B rejoignent la salle LiveKit (identité = id utilisateur) et publient micro (+ caméra).
 *   DM_CALL_HANGUP / DM_CALL_DECLINE ⇒ DM_CALL_ENDED / DM_CALL_DECLINED
 *
 * Le serveur ne délivre l'accès LiveKit qu'entre deux utilisateurs ayant une conversation commune.
 */

export type CallType = 'voice' | 'video'
export type CallPhase = 'idle' | 'calling' | 'connecting' | 'connected'

export interface IncomingCall {
  fromUserId: string
  fromUsername: string
  dmId: string
  callType: CallType
  receivedAt: number
}

interface CallState {
  incoming: IncomingCall | null
  phase: CallPhase
  dmId: string | null
  partnerId: string | null
  partnerName: string | null
  partnerAvatar: string | null
  /** Correspondant du dernier appel terminé avec un motif : l'écran de fin garde son nom et son avatar. */
  endedWith: { name: string; avatar: string | null } | null
  callType: CallType
  /** Notre caméra (aperçu), null si coupée ou en partage d'écran. */
  localVideo: MediaStream | null
  /** Vidéo du correspondant : son écran partagé s'il y en a un, sinon sa caméra. */
  remoteVideo: MediaStream | null
  micMuted: boolean
  camOff: boolean
  /** Notre écran est diffusé à la place de la caméra (appel vidéo uniquement). */
  screenSharing: boolean
  speaker: boolean
  connectedAt: number | null
  endReason: string | null
  start: (dmId: string, partnerId: string, partnerName: string, type: CallType, partnerAvatar?: string | null) => Promise<void>
  accept: () => Promise<void>
  decline: () => void
  hangup: () => void
  toggleMic: () => void
  toggleCam: () => void
  switchCamera: () => void
  toggleSpeaker: () => void
  shareScreen: () => Promise<void>
  stopScreenShare: () => void
}

let room: Room | null = null
let ringTimeout: ReturnType<typeof setTimeout> | null = null
let connectTimeout: ReturnType<typeof setTimeout> | null = null
let partnerGoneTimer: ReturnType<typeof setTimeout> | null = null
let busy = false
/** Appelé : DM_CALL_ACCEPT envoyé, en attente de l'accès LiveKit (DM_CALL_MEDIA). */
let awaitingMedia = false
/** Session WebSocket de cet appareil (SESSION_INIT) : DM_CALL_MEDIA n'est que pour elle. */
let mySessionId: string | null = null
/** Caméra active avant le partage d'écran (rétablie à la fin du partage). */
let camBeforeShare = false
/** Incrémenté à chaque cleanup() : détecte une continuation async périmée (raccroché pendant un await). */
let callGeneration = 0

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i
const RING_TIMEOUT_MS = 45_000
const CONNECT_TIMEOUT_MS = 30_000
/** Coupure du correspondant (réseau, app fermée) : délai pour revenir, comme le web. */
const PARTNER_GONE_MS = 20_000

export const useCall = create<CallState>((set, get) => {
  const clearTimers = () => {
    for (const t of [ringTimeout, connectTimeout, partnerGoneTimer]) if (t) clearTimeout(t)
    ringTimeout = null
    connectTimeout = null
    partnerGoneTimer = null
  }

  const cleanup = (reason: string | null = null) => {
    callGeneration++
    busy = false
    awaitingMedia = false
    clearTimers()
    const r = room
    room = null
    if (r) void leaveRoom(r)
    ringtones.stopRingback()
    ringtones.stopRinging()
    if (get().phase !== 'idle') {
      ringtones.keepScreenOn(false)
      void callAudio.stop()
    }
    const { partnerName, partnerAvatar } = get()
    set({
      phase: 'idle',
      dmId: null,
      partnerId: null,
      partnerName: null,
      partnerAvatar: null,
      endedWith: reason && partnerName ? { name: partnerName, avatar: partnerAvatar } : null,
      localVideo: null,
      remoteVideo: null,
      micMuted: false,
      camOff: false,
      screenSharing: false,
      speaker: false,
      connectedAt: null,
      endReason: reason,
    })
  }

  const refreshRemote = () => {
    const pid = get().partnerId
    const rp = pid ? room?.remoteParticipants.get(pid) : undefined
    const screen = rp?.getTrackPublication(Track.Source.ScreenShare)
    const cam = rp?.getTrackPublication(Track.Source.Camera)
    const video = (screen?.isSubscribed && !screen.isMuted ? streamOf(screen.track) : null) ?? (cam?.isSubscribed && !cam.isMuted ? streamOf(cam.track) : null)
    set({ remoteVideo: video })
  }

  const refreshLocal = () => {
    const cam = room?.localParticipant.getTrackPublication(Track.Source.Camera)
    const { camOff, screenSharing } = get()
    set({ localVideo: !camOff && !screenSharing && cam && !cam.isMuted ? streamOf(cam.track) : null })
  }

  const markConnected = () => {
    if (connectTimeout) clearTimeout(connectTimeout)
    connectTimeout = null
    if (partnerGoneTimer) clearTimeout(partnerGoneTimer)
    partnerGoneTimer = null
    ringtones.stopRingback()
    set((s) => ({ phase: 'connected', connectedAt: s.connectedAt ?? Date.now() }))
  }

  const armConnectTimeout = () => {
    if (connectTimeout) clearTimeout(connectTimeout)
    connectTimeout = setTimeout(() => {
      if (get().phase === 'connected' || get().phase === 'idle') return
      const { partnerId, dmId } = get()
      if (partnerId && dmId) realtime.send({ type: 'DM_CALL_HANGUP', to: partnerId, dm_id: dmId })
      cleanup('Connexion impossible')
    }, CONNECT_TIMEOUT_MS)
  }

  /** Rejoint la salle LiveKit et publie micro (+ caméra en appel vidéo). */
  const connect = async (access: LiveKitAccess) => {
    if (room) return
    const gen = callGeneration
    const r = new Room({ adaptiveStream: false, dynacast: true })
    room = r
    const isPartner = (p: RemoteParticipant) => p.identity === get().partnerId
    r.on(RoomEvent.TrackSubscribed, (_t, _p, p) => isPartner(p) && refreshRemote())
      .on(RoomEvent.TrackUnsubscribed, (_t, _p, p) => isPartner(p) && refreshRemote())
      .on(RoomEvent.TrackMuted, () => refreshRemote())
      .on(RoomEvent.TrackUnmuted, () => refreshRemote())
      .on(RoomEvent.LocalTrackPublished, () => refreshLocal())
      .on(RoomEvent.LocalTrackUnpublished, (pub) => {
        // Partage arrêté depuis la notification système (ou par Android) : même nettoyage.
        if (pub.source === Track.Source.ScreenShare && get().screenSharing) get().stopScreenShare()
        refreshLocal()
      })
      .on(RoomEvent.ParticipantConnected, (p) => {
        if (!isPartner(p)) return
        markConnected()
        refreshRemote()
      })
      .on(RoomEvent.ParticipantDisconnected, (p) => {
        if (!isPartner(p)) return
        set({ remoteVideo: null })
        partnerGoneTimer = setTimeout(() => {
          if (room === r) cleanup('Appel terminé')
        }, PARTNER_GONE_MS)
      })
      .on(RoomEvent.Disconnected, (reason) => {
        if (room !== r) return
        if (reason !== DisconnectReason.CLIENT_INITIATED) cleanup('Connexion au serveur audio/vidéo perdue')
      })
    try {
      await callAudio.start(get().speaker)
      const turn = await voiceApi.turnServers()
      await r.connect(access.url, access.token, { autoSubscribe: true, ...(turn.length ? { rtcConfig: { iceServers: turn } } : {}) })
    } catch (err) {
      logger.warn('call', 'connexion LiveKit', err)
      if (gen === callGeneration) {
        const { partnerId, dmId } = get()
        if (partnerId && dmId) realtime.send({ type: 'DM_CALL_HANGUP', to: partnerId, dm_id: dmId })
        cleanup('Impossible de joindre le serveur audio/vidéo')
      }
      return
    }
    if (gen !== callGeneration || room !== r) {
      void r.disconnect().catch(() => undefined)
      return
    }
    try {
      await r.localParticipant.setMicrophoneEnabled(!get().micMuted)
      if (get().callType === 'video') {
        try {
          await r.localParticipant.setCameraEnabled(true, { facingMode: 'user', resolution: { width: 640, height: 480, frameRate: 24 } })
        } catch (err) {
          logger.warn('call', 'caméra indisponible, repli audio', err)
          set({ callType: 'voice', camOff: true })
        }
      }
    } catch (err) {
      logger.warn('call', 'publication micro', err)
    }
    if (gen !== callGeneration) return
    const pid = get().partnerId
    if (pid && r.remoteParticipants.has(pid)) markConnected()
    refreshRemote()
    refreshLocal()
  }

  const unpublishCamera = async (r: Room) => {
    const track = r.localParticipant.getTrackPublication(Track.Source.Camera)?.track
    if (track) await r.localParticipant.unpublishTrack(track, true).catch((e: unknown) => logger.warn('call', 'retrait caméra', e))
  }

  /** Accès LiveKit reçu : validé (adresse autorisée), sinon fin d'appel avec le motif. */
  const connectWith = (raw: unknown) => {
    const res = liveKitAccess(raw)
    if ('error' in res) {
      const { partnerId, dmId } = get()
      if (partnerId && dmId) realtime.send({ type: 'DM_CALL_HANGUP', to: partnerId, dm_id: dmId })
      cleanup(res.error)
      return
    }
    void connect(res.access)
  }

  // ── Signalisation entrante ────────────────────────────────────────────────
  realtime.on('SESSION_INIT', (e: RealtimeEvent) => {
    mySessionId = typeof e.session_id === 'string' ? e.session_id : null
  })

  realtime.on('DM_CALL_INCOMING', (e: RealtimeEvent) => {
    const from = typeof e.from === 'string' ? e.from : null
    const dmId = typeof e.dm_id === 'string' ? e.dm_id : null
    if (!from || !dmId || !UUID_RE.test(from) || !UUID_RE.test(dmId)) return
    const s = get()
    if (s.phase !== 'idle' || s.incoming || useVoice.getState().channelId) {
      // Déjà en appel ou dans un salon vocal : occupé.
      realtime.send({ type: 'DM_CALL_DECLINE', to: from, dm_id: dmId })
      return
    }
    set({
      incoming: {
        fromUserId: from,
        fromUsername: typeof e.from_username === 'string' ? e.from_username.slice(0, 64) : 'Inconnu',
        dmId,
        callType: e.call_type === 'video' ? 'video' : 'voice',
        receivedAt: Date.now(),
      },
    })
    ringtones.startRinging()
    ringTimeout = setTimeout(() => {
      if (get().incoming?.dmId === dmId) {
        ringtones.stopRinging()
        set({ incoming: null })
      }
    }, RING_TIMEOUT_MS)
  })

  // Appelant : le correspondant a décroché, le serveur joint l'accès au SFU.
  realtime.on('DM_CALL_ACCEPTED', (e) => {
    if (e.dm_id !== get().dmId || get().phase !== 'calling') return
    if (ringTimeout) clearTimeout(ringTimeout)
    ringTimeout = null
    ringtones.stopRingback()
    set({ phase: 'connecting' })
    armConnectTimeout()
    connectWith(e.livekit)
  })

  // Appelé : accès au SFU, envoyé à la seule session qui a décroché.
  realtime.on('DM_CALL_MEDIA', (e) => {
    if (e.dm_id !== get().dmId || !awaitingMedia) return
    if (typeof e.session_id === 'string' && mySessionId && e.session_id !== mySessionId) return
    awaitingMedia = false
    connectWith(e.livekit)
  })

  // Une autre session du même compte (web, desktop) a décroché ou refusé : on arrête de sonner.
  realtime.on('DM_CALL_TAKEN', (e) => {
    if (typeof e.session_id === 'string' && e.session_id === mySessionId) return
    const inc = get().incoming
    if (inc && e.dm_id === inc.dmId) {
      if (ringTimeout) clearTimeout(ringTimeout)
      ringTimeout = null
      ringtones.stopRinging()
      set({ incoming: null })
    }
  })

  const remoteEnded = (reason: string) => (e: RealtimeEvent) => {
    const inc = get().incoming
    if (inc && e.dm_id === inc.dmId) {
      ringtones.stopRinging()
      set({ incoming: null })
      return
    }
    if (e.dm_id && e.dm_id !== get().dmId) return
    if (get().phase !== 'idle') cleanup(reason)
  }
  realtime.on('DM_CALL_ENDED', remoteEnded('Appel terminé'))
  realtime.on('DM_CALL_DECLINED', remoteEnded('Appel refusé'))
  realtime.on('DM_CALL_ERROR', (e) => {
    if (get().phase === 'idle') return
    if (e.dm_id && e.dm_id !== get().dmId) return
    cleanup(e.reason === 'offline' ? 'Ton correspondant est hors ligne' : e.reason === 'rate_limited' ? 'Trop d’appels, patiente un peu' : 'Appel impossible')
  })

  return {
    incoming: null,
    phase: 'idle',
    dmId: null,
    partnerId: null,
    partnerName: null,
    partnerAvatar: null,
    endedWith: null,
    callType: 'voice',
    localVideo: null,
    remoteVideo: null,
    micMuted: false,
    camOff: false,
    screenSharing: false,
    speaker: false,
    connectedAt: null,
    endReason: null,

    start: async (dmId, partnerId, partnerName, type, partnerAvatar = null) => {
      if (busy || get().phase !== 'idle') return
      if (!realtime.isOpen) throw new Error('Connexion temps réel indisponible')
      busy = true
      const gen = callGeneration
      // Phase posée AVANT les await : un DM_CALL_ERROR/ENDED distant ou un hangup() local pendant
      // l'attente des permissions doit voir phase !== 'idle' et appeler cleanup().
      set({ phase: 'calling', dmId, partnerId, partnerName, partnerAvatar, endedWith: null, callType: type, endReason: null, speaker: type === 'video' })
      try {
        if (!(await ensureMediaPermissions(type === 'video'))) throw new Error('Permission micro/caméra refusée')
        if (gen !== callGeneration) return
        ringtones.keepScreenOn(true)
        ringtones.startRingback()
        realtime.send({ type: 'DM_CALL_INIT', to: partnerId, dm_id: dmId, call_type: type })
        ringTimeout = setTimeout(() => {
          if (get().phase === 'calling') {
            realtime.send({ type: 'DM_CALL_HANGUP', to: partnerId, dm_id: dmId })
            cleanup('Pas de réponse')
          }
        }, RING_TIMEOUT_MS)
      } catch (e) {
        cleanup(e instanceof Error ? e.message : 'Appel impossible')
        throw e
      } finally {
        busy = false
      }
    },

    accept: async () => {
      const inc = get().incoming
      if (!inc || busy) return
      busy = true
      const gen = callGeneration
      if (ringTimeout) clearTimeout(ringTimeout)
      ringTimeout = null
      ringtones.stopRinging()
      set({
        incoming: null,
        phase: 'connecting',
        dmId: inc.dmId,
        partnerId: inc.fromUserId,
        partnerName: inc.fromUsername,
        partnerAvatar: null,
        endedWith: null,
        callType: inc.callType,
        endReason: null,
        speaker: inc.callType === 'video',
      })
      try {
        if (!(await ensureMediaPermissions(inc.callType === 'video'))) throw new Error('Micro inaccessible — appel refusé')
        if (gen !== callGeneration) return
        ringtones.keepScreenOn(true)
        awaitingMedia = true
        realtime.send({ type: 'DM_CALL_ACCEPT', to: inc.fromUserId, dm_id: inc.dmId })
        armConnectTimeout()
      } catch (e) {
        // gen !== callGeneration ⇒ appel déjà terminé (raccroché distant…) : pas de DECLINE en double.
        if (gen === callGeneration) {
          realtime.send({ type: 'DM_CALL_DECLINE', to: inc.fromUserId, dm_id: inc.dmId })
          cleanup(e instanceof Error ? e.message : 'Micro inaccessible — appel refusé')
        }
      } finally {
        busy = false
      }
    },

    decline: () => {
      const inc = get().incoming
      if (!inc) return
      if (ringTimeout) clearTimeout(ringTimeout)
      ringTimeout = null
      ringtones.stopRinging()
      realtime.send({ type: 'DM_CALL_DECLINE', to: inc.fromUserId, dm_id: inc.dmId })
      set({ incoming: null })
    },

    hangup: () => {
      const { partnerId, dmId, phase } = get()
      if (partnerId && dmId && phase !== 'idle') realtime.send({ type: 'DM_CALL_HANGUP', to: partnerId, dm_id: dmId })
      cleanup('Appel terminé')
    },

    toggleMic: () => {
      const muted = !get().micMuted
      set({ micMuted: muted })
      void room?.localParticipant.setMicrophoneEnabled(!muted).catch((e: unknown) => logger.warn('call', 'micro', e))
    },

    toggleCam: () => {
      if (get().screenSharing) return
      const off = !get().camOff
      set({ camOff: off })
      void room?.localParticipant
        .setCameraEnabled(!off)
        .then(refreshLocal)
        .catch((e: unknown) => logger.warn('call', 'caméra', e))
    },

    switchCamera: () => {
      const track = room?.localParticipant.getTrackPublication(Track.Source.Camera)?.track?.mediaStreamTrack as
        | { _switchCamera?: () => void }
        | undefined
      track?._switchCamera?.()
    },

    toggleSpeaker: () => {
      const on = !get().speaker
      set({ speaker: on })
      void callAudio.setSpeaker(on)
    },

    // Le correspondant ne voit qu'une vidéo : l'écran remplace la caméra le temps du partage.
    shareScreen: async () => {
      const { phase, callType, screenSharing, camOff } = get()
      const r = room
      if (screenSharing || !r || !canShareInCall(phase, callType)) return
      camBeforeShare = !camOff
      // Caméra DÉPUBLIÉE (pas seulement coupée) : le web assemble toutes les pistes du correspondant
      // dans un seul flux et affiche la première vidéo ; une caméra en sourdine y resterait en noir.
      await unpublishCamera(r)
      try {
        await r.localParticipant.setScreenShareEnabled(true)
      } catch (e) {
        if (camBeforeShare && room === r) await r.localParticipant.setCameraEnabled(true).catch(() => undefined)
        refreshLocal()
        throw e
      }
      if (room !== r) return
      set({ screenSharing: true })
      refreshLocal()
    },

    stopScreenShare: () => {
      const r = room
      if (!get().screenSharing) return
      set({ screenSharing: false })
      if (!r) return
      void (async () => {
        await stopScreenShare(r)
        if (camBeforeShare && room === r) await r.localParticipant.setCameraEnabled(true).catch(() => undefined)
        refreshLocal()
      })()
    },
  }
})

registerSignOutHook(() => {
  const s = useCall.getState()
  if (s.incoming) s.decline()
  if (s.phase !== 'idle') s.hangup()
})
