import { create } from 'zustand'
import type { MediaStream } from '@livekit/react-native-webrtc'
import { DisconnectReason, Room, RoomEvent, Track, VideoQuality, type Participant, type RemoteParticipant } from 'livekit-client'
import { voiceApi } from '@/api/voice'
import type { LiveKitAccess } from '@/config/livekitUrl'
import { logger } from '@/lib/logger'
import { realtime, type RealtimeEvent } from '@/lib/realtime'
import { callAudio, leaveRoom, liveKitAccess, stopScreenShare, streamOf, CAMERA_RESOLUTION } from '@/services/livekit'
import { ensureMediaPermissions } from '@/services/media'
import { playSoundFile } from '@/services/soundboard'
import { t } from '@/i18n'
import { getMyId, registerSignOutHook } from './auth'
import { E2EE_CLAIM, enableMediaE2EE, mediaE2EEError, openMediaE2EE, watchOutdated, type MediaE2EE } from '@/e2e/media'

/**
 * Salons vocaux de serveur — protocole du serveur ForgeChat ≥ 3.251 et du client web
 * (client/src/store/voice.ts + voiceSfu.ts + voiceModeration.ts) :
 *
 *  - présence par le WebSocket : VOICE_JOIN → VOICE_EXISTING_PEERS { peers, livekit, can_speak,
 *    server_muted, server_deafened, hand_raises }, puis VOICE_USER_JOINED / VOICE_USER_LEFT /
 *    VOICE_STATE_UPDATE ; notre état (muet, sourdine, caméra, écran) part dans VOICE_STATE ;
 *  - salon « auto-création » : le serveur nous place dans un salon temporaire et envoie
 *    VOICE_REDIRECT, avant ou après VOICE_EXISTING_PEERS selon sa version ;
 *  - le serveur nous sort du vocal quand le WebSocket tombe : VOICE_JOIN est rejoué à la
 *    réouverture (le média LiveKit, lui, survit le plus souvent) ;
 *  - modération : VOICE_SERVER_STATE (muet / sourdine imposés), VOICE_MOVE, VOICE_FORCE_DISCONNECT ;
 *  - média par le SFU LiveKit (identité = id utilisateur) ; micro, caméra et écran sont des pistes
 *    de sources distinctes ;
 *  - soundboard : SOUNDBOARD_PLAY { sound_id, channel_id } → diffusé au salon avec file_url et user_id ;
 *  - scène (salon `stage`, server/src/handlers/websocket.rs + client/src/components/voice/StageChannel.tsx) :
 *    STAGE_JOIN → STAGE_STATE { speakers, hand_raises } ; STAGE_HAND_RAISE / STAGE_REQUEST_SPEAK,
 *    STAGE_INVITE_SPEAK { target_user_id } (modérateur), STAGE_LEAVE_SPEAKER { target_user_id? } ;
 *    le serveur diffuse STAGE_SPEAKER_ADD / STAGE_SPEAKER_REMOVE / STAGE_HAND_RAISE. L'audience écoute
 *    seulement (listen_only) ; un orateur rejoint le salon avec micro.
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
  /** Ce pair enregistre la conversation. */
  recording: boolean
  handRaised: boolean
}

export interface StageUser {
  userId: string
  username: string
  avatar: string | null
}

/** Salon Scène : orateurs et mains levées tenus par le serveur (en mémoire). */
export interface StageState {
  channelId: string
  speakers: StageUser[]
  hands: StageUser[]
  /** Demande de parole envoyée, en attente d'un modérateur. */
  requested: boolean
}

export type MediaStatus = 'idle' | 'connecting' | 'connected' | 'reconnecting' | 'failed'

interface VoiceState {
  serverId: string | null
  channelId: string | null
  /** Salon choisi par l'utilisateur ; channelId peut devenir un salon temporaire (auto-création). */
  entryChannelId: string | null
  channelName: string | null
  joined: boolean
  joining: boolean
  peers: VoicePeer[]
  muted: boolean
  deafened: boolean
  speaker: boolean
  /** Écoute seule : ni micro ni caméra (jeton LiveKit sans publication). */
  listenOnly: boolean
  /** Parole interdite par le serveur (permission, muet ou sourdine imposés). */
  speakLocked: boolean
  /** Notre caméra est diffusée. */
  video: boolean
  localVideo: MediaStream | null
  facing: 'user' | 'environment'
  /** Notre partage d'écran est en cours. */
  screenSharing: boolean
  handRaised: boolean
  /** Identités LiveKit (ids utilisateur) qui parlent, nous compris. */
  speaking: string[]
  /** Dernière réaction de chaque participant (effacée après quelques secondes). */
  reactions: Record<string, string>
  /** Volume de lecture choisi par participant (1 = normal). */
  volumes: Record<string, number>
  mediaStatus: MediaStatus
  /** Médias du salon chiffrés de bout en bout (§5) ; participants dont l'appli ne chiffre pas. */
  e2ee: boolean
  e2eeOutdated: string[]
  /** Qualité de notre connexion au SFU (excellent, good, poor, lost). */
  quality: string | null
  error: string | null
  /** Information non bloquante (enregistrement, modération…). */
  notice: string | null
  /** Salon Scène en cours (null pour un salon vocal ordinaire). */
  stage: StageState | null
  join: (serverId: string, channelId: string, channelName: string, password?: string, listenOnly?: boolean) => Promise<void>
  leave: () => void
  toggleMute: () => void
  toggleDeafen: () => void
  toggleSpeaker: () => void
  toggleCamera: () => Promise<void>
  switchCamera: () => void
  shareScreen: () => Promise<void>
  stopScreenShare: () => void
  setPeerVolume: (userId: string, volume: number) => void
  toggleHand: () => void
  react: (emoji: string) => void
  dismiss: () => void
  /** Joue un son pour tout le salon (et pour soi, sauf en sourdine). */
  playSound: (soundId: string, fileUrl: string) => void
  /** Rejoint une scène en auditeur. */
  joinStage: (serverId: string, channelId: string, channelName: string, password?: string) => Promise<void>
  stageRequestSpeak: () => void
  stageToggleHand: () => void
  /** Modérateur : donner la parole (soi-même compris). */
  stageInvite: (userId: string) => void
  /** Redescendre de la scène, ou (modérateur) retirer la parole à `userId`. */
  stageRemoveSpeaker: (userId?: string) => void
}

let room: Room | null = null
let roomName: string | null = null
/** Droits donnés par le serveur : parole (can_speak), muet et sourdine imposés par un modérateur. */
let canSpeak = true
let serverMuted = false
let serverDeafened = false
/** Incrémenté à chaque leave() : détecte une continuation async de join() périmée. */
let joinGeneration = 0
/** Mot de passe du salon, rejoué avec VOICE_JOIN après une reconnexion du WebSocket. */
let joinPassword: string | undefined
/** Micro coupé avant la sourdine : rétabli quand on la retire. */
let mutedBeforeDeafen = false
/** VOICE_JOIN rejoué sans réponse (salon temporaire supprimé entre-temps…) : on abandonne. */
let rejoinTimer: ReturnType<typeof setTimeout> | null = null
/** Salons quittés : un VOICE_EXISTING_PEERS tardif pour l'un d'eux n'est pas un salon temporaire. */
const leftChannels = new Set<string>()
const reactionTimers = new Map<string, ReturnType<typeof setTimeout>>()

const isStr = (v: unknown): v is string => typeof v === 'string' && v.length > 0 && v.length < 100
const stageUser = (raw: unknown): StageUser | null => {
  const r = raw as Record<string, unknown> | null
  if (!r || !isStr(r.user_id)) return null
  return { userId: r.user_id, username: isStr(r.username) ? r.username : '…', avatar: isStr(r.avatar) ? r.avatar : null }
}
const stageUsers = (list: unknown): StageUser[] => (Array.isArray(list) ? list.map(stageUser).filter((u): u is StageUser => !!u) : [])
const CAMERA_OPTIONS = { resolution: CAMERA_RESOLUTION }
const REJOIN_TIMEOUT_MS = 15_000

export const useVoice = create<VoiceState>((set, get) => {
  const speakAllowed = () => canSpeak && !serverMuted && !serverDeafened && !get().listenOnly
  const setLocked = () => set({ speakLocked: !canSpeak || serverMuted || serverDeafened })

  const clearRejoinTimer = () => {
    if (rejoinTimer) clearTimeout(rejoinTimer)
    rejoinTimer = null
  }

  const upsertPeer = (id: string, patch: Partial<VoicePeer>) =>
    set((s) => {
      const existing = s.peers.find((p) => p.userId === id)
      if (existing) return { peers: s.peers.map((p) => (p.userId === id ? { ...p, ...patch } : p)) }
      return {
        peers: [
          ...s.peers,
          {
            userId: id,
            username: '…',
            avatar: null,
            stream: null,
            screenStream: null,
            muted: false,
            video: false,
            screen: false,
            recording: false,
            handRaised: false,
            ...patch,
          },
        ],
      }
    })

  /** Modifie un pair connu, sans jamais en créer (évite les tuiles fantômes « … »). */
  const patchPeer = (id: string, patch: Partial<VoicePeer>) =>
    set((s) => (s.peers.some((p) => p.userId === id) ? { peers: s.peers.map((p) => (p.userId === id ? { ...p, ...patch } : p)) } : {}))

  const applyAudio = (p: RemoteParticipant) => {
    const { deafened, volumes } = get()
    const volume = volumes[p.identity]
    if (volume !== undefined) p.setVolume?.(volume)
    p.audioTrackPublications.forEach((pub) => {
      const mst = pub.track?.mediaStreamTrack
      if (mst) mst.enabled = !deafened
    })
  }
  const applyAudioAll = () => room?.remoteParticipants.forEach((p) => applyAudio(p))

  /** Pistes LiveKit d'un pair → caméra et écran affichables ; volume et sourdine appliqués. */
  const rebuildPeer = (p: Participant) => {
    if (p === room?.localParticipant || !get().peers.some((x) => x.userId === p.identity)) return
    const cam = p.getTrackPublication(Track.Source.Camera)
    const scr = p.getTrackPublication(Track.Source.ScreenShare)
    applyAudio(p as RemoteParticipant)
    patchPeer(p.identity, {
      stream: cam?.isSubscribed && !cam.isMuted ? streamOf(cam.track) : null,
      screenStream: scr?.isSubscribed && !scr.isMuted ? streamOf(scr.track) : null,
    })
  }

  const broadcastState = () => {
    const { channelId, joined, muted, deafened, video, screenSharing } = get()
    if (channelId && joined) realtime.send({ type: 'VOICE_STATE', channel_id: channelId, muted, deafened, video, screen: screenSharing, recording: false })
  }

  const setMic = (on: boolean) => void room?.localParticipant.setMicrophoneEnabled(on).catch((e: unknown) => logger.warn('voice', 'micro', e))

  const refreshLocalVideo = () => {
    const cam = room?.localParticipant.getTrackPublication(Track.Source.Camera)
    set({ localVideo: get().video && cam && !cam.isMuted ? streamOf(cam.track) : null })
  }

  const unpublishCamera = async (r: Room) => {
    const track = r.localParticipant.getTrackPublication(Track.Source.Camera)?.track
    if (track) await r.localParticipant.unpublishTrack(track, true).catch((e: unknown) => logger.warn('voice', 'retrait caméra', e))
  }

  const disconnectMedia = () => {
    const r = room
    room = null
    roomName = null
    if (r) void leaveRoom(r)
  }

  const fail = (message: string) => {
    get().leave()
    set({ error: message })
  }

  /** Rejoue VOICE_JOIN (reconnexion du WebSocket, SFU perdu) : le serveur renvoie l'état et un jeton. */
  const rejoin = () => {
    const { channelId, joined, joining, listenOnly, stage } = get()
    if (!channelId || !(joined || joining)) return
    realtime.send({ type: 'VOICE_JOIN', channel_id: channelId, listen_only: listenOnly, ...E2EE_CLAIM, ...(joinPassword ? { password: joinPassword } : {}) })
    // Le serveur retire un orateur dont le WebSocket tombe : relire l'état de la scène.
    if (stage) realtime.send({ type: 'STAGE_JOIN', channel_id: stage.channelId })
    clearRejoinTimer()
    rejoinTimer = setTimeout(() => {
      rejoinTimer = null
      if (get().channelId === channelId) fail(t('store.voice.lost'))
    }, REJOIN_TIMEOUT_MS)
  }

  const connectMedia = async (access: LiveKitAccess) => {
    if (room && roomName && roomName === access.room && room.state !== 'disconnected') return
    disconnectMedia()
    const gen = joinGeneration
    // Salon chiffré (clé du salon, conversation `channel`) : jamais de connexion en clair.
    const channelId = get().channelId
    let e2ee: MediaE2EE | null = null
    if (access.e2ee && channelId) {
      set({ mediaStatus: 'connecting' })
      try {
        e2ee = await openMediaE2EE('channel', channelId)
      } catch (err) {
        if (gen === joinGeneration) set({ mediaStatus: 'failed', error: t(mediaE2EEError(err)) })
        return
      }
      if (gen !== joinGeneration || room) {
        e2ee.stop()
        return
      }
    }
    set({ e2ee: !!e2ee, e2eeOutdated: [] })
    // Pas d'adaptiveStream : il suppose des éléments vidéo observés (VideoTrack) et mettrait en pause
    // les vidéos affichées par RTCView. ponytail: qualité fixée par piste ci-dessous ; passer à
    // VideoTrack + adaptiveStream si le débit en 4G pose encore problème.
    const r = new Room({ adaptiveStream: false, dynacast: true, ...(e2ee ? { encryption: e2ee.encryption } : {}) })
    room = r
    roomName = access.room
    set({ mediaStatus: 'connecting' })
    if (e2ee) {
      await enableMediaE2EE(r, e2ee)
      watchOutdated(r, (ids) => set({ e2eeOutdated: ids }))
    }
    r.on(RoomEvent.TrackSubscribed, (_t, pub, p) => {
      // Caméras en qualité moyenne (tuiles), écrans en pleine qualité (texte lisible).
      if (pub.source === Track.Source.Camera) pub.setVideoQuality?.(VideoQuality.MEDIUM)
      rebuildPeer(p)
    })
      .on(RoomEvent.TrackUnsubscribed, (_t, _pub, p) => rebuildPeer(p))
      .on(RoomEvent.TrackMuted, (_pub, p) => rebuildPeer(p))
      .on(RoomEvent.TrackUnmuted, (_pub, p) => rebuildPeer(p))
      .on(RoomEvent.TrackUnpublished, (_pub, p) => rebuildPeer(p))
      .on(RoomEvent.ParticipantConnected, (p) => rebuildPeer(p))
      .on(RoomEvent.ParticipantDisconnected, (p) => patchPeer(p.identity, { stream: null, screenStream: null }))
      .on(RoomEvent.ActiveSpeakersChanged, (speakers) => set({ speaking: speakers.map((p) => p.identity) }))
      .on(RoomEvent.Reconnecting, () => set({ mediaStatus: 'reconnecting' }))
      .on(RoomEvent.Reconnected, () => set({ mediaStatus: 'connected' }))
      .on(RoomEvent.ConnectionQualityChanged, (q, p) => {
        if (p === r.localParticipant) set({ quality: q })
      })
      .on(RoomEvent.LocalTrackPublished, () => refreshLocalVideo())
      .on(RoomEvent.LocalTrackUnpublished, (pub) => {
        // Partage arrêté depuis la notification système (ou par Android).
        if (pub.source === Track.Source.ScreenShare && get().screenSharing) {
          set({ screenSharing: false })
          broadcastState()
        }
        refreshLocalVideo()
      })
      .on(RoomEvent.Disconnected, (reason) => {
        if (room !== r || reason === DisconnectReason.CLIENT_INITIATED || !get().channelId) return
        if (reason === DisconnectReason.DUPLICATE_IDENTITY) return fail(t('store.voice.otherDevice'))
        // WebSocket ouvert : éjection voulue par le serveur (salon supprimé, exclusion…). Fermé : le
        // serveur nous a sortis parce que la connexion est tombée ; VOICE_JOIN sera rejoué.
        if ((reason === DisconnectReason.PARTICIPANT_REMOVED || reason === DisconnectReason.ROOM_DELETED) && realtime.isOpen) {
          return fail(t('store.voice.removed'))
        }
        set({ mediaStatus: 'reconnecting' })
        if (realtime.isOpen) rejoin()
      })
    try {
      await callAudio.start(get().speaker, t('store.voice.title', { name: get().channelName ?? t('store.voice.channel') }))
      const turn = await voiceApi.turnServers()
      await r.connect(access.url, access.token, { autoSubscribe: true, ...(turn.length ? { rtcConfig: { iceServers: turn } } : {}) })
    } catch (err) {
      logger.warn('voice', 'connexion LiveKit', err)
      if (room === r) {
        room = null
        roomName = null
        set({ mediaStatus: 'failed', error: t('store.voice.mediaUnreachable') })
      }
      return
    }
    if (gen !== joinGeneration || room !== r) {
      void r.disconnect().catch(() => undefined)
      return
    }
    set({ mediaStatus: 'connected' })
    r.remoteParticipants.forEach((p) => rebuildPeer(p))
    try {
      if (speakAllowed()) await r.localParticipant.setMicrophoneEnabled(!get().muted)
      if (get().video && speakAllowed()) {
        await r.localParticipant.setCameraEnabled(true, { facingMode: get().facing, ...CAMERA_OPTIONS })
        refreshLocalVideo()
      }
    } catch (err) {
      logger.warn('voice', 'publication micro/caméra', err)
      set({ error: t('store.voice.publishFailed') })
    }
  }

  /** Scène : passer d'auditeur à orateur (ou l'inverse) = rejoindre à nouveau avec ou sans micro, comme le web. */
  const switchStageMode = (listenOnly: boolean) => {
    const { stage, serverId, channelName } = get()
    if (!stage || !serverId) return
    const password = joinPassword
    set({ stage: null }) // leave() ne doit pas nous faire descendre de scène
    get().leave()
    get()
      .join(serverId, stage.channelId, channelName ?? 'Scène', password, listenOnly)
      .catch((e: unknown) => logger.warn('voice', 'scène', e))
    set({ stage })
  }
  /** Orateur ⇔ micro : aligne le mode d'écoute sur la liste des orateurs. */
  const syncStageMode = () => {
    const s = get()
    if (!s.stage || !s.channelId) return
    const speaker = s.stage.speakers.some((u) => u.userId === getMyId())
    if (speaker === s.listenOnly) switchStageMode(!speaker)
  }
  const stageHere = (cid: unknown) => {
    const st = get().stage
    return st && isStr(cid) && cid === st.channelId ? st : null
  }

  // ── Signalisation entrante (enregistrée une fois, filtrée sur le salon courant) ──
  const here = (cid: unknown) => isStr(cid) && cid === get().channelId

  realtime.onOpen(rejoin)

  realtime.on('VOICE_EXISTING_PEERS', (e: RealtimeEvent) => {
    const s = get()
    if (!s.channelId || !isStr(e.channel_id)) return
    if (e.channel_id !== s.channelId) {
      // Salon auto-création, VOICE_REDIRECT pas encore reçu : adopter le salon temporaire.
      if (!s.joining || leftChannels.has(e.channel_id)) return
      set({ channelId: e.channel_id })
    }
    clearRejoinTimer()
    const me = getMyId()
    const peers = Array.isArray(e.peers) ? (e.peers as Record<string, unknown>[]) : []
    // Réponse à un re-VOICE_JOIN (reconnexion WS) : retirer ceux partis entre-temps.
    const present = new Set(peers.map((p) => String(p.user_id)))
    const before = new Map(s.peers.map((p) => [p.userId, p]))
    set((st) => ({ joined: true, joining: false, error: null, peers: st.peers.filter((p) => present.has(p.userId)) }))
    const hands = new Set((Array.isArray(e.hand_raises) ? (e.hand_raises as Record<string, unknown>[]) : []).map((h) => String(h.user_id)))
    for (const raw of peers) {
      if (!isStr(raw.user_id) || raw.user_id === me) continue
      const recording = raw.recording === true
      upsertPeer(raw.user_id, {
        username: isStr(raw.username) ? raw.username : '…',
        avatar: isStr(raw.avatar) ? raw.avatar : null,
        muted: raw.muted === true || raw.server_muted === true,
        video: raw.video === true,
        screen: raw.screen === true,
        recording,
        handRaised: raw.hand_raised === true || hands.has(raw.user_id),
      })
      if (recording && !before.get(raw.user_id)?.recording) {
        set({ notice: t('store.voice.recording', { name: isStr(raw.username) ? raw.username : t('store.voice.aMember') }) })
      }
    }
    set({ handRaised: !!me && hands.has(me) })
    // Parole interdite (permission) ou muet / sourdine imposés par un modérateur.
    canSpeak = e.can_speak !== false
    serverMuted = e.server_muted === true
    serverDeafened = e.server_deafened === true
    setLocked()
    if (!speakAllowed()) set({ muted: true })
    if (serverDeafened && !get().deafened) {
      set({ deafened: true })
      applyAudioAll()
    }
    broadcastState()
    const res = liveKitAccess(e.livekit)
    if ('error' in res) {
      set({ error: res.error, mediaStatus: 'failed' })
      return
    }
    void connectMedia(res.access)
  })

  realtime.on('VOICE_REDIRECT', (e) => {
    // Salon « auto-création » : le serveur nous place dans un salon temporaire.
    const s = get()
    if (!s.channelId || !isStr(e.channel_id)) return
    if (e.from_channel_id !== undefined && e.from_channel_id !== s.entryChannelId && e.from_channel_id !== s.channelId) return
    set({ channelId: e.channel_id })
  })

  realtime.on('VOICE_USER_JOINED', (e) => {
    if (!here(e.channel_id) || !isStr(e.user_id) || e.user_id === getMyId()) return
    upsertPeer(e.user_id, {
      username: isStr(e.username) ? e.username : '…',
      avatar: isStr(e.avatar) ? e.avatar : null,
      muted: e.server_muted === true,
      video: e.video === true,
      screen: e.screen === true,
    })
    const rp = room?.remoteParticipants.get(e.user_id)
    if (rp) rebuildPeer(rp)
  })

  realtime.on('VOICE_USER_LEFT', (e) => {
    if (here(e.channel_id) && isStr(e.user_id)) set((s) => ({ peers: s.peers.filter((p) => p.userId !== e.user_id) }))
  })

  realtime.on('VOICE_STATE_UPDATE', (e) => {
    if (!here(e.channel_id) || !isStr(e.user_id)) return
    const before = get().peers.find((p) => p.userId === e.user_id)
    if (!before) return
    const screen = e.screen === true
    const recording = e.recording === true
    patchPeer(e.user_id, { muted: e.muted === true, video: e.video === true, screen, recording, ...(screen ? {} : { screenStream: null }) })
    if (recording && !before.recording) set({ notice: t('store.voice.recordingStarted', { name: before.username }) })
  })

  realtime.on('VOICE_JOIN_ERROR', (e) => {
    const s = get()
    if (!s.channelId || (e.channel_id !== undefined && e.channel_id !== s.channelId && e.channel_id !== s.entryChannelId)) return
    fail(
      e.reason === 'wrong_password'
        ? t('store.voice.wrongPassword')
        : e.reason === 'channel_full' || e.reason === 'full'
          ? typeof e.limit === 'number' && typeof e.current === 'number' ? t('store.voice.fullCount', { current: e.current, limit: e.limit }) : t('store.voice.full')
          : e.reason === 'missing_permission'
            ? t('store.voice.noPermission')
            : e.reason === 'rate_limited'
              ? t('store.voice.rateLimited')
              : e.reason === 'media_unavailable'
                ? t('store.voice.mediaUnavailable')
                : t('voice.joinFailed'),
    )
  })

  // Le serveur refuse un partage (permission STREAM) ou la parole (SPEAK_VOICE).
  realtime.on('VOICE_STATE_ERROR', (e) => {
    if (!here(e.channel_id)) return
    if (e.permission === 'STREAM') {
      get().stopScreenShare()
      set({ error: t('store.voice.noStream') })
    } else if (e.permission === 'SPEAK_VOICE') {
      canSpeak = false
      setLocked()
      set({ muted: true, error: t('store.voice.noSpeak') })
      setMic(false)
    }
  })

  // ── Modération (server/src/handlers/voice_moderation.rs) ──
  realtime.on('VOICE_SERVER_STATE', (e) => {
    if (!isStr(e.user_id)) return
    const muted = e.server_muted === true
    const deafened = e.server_deafened === true
    if (e.user_id !== getMyId()) {
      if (here(e.channel_id) && (muted || deafened)) patchPeer(e.user_id, { muted: true })
      return
    }
    if (!get().channelId || (e.channel_id != null && !here(e.channel_id))) return
    serverMuted = muted
    serverDeafened = deafened
    setLocked()
    if (!speakAllowed()) {
      set({ muted: true })
      setMic(false)
    }
    if (deafened && !get().deafened) {
      set({ deafened: true })
      applyAudioAll()
    }
    set({
      notice: t(deafened ? 'store.voice.serverDeafened' : muted ? 'store.voice.serverMuted' : 'store.voice.unmutedByMod'),
    })
    broadcastState()
  })

  realtime.on('VOICE_MOVE', (e) => {
    const s = get()
    if (!s.channelId || !isStr(e.channel_id) || !isStr(e.server_id)) return
    const name = isStr(e.channel_name) ? e.channel_name : t('voice.fallback')
    const listenOnly = s.listenOnly
    s.leave()
    get()
      .join(e.server_id, e.channel_id, name, undefined, listenOnly)
      .then(() => set({ notice: t('store.voice.moved', { name }) }))
      .catch((err: unknown) => logger.warn('voice', 'déplacement', err))
  })

  realtime.on('VOICE_FORCE_DISCONNECT', (e) => {
    if (!get().channelId || (e.channel_id != null && !here(e.channel_id))) return
    fail(t('store.voice.kicked'))
  })

  realtime.on('HAND_RAISE', (e) => {
    if (!here(e.channel_id) || !isStr(e.user_id)) return
    const raised = e.raised === true
    if (e.user_id === getMyId()) set({ handRaised: raised })
    else patchPeer(e.user_id, { handRaised: raised })
  })

  realtime.on('VOICE_REACTION', (e) => {
    if (!here(e.channel_id) || !isStr(e.user_id) || typeof e.emoji !== 'string' || !e.emoji || e.emoji.length > 16) return
    const userId = e.user_id
    const emoji = e.emoji
    set((s) => ({ reactions: { ...s.reactions, [userId]: emoji } }))
    const prev = reactionTimers.get(userId)
    if (prev) clearTimeout(prev)
    reactionTimers.set(
      userId,
      setTimeout(() => {
        reactionTimers.delete(userId)
        set((s) => {
          const reactions = { ...s.reactions }
          delete reactions[userId]
          return { reactions }
        })
      }, 4000),
    )
  })

  // Son joué par un autre membre du salon (le nôtre est déjà joué localement).
  realtime.on('SOUNDBOARD_PLAY', (e) => {
    const s = get()
    if (!here(e.channel_id) || !s.joined || s.deafened || e.user_id === getMyId()) return
    playSoundFile(e.file_url)
  })

  // ── Scène ──
  realtime.on('STAGE_STATE', (e) => {
    const st = stageHere(e.channel_id)
    if (!st) return
    set({ stage: { ...st, speakers: stageUsers(e.speakers), hands: stageUsers(e.hand_raises) } })
    syncStageMode()
  })

  realtime.on('STAGE_SPEAKER_ADD', (e) => {
    const st = stageHere(e.channel_id)
    const u = stageUser(e)
    if (!st || !u) return
    const mine = u.userId === getMyId()
    set({
      stage: {
        ...st,
        speakers: st.speakers.some((x) => x.userId === u.userId) ? st.speakers : [...st.speakers, u],
        hands: st.hands.filter((x) => x.userId !== u.userId),
        requested: mine ? false : st.requested,
      },
    })
    if (mine) syncStageMode()
  })

  realtime.on('STAGE_SPEAKER_REMOVE', (e) => {
    const st = stageHere(e.channel_id)
    if (!st || !isStr(e.user_id)) return
    set({ stage: { ...st, speakers: st.speakers.filter((x) => x.userId !== e.user_id) } })
    if (e.user_id === getMyId()) syncStageMode()
  })

  realtime.on('STAGE_HAND_RAISE', (e) => {
    const st = stageHere(e.channel_id)
    const u = stageUser(e)
    if (!st || !u) return
    const raised = e.raised === true
    const mine = u.userId === getMyId()
    const hands = st.hands.filter((x) => x.userId !== u.userId)
    set({
      stage: { ...st, hands: raised ? [...hands, u] : hands, requested: mine && !raised ? false : st.requested },
      ...(raised && !mine ? { notice: t('store.voice.handRaised', { name: u.username }) } : {}),
    })
  })

  return {
    serverId: null,
    channelId: null,
    entryChannelId: null,
    channelName: null,
    joined: false,
    joining: false,
    peers: [],
    muted: false,
    deafened: false,
    speaker: true,
    listenOnly: false,
    speakLocked: false,
    video: false,
    localVideo: null,
    facing: 'user',
    screenSharing: false,
    handRaised: false,
    speaking: [],
    reactions: {},
    volumes: {},
    mediaStatus: 'idle',
    quality: null,
    e2ee: false,
    e2eeOutdated: [],
    error: null,
    notice: null,
    stage: null,

    join: async (serverId, channelId, channelName, password, listenOnly = false) => {
      const cur = get()
      if ((cur.channelId === channelId || cur.entryChannelId === channelId) && (cur.joined || cur.joining) && cur.listenOnly === listenOnly) return
      if (cur.channelId) cur.leave()
      if (!realtime.isOpen) throw new Error(t('store.realtimeDown'))
      const gen = ++joinGeneration
      canSpeak = true
      serverMuted = false
      serverDeafened = false
      joinPassword = password
      leftChannels.delete(channelId)
      set({
        serverId,
        channelId,
        entryChannelId: channelId,
        channelName,
        joining: true,
        joined: false,
        error: null,
        notice: null,
        peers: [],
        muted: listenOnly,
        deafened: false,
        speaker: true,
        listenOnly,
        speakLocked: false,
        video: false,
        localVideo: null,
        handRaised: false,
        speaking: [],
        reactions: {},
        mediaStatus: 'idle',
        quality: null,
        e2ee: false,
        e2eeOutdated: [],
      })
      if (!listenOnly && !(await ensureMediaPermissions(false))) {
        if (gen === joinGeneration) set({ joining: false, channelId: null, entryChannelId: null, error: t('store.micDenied') })
        throw new Error(t('store.micDenied'))
      }
      if (gen !== joinGeneration) return // leave() ou autre join() pendant la demande de permission
      realtime.send({ type: 'VOICE_JOIN', channel_id: channelId, listen_only: listenOnly, ...E2EE_CLAIM, ...(password ? { password } : {}) })
    },

    leave: () => {
      const { channelId, entryChannelId, stage } = get()
      if (stage) {
        // Quitter la scène pour de bon : le serveur ne retire un orateur qu'à la déconnexion du WebSocket.
        if (stage.speakers.some((u) => u.userId === getMyId())) realtime.send({ type: 'STAGE_LEAVE_SPEAKER', channel_id: stage.channelId })
        set({ stage: null })
      }
      if (!channelId) return
      joinGeneration++
      clearRejoinTimer()
      realtime.send({ type: 'VOICE_LEAVE', channel_id: channelId })
      leftChannels.add(channelId)
      if (entryChannelId) leftChannels.add(entryChannelId)
      disconnectMedia()
      void callAudio.stop()
      reactionTimers.forEach((t) => clearTimeout(t))
      reactionTimers.clear()
      set({
        serverId: null,
        channelId: null,
        entryChannelId: null,
        channelName: null,
        joined: false,
        joining: false,
        peers: [],
        screenSharing: false,
        video: false,
        localVideo: null,
        handRaised: false,
        speaking: [],
        reactions: {},
        speakLocked: false,
        mediaStatus: 'idle',
        quality: null,
        e2ee: false,
        e2eeOutdated: [],
        notice: null,
      })
    },

    toggleMute: () => {
      const s = get()
      if (s.muted && !speakAllowed()) {
        // Parole interdite par le serveur ou écoute seule : le dire au lieu de ne rien faire.
        set({
          notice: t(s.stage ? 'store.voice.audience' : s.listenOnly ? 'store.voice.listenOnlySpeak' : 'store.voice.cantSpeak'),
        })
        return
      }
      const muted = !s.muted
      // Réactiver le micro retire aussi la sourdine (comme le web).
      set({ muted, ...(s.deafened && !muted ? { deafened: false } : {}) })
      if (s.deafened && !muted) applyAudioAll()
      setMic(!muted)
      broadcastState()
    },

    toggleDeafen: () => {
      const s = get()
      if (s.deafened && serverDeafened) {
        set({ notice: t('store.voice.deafLocked') })
        return
      }
      const deafened = !s.deafened
      // Se rendre sourd coupe aussi le micro ; on retrouve l'état d'avant en la retirant.
      if (deafened) mutedBeforeDeafen = s.muted
      const muted = deafened || !speakAllowed() ? true : mutedBeforeDeafen
      set({ deafened, muted })
      applyAudioAll()
      if (speakAllowed()) setMic(!muted)
      broadcastState()
    },

    toggleSpeaker: () => {
      const speaker = !get().speaker
      set({ speaker })
      void callAudio.setSpeaker(speaker)
    },

    toggleCamera: async () => {
      const r = room
      const s = get()
      if (!s.joined || !r) return
      if (s.video) {
        set({ video: false, localVideo: null })
        await unpublishCamera(r)
        broadcastState()
        return
      }
      if (!speakAllowed()) {
        set({ notice: t(s.listenOnly ? 'store.voice.listenOnlyCamera' : 'store.voice.cantStream') })
        return
      }
      if (!(await ensureMediaPermissions(true))) {
        set({ error: t('store.cameraDenied') })
        return
      }
      try {
        await r.localParticipant.setCameraEnabled(true, { facingMode: get().facing, ...CAMERA_OPTIONS })
      } catch (e) {
        logger.warn('voice', 'caméra', e)
        set({ error: t('store.cameraUnavailable') })
        return
      }
      if (room !== r) return
      set({ video: true })
      refreshLocalVideo()
      broadcastState()
    },

    switchCamera: () => {
      const track = room?.localParticipant.getTrackPublication(Track.Source.Camera)?.track?.mediaStreamTrack as { _switchCamera?: () => void } | undefined
      if (!track?._switchCamera) return
      track._switchCamera()
      set((s) => ({ facing: s.facing === 'user' ? 'environment' : 'user' }))
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

    setPeerVolume: (userId, volume) => {
      set((s) => ({ volumes: { ...s.volumes, [userId]: volume } }))
      const p = room?.remoteParticipants.get(userId)
      if (p) applyAudio(p)
    },

    toggleHand: () => {
      const { channelId, joined, handRaised } = get()
      if (!channelId || !joined) return
      set({ handRaised: !handRaised }) // optimiste ; le HAND_RAISE du serveur confirme
      realtime.send({ type: 'HAND_RAISE', channel_id: channelId, raised: !handRaised })
    },

    react: (emoji) => {
      const { channelId, joined } = get()
      if (channelId && joined) realtime.send({ type: 'VOICE_REACTION', channel_id: channelId, emoji })
    },

    dismiss: () => set({ error: null, notice: null }),

    playSound: (soundId, fileUrl) => {
      const { channelId, joined, deafened } = get()
      if (!channelId || !joined) return
      realtime.send({ type: 'SOUNDBOARD_PLAY', sound_id: soundId, channel_id: channelId })
      if (!deafened) playSoundFile(fileUrl)
    },

    joinStage: async (serverId, channelId, channelName, password) => {
      const joining = get().join(serverId, channelId, channelName, password, true)
      set({ stage: { channelId, speakers: [], hands: [], requested: false } })
      realtime.send({ type: 'STAGE_JOIN', channel_id: channelId })
      await joining
    },

    stageRequestSpeak: () => {
      const st = get().stage
      if (!st || st.requested) return
      set({ stage: { ...st, requested: true }, notice: t('store.voice.requestSent') })
      realtime.send({ type: 'STAGE_REQUEST_SPEAK', channel_id: st.channelId })
    },

    stageToggleHand: () => {
      const st = get().stage
      if (!st) return
      const raised = !st.hands.some((u) => u.userId === getMyId())
      realtime.send({ type: 'STAGE_HAND_RAISE', channel_id: st.channelId, raised })
    },

    stageInvite: (userId) => {
      const st = get().stage
      if (st) realtime.send({ type: 'STAGE_INVITE_SPEAK', channel_id: st.channelId, target_user_id: userId })
    },

    stageRemoveSpeaker: (userId) => {
      const st = get().stage
      if (st) realtime.send({ type: 'STAGE_LEAVE_SPEAKER', channel_id: st.channelId, ...(userId ? { target_user_id: userId } : {}) })
    },
  }
})

registerSignOutHook(() => useVoice.getState().leave())
