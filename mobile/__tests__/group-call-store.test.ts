import type { RealtimeEvent } from '@/lib/realtime'

/** Appels de groupe : sonnerie, arrêt de la sonnerie quand l'appel se vide, accès LiveKit par session. */

const mockRooms: unknown[] = []
jest.mock('livekit-client', () => {
  class Room {
    remoteParticipants = new Map()
    localParticipant = {
      setMicrophoneEnabled: jest.fn().mockResolvedValue(undefined),
      setCameraEnabled: jest.fn().mockResolvedValue(undefined),
      getTrackPublication: () => undefined,
    }
    connect = jest.fn().mockResolvedValue(undefined)
    disconnect = jest.fn().mockResolvedValue(undefined)
    constructor() {
      mockRooms.push(this)
    }
    on() {
      return this
    }
  }
  return { Room, RoomEvent: new Proxy({}, { get: (_t, k) => String(k) }), Track: { Source: { Camera: 'camera' } }, DisconnectReason: { CLIENT_INITIATED: 1 } }
})

const mockAccess = { url: 'wss://chat.example.org/livekit', token: 't'.repeat(40), room: 'gdm-x' }
jest.mock('@/services/livekit', () => ({
  liveKitAccess: () => ({ access: mockAccess }),
  leaveRoom: (r: { disconnect: () => Promise<void> }) => r.disconnect(),
  streamOf: () => null,
  callAudio: { start: jest.fn().mockResolvedValue(undefined), stop: jest.fn().mockResolvedValue(undefined), setSpeaker: jest.fn() },
}))
const mockRingtones = { startRinging: jest.fn(), stopRinging: jest.fn() }
jest.mock('@/services/media', () => ({ ensureMediaPermissions: jest.fn().mockResolvedValue(true), ringtones: mockRingtones }))
jest.mock('@/api/voice', () => ({ voiceApi: { turnServers: jest.fn().mockResolvedValue([]) } }))
jest.mock('@/stores/auth', () => ({ registerSignOutHook: jest.fn() }))
jest.mock('@/lib/logger', () => ({ logger: { warn: jest.fn(), debug: jest.fn(), error: jest.fn() } }))

const mockHandlers = new Map<string, (e: RealtimeEvent) => void>()
const mockSend = jest.fn()
jest.mock('@/lib/realtime', () => ({
  realtime: {
    isOpen: true,
    on: (type: string, h: (e: RealtimeEvent) => void) => {
      mockHandlers.set(type, h)
      return () => undefined
    },
    send: (...a: unknown[]) => mockSend(...a),
  },
}))

const fire = (type: string, e: Partial<RealtimeEvent> = {}) => mockHandlers.get(type)?.({ type, ...e })
const flush = async () => {
  for (let i = 0; i < 8; i++) await Promise.resolve()
}
const GROUP = '44444444-4444-4444-4444-444444444444'
const BOB = '22222222-2222-2222-2222-222222222222'

describe('stores/groupCall', () => {
  let useGroupCall: typeof import('@/stores/groupCall').useGroupCall

  beforeEach(() => {
    jest.resetModules()
    jest.useFakeTimers()
    mockHandlers.clear()
    mockSend.mockClear()
    mockRooms.length = 0
    Object.values(mockRingtones).forEach((f) => f.mockClear())
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    ;({ useGroupCall } = require('@/stores/groupCall'))
  })

  afterEach(() => {
    useGroupCall.getState().dismissRing()
    useGroupCall.getState().leave()
    jest.useRealTimers()
  })

  it('sonne à l’ouverture d’un appel, s’arrête quand l’appel se vide', () => {
    fire('GROUP_CALL_RING', { group_id: GROUP, from: BOB, from_username: 'Bob', call_type: 'video', ring_timeout_ms: 45_000 })
    expect(useGroupCall.getState().ring).toEqual({ groupId: GROUP, fromUsername: 'Bob', callType: 'video' })
    expect(mockRingtones.startRinging).toHaveBeenCalled()
    fire('GROUP_CALL_UPDATE', { group_id: GROUP, participants: [] })
    expect(useGroupCall.getState().ring).toBeNull()
    expect(mockRingtones.stopRinging).toHaveBeenCalled()
  })

  it('la sonnerie s’arrête seule après le délai du serveur', () => {
    fire('GROUP_CALL_RING', { group_id: GROUP, from_username: 'Bob', ring_timeout_ms: 10_000 })
    jest.advanceTimersByTime(10_000)
    expect(useGroupCall.getState().ring).toBeNull()
  })

  it('rejoindre : GROUP_CALL_JOIN, puis LiveKit avec l’accès de NOTRE session seulement', async () => {
    fire('SESSION_INIT', { session_id: 'moi' })
    await useGroupCall.getState().join(GROUP, 'voice', 'Amis')
    expect(mockSend).toHaveBeenCalledWith({ type: 'GROUP_CALL_JOIN', group_id: GROUP, call_type: 'voice' })
    fire('GROUP_CALL_MEDIA', { group_id: GROUP, session_id: 'autre', livekit: mockAccess })
    await flush()
    expect(mockRooms).toHaveLength(0)
    fire('GROUP_CALL_MEDIA', { group_id: GROUP, session_id: 'moi', livekit: mockAccess })
    await flush()
    expect(mockRooms).toHaveLength(1)
    expect(useGroupCall.getState().status).toBe('connected')
    useGroupCall.getState().leave()
    expect(mockSend).toHaveBeenCalledWith({ type: 'GROUP_CALL_LEAVE', group_id: GROUP })
    expect(useGroupCall.getState().groupId).toBeNull()
  })
})
