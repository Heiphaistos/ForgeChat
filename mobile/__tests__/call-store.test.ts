import type { RealtimeEvent } from '@/lib/realtime'

/**
 * Store d'appel 1:1 (LiveKit) : protocole du serveur (DM_CALL_*, accès LiveKit) et courses entre
 * le setup asynchrone et la fin d'appel (raccroché distant, hangup local, timeout).
 */

// ── Mocks ──────────────────────────────────────────────────────────────────

const mockConnect = jest.fn()
const mockRooms: { connect: jest.Mock; disconnect: jest.Mock }[] = []
jest.mock('livekit-client', () => {
  class Room {
    remoteParticipants = new Map()
    state = 'connected'
    localParticipant = {
      setMicrophoneEnabled: jest.fn().mockResolvedValue(undefined),
      setCameraEnabled: jest.fn().mockResolvedValue(undefined),
      setScreenShareEnabled: jest.fn().mockResolvedValue(undefined),
      getTrackPublication: () => undefined,
    }
    connect = jest.fn((...a: unknown[]) => mockConnect(...a))
    disconnect = jest.fn().mockResolvedValue(undefined)
    constructor() {
      mockRooms.push(this)
    }
    on() {
      return this
    }
  }
  return {
    Room,
    RoomEvent: new Proxy({}, { get: (_t, k) => String(k) }),
    Track: { Source: { Camera: 'camera', ScreenShare: 'screen_share', Microphone: 'microphone' } },
    DisconnectReason: { CLIENT_INITIATED: 1 },
  }
})

const mockPermissions = jest.fn()
const mockRingtones = {
  startRinging: jest.fn(),
  stopRinging: jest.fn(),
  startRingback: jest.fn(),
  stopRingback: jest.fn(),
  keepScreenOn: jest.fn(),
}
jest.mock('@/services/media', () => ({
  ensureMediaPermissions: (...a: unknown[]) => mockPermissions(...a),
  ringtones: mockRingtones,
}))

const mockAccess = jest.fn()
jest.mock('@/services/livekit', () => ({
  liveKitAccess: (v: unknown) => mockAccess(v),
  leaveRoom: (r: { disconnect: () => Promise<void> }) => r.disconnect(),
  stopScreenShare: jest.fn().mockResolvedValue(undefined),
  streamOf: () => null,
  callAudio: { start: jest.fn().mockResolvedValue(undefined), stop: jest.fn().mockResolvedValue(undefined), setSpeaker: jest.fn() },
}))

jest.mock('@/api/voice', () => ({
  voiceApi: { turnServers: jest.fn().mockResolvedValue([]) },
}))

const mockVoice = { channelId: null as string | null, leave: jest.fn() }
jest.mock('@/stores/voice', () => ({
  useVoice: { getState: () => mockVoice },
}))

const mockGroupLeave = jest.fn()
jest.mock('@/stores/groupCall', () => ({
  useGroupCall: { getState: () => ({ leave: mockGroupLeave }) },
}))

let mockMyId = '33333333-3333-3333-3333-333333333333'
jest.mock('@/stores/auth', () => ({
  registerSignOutHook: jest.fn(),
  getMyId: () => mockMyId,
}))

jest.mock('@/lib/queryClient', () => ({
  qk: { conversations: ['conversations'] },
  queryClient: { getQueryData: () => [{ is_group: false, other_user_id: '22222222-2222-2222-2222-222222222222', avatar: '/uploads/bob.png' }] },
}))

jest.mock('@/lib/logger', () => ({
  logger: { warn: jest.fn(), debug: jest.fn(), error: jest.fn() },
}))

const mockRealtimeHandlers = new Map<string, (e: RealtimeEvent) => void>()
const mockOpenHandlers: (() => void)[] = []
const mockRealtimeSend = jest.fn()
jest.mock('@/lib/realtime', () => ({
  realtime: {
    isOpen: true,
    onOpen: (h: () => void) => {
      mockOpenHandlers.push(h)
      return () => undefined
    },
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

function deferred<T>() {
  let resolve!: (v: T) => void
  const promise = new Promise<T>((res) => {
    resolve = res
  })
  return { promise, resolve }
}

const flush = async () => {
  for (let i = 0; i < 8; i++) await Promise.resolve()
}

const DM_ID = '11111111-1111-1111-1111-111111111111'
const PARTNER_ID = '22222222-2222-2222-2222-222222222222'
const ACCESS = { url: 'wss://chat.example.org/livekit', token: 't'.repeat(40), room: 'dm' }

describe('stores/call (LiveKit)', () => {
  let useCall: typeof import('@/stores/call').useCall

  beforeEach(() => {
    jest.resetModules()
    mockRealtimeHandlers.clear()
    mockOpenHandlers.length = 0
    mockRealtimeSend.mockClear()
    mockVoice.channelId = null
    mockVoice.leave.mockClear()
    mockGroupLeave.mockClear()
    mockMyId = '33333333-3333-3333-3333-333333333333'
    mockPermissions.mockReset().mockResolvedValue(true)
    mockConnect.mockReset().mockResolvedValue(undefined)
    mockAccess.mockReset().mockImplementation((v: unknown) => (v ? { access: ACCESS } : { error: 'Serveur audio/vidéo indisponible.' }))
    mockRooms.length = 0
    Object.values(mockRingtones).forEach((fn) => fn.mockClear())
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    ;({ useCall } = require('@/stores/call'))
  })

  afterEach(() => {
    // Minuteurs de sonnerie / connexion annulés : Jest peut se terminer aussitôt.
    const s = useCall.getState()
    if (s.incoming) s.decline()
    s.hangup()
    jest.useRealTimers()
  })

  it('appelant : DM_CALL_INIT, puis connexion LiveKit avec l’accès joint à DM_CALL_ACCEPTED', async () => {
    await useCall.getState().start(DM_ID, PARTNER_ID, 'Bob', 'voice')
    expect(mockRealtimeSend).toHaveBeenCalledWith({ type: 'DM_CALL_INIT', to: PARTNER_ID, dm_id: DM_ID, call_type: 'voice' })
    expect(mockRooms).toHaveLength(0) // pas de média avant que l'autre décroche

    fire('DM_CALL_ACCEPTED', { dm_id: DM_ID, livekit: ACCESS })
    await flush()
    expect(useCall.getState().phase).toBe('connecting')
    expect(mockRooms).toHaveLength(1)
    expect(mockConnect).toHaveBeenCalledWith(ACCESS.url, ACCESS.token, { autoSubscribe: true })
  })

  it('appelé : DM_CALL_ACCEPT puis connexion seulement sur DM_CALL_MEDIA de SA session', async () => {
    fire('SESSION_INIT', { session_id: 'moi' })
    fire('DM_CALL_INCOMING', { from: PARTNER_ID, dm_id: DM_ID, from_username: 'Bob', call_type: 'voice' })
    await useCall.getState().accept()
    expect(mockRealtimeSend).toHaveBeenCalledWith({ type: 'DM_CALL_ACCEPT', to: PARTNER_ID, dm_id: DM_ID })

    fire('DM_CALL_MEDIA', { dm_id: DM_ID, session_id: 'autre-appareil', livekit: ACCESS })
    await flush()
    expect(mockRooms).toHaveLength(0)

    fire('DM_CALL_MEDIA', { dm_id: DM_ID, session_id: 'moi', livekit: ACCESS })
    await flush()
    expect(mockRooms).toHaveLength(1)
  })

  it('DM_CALL_TAKEN d’une autre session : la sonnerie s’arrête', () => {
    fire('SESSION_INIT', { session_id: 'moi' })
    fire('DM_CALL_INCOMING', { from: PARTNER_ID, dm_id: DM_ID, from_username: 'Bob', call_type: 'voice' })
    fire('DM_CALL_TAKEN', { dm_id: DM_ID, session_id: 'web' })
    expect(useCall.getState().incoming).toBeNull()
    expect(mockRingtones.stopRinging).toHaveBeenCalled()
  })

  it('accès LiveKit refusé : fin d’appel avec le motif, raccroché envoyé', async () => {
    await useCall.getState().start(DM_ID, PARTNER_ID, 'Bob', 'voice')
    mockAccess.mockReturnValueOnce({ error: 'Serveur audio/vidéo refusé : adresse inattendue.' })
    fire('DM_CALL_ACCEPTED', { dm_id: DM_ID, livekit: { url: 'wss://ailleurs.example.net', token: 'x'.repeat(40) } })
    await flush()
    expect(useCall.getState().phase).toBe('idle')
    expect(useCall.getState().endReason).toBe('Serveur audio/vidéo refusé : adresse inattendue.')
    expect(mockRealtimeSend).toHaveBeenCalledWith(expect.objectContaining({ type: 'DM_CALL_HANGUP' }))
    expect(mockRooms).toHaveLength(0)
  })

  it('un raccroché distant pendant accept() annule la reprise (pas de DM_CALL_ACCEPT, retour à idle)', async () => {
    fire('DM_CALL_INCOMING', { from: PARTNER_ID, dm_id: DM_ID, from_username: 'Bob', call_type: 'voice' })
    const perm = deferred<boolean>()
    mockPermissions.mockReturnValueOnce(perm.promise)

    const acceptPromise = useCall.getState().accept()
    await flush()
    // Phase posée AVANT l'attente : DM_CALL_ENDED ci-dessous est pris en compte.
    expect(useCall.getState().phase).toBe('connecting')

    fire('DM_CALL_ENDED', { dm_id: DM_ID })
    expect(useCall.getState().phase).toBe('idle')

    perm.resolve(true)
    await acceptPromise
    await flush()
    expect(mockRealtimeSend).not.toHaveBeenCalledWith(expect.objectContaining({ type: 'DM_CALL_ACCEPT' }))
    expect(mockRealtimeSend).not.toHaveBeenCalledWith(expect.objectContaining({ type: 'DM_CALL_DECLINE' }))
    expect(useCall.getState().phase).toBe('idle')
  })

  it('hangup() local pendant start() annule l’appel sortant sans envoyer DM_CALL_INIT', async () => {
    const perm = deferred<boolean>()
    mockPermissions.mockReturnValueOnce(perm.promise)
    const startPromise = useCall.getState().start(DM_ID, PARTNER_ID, 'Bob', 'voice')
    await flush()
    expect(useCall.getState().phase).toBe('calling')

    useCall.getState().hangup()
    expect(useCall.getState().phase).toBe('idle')

    perm.resolve(true)
    await startPromise
    await flush()
    expect(mockRealtimeSend).not.toHaveBeenCalledWith(expect.objectContaining({ type: 'DM_CALL_INIT' }))
    expect(useCall.getState().phase).toBe('idle')
  })

  it('raccroche après 30 s si la connexion n’aboutit jamais (timeout de connexion)', async () => {
    jest.useFakeTimers()
    mockConnect.mockReturnValue(new Promise(() => undefined)) // SFU injoignable : jamais résolu
    await useCall.getState().start(DM_ID, PARTNER_ID, 'Bob', 'voice')
    fire('DM_CALL_ACCEPTED', { dm_id: DM_ID, livekit: ACCESS })
    await flush()
    expect(useCall.getState().phase).toBe('connecting')

    jest.advanceTimersByTime(30_000)
    await flush()
    expect(useCall.getState().phase).toBe('idle')
    expect(useCall.getState().endReason).toBe('Connexion impossible')
    expect(mockRealtimeSend).toHaveBeenCalledWith(expect.objectContaining({ type: 'DM_CALL_HANGUP' }))
  })

  it('garde le nom et l’avatar du correspondant sur l’écran de fin (hors ligne)', async () => {
    await useCall.getState().start(DM_ID, PARTNER_ID, 'Bob', 'voice', '/uploads/bob.png')
    fire('DM_CALL_ERROR', { dm_id: DM_ID, reason: 'offline' })
    await flush()
    const s = useCall.getState()
    expect(s.phase).toBe('idle')
    expect(s.partnerName).toBeNull()
    expect(s.endReason).toBe('Ton correspondant est hors ligne')
    expect(s.endedWith).toEqual({ name: 'Bob', avatar: '/uploads/bob.png' })
  })

  it('appel croisé : l’id le plus petit décroche l’appel de l’autre', async () => {
    mockMyId = '11111111-0000-0000-0000-000000000000' // < PARTNER_ID
    await useCall.getState().start(DM_ID, PARTNER_ID, 'Bob', 'voice')
    fire('SESSION_INIT', { session_id: 'moi' })
    fire('DM_CALL_INCOMING', { from: PARTNER_ID, dm_id: DM_ID, from_username: 'Bob', call_type: 'voice' })
    expect(mockRealtimeSend).toHaveBeenCalledWith({ type: 'DM_CALL_ACCEPT', to: PARTNER_ID, dm_id: DM_ID })
    expect(mockRealtimeSend).not.toHaveBeenCalledWith(expect.objectContaining({ type: 'DM_CALL_DECLINE' }))
    expect(useCall.getState().incoming).toBeNull()
    expect(useCall.getState().phase).toBe('connecting')
    fire('DM_CALL_MEDIA', { dm_id: DM_ID, session_id: 'moi', livekit: ACCESS })
    await flush()
    expect(mockRooms).toHaveLength(1)
    // Notre propre appel expire côté serveur : sans effet sur l'appel décroché.
    fire('DM_CALL_ENDED', { dm_id: DM_ID, from: mockMyId, reason: 'timeout' })
    expect(useCall.getState().phase).not.toBe('idle')
  })

  it('appel croisé : l’id le plus grand attend DM_CALL_ACCEPTED sans rien envoyer', async () => {
    mockMyId = '99999999-0000-0000-0000-000000000000' // > PARTNER_ID
    await useCall.getState().start(DM_ID, PARTNER_ID, 'Bob', 'voice')
    mockRealtimeSend.mockClear()
    fire('DM_CALL_INCOMING', { from: PARTNER_ID, dm_id: DM_ID, from_username: 'Bob', call_type: 'voice' })
    expect(mockRealtimeSend).not.toHaveBeenCalled()
    expect(useCall.getState().phase).toBe('calling')
    fire('DM_CALL_ACCEPTED', { dm_id: DM_ID, livekit: ACCESS })
    await flush()
    expect(mockRooms).toHaveLength(1)
  })

  it('en vocal : l’appel entrant est proposé (pas de refus automatique) et décrocher quitte le vocal', async () => {
    mockVoice.channelId = 'salon'
    fire('DM_CALL_INCOMING', { from: PARTNER_ID, dm_id: DM_ID, from_username: 'Bob', call_type: 'voice' })
    expect(mockRealtimeSend).not.toHaveBeenCalledWith(expect.objectContaining({ type: 'DM_CALL_DECLINE' }))
    expect(useCall.getState().incoming?.fromAvatar).toBe('/uploads/bob.png')
    await useCall.getState().accept()
    expect(mockVoice.leave).toHaveBeenCalled()
    expect(mockGroupLeave).toHaveBeenCalled()
    expect(mockRealtimeSend).toHaveBeenCalledWith({ type: 'DM_CALL_ACCEPT', to: PARTNER_ID, dm_id: DM_ID })
  })

  it('la sonnerie annulée par l’appelant ne coupe pas un nouvel appel entrant plus tard', () => {
    jest.useFakeTimers()
    fire('DM_CALL_INCOMING', { from: PARTNER_ID, dm_id: DM_ID, from_username: 'Bob', call_type: 'voice' })
    jest.advanceTimersByTime(10_000)
    fire('DM_CALL_ENDED', { dm_id: DM_ID, from: PARTNER_ID })
    expect(useCall.getState().incoming).toBeNull()
    jest.advanceTimersByTime(10_000)
    fire('DM_CALL_INCOMING', { from: PARTNER_ID, dm_id: DM_ID, from_username: 'Bob', call_type: 'voice' })
    jest.advanceTimersByTime(30_000) // 50 s après le premier appel : son minuteur ne doit plus agir
    expect(useCall.getState().incoming).not.toBeNull()
    jest.advanceTimersByTime(15_000)
    expect(useCall.getState().incoming).toBeNull()
  })

  it('WebSocket rétabli pendant la sonnerie sortante : appel abandonné', async () => {
    await useCall.getState().start(DM_ID, PARTNER_ID, 'Bob', 'voice')
    mockOpenHandlers.forEach((h) => h())
    expect(useCall.getState().phase).toBe('idle')
    expect(useCall.getState().endReason).toBe('Connexion perdue')
  })

  it('fin de sonnerie décidée par le serveur : « Pas de réponse »', async () => {
    await useCall.getState().start(DM_ID, PARTNER_ID, 'Bob', 'voice')
    fire('DM_CALL_ENDED', { dm_id: DM_ID, from: mockMyId, reason: 'timeout' })
    expect(useCall.getState().endReason).toBe('Pas de réponse')
  })

  it('caméra refusée : appel vidéo transformé en appel vocal au lieu d’être annulé', async () => {
    mockPermissions.mockResolvedValueOnce(false).mockResolvedValueOnce(true)
    await useCall.getState().start(DM_ID, PARTNER_ID, 'Bob', 'video')
    expect(mockRealtimeSend).toHaveBeenCalledWith({ type: 'DM_CALL_INIT', to: PARTNER_ID, dm_id: DM_ID, call_type: 'voice' })
    expect(useCall.getState().callType).toBe('voice')
    expect(useCall.getState().warning).toMatch(/Caméra/)
  })

  it('permission micro refusée : pas d’appel lancé', async () => {
    mockPermissions.mockResolvedValueOnce(false)
    await expect(useCall.getState().start(DM_ID, PARTNER_ID, 'Bob', 'voice')).rejects.toThrow(/Permission/)
    expect(mockRealtimeSend).not.toHaveBeenCalledWith(expect.objectContaining({ type: 'DM_CALL_INIT' }))
    expect(useCall.getState().phase).toBe('idle')
  })
})
