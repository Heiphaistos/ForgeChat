import { parseWaiting } from '@/stores/voiceExtras'
import { captureOptionsFor } from '@/services/voiceFx'

/** Réglages Voix et vidéo (options de capture) et file de la salle d'attente. */
jest.mock('@/lib/realtime', () => ({ realtime: { on: jest.fn(), onOpen: jest.fn(), send: jest.fn(), isOpen: false } }))
jest.mock('@/stores/voice', () => ({ useVoice: { getState: () => ({ joined: false }), subscribe: jest.fn() } }))
jest.mock('livekit-client', () => ({ RoomEvent: {}, Track: { Source: {} } }))

describe('voix et vidéo', () => {
  it('suppression de bruit : off garde l’annulation d’écho, standard et forte activent tout', () => {
    expect(captureOptionsFor('off')).toEqual({ echoCancellation: true, noiseSuppression: false, autoGainControl: false })
    expect(captureOptionsFor('standard')).toEqual({ echoCancellation: true, noiseSuppression: true, autoGainControl: true })
    expect(captureOptionsFor('strong')).toEqual(captureOptionsFor('standard'))
  })

  it('salle d’attente : entrées invalides écartées, 50 au plus, noms bornés', () => {
    expect(parseWaiting(null)).toEqual([])
    expect(parseWaiting([{ user_id: 'a', username: 'Alice' }, { user_id: 1 }, null, { username: 'x' }])).toEqual([{ userId: 'a', username: 'Alice' }])
    const many = Array.from({ length: 80 }, (_, i) => ({ user_id: `u${i}`, username: 'n'.repeat(100) }))
    const out = parseWaiting(many)
    expect(out).toHaveLength(50)
    expect(out[0]!.username).toHaveLength(64)
  })
})
