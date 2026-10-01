import type { MediaStream, MediaStreamTrack, RTCIceCandidate, RTCPeerConnection } from 'react-native-webrtc'

/**
 * Les typings publiés de react-native-webrtc référencent un « event-target-shim »
 * absent de lib/typescript : addEventListener n'est donc pas typé. Ce petit
 * adaptateur fournit une API d'événements typée et sûre.
 */
interface PeerEvents {
  icecandidate: { candidate: RTCIceCandidate | null }
  track: { streams: MediaStream[]; track: MediaStreamTrack | null }
  connectionstatechange: unknown
}

type Listenable = { addEventListener: (type: string, fn: (e: unknown) => void) => void }

/** Fin d'une piste (ex. capture d'écran arrêtée depuis la notification système). */
export function onTrackEnded(track: MediaStreamTrack, fn: () => void) {
  ;(track as unknown as Listenable).addEventListener('ended', fn)
}

export function onPeer<K extends keyof PeerEvents>(pc: RTCPeerConnection, type: K, fn: (e: PeerEvents[K]) => void) {
  ;(pc as unknown as Listenable).addEventListener(type, fn as (e: unknown) => void)
}
