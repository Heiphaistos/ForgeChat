import { create } from 'zustand'
import { useWs } from './ws'
import { useAuth } from './auth'
import api from '../api/client'
import toast from 'react-hot-toast'
import { webrtcMissing, openInBrowser, NO_WEBRTC_MESSAGE } from '../lib/webrtcSupport'
import { isNativeVoice, nativeSetDeafen, nativeSetPeerAudio, nativeSetCamera, nativeSetScreen } from '../lib/nativeVoice'
import {
  createProcessedAudioTrack, getNoiseEngine, setNoiseEngine as persistNoiseEngine,
  type NoiseEngine, type ProcessedAudio,
} from '../lib/audio'
import {
  addPeer, removePeer, connectMedia, disconnectMedia, watchStream as sfuWatchStream, getAutoWatch, setAutoWatch as sfuSetAutoWatch,
  setLocalStream, replaceMicTrack, applyMicEnabled, addCameraTrack, removeCameraTrack,
  startScreenTracks, stopScreenTracks, clearLocalMedia, getLocalStream, getRawMicTrack,
  getMicTrack, refreshAllSenderQuality, setWhisper, warn,
  type MeshCtx, type MediaStatus,
} from './voiceSfu'
import type { ConnectionQuality } from 'livekit-client'

export { getRoom } from './voiceSfu'
export type { MediaStatus }

// Idem : le store est atteignable depuis la console pour diagnostiquer un appel
// (window.__fcVoiceStore.getState()).
declare global { interface Window { __fcVoiceStore?: unknown } }

export interface VoicePeer {
  userId: string
  username: string
  avatar?: string
  discriminator?: string
  stream: MediaStream | null       // audio micro + vidéo caméra
  screenStream: MediaStream | null // écran partagé (vidéo + son du partage) — msid distinct
  muted: boolean
  deafened: boolean
  videoEnabled: boolean
  screenSharing: boolean
  prioritySpeaker?: boolean
  /** Enregistre la conversation : affiché à tout le salon. */
  recording?: boolean
  connectionLost?: boolean
  /** Application Linux : vidéo reçue sous forme de flux vidéo local (pas de MediaStream). */
  videoUrl?: string | null
  screenUrl?: string | null
}

export interface VoiceRoomParticipant {
  userId: string
  username: string
  avatar?: string
  muted: boolean
  video: boolean
  screen: boolean
}

export interface ActiveStream {
  userId: string
  username: string
  channelId: string
  viewers?: number
}

interface VoiceStore {
  channelId: string | null
  channelName: string | null
  serverId: string | null
  joined: boolean
  listenOnly: boolean
  peers: VoicePeer[]
  localStream: MediaStream | null
  localScreenStream: MediaStream | null
  muted: boolean
  deafened: boolean
  videoEnabled: boolean
  screenSharing: boolean
  /** J'enregistre le salon (annoncé aux autres). */
  recording: boolean
  error: string | null
  notice: string | null
  roomParticipants: Record<string, VoiceRoomParticipant[]>
  pttActive: boolean
  pttMode: boolean
  userVolumes: Record<string, number>
  screenVolumes: Record<string, number>
  activePrioritySpeaker: string | null
  whisperTargets: string[] | null
  activeStreams: Record<string, ActiveStream>
  noiseEngine: NoiseEngine
  /** État de la connexion au serveur média (SFU), distinct de la présence WebSocket. */
  mediaStatus: MediaStatus
  mediaQuality: ConnectionQuality | null
  /** Application Linux : aperçus locaux et orateurs actifs fournis par le natif. */
  localVideoUrl: string | null
  localScreenUrl: string | null
  nativeSpeakers: string[]
  /** Streams regardés à la demande (identifiants), quand la lecture auto est coupée. */
  watchedStreams: string[]
  autoWatchStreams: boolean

  join(channelId: string, serverId: string, withVideo?: boolean, password?: string, channelName?: string, listenOnly?: boolean): Promise<void>
  leave(): void
  toggleMute(): void
  toggleDeafen(): void
  toggleVideo(): Promise<void>
  shareScreen(): Promise<void>
  stopScreenShare(): Promise<void>
  setRecording(on: boolean): void
  clearError(): void
  clearNotice(): void
  initGlobalListeners(): () => void
  setPttMode(enabled: boolean): void
  activatePtt(): void
  deactivatePtt(): void
  setUserVolume(userId: string, volume: number): void
  setScreenVolume(userId: string, volume: number): void
  setNoiseSuppressionEnabled(enabled: boolean): Promise<void>
  setNoiseEngine(engine: NoiseEngine): Promise<void>
  setAudioInput(deviceId: string): Promise<void>
  setVideoInput(deviceId: string): Promise<void>
  applyQualityPrefs(): Promise<void>
  setWhisperTargets(targets: string[] | null): void
  watchStream(userId: string, on: boolean): void
  setAutoWatchStreams(on: boolean): void
}

// ── État non réactif ─────────────────────────────────────────────────────────
let _processed: ProcessedAudio | null = null
let _joining = false
let _offFns: Array<() => void> = []
let _offOpen: (() => void) | null = null

const VOLUMES_KEY = 'fc_user_volumes'
const SCREEN_VOLUMES_KEY = 'fc_screen_volumes'
const PTT_KEY = 'fc_ptt_mode'

function loadVolumes(key: string): Record<string, number> {
  try {
    const raw = localStorage.getItem(key)
    const parsed = raw ? JSON.parse(raw) : {}
    return typeof parsed === 'object' && parsed !== null ? parsed : {}
  } catch {
    return {}
  }
}

function saveVolumes(key: string, volumes: Record<string, number>) {
  try { localStorage.setItem(key, JSON.stringify(volumes)) } catch { /* quota/private mode */ }
}

function micConstraints(): MediaTrackConstraints {
  const savedMicId = localStorage.getItem('fc_audio_input') || undefined
  const engine = getNoiseEngine()
  // Quand un moteur applicatif traite le signal, l'AGC du navigateur en plus
  // faisait « pomper » la voix (gain qui monte dans les silences nettoyés).
  const nativeProcessing = engine === 'off' || engine === 'browser'
  return {
    echoCancellation: true,
    noiseSuppression: nativeProcessing,
    autoGainControl: nativeProcessing,
    ...(savedMicId ? { deviceId: { exact: savedMicId } } : {}),
  }
}

function camConstraints(): MediaTrackConstraints {
  const savedCamId = localStorage.getItem('fc_video_input') || undefined
  const height = Number(localStorage.getItem('fc_cam_height') ?? '720') || 720
  return {
    width: { ideal: Math.round((height * 16) / 9) },
    height: { ideal: height },
    frameRate: { ideal: Number(localStorage.getItem('fc_cam_fps') ?? '30') || 30 },
    ...(savedCamId ? { deviceId: { exact: savedCamId } } : {}),
  }
}

function screenConstraints() {
  const height = Number(localStorage.getItem('fc_screen_height') ?? '1080') || 1080
  const fps = Number(localStorage.getItem('fc_screen_fps') ?? '30') || 30
  return {
    video: { width: { ideal: Math.round((height * 16) / 9) }, height: { ideal: height }, frameRate: { ideal: fps } },
    // systemAudio/selfBrowserSurface : sans eux, partager une fenêtre ne transmet
    // aucun son et rien n'empêche de partager l'onglet ForgeChat lui-même (miroir).
    audio: { echoCancellation: false, noiseSuppression: false, autoGainControl: false },
    systemAudio: 'include',
    selfBrowserSurface: 'exclude',
    surfaceSwitching: 'include',
  }
}

function micShouldBeOpen(s: VoiceStore): boolean {
  if (s.listenOnly) return false
  if (s.pttMode) return s.pttActive
  return !s.muted
}

/** Construit la piste micro à envoyer : brute + moteur de suppression de bruit. */
async function buildMicTrack(raw: MediaStreamTrack, engine: NoiseEngine): Promise<{ track: MediaStreamTrack; error: string | null }> {
  if (engine === 'off' || engine === 'browser') return { track: raw, error: null }
  try {
    _processed?.dispose()
    _processed = await createProcessedAudioTrack(raw, engine)
    return { track: _processed.track, error: null }
  } catch (e) {
    warn(`moteur de suppression de bruit "${engine}" indisponible`, e)
    _processed = null
    return { track: raw, error: `Suppression de bruit « ${engine} » indisponible : traitement du navigateur utilisé à la place.` }
  }
}

function disposeProcessed() {
  _processed?.dispose()
  _processed = null
}

// ── Store ─────────────────────────────────────────────────────────────────────
export const useVoice = create<VoiceStore>((set, get) => {
  const ctx: MeshCtx = { get: get as any, set: set as any }

  const syncMic = () => applyMicEnabled(micShouldBeOpen(get()))

  const broadcastState = () => {
    const s = get()
    if (!s.channelId) return
    useWs.getState().send({
      type: 'VOICE_STATE',
      channel_id: s.channelId,
      muted: s.muted,
      deafened: s.deafened,
      video: s.videoEnabled,
      screen: s.screenSharing,
      recording: s.recording,
    })
  }

  const refreshLocal = () => {
    const ls = getLocalStream()
    set({ localStream: ls ? new MediaStream(ls.getTracks()) : null })
  }

  return {
    channelId: null,
    channelName: null,
    serverId: null,
    joined: false,
    listenOnly: false,
    peers: [],
    localStream: null,
    localScreenStream: null,
    muted: false,
    deafened: false,
    videoEnabled: false,
    screenSharing: false,
    recording: false,
    error: null,
    notice: null,
    roomParticipants: {},
    pttActive: false,
    pttMode: localStorage.getItem(PTT_KEY) === 'true',
    userVolumes: loadVolumes(VOLUMES_KEY),
    screenVolumes: loadVolumes(SCREEN_VOLUMES_KEY),
    activePrioritySpeaker: null,
    whisperTargets: null,
    activeStreams: {},
    noiseEngine: getNoiseEngine(),
    mediaStatus: 'idle',
    mediaQuality: null,
    localVideoUrl: null,
    localScreenUrl: null,
    nativeSpeakers: [],
    watchedStreams: [],
    autoWatchStreams: getAutoWatch(),

    // ── Listeners globaux (sidebar, badges LIVE) ─────────────────────────────
    initGlobalListeners: () => {
      const ws = useWs.getState()

      const bootstrap = async () => {
        // Sans ce bootstrap, après un F5 tous les canaux vocaux apparaissaient
        // vides et les badges LIVE disparaissaient jusqu'au prochain join/leave.
        try {
          const { data } = await api.get('/voice/state')
          const rooms: Record<string, VoiceRoomParticipant[]> = {}
          const streams: Record<string, ActiveStream> = {}
          for (const channel of data.channels ?? []) {
            rooms[channel.channel_id] = (channel.participants ?? []).map((p: any) => ({
              userId: p.user_id, username: p.username, avatar: p.avatar,
              muted: p.muted ?? false, video: p.video ?? false, screen: p.screen ?? false,
            }))
            for (const p of channel.participants ?? []) {
              if (p.screen) streams[p.user_id] = { userId: p.user_id, username: p.username, channelId: channel.channel_id }
            }
          }
          set(s => ({
            roomParticipants: { ...s.roomParticipants, ...rooms },
            activeStreams: { ...streams },
          }))
        } catch (e) {
          warn('bootstrap état vocal', e)
        }
      }
      void bootstrap()

      const offJoined = ws.on('VOICE_USER_JOINED', (d: any) => {
        set(s => {
          const current = s.roomParticipants[d.channel_id] ?? []
          return {
            roomParticipants: {
              ...s.roomParticipants,
              [d.channel_id]: [
                ...current.filter(p => p.userId !== d.user_id),
                { userId: d.user_id, username: d.username, avatar: d.avatar, muted: d.muted ?? false, video: d.video ?? false, screen: d.screen ?? false },
              ],
            },
          }
        })
      })

      const offLeft = ws.on('VOICE_USER_LEFT', (d: any) => {
        set(s => {
          const current = s.roomParticipants[d.channel_id] ?? []
          // Purge du badge LIVE : sans ça, un utilisateur qui ferme son onglet en
          // plein partage restait « en live » pour tout le monde, indéfiniment.
          const streams = { ...s.activeStreams }
          delete streams[d.user_id]
          return {
            roomParticipants: { ...s.roomParticipants, [d.channel_id]: current.filter(p => p.userId !== d.user_id) },
            activeStreams: streams,
          }
        })
      })

      const offVoiceState = ws.on('VOICE_STATE_UPDATE', (d: any) => {
        const isPriority = d.priority_speaker === true
        // Comme Discord/Teams : tout le salon est prévenu qu'on l'enregistre.
        const before = get().peers.find(p => p.userId === d.user_id)
        if (before && !!d.recording !== !!before.recording) {
          if (d.recording) toast(`🔴 ${before.username} a commencé à enregistrer la conversation`, { duration: 8000 })
          else toast(`${before.username} a arrêté l'enregistrement`, { duration: 4000 })
        }
        set(s => {
          const current = s.roomParticipants[d.channel_id] ?? []
          let newActivePriority = s.activePrioritySpeaker
          if (isPriority && !d.muted) newActivePriority = d.user_id
          else if (s.activePrioritySpeaker === d.user_id && (d.muted || !isPriority)) newActivePriority = null

          return {
            activePrioritySpeaker: newActivePriority,
            roomParticipants: {
              ...s.roomParticipants,
              [d.channel_id]: current.map(p => p.userId === d.user_id ? { ...p, muted: d.muted, video: d.video, screen: d.screen } : p),
            },
            peers: s.peers.map(p => p.userId === d.user_id
              ? { ...p, muted: d.muted, videoEnabled: d.video, screenSharing: d.screen, prioritySpeaker: isPriority, screenStream: d.screen ? p.screenStream : null, recording: !!d.recording }
              : p),
          }
        })
      })

      const offStreamStart = ws.on('STREAM_START', (d: any) => {
        set(s => ({
          activeStreams: {
            ...s.activeStreams,
            [d.user_id]: { userId: d.user_id, username: d.username, channelId: d.channel_id, viewers: d.viewers },
          },
        }))
      })

      const offStreamEnd = ws.on('STREAM_END', (d: any) => {
        set(s => {
          const next = { ...s.activeStreams }
          delete next[d.user_id]
          return { activeStreams: next }
        })
      })

      const offOpen = ws.onOpen(() => { void bootstrap() })

      return () => { offJoined(); offLeft(); offVoiceState(); offStreamStart(); offStreamEnd(); offOpen() }
    },

    // ── Join ────────────────────────────────────────────────────────────────
    join: async (channelId, serverId, withVideo = false, password, channelName, listenOnly = false) => {
      const cur = get()
      if (cur.joined && cur.channelId === channelId && cur.listenOnly === listenOnly) return
      if (webrtcMissing() && !isNativeVoice()) {
        const opened = await openInBrowser(`/servers/${serverId}/channels/${channelId}`)
        set({ error: opened ? NO_WEBRTC_MESSAGE : 'Ce moteur d\'affichage ne gère pas les appels : ouvrez ForgeChat dans votre navigateur.' })
        return
      }
      // Garde posée AVANT l'await : deux clics rapides créaient deux jeux de
      // listeners WS, le premier n'étant jamais désabonné.
      if (_joining) return
      _joining = true
      try {
        if (cur.joined) get().leave()
        set({ error: null, notice: null })

        let hasVideo = false
        let noiseError: string | null = null
        const engine = getNoiseEngine()

        if (listenOnly || isNativeVoice()) {
          // Application Linux : micro et caméra capturés par le processus natif.
          setLocalStream(null, null)
        } else {
          let stream: MediaStream
          try {
            stream = await navigator.mediaDevices.getUserMedia({
              audio: micConstraints(),
              video: withVideo ? camConstraints() : false,
            })
          } catch {
            try {
              // Repli sans deviceId : un micro mémorisé puis débranché rendait
              // sinon tout le vocal inaccessible.
              stream = await navigator.mediaDevices.getUserMedia({ audio: true, video: false })
            } catch {
              set({ error: 'Impossible d\'accéder au microphone. Vérifiez les permissions du navigateur.' })
              return
            }
          }

          const raw = stream.getAudioTracks()[0] ?? null
          hasVideo = stream.getVideoTracks().length > 0

          let micTrack = raw
          if (raw) {
            const built = await buildMicTrack(raw, engine)
            micTrack = built.track
            noiseError = built.error
          }

          const outgoing = new MediaStream()
          if (micTrack) outgoing.addTrack(micTrack)
          stream.getVideoTracks().forEach(t => outgoing.addTrack(t))
          setLocalStream(outgoing, raw)
        }

        set({
          joined: true,
          listenOnly,
          channelId,
          channelName: channelName ?? null,
          serverId,
          localStream: getLocalStream(),
          localScreenStream: null,
          videoEnabled: hasVideo,
          muted: listenOnly,
          deafened: false,
          screenSharing: false,
          recording: false,
          peers: [],
          noiseEngine: engine,
          notice: noiseError,
        })
        syncMic()

        const ws = useWs.getState()

        const offExisting = ws.on('VOICE_EXISTING_PEERS', async (d: any) => {
          const s = get()
          // Comparer au canal EFFECTIF : sur un canal auto-create, le serveur
          // répond pour le canal temporaire, pas pour celui qui a été cliqué.
          if (d.channel_id !== s.channelId) return
          // La liste du serveur ne contient que les AUTRES : sans s'y ajouter soi-même,
          // on n'apparaissait pas sous le salon dans sa propre barre latérale.
          const me = useAuth.getState().user
          set(st => ({
            roomParticipants: {
              ...st.roomParticipants,
              [d.channel_id]: [
                ...(me ? [{
                  userId: me.id, username: me.username, avatar: me.avatar ?? undefined,
                  muted: st.muted, video: st.videoEnabled, screen: st.screenSharing,
                }] : []),
                ...(d.peers ?? []).filter((p: any) => String(p.user_id) !== me?.id).map((p: any) => ({
                  userId: p.user_id, username: p.username, avatar: p.avatar,
                  muted: p.muted ?? false, video: p.video ?? false, screen: p.screen ?? false,
                })),
              ],
            },
          }))
          // Réponse à un re-VOICE_JOIN (reconnexion WS) : retirer ceux partis entre-temps.
          const present = new Set((d.peers ?? []).map((p: any) => String(p.user_id)))
          set(st => ({ peers: st.peers.filter(p => present.has(p.userId)) }))
          for (const peer of (d.peers ?? [])) {
            // Les drapeaux video/screen étaient perdus ici : la tuile restait sur
            // l'avatar jusqu'au prochain VOICE_STATE_UPDATE du pair.
            addPeer(String(peer.user_id), {
              username: peer.username, avatar: peer.avatar,
              discriminator: peer.discriminator, muted: peer.muted,
              videoEnabled: peer.video ?? false, screenSharing: peer.screen ?? false,
              recording: !!peer.recording,
            }, ctx)
            if (peer.recording) toast(`🔴 ${peer.username ?? 'Un membre'} enregistre cette conversation`, { duration: 8000 })
          }
          const lk = d.livekit
          if (!lk?.url || !lk?.token || !lk?.room) {
            set({ mediaStatus: 'failed', error: 'Serveur audio/vidéo indisponible : réessayez dans un instant.' })
            return
          }
          // Sans effet si la connexion au SFU tient déjà (reconnexion du seul WebSocket).
          await connectMedia(lk.url, lk.token, lk.room, ctx)
        })

        const offJoined = ws.on('VOICE_USER_JOINED', (d: any) => {
          if (d.channel_id !== get().channelId) return
          addPeer(String(d.user_id), {
            username: d.username, avatar: d.avatar, discriminator: d.discriminator,
            videoEnabled: d.video ?? false, screenSharing: d.screen ?? false,
          }, ctx)
        })

        const offLeft = ws.on('VOICE_USER_LEFT', (d: any) => {
          if (d.channel_id !== get().channelId) return
          removePeer(String(d.user_id), ctx)
        })

        const offRedirect = ws.on('VOICE_REDIRECT', (d: any) => {
          // Canal auto-create : le serveur nous place dans un canal temporaire.
          // On met simplement à jour l'identifiant courant — un leave()/join()
          // ici supprimait le canal temporaire aussitôt créé.
          if (!d?.channel_id) return
          set({ channelId: d.channel_id })
        })

        const offError = ws.on('VOICE_JOIN_ERROR', (d: any) => {
          if (d.reason === 'channel_full' || d.reason === 'full') set({ error: `Canal plein (${d.current ?? '?'}/${d.limit} places)` })
          else if (d.reason === 'missing_permission') set({ error: "Vous n'avez pas la permission de rejoindre ce salon vocal." })
          else if (d.reason === 'rate_limited') set({ error: 'Trop de tentatives de connexion : patientez quelques secondes.' })
          else if (d.reason === 'wrong_password') set({ error: 'Mot de passe du salon incorrect.' })
        })

        // Le serveur refuse un partage sans la permission STREAM : sans ce handler,
        // la capture locale continuait et l'utilisateur croyait diffuser.
        const offStateError = ws.on('VOICE_STATE_ERROR', (d: any) => {
          if (d.permission === 'STREAM') {
            void get().stopScreenShare()
            set({ error: "Vous n'avez pas la permission de partager votre écran sur ce serveur." })
          } else if (d.permission === 'SPEAK_VOICE') {
            set({ muted: true, notice: "Vous n'avez pas la permission de parler dans ce salon : micro coupé." })
            syncMic()
          }
        })

        _offFns = [offExisting, offJoined, offLeft, offRedirect, offError, offStateError]

        // Re-synchronisation après reconnexion WS : sans elle, le serveur nous a
        // sortis du canal (cleanup à la déconnexion) alors que l'UI affiche
        // toujours « connecté » — invisible pour les autres, définitivement.
        _offOpen?.()
        _offOpen = ws.onOpen(() => {
          const s = get()
          if (!s.joined || !s.channelId) return
          // Le média ne passe pas par le WebSocket : la connexion au SFU survit
          // à un redémarrage du serveur ForgeChat, seule la présence est rejouée.
          ws.send({ type: 'VOICE_JOIN', channel_id: s.channelId, listen_only: s.listenOnly, ...(password ? { password } : {}) })
          setTimeout(broadcastState, 300)
        })

        ws.send({ type: 'VOICE_JOIN', channel_id: channelId, listen_only: listenOnly, ...(password ? { password } : {}) })
        setTimeout(broadcastState, 200)
      } finally {
        _joining = false
      }
    },

    // ── Leave ───────────────────────────────────────────────────────────────
    leave: () => {
      const { channelId, joined, screenSharing } = get()
      if (!joined) return

      const ws = useWs.getState()
      // Annoncer la fin du partage AVANT de quitter, sinon le badge LIVE reste
      // affiché chez les autres.
      if (screenSharing && channelId) {
        ws.send({ type: 'VOICE_STATE', channel_id: channelId, muted: true, deafened: false, video: false, screen: false })
      }
      ws.send({ type: 'VOICE_LEAVE', channel_id: channelId })

      void disconnectMedia()

      const tracks = new Set<MediaStreamTrack>()
      getLocalStream()?.getTracks().forEach(t => tracks.add(t))
      const raw = getRawMicTrack()
      // La piste micro BRUTE n'était référencée que par ce champ dès que la
      // suppression de bruit était active : elle n'était jamais stoppée et
      // l'indicateur micro de l'OS restait allumé après avoir quitté.
      if (raw) tracks.add(raw)
      const mic = getMicTrack()
      if (mic) tracks.add(mic)
      get().localScreenStream?.getTracks().forEach(t => tracks.add(t))
      tracks.forEach(t => t.stop())

      disposeProcessed()
      void stopScreenTracks()
      clearLocalMedia()

      _offFns.forEach(off => off())
      _offFns = []
      _offOpen?.()
      _offOpen = null

      set({
        joined: false, listenOnly: false, channelId: null, channelName: null, serverId: null,
        localVideoUrl: null, localScreenUrl: null, nativeSpeakers: [], watchedStreams: [],
        localStream: null, localScreenStream: null, peers: [], muted: false, deafened: false,
        videoEnabled: false, screenSharing: false, recording: false, error: null, notice: null,
        pttActive: false, activePrioritySpeaker: null, whisperTargets: null,
        // userVolumes/screenVolumes/pttMode sont des préférences : elles survivent
        // à la sortie du salon (et sont persistées).
      })
    },

    toggleMute: () => {
      set(s => ({ muted: !s.muted }))
      syncMic()
      broadcastState()
    },

    toggleDeafen: () => {
      const next = !get().deafened
      if (isNativeVoice()) void nativeSetDeafen(next).catch(e => warn('sourdine native', e))
      get().peers.forEach(peer => {
        peer.stream?.getAudioTracks().forEach(t => { t.enabled = !next })
        peer.screenStream?.getAudioTracks().forEach(t => { t.enabled = !next })
      })
      set({ deafened: next })
      broadcastState()
    },

    // ── Caméra ──────────────────────────────────────────────────────────────
    toggleVideo: async () => {
      const { videoEnabled, joined, listenOnly } = get()
      if (!joined || listenOnly) return
      if (isNativeVoice()) {
        try {
          const url = await nativeSetCamera(!videoEnabled)
          set({ videoEnabled: !videoEnabled && !!url, localVideoUrl: url })
        } catch (e) {
          warn('caméra native', e)
          set({ error: `Caméra indisponible : ${String(e)}` })
        }
        broadcastState()
        return
      }

      if (videoEnabled) {
        await removeCameraTrack()
        set({ videoEnabled: false })
        refreshLocal()
      } else {
        try {
          const vs = await navigator.mediaDevices.getUserMedia({ video: camConstraints() })
          const vt = vs.getVideoTracks()[0]
          if (!vt) throw new Error('aucune piste caméra')
          await addCameraTrack(vt)
          set({ videoEnabled: true })
          refreshLocal()
        } catch (e) {
          warn('activation caméra', e)
          set({ error: 'Impossible d\'accéder à la caméra.' })
        }
      }
      broadcastState()
    },

    // ── Partage d'écran ─────────────────────────────────────────────────────
    shareScreen: async () => {
      const { joined, listenOnly } = get()
      if (!joined || listenOnly) return
      if (isNativeVoice()) {
        try {
          const url = await nativeSetScreen(true)
          set({ screenSharing: !!url, localScreenUrl: url })
          broadcastState()
        } catch (e) {
          warn('partage natif', e)
          set({ error: `Partage d'écran impossible : ${String(e)}` })
        }
        return
      }
      const md = navigator.mediaDevices as any
      if (typeof md?.getDisplayMedia !== 'function') {
        set({ error: 'Le partage d\'écran n\'est pas disponible sur cette version de l\'application.' })
        return
      }

      try {
        const screenStream: MediaStream = await md.getDisplayMedia(screenConstraints())
        const svt = screenStream.getVideoTracks()[0]
        if (!svt) throw new Error('aucune piste écran')
        const sat = screenStream.getAudioTracks()[0] ?? null

        await startScreenTracks(svt, sat)

        const localScreen = new MediaStream([svt])
        set({
          screenSharing: true,
          localScreenStream: localScreen,
          // Partager UNE FENÊTRE ne transmet jamais le son (limite navigateur) :
          // le dire, au lieu de laisser croire que le retour audio est cassé.
          notice: sat ? null : 'Aucun son capté : partagez un onglet ou l\'écran entier pour transmettre le son du jeu.',
        })
        broadcastState()

        svt.onended = () => { void get().stopScreenShare() }
      } catch (e) {
        const err = e as DOMException
        if (err?.name === 'NotAllowedError' && /permission|denied|disallowed/i.test(err.message ?? '')) {
          // Sous WebKitGTK (paquets Linux), la capture est refusée par le moteur
          // et renvoie la même erreur qu'une annulation utilisateur.
          set({ error: 'Partage d\'écran refusé par le système. Sur Linux, lancez l\'application avec le portail de capture activé ou utilisez la version web.' })
          return
        }
        if (err?.name === 'NotAllowedError') return // annulation du sélecteur
        warn('shareScreen', e)
        set({ error: 'Impossible de partager l\'écran' })
      }
    },

    setRecording: (on) => {
      if (get().recording === on) return
      set({ recording: on })
      broadcastState()
    },

    stopScreenShare: async () => {
      if (isNativeVoice()) {
        await nativeSetScreen(false).catch(e => warn('fin du partage natif', e))
        set({ localScreenUrl: null })
      }
      await stopScreenTracks()
      set({ screenSharing: false, localScreenStream: null })
      broadcastState()
    },

    clearError: () => set({ error: null }),
    clearNotice: () => set({ notice: null }),

    // ── Push-to-talk ────────────────────────────────────────────────────────
    setPttMode: (enabled) => {
      localStorage.setItem(PTT_KEY, enabled ? 'true' : 'false')
      set({ pttMode: enabled, pttActive: false })
      syncMic()
      broadcastState()
    },

    activatePtt: () => {
      if (!get().pttMode || !get().joined) return
      set({ pttActive: true })
      syncMic()
      broadcastState()
    },

    deactivatePtt: () => {
      if (!get().pttMode || !get().joined) return
      set({ pttActive: false })
      syncMic()
      broadcastState()
    },

    // ── Volumes ─────────────────────────────────────────────────────────────
    setUserVolume: (userId, volume) => {
      // Natif : le module audio du système ne règle pas le volume par personne,
      // seulement coupé ou audible.
      if (isNativeVoice()) void nativeSetPeerAudio(userId, volume > 0).catch(e => warn('volume natif', e))
      set(s => {
        const next = { ...s.userVolumes, [userId]: volume }
        saveVolumes(VOLUMES_KEY, next)
        return { userVolumes: next }
      })
    },

    setScreenVolume: (userId, volume) => {
      set(s => {
        const next = { ...s.screenVolumes, [userId]: volume }
        saveVolumes(SCREEN_VOLUMES_KEY, next)
        return { screenVolumes: next }
      })
    },

    // ── Suppression de bruit ────────────────────────────────────────────────
    setNoiseSuppressionEnabled: async (enabled) => {
      await get().setNoiseEngine(enabled ? 'rnnoise' : 'browser')
    },

    setNoiseEngine: async (engine) => {
      persistNoiseEngine(engine)
      set({ noiseEngine: engine })
      if (!get().joined || get().listenOnly) return

      const raw = getRawMicTrack()
      if (!raw) return
      const built = await buildMicTrack(raw, engine)
      // Réappliquer l'état mute APRÈS le remplacement : sinon basculer ce réglage
      // rouvrait le micro d'un utilisateur muet, sans que l'icône ne change.
      await replaceMicTrack(built.track, micShouldBeOpen(get()))
      refreshLocal()
      set({ notice: built.error })
    },

    // ── Périphériques à chaud ───────────────────────────────────────────────
    setAudioInput: async (deviceId) => {
      localStorage.setItem('fc_audio_input', deviceId)
      if (!get().joined || get().listenOnly) return
      try {
        const stream = await navigator.mediaDevices.getUserMedia({ audio: micConstraints() })
        const raw = stream.getAudioTracks()[0]
        if (!raw) return
        getRawMicTrack()?.stop()
        disposeProcessed()
        const built = await buildMicTrack(raw, get().noiseEngine)
        const ls = getLocalStream()
        setLocalStream(ls, raw)
        await replaceMicTrack(built.track, micShouldBeOpen(get()))
        refreshLocal()
        set({ notice: built.error })
      } catch (e) {
        warn('changement de microphone', e)
        set({ error: 'Impossible d\'utiliser ce microphone.' })
      }
    },

    setVideoInput: async (deviceId) => {
      localStorage.setItem('fc_video_input', deviceId)
      if (!get().joined || !get().videoEnabled) return
      try {
        const vs = await navigator.mediaDevices.getUserMedia({ video: camConstraints() })
        const vt = vs.getVideoTracks()[0]
        if (!vt) return
        await addCameraTrack(vt)
        refreshLocal()
      } catch (e) {
        warn('changement de caméra', e)
        set({ error: 'Impossible d\'utiliser cette caméra.' })
      }
    },

    applyQualityPrefs: async () => {
      await refreshAllSenderQuality()
    },

    // ── Stream à la demande ─────────────────────────────────────────────────
    watchStream: (userId, on) => sfuWatchStream(userId, on),
    setAutoWatchStreams: (on) => {
      sfuSetAutoWatch(on)
      set({ autoWatchStreams: on })
    },

    // ── Whisper ─────────────────────────────────────────────────────────────
    setWhisperTargets: (targets) => {
      set({ whisperTargets: targets })
      // Par sender (replaceTrack), jamais par track.enabled : tous les senders
      // partagent le MÊME MediaStreamTrack, donc couper « pour un pair » coupait
      // le micro pour tout le monde.
      setWhisper(targets)
    },
  }
})

if (typeof window !== 'undefined') window.__fcVoiceStore = useVoice
