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
import { onPeer } from '@/services/webrtc'
import { getMyId, registerSignOutHook } from './auth'

/**
 * Salons vocaux de serveur — maillage WebRTC (mesh), compatible avec le client
 * web (client/src/store/voice.ts) :
 *
 *  - VOICE_JOIN → VOICE_EXISTING_PEERS : le nouvel arrivant envoie une offer à
 *    chaque pair déjà présent ; les suivants (VOICE_USER_JOINED) nous l'enverront.
 *  - VOICE_SIGNAL avec payload { type, data } (≠ appels DM : payload.sdp).
 *  - Glare : le pair « poli » (id lexicographiquement inférieur) fait un rollback.
 *
 * Mobile : micro + réception audio/vidéo des autres (caméra/écran visibles),
 * sans émission vidéo (économie batterie/données).
 */

export interface VoicePeer {
  userId: string
  username: string
  avatar: string | null
  stream: MediaStream | null
  muted: boolean
  video: boolean
}

interface VoiceState {
  serverId: string | null
  channelId: string | null
  channelName: string | null
  joined: boolean
  joining: boolean
  peers: VoicePeer[]
  muted: boolean
  deafened: boolean
  speaker: boolean
  error: string | null
  join: (serverId: string, channelId: string, channelName: string, password?: string) => Promise<void>
  leave: () => void
  toggleMute: () => void
  toggleDeafen: () => void
  toggleSpeaker: () => void
}

const pcs = new Map<string, RTCPeerConnection>()
const iceQueues = new Map<string, unknown[]>()
let localStream: MediaStream | null = null
/** Incrémenté à chaque leave() : détecte une continuation async de join() périmée
 *  par un leave()/re-join concurrent survenu pendant l'attente du micro. */
let joinGeneration = 0

const isStr = (v: unknown): v is string => typeof v === 'string' && v.length > 0 && v.length < 100

export const useVoice = create<VoiceState>((set, get) => {
  const send = (to: string, payload: { type: string; data: unknown }) =>
    realtime.send({ type: 'VOICE_SIGNAL', to, payload })

  const upsertPeer = (id: string, patch: Partial<VoicePeer>) =>
    set((s) => {
      const existing = s.peers.find((p) => p.userId === id)
      if (existing) return { peers: s.peers.map((p) => (p.userId === id ? { ...p, ...patch } : p)) }
      return {
        peers: [
          ...s.peers,
          { userId: id, username: patch.username ?? '…', avatar: patch.avatar ?? null, stream: null, muted: false, video: false, ...patch },
        ],
      }
    })

  const dropPeer = (id: string) => {
    const pc = pcs.get(id)
    try {
      pc?.close()
    } catch {
      /* ignore */
    }
    pcs.delete(id)
    iceQueues.delete(id)
    set((s) => ({ peers: s.peers.filter((p) => p.userId !== id) }))
  }

  const drainIce = async (id: string) => {
    const pc = pcs.get(id)
    const q = iceQueues.get(id) ?? []
    iceQueues.set(id, [])
    if (!pc) return
    for (const c of q) await pc.addIceCandidate(new RTCIceCandidate(c as never)).catch(() => undefined)
  }

  const createPeer = async (id: string, info: Partial<VoicePeer>): Promise<RTCPeerConnection> => {
    const existing = pcs.get(id)
    if (existing) return existing
    const iceServers = await voiceApi.iceServers()
    const pc = new RTCPeerConnection({ iceServers, bundlePolicy: 'max-bundle' })
    pcs.set(id, pc)
    iceQueues.set(id, [])

    if (localStream) localStream.getTracks().forEach((t) => pc.addTrack(t, localStream!))
    else pc.addTransceiver('audio', { direction: 'recvonly' })
    // Recevoir la vidéo des pairs (caméra / partage d'écran) même sans en émettre.
    pc.addTransceiver('video', { direction: 'recvonly' })

    onPeer(pc, 'icecandidate', (e) => {
      const c = e.candidate
      if (c) send(id, { type: 'ice', data: { candidate: c.candidate, sdpMid: c.sdpMid, sdpMLineIndex: c.sdpMLineIndex } })
    })
    onPeer(pc, 'track', (e) => {
      const stream = e.streams[0]
      if (!stream) return
      if (get().deafened) stream.getAudioTracks().forEach((t) => (t.enabled = false))
      upsertPeer(id, { stream })
    })
    let timer: ReturnType<typeof setTimeout> | null = null
    onPeer(pc, 'connectionstatechange', () => {
      const st = pc.connectionState
      if (st === 'connected' && timer) {
        clearTimeout(timer)
        timer = null
      } else if (st === 'disconnected') {
        timer = setTimeout(() => {
          if (pc.connectionState === 'disconnected' || pc.connectionState === 'failed') dropPeer(id)
        }, 6000)
      } else if (st === 'failed') {
        pc.restartIce()
      }
    })
    upsertPeer(id, info)
    return pc
  }

  let offFns: (() => void)[] = []

  const bindRoom = (channelId: string) => {
    offFns.forEach((f) => f())
    offFns = [
      realtime.on('VOICE_EXISTING_PEERS', async (e: RealtimeEvent) => {
        if (e.channel_id !== channelId || !Array.isArray(e.peers)) return
        set({ joined: true, joining: false })
        for (const raw of e.peers as Record<string, unknown>[]) {
          if (!isStr(raw.user_id)) continue
          const pc = await createPeer(raw.user_id, {
            username: isStr(raw.username) ? raw.username : '…',
            avatar: isStr(raw.avatar) ? raw.avatar : null,
            muted: raw.muted === true,
            video: raw.video === true,
          })
          try {
            const offer = await pc.createOffer({})
            await pc.setLocalDescription(offer)
            send(raw.user_id, { type: 'offer', data: { type: offer.type, sdp: offer.sdp } })
          } catch (err) {
            logger.warn('voice', 'offer initiale', err)
          }
        }
      }),
      realtime.on('VOICE_USER_JOINED', (e) => {
        if (e.channel_id !== channelId || !isStr(e.user_id) || e.user_id === getMyId()) return
        void createPeer(e.user_id, {
          username: isStr(e.username) ? e.username : '…',
          avatar: isStr(e.avatar) ? e.avatar : null,
        })
      }),
      realtime.on('VOICE_USER_LEFT', (e) => {
        if (e.channel_id === channelId && isStr(e.user_id)) dropPeer(e.user_id)
      }),
      realtime.on('VOICE_STATE_UPDATE', (e) => {
        if (e.channel_id !== channelId || !isStr(e.user_id)) return
        if (!pcs.has(e.user_id)) return
        upsertPeer(e.user_id, { muted: e.muted === true, video: e.video === true || e.screen === true })
      }),
      realtime.on('VOICE_REDIRECT', (e) => {
        if (e.from_channel_id === channelId && isStr(e.channel_id)) {
          const next = e.channel_id
          set({ channelId: next })
          bindRoom(next)
        }
      }),
      realtime.on('VOICE_JOIN_ERROR', (e) => {
        if (e.channel_id !== channelId) return
        const reason =
          e.reason === 'wrong_password' ? 'Mot de passe vocal incorrect' : e.reason === 'channel_full' ? 'Salon plein' : 'Impossible de rejoindre'
        get().leave()
        set({ error: reason })
      }),
      realtime.on('VOICE_SIGNAL', async (e) => {
        const from = e.from
        const payload = e.payload as { type?: string; data?: unknown } | undefined
        if (!isStr(from) || !payload || payload.data === undefined || typeof payload.type !== 'string') return
        if (payload.type === 'offer' && !pcs.has(from)) await createPeer(from, {})
        const pc = pcs.get(from)
        if (!pc) return
        try {
          if (payload.type === 'offer') {
            if (pc.signalingState === 'have-local-offer') {
              const polite = (getMyId() ?? '') < from
              if (!polite) return
              await pc.setLocalDescription({ type: 'rollback', sdp: '' } as never)
            }
            await pc.setRemoteDescription(new RTCSessionDescription(payload.data as { type: string; sdp: string }))
            await drainIce(from)
            const answer = await pc.createAnswer()
            await pc.setLocalDescription(answer)
            send(from, { type: 'answer', data: { type: answer.type, sdp: answer.sdp } })
          } else if (payload.type === 'answer') {
            if (pc.signalingState === 'have-local-offer') {
              await pc.setRemoteDescription(new RTCSessionDescription(payload.data as { type: string; sdp: string }))
              await drainIce(from)
            }
          } else if (payload.type === 'ice' && payload.data) {
            if (pc.remoteDescription) await pc.addIceCandidate(new RTCIceCandidate(payload.data as never)).catch(() => undefined)
            else {
              const q = iceQueues.get(from) ?? []
              if (q.length < 200) q.push(payload.data)
              iceQueues.set(from, q)
            }
          }
        } catch (err) {
          logger.warn('voice', `signal ${payload.type}`, err)
        }
      }),
    ]
  }

  const broadcastState = () => {
    const { channelId, muted, deafened } = get()
    if (channelId) realtime.send({ type: 'VOICE_STATE', channel_id: channelId, muted, deafened, video: false, screen: false })
  }

  return {
    serverId: null,
    channelId: null,
    channelName: null,
    joined: false,
    joining: false,
    peers: [],
    muted: false,
    deafened: false,
    speaker: true,
    error: null,

    join: async (serverId, channelId, channelName, password) => {
      if (get().channelId === channelId && (get().joined || get().joining)) return
      if (get().channelId) get().leave()
      if (!realtime.isOpen) throw new Error('Connexion temps réel indisponible')
      const gen = ++joinGeneration
      set({ serverId, channelId, channelName, joining: true, joined: false, error: null, peers: [], muted: false, deafened: false })
      let stream: MediaStream
      try {
        const res = await getLocalMedia(false)
        stream = res.stream
      } catch (e) {
        if (gen === joinGeneration) {
          set({ joining: false, channelId: null, error: e instanceof Error ? e.message : 'Micro inaccessible' })
        }
        throw e
      }
      if (gen !== joinGeneration) {
        // leave() (ou un nouveau join()) a eu lieu pendant l'attente du micro : ne
        // pas ressusciter un flux audio ni réabonner les listeners du salon.
        stopStream(stream)
        return
      }
      localStream = stream
      audioSession.start(false)
      audioSession.setSpeaker(true)
      bindRoom(channelId)
      realtime.send({ type: 'VOICE_JOIN', channel_id: channelId, ...(password ? { password } : {}) })
      setTimeout(broadcastState, 300)
    },

    leave: () => {
      const { channelId } = get()
      if (!channelId) return
      joinGeneration++
      realtime.send({ type: 'VOICE_LEAVE', channel_id: channelId })
      offFns.forEach((f) => f())
      offFns = []
      for (const id of [...pcs.keys()]) {
        try {
          pcs.get(id)?.close()
        } catch {
          /* ignore */
        }
      }
      pcs.clear()
      iceQueues.clear()
      stopStream(localStream)
      localStream = null
      audioSession.stop()
      set({ serverId: null, channelId: null, channelName: null, joined: false, joining: false, peers: [] })
    },

    toggleMute: () => {
      const muted = !get().muted
      localStream?.getAudioTracks().forEach((t) => (t.enabled = !muted))
      set({ muted })
      broadcastState()
    },

    toggleDeafen: () => {
      const deafened = !get().deafened
      get().peers.forEach((p) => p.stream?.getAudioTracks().forEach((t) => (t.enabled = !deafened)))
      // Se rendre sourd coupe aussi le micro (comportement du client web).
      const muted = deafened ? true : get().muted
      localStream?.getAudioTracks().forEach((t) => (t.enabled = !muted))
      set({ deafened, muted })
      broadcastState()
    },

    toggleSpeaker: () => {
      const speaker = !get().speaker
      audioSession.setSpeaker(speaker)
      set({ speaker })
    },
  }
})

registerSignOutHook(() => useVoice.getState().leave())
