// Transport média du vocal de serveur : SFU LiveKit.
//
// Remplace le maillage pair-à-pair (une RTCPeerConnection par pair). Le maillage
// échouait entre deux PC du même réseau local (adresses mDNS non résolues,
// hairpin NAT de la box) : 0 son, 0 image, signalé le 2026-09-22 avec deux PC
// réels alors que tous les tests automatisés passaient. Ici chaque client
// n'ouvre qu'UNE connexion, vers l'IP publique du VPS.
//
// ForgeChat garde l'autorité : la présence (qui est dans le salon, pseudo,
// avatar, muet, LIVE) vient du WebSocket ; LiveKit ne transporte que le média.
// L'identité LiveKit d'un participant est son id utilisateur ForgeChat.
import {
  Room, RoomEvent, Track, ConnectionQuality, DisconnectReason,
  AudioPresets,
  type LocalTrackPublication, type RemoteParticipant, type RemoteTrackPublication,
  type ParticipantTrackPermission,
} from 'livekit-client'
import type { VoicePeer } from './voice'
import api from '../api/client'
import { maybeBlur } from '../utils/backgroundBlur'
import { screenCaptureConstraints } from '../lib/voiceDock'
import {
  isNativeVoice, nativeConnect, nativeDisconnect, nativeSetMic,
  type NativeTrackEvent, type NativeStateEvent,
} from '../lib/nativeVoice'
import { t } from '../i18n'
import { hasUxPref } from './uxPrefs'
import { enableMediaE2EE, mediaE2EEError, nativeMediaKey, openMediaE2EE, retryWhenKeyReady, watchOutdated } from '../e2e/media'

export function warn(ctx: string, e: unknown) {
  console.warn(`[voice] ${ctx}`, e)
}

/** Pourquoi le média est perdu alors qu'on est toujours dans le salon. */
export type MediaLoss = 'network' | 'duplicate' | 'removed' | 'evicted'

export interface MeshCtx {
  get: () => any
  set: (fn: any) => void
  /** Média perdu sans sortie voulue : le store décide (reconnexion ou sortie). */
  onMediaLost?: (why: MediaLoss) => void
}

export type MediaStatus = 'idle' | 'connecting' | 'connected' | 'reconnecting' | 'failed'

// ── État média local ─────────────────────────────────────────────────────────
let _localStream: MediaStream | null = null      // aperçu local : micro traité + caméra
let _rawMicTrack: MediaStreamTrack | null = null // piste brute de getUserMedia
let _micTrack: MediaStreamTrack | null = null    // piste micro réellement publiée
let _camTrack: MediaStreamTrack | null = null
let _screenVideoTrack: MediaStreamTrack | null = null
let _screenAudioTrack: MediaStreamTrack | null = null
let _micOpen = false

let _room: Room | null = null
let _roomName: string | null = null
let _micPub: LocalTrackPublication | null = null
let _micPublishing = false
let _camPub: LocalTrackPublication | null = null
let _screenPub: LocalTrackPublication | null = null
let _screenAudioPub: LocalTrackPublication | null = null
let _whisper: string[] | null = null
let _ctx: MeshCtx | null = null
/** Salle ouverte par le vocal natif Linux (pas d'objet Room côté JS). */
let _nativeRoom: string | null = null
/** Suivi de la clé de média du vocal natif (nouvelles époques du salon). */
let _stopNativeKeys: (() => void) | null = null
/** Connexion en attente de la clé du salon (compte pas encore déverrouillé, enveloppe attendue). */
let _keyWait: (() => void) | null = null

export const getLocalStream = () => _localStream
export const getRawMicTrack = () => _rawMicTrack
export const getMicTrack = () => _micTrack
export const getRoom = () => _room

declare global { interface Window { __fcRoom?: Room | null } }
const expose = () => { if (typeof window !== 'undefined') window.__fcRoom = _room }

// ── Config ICE (repli TURN/TLS du VPS quand l'UDP direct est filtré) ─────────
let _iceConfig: RTCConfiguration | null = null
let _iceExpiry = 0

export async function getIceConfig(): Promise<RTCConfiguration | undefined> {
  if (_iceConfig && Date.now() < _iceExpiry) return _iceConfig
  try {
    const res = await api.get('/voice/ice-config')
    _iceConfig = { iceServers: res.data.ice_servers }
    const ttl = typeof res.data.ttl === 'number' ? res.data.ttl : 3600
    _iceExpiry = Date.now() + Math.max(60, ttl - 60) * 1000
    return _iceConfig
  } catch (e) {
    warn('config ICE indisponible (serveurs STUN de LiveKit par défaut)', e)
    return undefined
  }
}

// ── Qualité d'émission ───────────────────────────────────────────────────────
export interface QualityPrefs {
  camMaxBitrate: number
  camFps: number
  screenMaxBitrate: number
  screenFps: number
  screenContentHint: 'motion' | 'detail'
}

export function getQualityPrefs(): QualityPrefs {
  const num = (k: string, d: number) => {
    const v = Number(localStorage.getItem(k) ?? d)
    return Number.isFinite(v) && v > 0 ? v : d
  }
  const hint = localStorage.getItem('fc_screen_hint') === 'detail' ? 'detail' : 'motion'
  return {
    camMaxBitrate: num('fc_cam_bitrate', 1_200_000),
    camFps: num('fc_cam_fps', 30),
    screenMaxBitrate: num('fc_screen_bitrate', 4_000_000),
    screenFps: num('fc_screen_fps', 30),
    screenContentHint: hint,
  }
}

async function publishCamera(room: Room, track: MediaStreamTrack) {
  const q = getQualityPrefs()
  _camPub = await room.localParticipant.publishTrack(track, {
    source: Track.Source.Camera,
    simulcast: true,
    videoEncoding: { maxBitrate: q.camMaxBitrate, maxFramerate: q.camFps },
  })
  // Chuchotement en cours : la nouvelle piste doit rester visible des autres.
  applyWhisper()
}

async function publishScreen(room: Room) {
  if (!_screenVideoTrack) return
  const q = getQualityPrefs()
  _screenVideoTrack.contentHint = q.screenContentHint
  _screenPub = await room.localParticipant.publishTrack(_screenVideoTrack, {
    source: Track.Source.ScreenShare,
    // Un stream se regarde en plein écran : pas de couches dégradées à l'envoi,
    // le SFU régule par abonné (dynacast) sans toucher à la netteté du texte.
    simulcast: false,
    videoEncoding: { maxBitrate: q.screenMaxBitrate, maxFramerate: q.screenFps },
    degradationPreference: q.screenContentHint === 'detail' ? 'maintain-resolution' : 'maintain-framerate',
  })
  if (_screenAudioTrack) {
    // Son de jeu ou de vidéo : stéréo haute qualité, sans DTX (qui coupe les silences
    // et hache la musique) ni traitement de la voix.
    _screenAudioPub = await room.localParticipant.publishTrack(_screenAudioTrack, {
      source: Track.Source.ScreenShareAudio,
      audioPreset: AudioPresets.musicHighQualityStereo,
      dtx: false,
      red: false,
      forceStereo: true,
    })
  }
  applyWhisper()
}

export async function refreshAllSenderQuality() {
  const q = getQualityPrefs()
  const apply = async (pub: LocalTrackPublication | null, bitrate: number, fps: number) => {
    const sender = pub?.track?.sender
    if (!sender) return
    try {
      const params = sender.getParameters()
      if (!params.encodings?.length) return
      // Couche la plus haute seulement : les couches simulcast basses gardent
      // leurs plafonds, calculés par le SDK.
      const top = params.encodings[params.encodings.length - 1]
      top.maxBitrate = bitrate
      top.maxFramerate = fps
      await sender.setParameters(params)
    } catch (e) { warn('réglage qualité', e) }
  }
  // Résolution, images/s et type de contenu des captures en cours : seuls les
  // débits suivaient, le reste attendait le prochain partage.
  const fit = (t: MediaStreamTrack | null, key: string, def: number, fps: number) => {
    const h = Number(localStorage.getItem(key) ?? def) || def
    t?.applyConstraints({ width: { ideal: Math.round((h * 16) / 9) }, height: { ideal: h }, frameRate: { ideal: fps } })
      .catch(e => warn('contraintes vidéo', e))
  }
  fit(_camTrack, 'fc_cam_height', 720, q.camFps)
  _screenVideoTrack?.applyConstraints(screenCaptureConstraints(localStorage.getItem('fc_screen_height'), q.screenFps))
    .catch(e => warn('contraintes vidéo', e))
  if (_screenVideoTrack) _screenVideoTrack.contentHint = q.screenContentHint
  await apply(_camPub, q.camMaxBitrate, q.camFps)
  await apply(_screenPub, q.screenMaxBitrate, q.screenFps)
}

// ── Pairs (présence WebSocket) ↔ média (LiveKit) ─────────────────────────────
function patchPeer(userId: string, patch: Partial<VoicePeer>) {
  _ctx?.set((s: any) => ({ peers: s.peers.map((p: VoicePeer) => p.userId === userId ? { ...p, ...patch } : p) }))
}

/** Reconstruit les deux flux d'un pair à partir de ses pistes abonnées. */
function rebuildPeer(p: RemoteParticipant) {
  const cam: MediaStreamTrack[] = []
  const scr: MediaStreamTrack[] = []
  p.trackPublications.forEach((pub: RemoteTrackPublication) => {
    const mst = pub.isSubscribed ? pub.track?.mediaStreamTrack : undefined
    if (!mst || mst.readyState === 'ended') return
    if (pub.source === Track.Source.ScreenShare || pub.source === Track.Source.ScreenShareAudio) scr.push(mst)
    else cam.push(mst)
  })
  const deafened = _ctx?.get().deafened === true
  for (const t of [...cam, ...scr]) if (t.kind === 'audio') t.enabled = !deafened
  const hasScreenVideo = scr.some(t => t.kind === 'video')
  patchPeer(p.identity, {
    stream: cam.length ? new MediaStream(cam) : null,
    screenStream: hasScreenVideo ? new MediaStream(scr) : null,
    connectionLost: false,
  })
}

/** Ajoute (ou met à jour) un pair annoncé par le serveur ForgeChat. */
export function addPeer(userId: string, info: Partial<VoicePeer>, ctx: MeshCtx) {
  _ctx = ctx
  ctx.set((s: any) => ({
    peers: s.peers.some((p: VoicePeer) => p.userId === userId)
      ? s.peers.map((p: VoicePeer) => p.userId === userId ? { ...p, ...info } : p)
      : [...s.peers, {
          userId,
          username: info.username ?? userId,
          avatar: info.avatar,
          discriminator: info.discriminator,
          stream: null,
          screenStream: null,
          muted: info.muted ?? false,
          deafened: false,
          videoEnabled: info.videoEnabled ?? false,
          screenSharing: info.screenSharing ?? false,
          recording: info.recording ?? false,
          noRecord: info.noRecord ?? false,
          connectionLost: false,
        }],
  }))
  const known = _nativeUrls.get(userId)
  if (known) patchPeer(userId, known)
  const rp = _room?.remoteParticipants.get(userId)
  if (rp) rebuildPeer(rp)
  applyWhisper()
}

// ── Stream à la demande ──────────────────────────────────────────────────────
// Un partage d'écran n'est téléchargé que si on le regarde (comme Discord) :
// un spectateur passif ne consomme plus 4 Mb/s par stream affiché nulle part.
const WATCH_KEY = 'fc_auto_watch'
const _watched = new Set<string>()

export function getAutoWatch(): boolean {
  return localStorage.getItem(WATCH_KEY) !== 'false'
}

export function setAutoWatch(on: boolean) {
  try { localStorage.setItem(WATCH_KEY, on ? 'true' : 'false') } catch { /* mode privé */ }
  // Sans ça, le réglage ne valait que pour les partages commencés ensuite.
  resubscribeAll()
}

const isScreenSource = (s: Track.Source) => s === Track.Source.ScreenShare || s === Track.Source.ScreenShareAudio

/** Décide de l'abonnement d'une piste distante (« Désactiver la vidéo » : ni caméra ni partage). */
function applySubscription(pub: RemoteTrackPublication, identity: string, force = false) {
  const videoOff = pub.source !== Track.Source.Microphone && hasUxPref('videoOff', identity)
  const want = !videoOff && (!isScreenSource(pub.source) || getAutoWatch() || _watched.has(identity))
  if (force || pub.isSubscribed !== want) pub.setSubscribed(want)
}

/**
 * Réapplique l'abonnement de toutes les pistes distantes (lecture auto, sourdine
 * imposée levée). Envoyé même si l'état local semble bon : le SFU a pu retirer
 * l'abonnement de son côté (droit d'écoute retiré puis rendu).
 */
export function resubscribeAll() {
  _room?.remoteParticipants.forEach(p => p.trackPublications.forEach(pub => applySubscription(pub, p.identity, true)))
}

/** Regarder (ou arrêter de regarder) le partage d'écran d'un participant. */
export function watchStream(userId: string, on: boolean) {
  if (on) _watched.add(userId)
  else _watched.delete(userId)
  const p = _room?.remoteParticipants.get(userId)
  p?.trackPublications.forEach(pub => {
    if (isScreenSource(pub.source)) pub.setSubscribed(on && !hasUxPref('videoOff', userId))
  })
  _ctx?.set((s: any) => ({ watchedStreams: [..._watched] }))
}

export function removePeer(userId: string, ctx: MeshCtx) {
  ctx.set((s: any) => ({ peers: s.peers.filter((p: VoicePeer) => p.userId !== userId) }))
}

// ── Connexion au SFU ─────────────────────────────────────────────────────────
export function isConnectedTo(room: string) {
  if (_nativeRoom !== null) return _nativeRoom === room
  return _room !== null && _roomName === room && _room.state !== 'disconnected'
}

// ── Vocal natif (application Linux) ──────────────────────────────────────────
// URL connues par personne : une piste peut arriver avant l'annonce du pair par le serveur.
const _nativeUrls = new Map<string, { videoUrl?: string | null; screenUrl?: string | null }>()

function onNativeTrack(e: NativeTrackEvent) {
  const cur = _nativeUrls.get(e.identity) ?? {}
  if (e.source === 'camera') cur.videoUrl = e.active ? e.url : null
  else if (e.source === 'screen') cur.screenUrl = e.active ? e.url : null
  else return
  _nativeUrls.set(e.identity, cur)
  patchPeer(e.identity, e.source === 'screen' ? { screenUrl: cur.screenUrl, screenSharing: e.active } : { videoUrl: cur.videoUrl })
}

function onNativeState(e: NativeStateEvent, ctx: MeshCtx) {
  if (e.status === 'disconnected') {
    if (_nativeRoom === null) return
    // Salle oubliée : sans ça, isConnectedTo() la croyait toujours ouverte et
    // aucune reconnexion n'était jamais tentée.
    _nativeRoom = null
    _nativeUrls.clear()
    if (!ctx.get().joined) return
    ctx.set({ mediaStatus: 'failed' })
    if (e.reason === 'ClientInitiated') return
    ctx.onMediaLost?.(e.reason === 'DuplicateIdentity' ? 'duplicate' : e.reason === 'ParticipantRemoved' ? 'removed' : 'network')
    return
  }
  ctx.set({ mediaStatus: e.status === 'failed' ? 'failed' : e.status, ...(e.quality ? { mediaQuality: e.quality } : {}), ...(e.status === 'connected' ? { error: null } : {}) })
}

async function connectNative(url: string, token: string, roomName: string, ctx: MeshCtx, canSpeak: boolean, e2eeChannel: string | null) {
  const ice = (await getIceConfig())?.iceServers ?? []
  const s = ctx.get()
  // Salon chiffré : clé du salon donnée au SDK natif, jamais de connexion en clair.
  let keys: Awaited<ReturnType<typeof nativeMediaKey>> | null = null
  if (e2eeChannel) {
    try {
      keys = await nativeMediaKey('channel', e2eeChannel)
    } catch (e) {
      ctx.set({ mediaStatus: 'failed', error: t(mediaE2EEError(e)) })
      _keyWait = retryWhenKeyReady(e, 'channel', e2eeChannel, () => {
        _keyWait = null
        if (ctx.get().joined) void connectMedia(url, token, roomName, ctx, canSpeak, e2eeChannel)
      })
      if (!_keyWait) ctx.onMediaLost?.('network')
      return
    }
    if (!ctx.get().joined) { keys.stop(); return }
  }
  _nativeRoom = roomName
  try {
    _stopNativeKeys = keys?.stop ?? null
    // Sans droit de parole, le jeton refuse le micro : ne pas le demander, sinon
    // la connexion entière échouait et on ne pouvait même pas écouter.
    await nativeConnect('voice', url, token, ice, !s.listenOnly && canSpeak && !s.serverMuted && !s.serverDeafened, _micOpen, {
      onTrack: onNativeTrack,
      onSpeakers: ids => ctx.set({ nativeSpeakers: ids }),
      onState: e => onNativeState(e, ctx),
      onLocalEnded: source => { if (source === 'screen' && ctx.get().screenSharing) void ctx.get().stopScreenShare() },
      onEvicted: () => {
        _nativeRoom = null
        _nativeUrls.clear()
        ctx.onMediaLost?.('evicted')
      },
    }, keys?.first ?? null)
    report('connected', { native: true })
  } catch (e) {
    _nativeRoom = null
    report('connect_failed', { native: true, error: String(e) })
    ctx.set({ mediaStatus: 'failed', error: `Vocal indisponible : ${String(e)}` })
    ctx.onMediaLost?.('network')
  }
}

/** `e2eeChannel` : id du salon quand le serveur exige des médias chiffrés (clé du salon, §5). */
export async function connectMedia(url: string, token: string, roomName: string, ctx: MeshCtx, canSpeak = true, e2eeChannel: string | null = null) {
  _ctx = ctx
  if (isConnectedTo(roomName)) return
  await disconnectMedia()
  ctx.set({ e2ee: !!e2eeChannel, e2eeOutdated: [] })
  if (isNativeVoice()) return connectNative(url, token, roomName, ctx, canSpeak, e2eeChannel)

  if (typeof RTCPeerConnection === 'undefined') {
    ctx.set({ mediaStatus: 'failed', error: 'Ce moteur d\'affichage ne gère pas WebRTC : le vocal y est impossible. Utilisez la version web dans Chrome, Edge ou Firefox.' })
    return
  }

  // Salon chiffré : jamais de connexion en clair, même si la clé manque.
  let e2ee = null
  if (e2eeChannel) {
    try {
      e2ee = await openMediaE2EE('channel', e2eeChannel)
    } catch (e) {
      ctx.set({ mediaStatus: 'failed', error: t(mediaE2EEError(e)) })
      _keyWait = retryWhenKeyReady(e, 'channel', e2eeChannel, () => {
        _keyWait = null
        if (ctx.get().joined) void connectMedia(url, token, roomName, ctx, canSpeak, e2eeChannel)
      })
      return
    }
    if (_room || !ctx.get().joined) { e2ee.stop(); return }
  }

  const room = new Room({
    ...(e2ee ? { encryption: e2ee.encryption } : {}),
    // Les flux sont lus par nos propres <video>/<audio> (volumes, sortie, PiP,
    // fenêtres détachées) : pas de suivi de visibilité par le SDK.
    adaptiveStream: false,
    // Le SFU coupe les couches que personne ne regarde : économie d'upload.
    dynacast: true,
    disconnectOnPageLeave: true,
    stopLocalTrackOnUnpublish: false,
    publishDefaults: { dtx: true, red: true, videoCodec: 'vp8' },
  })
  _room = room
  _roomName = roomName
  expose()
  ctx.set({ mediaStatus: 'connecting' })
  if (e2ee) {
    await enableMediaE2EE(room, e2ee)
    watchOutdated(room, ids => ctx.set({ e2eeOutdated: ids }))
  }

  room
    .on(RoomEvent.TrackPublished, (pub, p) => {
      applySubscription(pub, p.identity)
      if (pub.source === Track.Source.ScreenShare) patchPeer(p.identity, { screenSharing: true })
    })
    // Le SFU fait foi : si le partage s'arrête sans que l'état ForgeChat suive
    // (onglet fermé, bouton « Arrêter le partage » du navigateur, coupure), la
    // tuile restait affichée en noir chez les autres.
    .on(RoomEvent.TrackUnpublished, (pub, p) => {
      if (pub.source === Track.Source.ScreenShare) patchPeer(p.identity, { screenSharing: false, screenStream: null })
      rebuildPeer(p)
    })
    .on(RoomEvent.TrackSubscribed, (_t, _pub, p) => rebuildPeer(p))
    .on(RoomEvent.TrackUnsubscribed, (_t, _pub, p) => rebuildPeer(p))
    .on(RoomEvent.TrackMuted, (_pub, p) => { if (p !== room.localParticipant) rebuildPeer(p as RemoteParticipant) })
    .on(RoomEvent.TrackUnmuted, (_pub, p) => { if (p !== room.localParticipant) rebuildPeer(p as RemoteParticipant) })
    .on(RoomEvent.ParticipantConnected, (p) => { rebuildPeer(p); applyWhisper() })
    .on(RoomEvent.ParticipantDisconnected, (p) => patchPeer(p.identity, { stream: null, screenStream: null, connectionLost: true }))
    // Qui parle selon le SFU (indicateurs en sourdine, AFK).
    .on(RoomEvent.ActiveSpeakersChanged, (speakers) => ctx.set({ sfuSpeakers: speakers.map(p => p.identity) }))
    .on(RoomEvent.Reconnecting, () => { ctx.set({ mediaStatus: 'reconnecting' }); report('reconnecting') })
    .on(RoomEvent.Reconnected, () => { ctx.set({ mediaStatus: 'connected', error: null }); report('reconnected') })
    .on(RoomEvent.ConnectionQualityChanged, (q, p) => {
      if (p === room.localParticipant) ctx.set({ mediaQuality: q })
      // Remis à false au retour : le pair restait marqué « connexion perdue ».
      else patchPeer(p.identity, { connectionLost: q === ConnectionQuality.Lost })
    })
    .on(RoomEvent.Disconnected, (reason) => {
      if (_room !== room) return
      report('disconnected', { reason: reason !== undefined ? DisconnectReason[reason] : 'unknown' })
      // Déconnexion voulue (sortie) : l'état du store est géré par leave().
      if (reason === DisconnectReason.CLIENT_INITIATED || !ctx.get().joined) return
      _room = null; _roomName = null; expose()
      ctx.set({ mediaStatus: 'failed' })
      ctx.onMediaLost?.(
        reason === DisconnectReason.DUPLICATE_IDENTITY ? 'duplicate'
          : reason === DisconnectReason.PARTICIPANT_REMOVED ? 'removed'
          : 'network',
      )
    })

  try {
    await room.connect(url, token, { autoSubscribe: false, rtcConfig: await getIceConfig() })
  } catch (e) {
    warn('connexion au serveur média', e)
    report('connect_failed', { error: String(e) })
    if (_room === room) {
      _room = null; _roomName = null; expose()
      ctx.set({ mediaStatus: 'failed', error: 'Impossible de joindre le serveur audio/vidéo. Vérifiez votre connexion puis réessayez.' })
      ctx.onMediaLost?.('network')
    }
    return
  }
  if (_room !== room) return // quitté pendant la connexion

  ctx.set({ mediaStatus: 'connected', error: null })
  report('connected')
  room.remoteParticipants.forEach(p => {
    p.trackPublications.forEach(pub => applySubscription(pub, p.identity))
    rebuildPeer(p)
  })

  // Une piste par essai : muet imposé, le jeton refuse le micro, et la caméra
  // n'était alors jamais publiée. Le micro suivra à la levée (applyMicEnabled).
  try {
    await publishMic(room)
  } catch (e) { warn('publication du micro', e) }
  try {
    if (_camTrack) await publishCamera(room, _camTrack)
  } catch (e) {
    warn('publication de la caméra', e)
    ctx.set({ error: 'Votre caméra n\'a pas pu être diffusée. Vérifiez les permissions du salon.' })
  }
  try {
    await publishScreen(room)
  } catch (e) {
    warn('publication du partage', e)
    ctx.set({ error: 'Votre partage d\'écran n\'a pas pu être diffusé. Vérifiez les permissions du salon.' })
  }
  applyWhisper()
}

async function publishMic(room: Room) {
  if (!_micTrack || _micPub || _micPublishing) return
  _micPublishing = true
  try {
    _micPub = await room.localParticipant.publishTrack(_micTrack, { source: Track.Source.Microphone, forceStereo: false })
    if (!_micOpen) await _micPub.mute()
    applyWhisper()
  } finally {
    _micPublishing = false
  }
}

export async function disconnectMedia() {
  _keyWait?.()
  _keyWait = null
  _stopNativeKeys?.()
  _stopNativeKeys = null
  if (_nativeRoom !== null) {
    _nativeRoom = null
    _nativeUrls.clear()
    await nativeDisconnect('voice')
  }
  const room = _room
  _room = null
  _roomName = null
  _micPub = _camPub = _screenPub = _screenAudioPub = null
  _watched.clear()
  expose()
  if (room) await room.disconnect(true).catch(e => warn('déconnexion SFU', e))
  _ctx?.set({ mediaStatus: 'idle', mediaQuality: null })
}

// ── Pistes locales ───────────────────────────────────────────────────────────
function rebuildLocal() {
  const tracks = [_micTrack, _camTrack].filter((t): t is MediaStreamTrack => !!t)
  _localStream = tracks.length ? new MediaStream(tracks) : null
}

export function setLocalStream(outgoing: MediaStream | null, raw: MediaStreamTrack | null) {
  _rawMicTrack = raw
  _micTrack = outgoing?.getAudioTracks()[0] ?? null
  _camTrack = outgoing?.getVideoTracks()[0] ?? null
  rebuildLocal()
}

export async function applyMicEnabled(open: boolean) {
  _micOpen = open
  if (_nativeRoom !== null) {
    await nativeSetMic(open).catch(e => warn('micro natif', e))
    return
  }
  // Coupure au niveau de la piste : effective même avant la publication.
  if (_micTrack) _micTrack.enabled = open
  try {
    if (_micPub) await (open ? _micPub.unmute() : _micPub.mute())
    // Micro jamais publié (muet imposé à l'arrivée) : publié à la première ouverture.
    else if (open && _room?.state === 'connected') await publishMic(_room)
  } catch (e) { warn('micro', e) }
}

export async function replaceMicTrack(track: MediaStreamTrack, open: boolean) {
  _micTrack = track
  rebuildLocal()
  if (_micPub?.track) {
    await _micPub.track.replaceTrack(track, { userProvidedTrack: true }).catch(e => warn('remplacement micro', e))
  }
  // Sans publication, applyMicEnabled publie la nouvelle piste si le micro est ouvert.
  await applyMicEnabled(open)
}

export async function addCameraTrack(raw: MediaStreamTrack) {
  const track = await maybeBlur(raw)
  const old = _camTrack
  _camTrack = track
  rebuildLocal()
  if (_camPub?.track) await _camPub.track.replaceTrack(track, { userProvidedTrack: true })
  else if (_room?.state === 'connected') await publishCamera(_room, track)
  if (old && old !== track) old.stop()
}

export async function removeCameraTrack() {
  const t = _camTrack
  _camTrack = null
  rebuildLocal()
  if (_camPub?.track && _room) await _room.localParticipant.unpublishTrack(_camPub.track, false).catch(e => warn('caméra', e))
  _camPub = null
  t?.stop()
}

export async function startScreenTracks(video: MediaStreamTrack, audio: MediaStreamTrack | null) {
  await stopScreenTracks()
  _screenVideoTrack = video
  _screenAudioTrack = audio
  if (_room?.state === 'connected') await publishScreen(_room)
}

/** Ce que le partage d'écran diffuse vraiment (encodeur) ; null hors SFU ou avant les premières images. */
export async function getScreenSendStats(): Promise<{ width?: number; height?: number; frameRate?: number } | null> {
  const sender = _screenPub?.track?.sender
  if (!sender) return null
  try {
    let out: { width?: number; height?: number; frameRate?: number } | null = null
    ;(await sender.getStats()).forEach((r: { type: string; frameWidth?: number; frameHeight?: number; framesPerSecond?: number }) => {
      if (r.type === 'outbound-rtp' && r.frameHeight) out = { width: r.frameWidth, height: r.frameHeight, frameRate: r.framesPerSecond }
    })
    return out
  } catch { return null }
}

/** Son du partage en cours (null : rien de capté, par exemple une fenêtre). */
export const getScreenAudioTrack = () => _screenAudioTrack

export async function stopScreenTracks() {
  const room = _room
  for (const pub of [_screenPub, _screenAudioPub]) {
    if (pub?.track && room) await room.localParticipant.unpublishTrack(pub.track, false).catch(e => warn('fin du partage', e))
  }
  _screenPub = _screenAudioPub = null
  _screenVideoTrack?.stop()
  _screenAudioTrack?.stop()
  _screenVideoTrack = _screenAudioTrack = null
}

export function clearLocalMedia() {
  _localStream = null
  _rawMicTrack = _micTrack = _camTrack = null
  _micOpen = false
  _whisper = null
}

// ── Chuchotement : seuls les destinataires reçoivent le micro ────────────────
export function setWhisper(targets: string[] | null) {
  _whisper = targets
  applyWhisper()
}

function applyWhisper() {
  const room = _room
  if (!room || room.state !== 'connected') return
  if (!_whisper) {
    room.localParticipant.setTrackSubscriptionPermissions(true)
    return
  }
  // Les autres gardent la caméra et le partage, pas le micro.
  const visible = [_camPub, _screenPub, _screenAudioPub].map(p => p?.trackSid).filter((s): s is string => !!s)
  const perms: ParticipantTrackPermission[] = [...room.remoteParticipants.values()].map(p =>
    _whisper!.includes(p.identity)
      ? { participantIdentity: p.identity, allowAll: true }
      : { participantIdentity: p.identity, allowAll: false, allowedTrackSids: visible },
  )
  room.localParticipant.setTrackSubscriptionPermissions(false, perms)
}

// ── Télémétrie : les pannes aussi, pas seulement les appels réussis ──────────
function report(event: string, extra: Record<string, unknown> = {}) {
  api.post('/voice/telemetry', {
    event,
    room: _roomName,
    quality: _room?.localParticipant.connectionQuality ?? null,
    participants: _room ? _room.remoteParticipants.size + 1 : 0,
    at: Date.now(),
    ...extra,
  }).catch(() => {})
}
