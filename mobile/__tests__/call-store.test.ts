import type { RealtimeEvent } from '@/lib/realtime'
import type { MediaStream } from 'react-native-webrtc'

/**
 * Course entre le setup asynchrone d'un appel (attente micro/ICE servers) et sa
 * fin (raccroché distant, hangup local, timeout) — cf. stores/call.ts.
 */

// ── Mocks ──────────────────────────────────────────────────────────────────

class MockPeerConnection {
  connectionState = 'new'
  signalingState = 'stable'
  remoteDescription: unknown = null
  private listeners = new Map<string, (e: unknown) => void>()
  addEventListener(type: string, fn: (e: unknown) => void) {
    this.listeners.set(type, fn)
  }
  removeEventListener(type: string) {
    this.listeners.delete(type)
  }
  emit(type: string, payload: unknown) {
    this.listeners.get(type)?.(payload)
  }
  addTrack() {
    /* no-op */
  }
  async createOffer() {
    return { type: 'offer', sdp: 'offer-sdp' }
  }
  async createAnswer() {
    return { type: 'answer', sdp: 'answer-sdp' }
  }
  async setLocalDescription() {
    /* no-op */
  }
  async setRemoteDescription() {
    /* no-op */
  }
  async addIceCandidate() {
    /* no-op */
  }
  restartIce() {
    /* no-op */
  }
  close() {
    this.connectionState = 'closed'
  }
}

let mockLastPeer: MockPeerConnection | null = null

jest.mock('react-native-webrtc', () => ({
  RTCPeerConnection: jest.fn().mockImplementation(() => {
    mockLastPeer = new MockPeerConnection()
    return mockLastPeer
  }),
  RTCSessionDescription: jest.fn().mockImplementation((init: unknown) => init),
  RTCIceCandidate: jest.fn().mockImplementation((init: unknown) => init),
}))

const mockGetLocalMedia = jest.fn()
const mockStopStream = jest.fn()
const mockAudioSession = {
  start: jest.fn(),
  stop: jest.fn(),
  setSpeaker: jest.fn(),
  startRinging: jest.fn(),
  stopRinging: jest.fn(),
  startRingback: jest.fn(),
  stopRingback: jest.fn(),
}
jest.mock('@/services/media', () => ({
  getLocalMedia: (...args: unknown[]) => mockGetLocalMedia(...args),
  stopStream: (...args: unknown[]) => mockStopStream(...args),
  audioSession: mockAudioSession,
}))

jest.mock('@/api/voice', () => ({
  voiceApi: { iceServers: jest.fn().mockResolvedValue([]) },
}))

jest.mock('@/stores/voice', () => ({
  useVoice: { getState: () => ({ channelId: null }) },
}))

jest.mock('@/stores/auth', () => ({
  registerSignOutHook: jest.fn(),
}))

jest.mock('@/lib/logger', () => ({
  logger: { warn: jest.fn(), debug: jest.fn(), error: jest.fn() },
}))

const mockRealtimeHandlers = new Map<string, (e: RealtimeEvent) => void>()
const mockRealtimeSend = jest.fn()
jest.mock('@/lib/realtime', () => ({
  realtime: {
    isOpen: true,
    on: (type: string, handler: (e: RealtimeEvent) => void) => {
      mockRealtimeHandlers.set(type, handler)
      return () => mockRealtimeHandlers.delete(type)
    },
    send: (...args: unknown[]) => mockRealtimeSend(...args),
  },
}))

// ── Aides ──────────────────────────────────────────────────────────────────

const fire = (type: string, event: Partial<RealtimeEvent> = {}) => {
  mockRealtimeHandlers.get(type)?.({ type, ...event })
}

function deferredMedia() {
  let resolve!: (v: { stream: MediaStream; hasVideo: boolean }) => void
  const promise = new Promise<{ stream: MediaStream; hasVideo: boolean }>((res) => {
    resolve = res
  })
  return { promise, resolve }
}

const fakeStream = () =>
  ({
    getTracks: () => [],
    getAudioTracks: () => [],
    getVideoTracks: () => [],
  }) as unknown as MediaStream

/** Laisse le micro-task queue se vider (les timers restent faux si fake timers actifs). */
const flush = async () => {
  for (let i = 0; i < 5; i++) await Promise.resolve()
}

const DM_ID = '11111111-1111-1111-1111-111111111111'
const PARTNER_ID = '22222222-2222-2222-2222-222222222222'

describe('stores/call — course entre setup asynchrone et fin d’appel', () => {
  let useCall: typeof import('@/stores/call').useCall

  beforeEach(() => {
    jest.resetModules()
    mockRealtimeHandlers.clear()
    mockRealtimeSend.mockClear()
    mockGetLocalMedia.mockReset()
    mockStopStream.mockClear()
    Object.values(mockAudioSession).forEach((fn) => fn.mockClear())
    mockLastPeer = null
    // require() plutôt qu'un import dynamique : jest ne l'exécute pas sous
    // --experimental-vm-modules dans cette config babel-jest/CommonJS.
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    ;({ useCall } = require('@/stores/call'))
  })

  afterEach(() => {
    jest.useRealTimers()
  })

  it('un raccroché distant pendant accept() annule la reprise (pas de DM_CALL_ACCEPT, retour à idle)', async () => {
    fire('DM_CALL_INCOMING', { from: PARTNER_ID, dm_id: DM_ID, from_username: 'Bob', call_type: 'voice' })
    expect(useCall.getState().incoming).not.toBeNull()

    const media = deferredMedia()
    mockGetLocalMedia.mockReturnValueOnce(media.promise)

    const acceptPromise = useCall.getState().accept()
    await flush()
    // La phase doit déjà refléter la tentative de connexion AVANT que le micro ne
    // soit obtenu : c'est ce qui permet à DM_CALL_ENDED ci-dessous d'être pris en
    // compte (phase !== 'idle') au lieu d'être silencieusement ignoré.
    expect(useCall.getState().phase).toBe('connecting')

    fire('DM_CALL_ENDED', { dm_id: DM_ID })
    expect(useCall.getState().phase).toBe('idle')

    media.resolve({ stream: fakeStream(), hasVideo: false })
    await acceptPromise
    await flush()

    expect(mockRealtimeSend).not.toHaveBeenCalledWith(expect.objectContaining({ type: 'DM_CALL_ACCEPT' }))
    expect(mockRealtimeSend).not.toHaveBeenCalledWith(expect.objectContaining({ type: 'DM_CALL_DECLINE' }))
    expect(useCall.getState().phase).toBe('idle')
    expect(mockStopStream).toHaveBeenCalled()
  })

  it('hangup() local pendant start() annule l’appel sortant sans envoyer DM_CALL_INIT', async () => {
    const media = deferredMedia()
    mockGetLocalMedia.mockReturnValueOnce(media.promise)

    const startPromise = useCall.getState().start(DM_ID, PARTNER_ID, 'Bob', 'voice')
    await flush()
    expect(useCall.getState().phase).toBe('calling')

    useCall.getState().hangup()
    expect(useCall.getState().phase).toBe('idle')

    media.resolve({ stream: fakeStream(), hasVideo: false })
    await startPromise
    await flush()

    expect(mockRealtimeSend).not.toHaveBeenCalledWith(expect.objectContaining({ type: 'DM_CALL_INIT' }))
    expect(useCall.getState().phase).toBe('idle')
    expect(mockStopStream).toHaveBeenCalled()
  })

  it('raccroche après 30 s si la connexion n’aboutit jamais (timeout de connexion)', async () => {
    jest.useFakeTimers()
    mockGetLocalMedia.mockResolvedValue({ stream: fakeStream(), hasVideo: false })

    await useCall.getState().start(DM_ID, PARTNER_ID, 'Bob', 'voice')
    expect(useCall.getState().phase).toBe('calling')

    fire('DM_CALL_ACCEPTED', { dm_id: DM_ID })
    await flush()
    expect(useCall.getState().phase).toBe('connecting')

    jest.advanceTimersByTime(30_000)
    await flush()

    expect(useCall.getState().phase).toBe('idle')
    expect(useCall.getState().endReason).toBe('Connexion impossible')
    expect(mockRealtimeSend).toHaveBeenCalledWith(expect.objectContaining({ type: 'DM_CALL_HANGUP' }))
  })
})
