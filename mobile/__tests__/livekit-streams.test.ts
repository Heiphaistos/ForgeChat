jest.mock('@livekit/react-native', () => ({
  AndroidAudioTypePresets: { communication: {} },
  AudioSession: {},
  registerGlobals: jest.fn(),
}))
jest.mock('react-native-incall-manager', () => ({}))
jest.mock('@livekit/react-native-webrtc', () => ({}))

import { streamOf } from '@/services/livekit'

/**
 * Flux des vidéos : celui que LiveKit tient pour la piste, jamais une copie relâchée par l'app
 * (relâcher un flux dont LiveKit a déjà disposé la piste faisait planter l'app Android).
 */
describe('streamOf', () => {
  const release = jest.fn()
  const track = (readyState: string, mediaStream: unknown = { release }) =>
    ({ mediaStreamTrack: { readyState }, mediaStream }) as never

  it('renvoie le flux de LiveKit tel quel, sans en créer ni en relâcher', () => {
    const t = track('live')
    expect(streamOf(t)).toBe((t as { mediaStream: unknown }).mediaStream)
    expect(streamOf(t)).toBe(streamOf(t))
    // Piste terminée : plus de vidéo, et toujours aucune libération faite par l'app.
    expect(streamOf(track('ended'))).toBeNull()
    expect(streamOf(track('live', null))).toBeNull()
    expect(streamOf(null)).toBeNull()
    expect(release).not.toHaveBeenCalled()
  })
})
