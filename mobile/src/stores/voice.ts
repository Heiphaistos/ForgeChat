import { create } from 'zustand'
import type { MediaStream } from '@livekit/react-native-webrtc'
import { DisconnectReason, Room, RoomEvent, Track, type Participant, type RemoteParticipant } from 'livekit-client'
import { voiceApi } from '@/api/voice'
import type { LiveKitAccess } from '@/config/livekitUrl'
import { logger } from '@/lib/logger'
import { realtime, type RealtimeEvent } from '@/lib/realtime'
import { callAudio, leaveRoom, liveKitAccess, stopScreenShare, streamOf } from '@/services/livekit'
import { ensureMediaPermissions } from '@/services/media'
import { getMyId, registerSignOutHook } from './auth'

/**
 * Salons vocaux de serveur — protocole du serveur ForgeChat ≥ 3.251 et du client web
 * (client/src/store/voice.ts + voiceSfu.ts) :
 *
 *  - présence par le WebSocket : VOICE_JOIN → VOICE_EXISTING_PEERS { peers, livekit, can_speak,
 *    server_muted }, puis VOICE_USER_JOINED / VOICE_USER_LEFT / VOICE_STATE_UPDATE ; notre état
 *    (muet, sourdine, partage d'écran) part dans VOICE_STATE ;
 *  - média par le SFU LiveKit (salle et jeton délivrés après les contrôles du serveur) ; identité
 *    LiveKit = id utilisateur ; micro, caméra et écran sont des pistes de sources distinctes.
 *
 * Mobile : micro + partage d'écran émis ; son, caméras et écrans des autres reçus.
 */

export interface VoicePeer {
  userId: string
  username: string
  avatar: string | null
  /** Caméra de ce pair (null si coupée ou pas encore reçue). */
  stream: MediaStream | null
  /** Écran partagé par ce pair. */
  screenStream: MediaStream | null
  muted: boolean
  video: boolean
  screen: boolean
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
  /** Notre partage d'écran est en cours. */
  screenSharing: boolean
  error: string | null
  join: (serverId: string, channelId: string, channelName: string, password?: string) => Promise<void>
  leave: () => void
  toggleMute: () => void
  toggleDeafen: () => void
  toggleSpeaker: () => void
  shareScreen: () => Promise<void>
  stopScreenShare: () => void
}

let room: Room | null = null
let roomName: string | null = null
/** Le serveur interdit la parole dans ce salon (can_speak=false ou muet imposé). */
let speakLocked = false
/** Incrémenté à chaque leave() : détecte une continuation async de join() périmée. */
let joinGeneration = 0

const isStr = (v: unknown): v is string => typeof v === 'string' && v.length > 0 && v.length < 100

export const useVoice = create<VoiceState>((set, get) => {
  const upsertPeer = (id: string, patch: Partial<VoicePeer>) =>
    set((s) => {
      const existing = s.peers.find((p) => p.userId === id)
      if (existing) return { peers: s.peers.map((p) => (p.userId === id ? { ...p, ...patch } : p)) }
      return {
        peers: [
          ...s.peers,
          { userId: id, username: patch.username ?? '…', avatar: patch.avatar ?? null, stream: null, screenStream: null, muted: false, video: false, screen: false, ...patch },
        ],
      }
    })

  /** Pistes LiveKit d'un pair → caméra et écran affichables ; son coupé si sourdine. */
  const rebuildPeer = (p: Participant) => {
    if (p === room?.localParticipant || !get().peers.some((x) => x.userId === p.identity)) return
    const cam = p.getTrackPublication(Track.Source.Camera)
    const scr = p.getTrackPublication(Track.Source.ScreenShare)
    applyDeafen(p as RemoteParticipant)
    upsertPeer(p.identity, {
      stream: cam?.isSubscribed && !cam.isMuted ? streamOf(cam.track) : null,
      screenStream: scr?.isSubscribed && !scr.isMuted ? streamOf(scr.track) : null,
    })
  }

  const applyDeafen = (p: RemoteParticipant) => {
    const deafened = get().deafened
    p.audioTrackPublications.forEach((pub) => {
      const mst = pub.track?.mediaStreamTrack
      if (mst) mst.enabled = !deafened
    })
  }

  const broadcastState = () => {
    const { channelId, muted, deafened, screenSharing } = get()
    if (channelId) realtime.send({ type: 'VOICE_STATE', channel_id: channelId, muted, deafened, video: false, screen: screenSharing, recording: false })
  }

  const disconnectMedia = () => {
    const r = room
    room = null
    roomName = null
    if (r) void leaveRoom(r)
  }

  const connectMedia = async (access: LiveKitAccess) => {
    if (room && roomName && roomName === access.room && room.state !== 'disconnected') return
    disconnectMedia()
    const gen = joinGeneration
    const r = new Room({ adaptiveStream: false, dynacast: true })
    room = r
    roomName = access.room
    r.on(RoomEvent.TrackSubscribed, (_t, _pub, p) => rebuildPeer(p))
      .on(RoomEvent.TrackUnsubscribed, (_t, _pub, p) => rebuildPeer(p))
      .on(RoomEvent.TrackMuted, (_pub, p) => rebuildPeer(p))
      .on(RoomEvent.TrackUnmuted, (_pub, p) => rebuildPeer(p))
      .on(RoomEvent.TrackUnpublished, (_pub, p) => rebuildPeer(p))
      .on(RoomEvent.ParticipantConnected, (p) => rebuildPeer(p))
      .on(RoomEvent.ParticipantDisconnected, (p) => upsertPeer(p.identity, { stream: null, screenStream: null }))
      .on(RoomEvent.LocalTrackUnpublished, (pub) => {
        // Partage arrêté depuis la notification système (ou par Android).
        if (pub.source === Track.Source.ScreenShare && get().screenSharing) {
          set({ screenSharing: false })
          broadcastState()
        }
      })
      .on(RoomEvent.Disconnected, (reason) => {
        if (room !== r) return
        if (reason !== DisconnectReason.CLIENT_INITIATED && get().joined) {
          set({ error: 'Connexion au serveur audio/vidéo perdue. Quitte et rejoins le salon.' })
        }
      })
    try {
      await callAudio.start(get().speaker)
      const turn = await voiceApi.turnServers()
      await r.connect(access.url, access.token, { autoSubscribe: true, ...(turn.length ? { rtcConfig: { iceServers: turn } } : {}) })
    } catch (err) {
      logger.warn('voice', 'connexion LiveKit', err)
      if (room === r) {
        room = null
        roomName = null
        set({ error: 'Impossible de joindre le serveur audio/vidéo. Vérifie ta connexion puis réessaie.' })
      }
      return
    }
    if (gen !== joinGeneration || room !== r) {
      void r.disconnect().catch(() => undefined)
      return
    }
    r.remoteParticipants.forEach((p) => rebuildPeer(p))
    try {
      if (!speakLocked) await r.localParticipant.setMicrophoneEnabled(!get().muted)
    } catch (err) {
      logger.warn('voice', 'publication micro', err)
      set({ error: 'Ton micro n’a pas pu être diffusé. Vérifie les permissions du salon.' })
    }
  }

  let offFns: (() => void)[] = []

  const bindRoom = (channelId: string) => {
    offFns.forEach((f) => f())
    offFns = [
      realtime.on('VOICE_EXISTING_PEERS', (e: RealtimeEvent) => {
        if (e.channel_id !== channelId) return
        const me = getMyId()
        const peers = Array.isArray(e.peers) ? (e.peers as Record<string, unknown>[]) : []
        // Réponse à un re-VOICE_JOIN (reconnexion WS) : retirer ceux partis entre-temps.
        const present = new Set(peers.map((p) => String(p.user_id)))
        set((s) => ({ joined: true, joining: false, peers: s.peers.filter((p) => present.has(p.userId)) }))
        for (const raw of peers) {
          if (!isStr(raw.user_id) || raw.user_id === me) continue
          upsertPeer(raw.user_id, {
            username: isStr(raw.username) ? raw.username : '…',
            avatar: isStr(raw.avatar) ? raw.avatar : null,
            muted: raw.muted === true,
            video: raw.video === true,
            screen: raw.screen === true,
          })
        }
        // Parole interdite (permission) ou muet imposé par un modérateur.
        speakLocked = e.can_speak === false || e.server_muted === true
        if (speakLocked) set({ muted: true })
        const res = liveKitAccess(e.livekit)
        if ('error' in res) {
          set({ error: res.error })
          return
        }
        void connectMedia(res.access)
      }),
      realtime.on('VOICE_USER_JOINED', (e) => {
        if (e.channel_id !== channelId || !isStr(e.user_id) || e.user_id === getMyId()) return
        upsertPeer(e.user_id, {
          username: isStr(e.username) ? e.username : '…',
          avatar: isStr(e.avatar) ? e.avatar : null,
          video: e.video === true,
          screen: e.screen === true,
        })
        const rp = room?.remoteParticipants.get(e.user_id)
        if (rp) rebuildPeer(rp)
      }),
      realtime.on('VOICE_USER_LEFT', (e) => {
        if (e.channel_id === channelId && isStr(e.user_id)) set((s) => ({ peers: s.peers.filter((p) => p.userId !== e.user_id) }))
      }),
      realtime.on('VOICE_STATE_UPDATE', (e) => {
        if (e.channel_id !== channelId || !isStr(e.user_id) || !get().peers.some((p) => p.userId === e.user_id)) return
        const screen = e.screen === true
        upsertPeer(e.user_id, { muted: e.muted === true, video: e.video === true, screen, ...(screen ? {} : { screenStream: null }) })
      }),
      realtime.on('VOICE_REDIRECT', (e) => {
        // Salon « auto-création » : le serveur nous place dans un salon temporaire.
        if ((e.from_channel_id === undefined || e.from_channel_id === channelId) && isStr(e.channel_id)) {
          const next = e.channel_id
          set({ channelId: next })
          bindRoom(next)
        }
      }),
      realtime.on('VOICE_JOIN_ERROR', (e) => {
        if (e.channel_id !== undefined && e.channel_id !== channelId) return
        const reason =
          e.reason === 'wrong_password'
            ? 'Mot de passe vocal incorrect'
            : e.reason === 'channel_full' || e.reason === 'full'
              ? 'Salon plein'
              : e.reason === 'missing_permission'
                ? 'Tu n’as pas la permission de rejoindre ce salon vocal'
                : e.reason === 'rate_limited'
                  ? 'Trop de tentatives : patiente quelques secondes'
                  : 'Impossible de rejoindre'
        get().leave()
        set({ error: reason })
      }),
      // Le serveur refuse un partage (permission STREAM) ou la parole (SPEAK_VOICE).
      realtime.on('VOICE_STATE_ERROR', (e) => {
        if (e.channel_id !== channelId) return
        if (e.permission === 'STREAM') {
          get().stopScreenShare()
          set({ error: 'Tu n’as pas la permission de partager ton écran sur ce serveur.' })
        } else if (e.permission === 'SPEAK_VOICE') {
          speakLocked = true
          set({ muted: true, error: 'Tu n’as pas la permission de parler dans ce salon : micro coupé.' })
          void room?.localParticipant.setMicrophoneEnabled(false).catch(() => undefined)
        }
      }),
    ]
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
    screenSharing: false,
    error: null,

    join: async (serverId, channelId, channelName, password) => {
      if (get().channelId === channelId && (get().joined || get().joining)) return
      if (get().channelId) get().leave()
      if (!realtime.isOpen) throw new Error('Connexion temps réel indisponible')
      const gen = ++joinGeneration
      speakLocked = false
      set({ serverId, channelId, channelName, joining: true, joined: false, error: null, peers: [], muted: false, deafened: false, speaker: true })
      if (!(await ensureMediaPermissions(false))) {
        if (gen === joinGeneration) set({ joining: false, channelId: null, error: 'Permission micro refusée' })
        throw new Error('Permission micro refusée')
      }
      if (gen !== joinGeneration) return // leave() ou autre join() pendant la demande de permission
      bindRoom(channelId)
      realtime.send({ type: 'VOICE_JOIN', channel_id: channelId, listen_only: false, ...(password ? { password } : {}) })
      setTimeout(broadcastState, 300)
    },

    leave: () => {
      const { channelId } = get()
      if (!channelId) return
      joinGeneration++
      realtime.send({ type: 'VOICE_LEAVE', channel_id: channelId })
      offFns.forEach((f) => f())
      offFns = []
      disconnectMedia()
      void callAudio.stop()
      set({ serverId: null, channelId: null, channelName: null, joined: false, joining: false, peers: [], screenSharing: false })
    },

    toggleMute: () => {
      if (speakLocked && get().muted) return // parole interdite par le serveur
      const muted = !get().muted
      set({ muted })
      void room?.localParticipant.setMicrophoneEnabled(!muted).catch((e: unknown) => logger.warn('voice', 'micro', e))
      broadcastState()
    },

    toggleDeafen: () => {
      const deafened = !get().deafened
      // Se rendre sourd coupe aussi le micro (comportement du client web).
      const muted = deafened ? true : speakLocked ? true : get().muted
      set({ deafened, muted })
      room?.remoteParticipants.forEach((p) => applyDeafen(p))
      void room?.localParticipant.setMicrophoneEnabled(!muted).catch(() => undefined)
      broadcastState()
    },

    toggleSpeaker: () => {
      const speaker = !get().speaker
      set({ speaker })
      void callAudio.setSpeaker(speaker)
    },

    shareScreen: async () => {
      const r = room
      if (!get().joined || get().screenSharing || !r) return
      await r.localParticipant.setScreenShareEnabled(true)
      if (room !== r || !get().joined) {
        void r.localParticipant.setScreenShareEnabled(false).catch(() => undefined) // salon quitté pendant le dialogue
        return
      }
      set({ screenSharing: true })
      broadcastState()
    },

    stopScreenShare: () => {
      if (!get().screenSharing) return
      set({ screenSharing: false })
      if (room) void stopScreenShare(room)
      broadcastState()
    },
  }
})

registerSignOutHook(() => useVoice.getState().leave())
