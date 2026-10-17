import { create } from 'zustand'
import { t as tr } from '../i18n'
import { useWs } from './ws'
import { useAuth } from './auth'
import { hasUxPref } from './uxPrefs'
import api from '../api/client'
import toast from 'react-hot-toast'
import { webrtcMissing, openInBrowser, noWebrtcMessage } from '../lib/webrtcSupport'
import { isNativeVoice, nativeSetDeafen, nativeSetPeerAudio, nativeSetCamera, nativeSetScreen } from '../lib/nativeVoice'
import {
  createProcessedAudioTrack, getNoiseEngine, setNoiseEngine as persistNoiseEngine,
  micNeedsChain, chainOptionsFromPrefs, hasLiveChain,
  type NoiseEngine, type ProcessedAudio,
} from '../lib/audio'
import { avPrefs, micConstraintsFor, camConstraintsFromPrefs, effectiveAutoGain } from '../lib/avPrefs'
import { nativeApplyAudioProcessing } from '../lib/nativeVoice'
import {
  addPeer, removePeer, connectMedia, disconnectMedia, watchStream as sfuWatchStream, getAutoWatch, setAutoWatch as sfuSetAutoWatch,
  setLocalStream, replaceMicTrack, applyMicEnabled, addCameraTrack, removeCameraTrack,
  startScreenTracks, stopScreenTracks, clearLocalMedia, getLocalStream, getRawMicTrack,
  getMicTrack, refreshAllSenderQuality, setWhisper, resubscribeAll, warn,
  type MeshCtx, type MediaStatus, type MediaLoss,
} from './voiceSfu'
import { maybeBlur } from '../utils/backgroundBlur'
import type { ConnectionQuality } from 'livekit-client'
import { initVoiceModeration } from './voiceModeration'
import { initVoiceWaiting, useVoiceWaiting } from './voiceWaiting'
import { t } from '../i18n'
import { e2eeClaim } from '../e2e/media'
import { playJoinSound } from '../lib/joinSound'
import { screenCaptureConstraints, screenAudioWanted } from '../lib/voiceDock'

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
  /** Enregistre la conversation : affiché à tout le salon. */
  recording?: boolean
  /** Refuse d'être enregistré : retiré du mixage des enregistrements. */
  noRecord?: boolean
  /** Muet / sourdine imposés par un modérateur (P2-2). */
  serverMuted?: boolean
  serverDeafened?: boolean
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
  serverMuted?: boolean
  serverDeafened?: boolean
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
  /** Je refuse d'être enregistré (annoncé aux autres). */
  noRecord: boolean
  error: string | null
  notice: string | null
  roomParticipants: Record<string, VoiceRoomParticipant[]>
  pttActive: boolean
  pttMode: boolean
  userVolumes: Record<string, number>
  screenVolumes: Record<string, number>
  whisperTargets: string[] | null
  activeStreams: Record<string, ActiveStream>
  noiseEngine: NoiseEngine
  /** État de la connexion au serveur média (SFU), distinct de la présence WebSocket. */
  mediaStatus: MediaStatus
  mediaQuality: ConnectionQuality | null
  /** Médias du salon chiffrés de bout en bout (§5) ; participants dont l'appli ne chiffre pas. */
  e2ee: boolean
  e2eeOutdated: string[]
  /** Application Linux : aperçus locaux et orateurs actifs fournis par le natif. */
  localVideoUrl: string | null
  localScreenUrl: string | null
  nativeSpeakers: string[]
  /** Streams regardés à la demande (identifiants), quand la lecture auto est coupée. */
  watchedStreams: string[]
  autoWatchStreams: boolean
  /** Aperçu demandé avant d'allumer la caméra (Réglages > Vidéo > Toujours prévisualiser). */
  cameraPreview: boolean
  /** Muet / sourdine imposés à MOI par un modérateur : non levables ici. */
  serverMuted: boolean
  serverDeafened: boolean
  /** Identités qui parlent (SFU) : indicateurs « parle » en sourdine, AFK. */
  sfuSpeakers: string[]

  join(channelId: string, serverId: string, withVideo?: boolean, password?: string, channelName?: string, listenOnly?: boolean): Promise<void>
  leave(): void
  toggleMute(): void
  toggleDeafen(): void
  /** `skipPreview` : depuis l'aperçu lui-même (sinon l'aperçu s'ouvre si le réglage le demande). */
  toggleVideo(opts?: { skipPreview?: boolean }): Promise<void>
  closeCameraPreview(): void
  shareScreen(): Promise<void>
  stopScreenShare(): Promise<void>
  setRecording(on: boolean): void
  setNoRecord(on: boolean): void
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
  /**
   * Reconstruit la chaîne du micro après un changement de Réglages > Voix (écho, gain
   * automatique, volume d'entrée, sensibilité). `onlyIfMissing` : seulement si la chaîne
   * en place ne peut pas suivre à chaud.
   */
  refreshMicChain(opts?: { onlyIfMissing?: boolean }): Promise<void>
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
/** VOICE_JOIN envoyé, réponse (pairs ou erreur) pas encore reçue. */
let _awaitingPeers = false
/** Mot de passe du salon : renvoyé avec chaque VOICE_JOIN de reconnexion. */
let _password: string | undefined
/** Reconnexion au média : tentatives et minuteur en cours. */
let _rejoinAttempts = 0
let _rejoinTimer: ReturnType<typeof setTimeout> | null = null
const MAX_REJOIN_ATTEMPTS = 5
/** Caméra en cours d'ouverture (double clic, sortie pendant getUserMedia). */
let _camBusy = false

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

/** Contraintes du micro : périphérique et traitements choisis dans Réglages > Voix (lib/avPrefs). */
function micConstraints(): MediaTrackConstraints {
  return micConstraintsFor(getNoiseEngine())
}

/**
 * Traitement du navigateur selon le moteur et les Réglages. Quand un moteur applicatif
 * traite le signal, l'AGC du navigateur en plus faisait « pomper » la voix (gain qui
 * monte dans les silences nettoyés) : il ne s'active alors que si l'utilisateur le
 * demande explicitement. « Désactivée » veut dire sans réduction de bruit.
 */
function browserProcessing(engine: NoiseEngine) {
  return {
    echoCancellation: avPrefs().echoCancellation,
    noiseSuppression: engine === 'browser',
    autoGainControl: effectiveAutoGain(engine),
  }
}

function camConstraints(): MediaTrackConstraints {
  return camConstraintsFromPrefs()
}

/** Délai de relâchement du push-to-talk en cours (Réglages > Voix). */
let _pttReleaseTimer: ReturnType<typeof setTimeout> | null = null

function screenConstraints() {
  const fps = Number(localStorage.getItem('fc_screen_fps') ?? '30') || 30
  return {
    video: screenCaptureConstraints(localStorage.getItem('fc_screen_height'), fps),
    // systemAudio/selfBrowserSurface : sans eux, partager une fenêtre ne transmet
    // aucun son et rien n'empêche de partager l'onglet ForgeChat lui-même (miroir).
    audio: screenAudioWanted() ? { echoCancellation: false, noiseSuppression: false, autoGainControl: false } : false,
    systemAudio: 'include',
    selfBrowserSurface: 'exclude',
    surfaceSwitching: 'include',
  }
}

function micShouldBeOpen(s: VoiceStore): boolean {
  // En sourdine on n'émet pas non plus (comme Discord) : le micro restait ouvert.
  if (s.listenOnly || s.serverMuted || s.serverDeafened || s.deafened) return false
  // Muet l'emporte sur le push-to-talk : appuyer sur la touche rouvrait le micro.
  if (s.pttMode) return s.pttActive && !s.muted
  return !s.muted
}

/** Construit la piste micro à envoyer : brute + moteur de suppression de bruit. */
async function buildMicTrack(raw: MediaStreamTrack, engine: NoiseEngine): Promise<{ track: MediaStreamTrack; error: string | null }> {
  if (!micNeedsChain(engine)) {
    // Ni moteur applicatif, ni volume d'entrée, ni seuil manuel : l'ancienne chaîne
    // (worklet + AudioContext) tournait encore pour rien.
    disposeProcessed()
    return { track: raw, error: null }
  }
  try {
    _processed?.dispose()
    _processed = await createProcessedAudioTrack(raw, engine, chainOptionsFromPrefs('voice'))
    return { track: _processed.track, error: null }
  } catch (e) {
    _processed = null
    if (engine === 'off' || engine === 'browser') {
      warn('volume d’entrée / seuil du micro indisponibles', e)
      return { track: raw, error: tr('sw.v.inputFx') }
    }
    warn(`moteur de suppression de bruit "${engine}" indisponible`, e)
    return { track: raw, error: tr('sw.v.noiseFx', { engine }) }
  }
}

function disposeProcessed() {
  _processed?.dispose()
  _processed = null
}

// ── Store ─────────────────────────────────────────────────────────────────────
export const useVoice = create<VoiceStore>((set, get) => {
  const ctx: MeshCtx = { get: get as any, set: set as any, onMediaLost: why => onMediaLost(why) }

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
      no_record: s.noRecord,
    })
  }

  const applyDeafen = (on: boolean) => {
    if (isNativeVoice()) void nativeSetDeafen(on).catch(e => warn('sourdine native', e))
    get().peers.forEach(peer => {
      peer.stream?.getAudioTracks().forEach(t => { t.enabled = !on })
      peer.screenStream?.getAudioTracks().forEach(t => { t.enabled = !on })
    })
    set({ deafened: on })
  }

  /** Muet / sourdine imposés : micro coupé, écoute coupée, non levables. */
  const applyImposed = (muted: boolean, deafened: boolean) => {
    // Sourdine imposée levée : le SFU a retiré nos abonnements, les redemander.
    if (get().serverDeafened && !deafened) resubscribeAll()
    set({ serverMuted: muted, serverDeafened: deafened })
    if (muted || deafened) set({ muted: true })
    if (deafened) applyDeafen(true)
    syncMic()
  }

  const clearRejoin = () => {
    if (_rejoinTimer) { clearTimeout(_rejoinTimer); _rejoinTimer = null }
    _rejoinAttempts = 0
  }

  const sendJoin = (channelId: string, listenOnly: boolean) => {
    _awaitingPeers = true
    useWs.getState().send({ type: 'VOICE_JOIN', channel_id: channelId, listen_only: listenOnly, ...e2eeClaim(), ...(_password ? { password: _password } : {}) })
  }

  /** Média perdu alors qu'on est toujours dans le salon. */
  const onMediaLost = (why: MediaLoss) => {
    if (!get().joined) return
    if (why === 'duplicate' || why === 'removed' || why === 'evicted') {
      // Le serveur nous a déjà sortis (ou un autre appareil a repris le salon) :
      // un VOICE_LEAVE ici sortirait l'autre appareil, et un VOICE_JOIN le chasserait.
      teardown(why === 'evicted', why === 'duplicate')
      toast(why === 'duplicate' ? tr('sw.v.movedDup')
        : why === 'evicted' ? tr('sw.v.movedEvicted')
        : tr('sw.v.movedOut'))
      return
    }
    // Panne réseau : redemander un accès au SFU (nouveau jeton) avant que le
    // serveur ne nous retire du salon (20 s d'absence), avec un délai croissant.
    if (_rejoinTimer) return
    if (_rejoinAttempts >= MAX_REJOIN_ATTEMPTS) {
      set({ mediaStatus: 'failed', error: tr('sw.v.mediaLostRejoin') })
      return
    }
    const delay = 1000 * 2 ** _rejoinAttempts++
    set({ mediaStatus: 'reconnecting' })
    _rejoinTimer = setTimeout(() => {
      _rejoinTimer = null
      const s = get()
      if (s.joined && s.channelId) sendJoin(s.channelId, s.listenOnly)
    }, delay)
  }

  /** Sortie locale. `announce` = prévenir le serveur (VOICE_LEAVE). */
  const teardown = (announce: boolean, stillThereElsewhere = false) => {
    const { channelId, joined, screenSharing } = get()
    if (!joined) return
    useVoiceWaiting.setState({ waitingIn: null })

    if (announce) {
      const ws = useWs.getState()
      // Annoncer la fin du partage AVANT de quitter, sinon le badge LIVE reste
      // affiché chez les autres.
      if (screenSharing && channelId) {
        ws.send({ type: 'VOICE_STATE', channel_id: channelId, muted: true, deafened: false, video: false, screen: false })
      }
      ws.send({ type: 'VOICE_LEAVE', channel_id: channelId })
    }
    clearRejoin()
    _awaitingPeers = false
    _password = undefined

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
    tracks.forEach(t => { t.onended = null; t.stop() })

    disposeProcessed()
    void stopScreenTracks()
    clearLocalMedia()

    _offFns.forEach(off => off())
    _offFns = []
    _offOpen?.()
    _offOpen = null

    // On restait affiché sous le salon dans sa propre barre latérale après l'avoir
    // quitté (VOICE_USER_LEFT n'était pas renvoyé à l'intéressé). Sauf si un autre de
    // nos appareils a repris le salon : on y est toujours.
    const myId = useAuth.getState().user?.id
    if (channelId && !stillThereElsewhere) {
      set(s => ({
        roomParticipants: { ...s.roomParticipants, [channelId]: (s.roomParticipants[channelId] ?? []).filter(p => p.userId !== myId) },
      }))
    }
    set({
      joined: false, listenOnly: false, channelId: null, channelName: null, serverId: null,
      localVideoUrl: null, localScreenUrl: null, nativeSpeakers: [], watchedStreams: [], cameraPreview: false,
      localStream: null, localScreenStream: null, peers: [], muted: false, deafened: false,
      videoEnabled: false, screenSharing: false, recording: false, error: null, notice: null,
      pttActive: false, whisperTargets: null,
      serverMuted: false, serverDeafened: false, sfuSpeakers: [],
      // userVolumes/screenVolumes/pttMode sont des préférences : elles survivent
      // à la sortie du salon (et sont persistées).
    })
  }

  /** Micro débranché : repli sur le micro par défaut, sans quitter le salon. */
  const watchMic = (raw: MediaStreamTrack | null) => {
    if (!raw) return
    raw.onended = () => {
      if (!get().joined || getRawMicTrack() !== raw) return
      localStorage.removeItem('fc_audio_input')
      set({ notice: tr('sw.v.micUnplugged') })
      void get().setAudioInput('')
    }
  }

  /** Caméra débranchée : la couper proprement au lieu d'envoyer une image figée. */
  const watchCam = (vt: MediaStreamTrack) => {
    vt.onended = () => {
      const s = get()
      if (!s.joined || !s.videoEnabled) return
      set({ notice: tr('sw.v.camUnplugged') })
      void s.toggleVideo()
    }
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
    noRecord: false,
    error: null,
    notice: null,
    roomParticipants: {},
    pttActive: false,
    pttMode: localStorage.getItem(PTT_KEY) === 'true',
    userVolumes: loadVolumes(VOLUMES_KEY),
    screenVolumes: loadVolumes(SCREEN_VOLUMES_KEY),
    whisperTargets: null,
    activeStreams: {},
    noiseEngine: getNoiseEngine(),
    mediaStatus: 'idle',
    mediaQuality: null,
    e2ee: false,
    e2eeOutdated: [],
    localVideoUrl: null,
    localScreenUrl: null,
    nativeSpeakers: [],
    watchedStreams: [],
    autoWatchStreams: getAutoWatch(),
    cameraPreview: false,
    serverMuted: false,
    serverDeafened: false,
    sfuSpeakers: [],

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
              serverMuted: p.server_muted ?? false, serverDeafened: p.server_deafened ?? false,
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
                { userId: d.user_id, username: d.username, avatar: d.avatar, muted: d.muted ?? false, video: d.video ?? false, screen: d.screen ?? false, serverMuted: d.server_muted ?? false, serverDeafened: d.server_deafened ?? false },
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
        // Comme Discord/Teams : tout le salon est prévenu qu'on l'enregistre.
        const before = get().peers.find(p => p.userId === d.user_id)
        if (before && !!d.recording !== !!before.recording) {
          if (d.recording) toast(tr('hc.t.recStart', { name: before.username }), { duration: 8000 })
          else toast(tr('hc.t.recStop', { name: before.username }), { duration: 4000 })
        }
        set(s => {
          const current = s.roomParticipants[d.channel_id] ?? []
          return {
            roomParticipants: {
              ...s.roomParticipants,
              [d.channel_id]: current.map(p => p.userId === d.user_id ? { ...p, muted: d.muted, video: d.video, screen: d.screen } : p),
            },
            peers: s.peers.map(p => p.userId === d.user_id
              ? { ...p, muted: d.muted, deafened: !!d.deafened, videoEnabled: d.video, screenSharing: d.screen, screenStream: d.screen ? p.screenStream : null, recording: !!d.recording, noRecord: !!d.no_record }
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
      const offModeration = initVoiceModeration(get, set, (m, d) => { applyImposed(m, d); broadcastState() })
      const offWaiting = initVoiceWaiting(
        () => get().channelId,
        () => { const s = get(); if (s.joined && s.channelId) sendJoin(s.channelId, s.listenOnly) },
        () => { get().leave(); set({ error: t('voiceLot.waiting.denied') }) },
      )

      return () => { offJoined(); offLeft(); offVoiceState(); offStreamStart(); offStreamEnd(); offOpen(); offModeration(); offWaiting() }
    },

    // ── Join ────────────────────────────────────────────────────────────────
    join: async (channelId, serverId, withVideo = false, password, channelName, listenOnly = false) => {
      const cur = get()
      if (cur.joined && cur.channelId === channelId && cur.listenOnly === listenOnly) return
      if (webrtcMissing() && !isNativeVoice()) {
        const opened = await openInBrowser(`/servers/${serverId}/channels/${channelId}`)
        set({ error: opened ? noWebrtcMessage() : tr('sw.v.noWebrtcEngine') })
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
              set({ error: tr('sw.v.micAccess') })
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
          for (const t of stream.getVideoTracks()) { watchCam(t); outgoing.addTrack(await maybeBlur(t)) }
          setLocalStream(outgoing, raw)
          watchMic(raw)
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
          // Réponse à NOTRE VOICE_JOIN pour un autre canal : c'est ce canal
          // temporaire, l'adopter (sinon jamais de son ni d'image).
          if (d.channel_id !== s.channelId) {
            if (!_awaitingPeers) return
            set({ channelId: d.channel_id })
          }
          // Réponse à notre propre arrivée (pas une resynchronisation) : son d'arrivée.
          if (_awaitingPeers && !get().listenOnly) playJoinSound(d.channel_id)
          _awaitingPeers = false
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
                  serverMuted: p.server_muted ?? false, serverDeafened: p.server_deafened ?? false,
                })),
              ],
            },
          }))
          // Muet / sourdine imposés par un modérateur : appliqués dès l'entrée.
          applyImposed(d.server_muted === true, d.server_deafened === true)
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
              noRecord: !!peer.no_record,
              serverMuted: peer.server_muted ?? false, serverDeafened: peer.server_deafened ?? false,
            }, ctx)
            if (peer.recording) toast(tr('hc.t.recNow', { name: peer.username ?? tr('hc.t.aMember') }), { duration: 8000 })
          }
          const lk = d.livekit
          if (!lk?.url || !lk?.token || !lk?.room) {
            set({ mediaStatus: 'failed', error: tr('sw.v.sfuRetry') })
            return
          }
          // Sans effet si la connexion au SFU tient déjà (reconnexion du seul WebSocket).
          await connectMedia(lk.url, lk.token, lk.room, ctx, d.can_speak !== false, String(d.channel_id))
          if (get().mediaStatus === 'connected') clearRejoin()
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
          if (!d?.channel_id || !_awaitingPeers) return
          set({ channelId: d.channel_id })
        })

        const offError = ws.on('VOICE_JOIN_ERROR', (d: any) => {
          // Seulement en réponse à notre VOICE_JOIN (le message part à toutes nos sessions).
          if (!_awaitingPeers) return
          const error = d.reason === 'channel_full' || d.reason === 'full' ? `Canal plein (${d.current ?? '?'}/${d.limit} places)`
            : d.reason === 'missing_permission' ? tr('sw.v.noJoinPerm')
            : d.reason === 'rate_limited' ? tr('sw.v.rateLimited')
            : d.reason === 'wrong_password' ? tr('sw.v.wrongPassword')
            : d.reason === 'media_unavailable' ? tr('sw.v.sfuRetry')
            : tr('sw.v.joinFail')
          // Le serveur ne nous a pas acceptés : l'interface ne doit pas rester
          // « connectée » à un salon où l'on n'est pas (micro ouvert pour rien).
          get().leave()
          set({ error })
        })

        // Le serveur refuse un partage sans la permission STREAM : sans ce handler,
        // la capture locale continuait et l'utilisateur croyait diffuser.
        const offStateError = ws.on('VOICE_STATE_ERROR', (d: any) => {
          if (d.permission === 'STREAM') {
            void get().stopScreenShare()
            set({ error: tr('sw.v.noStreamPerm') })
          } else if (d.permission === 'SPEAK_VOICE') {
            set({ muted: true, notice: tr('sw.v.noSpeakPerm') })
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
          sendJoin(s.channelId, s.listenOnly)
          setTimeout(broadcastState, 300)
        })

        _password = password
        sendJoin(channelId, listenOnly)
        setTimeout(broadcastState, 200)
      } finally {
        _joining = false
      }
    },

    // ── Leave ───────────────────────────────────────────────────────────────
    leave: () => teardown(true),

    toggleMute: () => {
      const s0 = get()
      if (s0.muted && (s0.serverMuted || s0.serverDeafened)) {
        set({ notice: tr('sw.v.modMuted') })
        return
      }
      set(s => ({ muted: !s.muted }))
      syncMic()
      broadcastState()
    },

    toggleDeafen: () => {
      const next = !get().deafened
      if (!next && get().serverDeafened) {
        set({ notice: tr('sw.v.modDeafened') })
        return
      }
      applyDeafen(next)
      syncMic()
      broadcastState()
    },

    // ── Caméra ──────────────────────────────────────────────────────────────
    toggleVideo: async (opts) => {
      const { videoEnabled, joined, listenOnly, channelId } = get()
      if (!joined || listenOnly) return
      // Toujours prévisualiser : l'aperçu (CameraPreviewDialog) s'ouvre d'abord et
      // rappelle toggleVideo({ skipPreview: true }) sur « Allumer la caméra ».
      // Pas sur l'application Linux : la caméra y est capturée par le natif.
      if (!videoEnabled && opts?.skipPreview !== true && avPrefs().camAlwaysPreview && !isNativeVoice()) {
        set({ cameraPreview: true })
        return
      }
      if (get().cameraPreview) set({ cameraPreview: false })
      // Double clic pendant l'ouverture : deux caméras ouvertes, une jamais fermée.
      if (_camBusy) return
      _camBusy = true
      // Salon quitté (ou changé) pendant l'attente : ne rien publier ni afficher.
      const stillHere = () => get().joined && get().channelId === channelId
      try {
        if (isNativeVoice()) {
          try {
            const url = await nativeSetCamera(!videoEnabled)
            if (!stillHere()) return
            set({ videoEnabled: !videoEnabled && !!url, localVideoUrl: url })
          } catch (e) {
            warn('caméra native', e)
            if (stillHere()) set({ error: tr('sw.v.camErr', { err: String(e) }) })
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
            if (!stillHere()) { vs.getTracks().forEach(t => t.stop()); return }
            await addCameraTrack(vt)
            if (!stillHere()) { await removeCameraTrack(); return }
            watchCam(vt)
            set({ videoEnabled: true })
            refreshLocal()
          } catch (e) {
            warn('activation caméra', e)
            set({ error: tr('sw.v.camAccess') })
          }
        }
        broadcastState()
      } finally {
        _camBusy = false
      }
    },

    closeCameraPreview: () => set({ cameraPreview: false }),

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
          set({ error: tr('sw.v.screenFail', { err: String(e) }) })
        }
        return
      }
      const md = navigator.mediaDevices as any
      if (typeof md?.getDisplayMedia !== 'function') {
        set({ error: tr('sw.v.noScreenShare') })
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
          notice: sat || !screenAudioWanted() ? null : tr('sw.v.noScreenAudio'),
        })
        broadcastState()

        svt.onended = () => { void get().stopScreenShare() }
      } catch (e) {
        const err = e as DOMException
        if (err?.name === 'NotAllowedError' && /permission|denied|disallowed/i.test(err.message ?? '')) {
          // Sous WebKitGTK (paquets Linux), la capture est refusée par le moteur
          // et renvoie la même erreur qu'une annulation utilisateur.
          set({ error: tr('sw.v.screenDenied') })
          return
        }
        if (err?.name === 'NotAllowedError') return // annulation du sélecteur
        warn('shareScreen', e)
        set({ error: tr('sw.v.screenCant') })
      }
    },

    setRecording: (on) => {
      if (get().recording === on) return
      set({ recording: on })
      broadcastState()
    },

    setNoRecord: (on) => {
      if (get().noRecord === on) return
      set({ noRecord: on })
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

    // Pas de VOICE_STATE à chaque appui : rien de diffusé ne change, et chaque
    // appui consommait la limite de 20 changements d'état par 10 s.
    activatePtt: () => {
      if (_pttReleaseTimer) { clearTimeout(_pttReleaseTimer); _pttReleaseTimer = null }
      if (!get().pttMode || !get().joined) return
      set({ pttActive: true })
      syncMic()
    },

    // Délai de relâchement (Réglages > Voix) : la fin du mot n'est plus coupée
    // quand on lâche la touche un peu tôt. Un nouvel appui l'annule.
    deactivatePtt: () => {
      if (!get().pttMode || !get().joined) return
      if (_pttReleaseTimer) clearTimeout(_pttReleaseTimer)
      const release = () => {
        _pttReleaseTimer = null
        if (!get().pttMode || !get().joined) return
        set({ pttActive: false })
        syncMic()
      }
      const delay = avPrefs().pttReleaseMs
      if (delay > 0) _pttReleaseTimer = setTimeout(release, delay)
      else release()
    },

    // ── Volumes ─────────────────────────────────────────────────────────────
    setUserVolume: (userId, volume) => {
      // Natif : le module audio du système ne règle pas le volume par personne,
      // seulement coupé ou audible.
      if (isNativeVoice()) void nativeSetPeerAudio(userId, volume > 0 && !hasUxPref('voiceMuted', userId)).catch(e => warn('volume natif', e))
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
      await get().refreshMicChain()
    },

    refreshMicChain: async (opts) => {
      nativeApplyAudioProcessing()
      if (!get().joined || get().listenOnly) return
      const raw = getRawMicTrack()
      if (!raw) return
      const engine = get().noiseEngine
      // Volume d'entrée ou seuil changés : réglés à chaud (setLiveInputGain,
      // setLiveGate) quand la chaîne en place convient — pas de coupure audible.
      if (opts?.onlyIfMissing) {
        const wantGate = avPrefs().vadMode === 'manual'
        const hasGate = !!_processed?.gate
        if (!micNeedsChain(engine) && !hasGate) return
        if (_processed && hasLiveChain('voice') && hasGate === wantGate) return
      }
      // Traitement du navigateur suivant le moteur : passer à « Navigateur » ne
      // réactivait pas sa réduction de bruit, « Désactivée » la gardait.
      await raw.applyConstraints(browserProcessing(engine)).catch(e => warn('contraintes micro', e))
      const built = await buildMicTrack(raw, engine)
      // Réappliquer l'état mute APRÈS le remplacement : sinon basculer ce réglage
      // rouvrait le micro d'un utilisateur muet, sans que l'icône ne change.
      await replaceMicTrack(built.track, micShouldBeOpen(get()))
      refreshLocal()
      set({ notice: built.error })
    },

    // ── Périphériques à chaud ───────────────────────────────────────────────
    setAudioInput: async (deviceId) => {
      if (deviceId) localStorage.setItem('fc_audio_input', deviceId)
      else localStorage.removeItem('fc_audio_input')
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
        watchMic(raw)
        await replaceMicTrack(built.track, micShouldBeOpen(get()))
        refreshLocal()
        set({ notice: built.error })
      } catch (e) {
        warn('changement de microphone', e)
        set({ error: tr('sw.v.micFail') })
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
        watchCam(vt)
        refreshLocal()
      } catch (e) {
        warn('changement de caméra', e)
        set({ error: tr('sw.v.camFail') })
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
