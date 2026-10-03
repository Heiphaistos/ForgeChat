import { AndroidAudioTypePresets, AudioSession, registerGlobals } from '@livekit/react-native'
import { MediaStream } from '@livekit/react-native-webrtc'
import { Track, type Room } from 'livekit-client'
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

/** Flux affichable (RTCView) pour une piste LiveKit, ou null. */
export function streamOf(track: Track | null | undefined): MediaStream | null {
  const mst = track?.mediaStreamTrack
  if (!mst || mst.readyState === 'ended') return null
  return new MediaStream([mst as never])
}

/** Session audio d'appel : mode communication, sortie haut-parleur ou écouteur. */
export const callAudio = {
  async start(speaker: boolean) {
    try {
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
  },
  async stop() {
    await AudioSession.stopAudioSession().catch((e: unknown) => logger.warn('livekit', 'fin session audio', e))
  },
  async setSpeaker(on: boolean) {
    await AudioSession.selectAudioOutput(on ? 'speaker' : 'earpiece').catch((e: unknown) => logger.warn('livekit', 'sortie audio', e))
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
