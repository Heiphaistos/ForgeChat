import { AndroidAudioTypePresets, AudioSession, registerGlobals } from '@livekit/react-native'
import { MediaStream } from '@livekit/react-native-webrtc'
import { requireOptionalNativeModule } from 'expo'
import { Track, type Room } from 'livekit-client'
import { AppRegistry, Platform } from 'react-native'
import InCallManager from 'react-native-incall-manager'
import { APP_ENV, BUILD_LIVEKIT_HOST, apiHostname } from '@/config/env'
import { parseLiveKitAccess, type LiveKitAccess } from '@/config/livekitUrl'
import { logger } from '@/lib/logger'

/**
 * Média des appels et salons vocaux : SFU LiveKit, comme le client web (le serveur ForgeChat
 * ne relaie plus de signalisation pair-à-pair). Le serveur garde l'autorité : il ne délivre un
 * jeton LiveKit qu'après ses contrôles (membre, permissions, mot de passe, conversation commune).
 * L'identité LiveKit d'un participant est son id utilisateur ForgeChat.
 */

let ready = false
/** À appeler une fois au démarrage, avant tout usage de livekit-client. */
export function setupLiveKit() {
  if (ready) return
  registerGlobals()
  ready = true
}

/** Valide l'accès joint par le serveur (adresse LiveKit autorisée, jeton présent). */
export function liveKitAccess(v: unknown): { access: LiveKitAccess } | { error: string } {
  const r = parseLiveKitAccess(v, { appEnv: APP_ENV, apiHost: apiHostname(), pinnedHost: BUILD_LIVEKIT_HOST })
  if ('error' in r) logger.warn('livekit', 'accès refusé', r.error)
  return r
}

/** Un flux par piste : en recréer un à chaque événement faisait clignoter la vidéo et fuyait côté natif. */
const streams = new Map<string, MediaStream>()

/** Flux affichable (RTCView) pour une piste LiveKit, ou null. */
export function streamOf(track: Track | null | undefined): MediaStream | null {
  for (const [id, s] of streams) {
    if (s.getTracks().every((t) => t.readyState === 'ended')) {
      s.release(false) // la piste appartient à LiveKit : ne libérer que le flux
      streams.delete(id)
    }
  }
  const mst = track?.mediaStreamTrack
  if (!mst || mst.readyState === 'ended') return null
  let s = streams.get(mst.id)
  if (!s) {
    s = new MediaStream([mst as never])
    streams.set(mst.id, s)
  }
  return s
}

/** Service au premier plan Android (modules/call-service) : micro et caméra gardés en arrière-plan. */
/**
 * Résolution de capture caméra commune (appels, salons vocaux, appels de groupe) : 720p à 30 i/s,
 * comme le web. La diffusion multi-qualité (simulcast) de LiveKit baisse d'elle-même si le réseau ne suit pas.
 */
export const CAMERA_RESOLUTION = { width: 1280, height: 720, frameRate: 30 }

const callService = requireOptionalNativeModule<{ start(title: string): void; stop(): void }>('ForgeCallService')

/**
 * Tâche headless démarrée par le service d'appel Android : tant qu'elle tourne, React Native garde
 * les minuteurs JS actifs en arrière-plan (sinon setTimeout est suspendu et aucune reconnexion,
 * chat ou LiveKit, n'a lieu avant le retour au premier plan). Elle se termine avec l'appel.
 */
let finMaintien: (() => void) | null = null
if (Platform.OS === 'android') {
  AppRegistry.registerHeadlessTask('ForgeChatKeepAlive', () => () =>
    new Promise<void>((resolve) => {
      finMaintien?.()
      finMaintien = resolve
    }),
  )
}

/** Écran éteint contre la joue (verrou de proximité), seulement quand le son sort par l'écouteur. */
function proximity(on: boolean) {
  try {
    if (on) InCallManager.turnScreenOff()
    else InCallManager.turnScreenOn()
  } catch (e) {
    logger.debug('livekit', 'capteur de proximité', e)
  }
}

/** Démarrages et arrêts en file : un stop() non terminé ne doit pas couper la session suivante. */
let audioQueue: Promise<unknown> = Promise.resolve()
function serial(fn: () => Promise<void>): Promise<void> {
  const next = audioQueue.then(fn, fn)
  audioQueue = next.catch(() => undefined)
  return next
}

/**
 * Session audio d'appel, commune aux appels et aux salons vocaux : mode communication, sortie
 * haut-parleur ou écouteur (un casque ou un appareil Bluetooth passe toujours avant), écran
 * gardé allumé et service au premier plan (micro et caméra continuent en arrière-plan).
 */
export const callAudio = {
  start: (speaker: boolean, title = 'Appel en cours') => serial(async () => {
    try {
      callService?.start(title)
      InCallManager.setKeepScreenOn(true)
      await AudioSession.configureAudio({
        android: {
          preferredOutputList: speaker ? ['bluetooth', 'headset', 'speaker', 'earpiece'] : ['bluetooth', 'headset', 'earpiece', 'speaker'],
          audioTypeOptions: AndroidAudioTypePresets.communication,
        },
        ios: { defaultOutput: speaker ? 'speaker' : 'earpiece' },
      })
      await AudioSession.startAudioSession()
    } catch (e) {
      logger.warn('livekit', 'session audio', e)
    }
    proximity(!speaker)
  }),
  stop: () => serial(async () => {
    proximity(false)
    try {
      finMaintien?.()
      finMaintien = null
      callService?.stop()
      InCallManager.setKeepScreenOn(false)
    } catch (e) {
      logger.warn('livekit', 'fin du service d’appel', e)
    }
    for (const s of streams.values()) s.release(false)
    streams.clear()
    await AudioSession.stopAudioSession().catch((e: unknown) => logger.warn('livekit', 'fin session audio', e))
  }),
  async setSpeaker(on: boolean) {
    try {
      const outputs = await AudioSession.getAudioOutputs()
      const target = on ? 'speaker' : (['bluetooth', 'headset', 'earpiece'].find((o) => outputs.includes(o)) ?? 'earpiece')
      await AudioSession.selectAudioOutput(target)
      proximity(target === 'earpiece')
    } catch (e) {
      logger.warn('livekit', 'sortie audio', e)
    }
  },
}

/** Piste d'écran native : son service au premier plan (notification) ne s'arrête qu'à sa libération. */
function releaseScreenTrack(room: Room) {
  const mst = room.localParticipant.getTrackPublication(Track.Source.ScreenShare)?.track?.mediaStreamTrack as
    | { release?: () => void }
    | undefined
  return () => {
    try {
      mst?.release?.()
    } catch {
      /* déjà libérée */
    }
  }
}

/** Arrête le partage d'écran ET libère la capture (MediaProjection, service, notification). */
export async function stopScreenShare(room: Room) {
  const release = releaseScreenTrack(room)
  await room.localParticipant.setScreenShareEnabled(false).catch((e: unknown) => logger.warn('livekit', 'fin du partage', e))
  release()
}

/** Quitte la salle en libérant une éventuelle capture d'écran en cours. */
export async function leaveRoom(room: Room) {
  const release = releaseScreenTrack(room)
  await room.disconnect().catch(() => undefined)
  release()
}
