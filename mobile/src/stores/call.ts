import { create } from 'zustand'
import {
  RTCIceCandidate,
  RTCPeerConnection,
  RTCSessionDescription,
  type MediaStream,
} from 'react-native-webrtc'
import { voiceApi } from '@/api/voice'
import { logger } from '@/lib/logger'
import { realtime, type RealtimeEvent } from '@/lib/realtime'
import { audioSession, getLocalMedia, stopStream } from '@/services/media'
import { canShareInCall } from '@/features/calls/screenShareLogic'
import { captureScreen, stopScreenCapture } from '@/services/screenCapture'
import { onPeer, onTrackEnded } from '@/services/webrtc'
import { registerSignOutHook } from './auth'
import { useVoice } from './voice'

/**
 * Appels privés 1:1 (audio/vidéo) — protocole identique au client web
 * (client/src/store/call.ts) pour l'interopérabilité mobile ⇄ web ⇄ desktop :
 *
 *   A: DM_CALL_INIT ─────────────▶ B: DM_CALL_INCOMING
 *   A: DM_CALL_ACCEPTED ◀───────── B: DM_CALL_ACCEPT
 *   A: VOICE_SIGNAL{offer}  ─────▶ B
 *   A ◀──── VOICE_SIGNAL{answer}   B
 *   A ⇄ VOICE_SIGNAL{ice} ⇄ B       (payload.sdp / payload.candidate)
 *   DM_CALL_HANGUP / DM_CALL_DECLINE ⇒ DM_CALL_ENDED / DM_CALL_DECLINED
 *
 * Le serveur n'autorise la signalisation qu'entre deux utilisateurs ayant un DM.
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
  localStream: MediaStream | null
  remoteStream: MediaStream | null
  micMuted: boolean
  camOff: boolean
  /** Notre écran remplace la caméra envoyée (appel vidéo uniquement). */
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

let pc: RTCPeerConnection | null = null
let pendingIce: RTCIceCandidateInitLike[] = []
let ringTimeout: ReturnType<typeof setTimeout> | null = null
let disconnectTimer: ReturnType<typeof setTimeout> | null = null
let connectTimeout: ReturnType<typeof setTimeout> | null = null
let busy = false
/** Partage d'écran en appel 1:1 : flux capturé (sa piste remplace la caméra envoyée). */
let callScreenStream: MediaStream | null = null
/** Incrémenté à chaque cleanup() : détecte une continuation async (start/accept)
 *  périmée par un raccroché distant/erreur survenu pendant un `await`. */
let callGeneration = 0

interface RTCIceCandidateInitLike {
  candidate?: string
  sdpMid?: string | null
  sdpMLineIndex?: number | null
}

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i
const RING_TIMEOUT_MS = 45_000
const CONNECT_TIMEOUT_MS = 30_000

export const useCall = create<CallState>((set, get) => {
  const cleanup = (reason: string | null = null) => {
    callGeneration++
    busy = false
    if (ringTimeout) clearTimeout(ringTimeout)
    if (disconnectTimer) clearTimeout(disconnectTimer)
    if (connectTimeout) clearTimeout(connectTimeout)
    ringTimeout = null
    disconnectTimer = null
    connectTimeout = null
    try {
      pc?.close()
    } catch {
      /* ignore */
    }
    pc = null
    pendingIce = []
    // Fin d'appel : la capture d'écran s'arrête aussi (libère MediaProjection et sa notification).
    stopScreenCapture(callScreenStream)
    callScreenStream = null
    stopStream(get().localStream)
    audioSession.stopRingback()
    audioSession.stopRinging()
    if (get().phase !== 'idle') audioSession.stop()
    const { partnerName, partnerAvatar } = get()
    set({
      phase: 'idle',
      dmId: null,
      partnerId: null,
      partnerName: null,
      partnerAvatar: null,
      endedWith: reason && partnerName ? { name: partnerName, avatar: partnerAvatar } : null,
      localStream: null,
      remoteStream: null,
      micMuted: false,
      camOff: false,
      screenSharing: false,
      speaker: false,
      connectedAt: null,
      endReason: reason,
    })
  }

  const signal = (payload: Record<string, unknown>) => {
    const to = get().partnerId
    if (to) realtime.send({ type: 'VOICE_SIGNAL', to, payload })
  }

  /** Armé en entrant en 'connecting' : si la connexion média n'aboutit pas
   *  (pair distant muet, ICE bloqué…) sous 30 s, on raccroche proprement au
   *  lieu de rester bloqué indéfiniment sur l'écran d'appel. */
  const armConnectTimeout = () => {
    if (connectTimeout) clearTimeout(connectTimeout)
    connectTimeout = setTimeout(() => {
      if (get().phase !== 'connecting') return
      const { partnerId, dmId } = get()
      if (partnerId && dmId) realtime.send({ type: 'DM_CALL_HANGUP', to: partnerId, dm_id: dmId })
      cleanup('Connexion impossible')
    }, CONNECT_TIMEOUT_MS)
  }

  const buildPeer = async (): Promise<RTCPeerConnection> => {
    const iceServers = await voiceApi.iceServers()
    const peer = new RTCPeerConnection({ iceServers, bundlePolicy: 'max-bundle' })

    onPeer(peer, 'icecandidate', (e) => {
      const c = e.candidate
      if (c) signal({ type: 'ice', candidate: { candidate: c.candidate, sdpMid: c.sdpMid, sdpMLineIndex: c.sdpMLineIndex } })
    })
    onPeer(peer, 'track', (e) => {
      const stream = e.streams[0]
      if (stream) set({ remoteStream: stream })
    })
    onPeer(peer, 'connectionstatechange', () => {
      const st = peer.connectionState
      if (st === 'connected') {
        if (disconnectTimer) clearTimeout(disconnectTimer)
        if (connectTimeout) clearTimeout(connectTimeout)
        disconnectTimer = null
        connectTimeout = null
        audioSession.stopRingback()
        set((s) => ({ phase: 'connected', connectedAt: s.connectedAt ?? Date.now() }))
      } else if (st === 'disconnected') {
        // Coupure réseau passagère (4G ⇄ Wi-Fi) : laisser 6 s pour récupérer.
        disconnectTimer = setTimeout(() => {
          if (peer.connectionState === 'disconnected' || peer.connectionState === 'failed') {
            get().hangup()
          }
        }, 6000)
      } else if (st === 'failed') {
        peer.restartIce()
        setTimeout(async () => {
          if (peer.connectionState !== 'failed') return
          try {
            const offer = await peer.createOffer({ iceRestart: true })
            await peer.setLocalDescription(offer)
            signal({ type: 'offer', sdp: { type: offer.type, sdp: offer.sdp } })
          } catch {
            get().hangup()
          }
        }, 2000)
      }
    })
    pc = peer
    return peer
  }

  const attachMedia = async (type: CallType) => {
    const { stream, hasVideo } = await getLocalMedia(type === 'video')
    set({ localStream: stream, callType: hasVideo ? 'video' : 'voice', speaker: hasVideo })
    return stream
  }

  // ── Signalisation entrante ────────────────────────────────────────────────
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
    audioSession.startRinging()
    ringTimeout = setTimeout(() => {
      if (get().incoming?.dmId === dmId) {
        audioSession.stopRinging()
        set({ incoming: null })
      }
    }, RING_TIMEOUT_MS)
  })

  realtime.on('DM_CALL_ACCEPTED', async (e) => {
    if (e.dm_id !== get().dmId || !pc || get().phase !== 'calling') return
    if (ringTimeout) clearTimeout(ringTimeout)
    ringTimeout = null
    set({ phase: 'connecting' })
    armConnectTimeout()
    try {
      const offer = await pc.createOffer({})
      await pc.setLocalDescription(offer)
      signal({ type: 'offer', sdp: { type: offer.type, sdp: offer.sdp } })
    } catch (err) {
      logger.warn('call', 'création offer', err)
      get().hangup()
    }
  })

  const remoteEnded = (reason: string) => (e: RealtimeEvent) => {
    const inc = get().incoming
    if (inc && e.dm_id === inc.dmId) {
      audioSession.stopRinging()
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

  realtime.on('VOICE_SIGNAL', async (e) => {
    const peer = pc
    if (!peer) return
    const payload = e.payload as Record<string, unknown> | undefined
    if (!payload || typeof payload.type !== 'string') return
    // Signaux du vocal de serveur (format payload.data) : pas pour nous.
    if (payload.data !== undefined && payload.sdp === undefined && payload.candidate === undefined) return
    if (typeof e.from === 'string' && e.from !== get().partnerId) return
    try {
      if (payload.type === 'offer' && payload.sdp) {
        await peer.setRemoteDescription(new RTCSessionDescription(payload.sdp as { type: string; sdp: string }))
        for (const c of pendingIce) await peer.addIceCandidate(new RTCIceCandidate(c)).catch(() => undefined)
        pendingIce = []
        const answer = await peer.createAnswer()
        await peer.setLocalDescription(answer)
        signal({ type: 'answer', sdp: { type: answer.type, sdp: answer.sdp } })
      } else if (payload.type === 'answer' && payload.sdp) {
        if (peer.signalingState === 'have-local-offer') {
          await peer.setRemoteDescription(new RTCSessionDescription(payload.sdp as { type: string; sdp: string }))
          for (const c of pendingIce) await peer.addIceCandidate(new RTCIceCandidate(c)).catch(() => undefined)
          pendingIce = []
        }
      } else if (payload.type === 'ice' && payload.candidate && typeof payload.candidate === 'object') {
        const c = payload.candidate as RTCIceCandidateInitLike
        if (peer.remoteDescription) await peer.addIceCandidate(new RTCIceCandidate(c)).catch(() => undefined)
        else if (pendingIce.length < 200) pendingIce.push(c)
      }
    } catch (err) {
      logger.warn('call', `signal ${String(payload.type)}`, err)
    }
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
    localStream: null,
    remoteStream: null,
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
      // Phase posée AVANT les await (média, ICE servers) : un DM_CALL_ERROR/ENDED
      // distant ou un hangup() local pendant cette attente doit voir phase !==
      // 'idle' pour que le handler correspondant appelle cleanup() — sinon
      // l'événement est ignoré et la garde de génération ci-dessous ne se
      // déclenche jamais (l'appel resterait bloqué après un raccroché distant).
      set({ phase: 'calling', dmId, partnerId, partnerName, partnerAvatar, endedWith: null, callType: type, endReason: null })
      try {
        const stream = await attachMedia(type)
        if (gen !== callGeneration) {
          stopStream(stream)
          return
        }
        const peer = await buildPeer()
        if (gen !== callGeneration) {
          try {
            peer.close()
          } catch {
            /* ignore */
          }
          pc = null
          stopStream(stream)
          return
        }
        stream.getTracks().forEach((t) => peer.addTrack(t, stream))
        audioSession.start(get().callType === 'video')
        audioSession.startRingback()
        realtime.send({ type: 'DM_CALL_INIT', to: partnerId, dm_id: dmId, call_type: get().callType })
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
      audioSession.stopRinging()
      // Idem start() : phase posée AVANT les await pour que remoteEnded /
      // DM_CALL_ERROR appellent cleanup() s'ils arrivent pendant l'attente du
      // micro/ICE, plutôt que de rester ignorés (phase encore 'idle').
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
      })
      try {
        const stream = await attachMedia(inc.callType)
        if (gen !== callGeneration) {
          stopStream(stream)
          return
        }
        const peer = await buildPeer()
        if (gen !== callGeneration) {
          try {
            peer.close()
          } catch {
            /* ignore */
          }
          pc = null
          stopStream(stream)
          return
        }
        stream.getTracks().forEach((t) => peer.addTrack(t, stream))
        audioSession.start(get().callType === 'video')
        realtime.send({ type: 'DM_CALL_ACCEPT', to: inc.fromUserId, dm_id: inc.dmId })
        armConnectTimeout()
      } catch {
        // gen !== callGeneration ⇒ l'appel a déjà été terminé par cleanup() (raccroché
        // distant, timeout…) pendant l'attente : ne pas renvoyer un DECLINE en double.
        if (gen === callGeneration) {
          realtime.send({ type: 'DM_CALL_DECLINE', to: inc.fromUserId, dm_id: inc.dmId })
          cleanup('Micro inaccessible — appel refusé')
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
      audioSession.stopRinging()
      realtime.send({ type: 'DM_CALL_DECLINE', to: inc.fromUserId, dm_id: inc.dmId })
      set({ incoming: null })
    },

    hangup: () => {
      const { partnerId, dmId, phase } = get()
      if (partnerId && dmId && phase !== 'idle') realtime.send({ type: 'DM_CALL_HANGUP', to: partnerId, dm_id: dmId })
      cleanup('Appel terminé')
    },

    toggleMic: () => {
      const track = get().localStream?.getAudioTracks()[0]
      if (!track) return
      const muted = !get().micMuted
      track.enabled = !muted
      set({ micMuted: muted })
    },

    toggleCam: () => {
      const track = get().localStream?.getVideoTracks()[0]
      if (!track) return
      const off = !get().camOff
      track.enabled = !off
      set({ camOff: off })
    },

    switchCamera: () => {
      const track = get().localStream?.getVideoTracks()[0]
      if (track) track._switchCamera()
    },

    toggleSpeaker: () => {
      const on = !get().speaker
      audioSession.setSpeaker(on)
      set({ speaker: on })
    },

    // Le web n'a pas de partage d'écran en appel 1:1 : on remplace la piste caméra envoyée
    // (replaceTrack, sans renégociation). Le correspondant voit l'écran à la place de la caméra.
    shareScreen: async () => {
      const { phase, callType, screenSharing } = get()
      if (screenSharing || !pc || !canShareInCall(phase, callType)) return
      const gen = callGeneration
      const captured = await captureScreen()
      const sender = pc?.getSenders().find((x) => x.track?.kind === 'video')
      if (gen !== callGeneration || !sender) {
        stopScreenCapture(captured.stream) // appel terminé pendant le dialogue système
        return
      }
      await sender.replaceTrack(captured.track)
      callScreenStream = captured.stream
      onTrackEnded(captured.track, () => {
        if (callScreenStream === captured.stream) get().stopScreenShare()
      })
      set({ screenSharing: true })
    },

    stopScreenShare: () => {
      if (!callScreenStream) return
      stopScreenCapture(callScreenStream)
      callScreenStream = null
      const cam = get().localStream?.getVideoTracks()[0] ?? null
      const sender = pc?.getSenders().find((x) => x.track?.kind === 'video' || x.track === null)
      if (sender) void sender.replaceTrack(cam).catch((err: unknown) => logger.warn('call', 'retour caméra', err))
      set({ screenSharing: false })
    },
  }
})

registerSignOutHook(() => {
  const s = useCall.getState()
  if (s.incoming) s.decline()
  if (s.phase !== 'idle') s.hangup()
})
