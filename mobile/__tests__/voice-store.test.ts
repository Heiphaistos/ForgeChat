import type { RealtimeEvent } from '@/lib/realtime'

/**
 * Salons vocaux (LiveKit) : ordre des événements du serveur (salons auto-création), reprise après
 * une coupure du WebSocket, pairs LiveKit qui partent, modération, sourdine.
 */

// ── Mocks ──────────────────────────────────────────────────────────────────

type Handler = (...a: unknown[]) => void
const mockRooms: MockRoom[] = []
interface MockRoom {
  handlers: Map<string, Handler>
  remoteParticipants: Map<string, unknown>
  localParticipant: { setMicrophoneEnabled: jest.Mock; setCameraEnabled: jest.Mock; getTrackPublication: () => undefined }
  state: string
}
jest.mock('livekit-client', () => {
  class Room {
    handlers = new Map<string, Handler>()
    remoteParticipants = new Map()
    state = 'connected'
    localParticipant = {
      setMicrophoneEnabled: jest.fn().mockResolvedValue(undefined),
      setCameraEnabled: jest.fn().mockResolvedValue(undefined),
      setScreenShareEnabled: jest.fn().mockResolvedValue(undefined),
      getTrackPublication: () => undefined,
    }
    connect = jest.fn().mockResolvedValue(undefined)
    disconnect = jest.fn().mockResolvedValue(undefined)
    constructor() {
      mockRooms.push(this as unknown as MockRoom)
    }
    on(ev: string, fn: Handler) {
      this.handlers.set(ev, fn)
      return this
    }
  }
  return {
    Room,
    RoomEvent: new Proxy({}, { get: (_t, k) => String(k) }),
    Track: { Source: { Camera: 'camera', ScreenShare: 'screen_share', Microphone: 'microphone' } },
    VideoQuality: { MEDIUM: 1 },
    DisconnectReason: { CLIENT_INITIATED: 1, DUPLICATE_IDENTITY: 2, PARTICIPANT_REMOVED: 4, ROOM_DELETED: 5, SIGNAL_CLOSE: 13 },
  }
})

const mockAccess = jest.fn()
jest.mock('@/services/livekit', () => ({
  liveKitAccess: (v: unknown) => mockAccess(v),
  leaveRoom: (r: { disconnect: () => Promise<void> }) => r.disconnect(),
  stopScreenShare: jest.fn().mockResolvedValue(undefined),
  streamOf: () => null,
  callAudio: { start: jest.fn().mockResolvedValue(undefined), stop: jest.fn().mockResolvedValue(undefined), setSpeaker: jest.fn() },
}))

const mockPlaySound = jest.fn()
jest.mock('@/services/soundboard', () => ({ playSoundFile: (u: unknown) => mockPlaySound(u) }))
jest.mock('@/services/media', () => ({ ensureMediaPermissions: jest.fn().mockResolvedValue(true) }))
jest.mock('@/api/voice', () => ({ voiceApi: { turnServers: jest.fn().mockResolvedValue([]) } }))
jest.mock('@/stores/auth', () => ({ registerSignOutHook: jest.fn(), getMyId: () => 'moi' }))
jest.mock('@/lib/logger', () => ({ logger: { warn: jest.fn(), debug: jest.fn(), error: jest.fn() } }))

const mockHandlers = new Map<string, (e: RealtimeEvent) => void>()
const mockOpenHandlers: (() => void)[] = []
const mockSend = jest.fn()
const mockRealtime = {
  isOpen: true,
  on: (type: string, h: (e: RealtimeEvent) => void) => {
    mockHandlers.set(type, h)
    return () => mockHandlers.delete(type)
  },
  onOpen: (h: () => void) => {
    mockOpenHandlers.push(h)
    return () => undefined
  },
  send: (...a: unknown[]) => mockSend(...a),
}
jest.mock('@/lib/realtime', () => ({ realtime: mockRealtime }))

// ── Aides ──────────────────────────────────────────────────────────────────

const fire = (type: string, event: Partial<RealtimeEvent> = {}) => mockHandlers.get(type)?.({ type, ...event })
const flush = async () => {
  for (let i = 0; i < 8; i++) await Promise.resolve()
}
const ACCESS = { url: 'wss://chat.example.org/livekit', token: 't'.repeat(40), room: 'voice-x' }
const peers = [{ user_id: 'bob', username: 'Bob', avatar: null, muted: false }]

describe('stores/voice (LiveKit)', () => {
  let useVoice: typeof import('@/stores/voice').useVoice

  beforeEach(() => {
    jest.resetModules()
    mockHandlers.clear()
    mockOpenHandlers.length = 0
    mockSend.mockClear()
    mockPlaySound.mockClear()
    mockRealtime.isOpen = true
    mockRooms.length = 0
    mockAccess.mockReset().mockReturnValue({ access: ACCESS })
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    ;({ useVoice } = require('@/stores/voice'))
  })

  afterEach(() => {
    useVoice.getState().leave()
    jest.useRealTimers()
  })

  const joinAndEnter = async (channel = 'salon') => {
    await useVoice.getState().join('srv', channel, 'Salon', 'secret')
    fire('VOICE_EXISTING_PEERS', { channel_id: channel, peers, livekit: ACCESS, can_speak: true })
    await flush()
  }

  it('rejoint le salon : VOICE_JOIN, puis état diffusé à la réception des pairs', async () => {
    await useVoice.getState().join('srv', 'salon', 'Salon')
    expect(mockSend).toHaveBeenCalledWith({ type: 'VOICE_JOIN', channel_id: 'salon', listen_only: false })
    expect(mockSend).not.toHaveBeenCalledWith(expect.objectContaining({ type: 'VOICE_STATE' }))
    fire('VOICE_EXISTING_PEERS', { channel_id: 'salon', peers, livekit: ACCESS })
    await flush()
    expect(useVoice.getState().joined).toBe(true)
    expect(useVoice.getState().peers.map((p) => p.userId)).toEqual(['bob'])
    expect(mockSend).toHaveBeenCalledWith(expect.objectContaining({ type: 'VOICE_STATE', channel_id: 'salon' }))
    expect(mockRooms).toHaveLength(1)
  })

  it('auto-création, VOICE_REDIRECT AVANT VOICE_EXISTING_PEERS : salon temporaire rejoint', async () => {
    await useVoice.getState().join('srv', 'auto', 'Créer un salon')
    fire('VOICE_REDIRECT', { from_channel_id: 'auto', channel_id: 'temp' })
    fire('VOICE_EXISTING_PEERS', { channel_id: 'temp', peers: [], livekit: ACCESS })
    await flush()
    const s = useVoice.getState()
    expect(s.joined).toBe(true)
    expect(s.channelId).toBe('temp')
    expect(s.entryChannelId).toBe('auto')
    expect(mockRooms).toHaveLength(1)
  })

  it('auto-création, VOICE_EXISTING_PEERS AVANT VOICE_REDIRECT : salon temporaire rejoint', async () => {
    await useVoice.getState().join('srv', 'auto', 'Créer un salon')
    fire('VOICE_EXISTING_PEERS', { channel_id: 'temp', peers: [], livekit: ACCESS })
    fire('VOICE_REDIRECT', { from_channel_id: 'auto', channel_id: 'temp' })
    await flush()
    const s = useVoice.getState()
    expect(s.joined).toBe(true)
    expect(s.channelId).toBe('temp')
    expect(mockRooms).toHaveLength(1)
    expect(mockSend).toHaveBeenCalledWith(expect.objectContaining({ type: 'VOICE_STATE', channel_id: 'temp' }))
  })

  it('réponse tardive d’un salon quitté : ignorée (pas prise pour un salon temporaire)', async () => {
    await useVoice.getState().join('srv', 'ancien', 'Ancien')
    useVoice.getState().leave()
    await useVoice.getState().join('srv', 'nouveau', 'Nouveau')
    fire('VOICE_EXISTING_PEERS', { channel_id: 'ancien', peers: [], livekit: ACCESS })
    expect(useVoice.getState().channelId).toBe('nouveau')
    expect(useVoice.getState().joined).toBe(false)
  })

  it('reconnexion du WebSocket : VOICE_JOIN rejoué avec le mot de passe, pas de nouvelle salle LiveKit', async () => {
    await joinAndEnter()
    mockSend.mockClear()
    mockOpenHandlers.forEach((h) => h())
    expect(mockSend).toHaveBeenCalledWith({ type: 'VOICE_JOIN', channel_id: 'salon', listen_only: false, password: 'secret' })
    fire('VOICE_EXISTING_PEERS', { channel_id: 'salon', peers: [], livekit: ACCESS })
    await flush()
    expect(useVoice.getState().peers).toEqual([]) // Bob parti pendant la coupure
    expect(mockRooms).toHaveLength(1)
  })

  it('reconnexion sans réponse du serveur (salon temporaire supprimé) : sortie avec un message', async () => {
    jest.useFakeTimers()
    await joinAndEnter()
    mockOpenHandlers.forEach((h) => h())
    jest.advanceTimersByTime(15_000)
    expect(useVoice.getState().channelId).toBeNull()
    expect(useVoice.getState().error).toMatch(/perdue/)
  })

  it('ParticipantDisconnected : pas de tuile fantôme pour un pair déjà parti', async () => {
    await joinAndEnter()
    fire('VOICE_USER_LEFT', { channel_id: 'salon', user_id: 'bob' })
    mockRooms[0]!.handlers.get('ParticipantDisconnected')!({ identity: 'bob' })
    expect(useVoice.getState().peers).toEqual([])
  })

  it('éjection LiveKit avec le WebSocket ouvert : salon quitté', async () => {
    await joinAndEnter()
    mockRooms[0]!.handlers.get('Disconnected')!(4)
    expect(useVoice.getState().channelId).toBeNull()
    expect(useVoice.getState().error).toMatch(/retiré/)
  })

  it('éjection LiveKit pendant une coupure du WebSocket : on attend la reprise', async () => {
    await joinAndEnter()
    mockRealtime.isOpen = false
    mockRooms[0]!.handlers.get('Disconnected')!(4)
    expect(useVoice.getState().channelId).toBe('salon')
    expect(useVoice.getState().mediaStatus).toBe('reconnecting')
    // Réouverture : nouveau jeton, nouvelle salle LiveKit.
    mockRealtime.isOpen = true
    mockRooms[0]!.state = 'disconnected'
    mockOpenHandlers.forEach((h) => h())
    fire('VOICE_EXISTING_PEERS', { channel_id: 'salon', peers, livekit: ACCESS })
    await flush()
    expect(mockRooms).toHaveLength(2)
    expect(useVoice.getState().mediaStatus).toBe('connected')
  })

  it('modération : muet imposé puis déconnexion forcée', async () => {
    await joinAndEnter()
    fire('VOICE_SERVER_STATE', { user_id: 'moi', channel_id: 'salon', server_muted: true, server_deafened: false })
    const s = useVoice.getState()
    expect(s.muted).toBe(true)
    expect(s.speakLocked).toBe(true)
    expect(mockRooms[0]!.localParticipant.setMicrophoneEnabled).toHaveBeenLastCalledWith(false)
    s.toggleMute()
    expect(useVoice.getState().muted).toBe(true) // bloqué, avec un message
    expect(useVoice.getState().notice).toBeTruthy()
    fire('VOICE_FORCE_DISCONNECT', { channel_id: 'salon' })
    expect(useVoice.getState().channelId).toBeNull()
    expect(useVoice.getState().error).toMatch(/modérateur/)
  })

  it('modération : déplacement vers un autre salon', async () => {
    await joinAndEnter()
    fire('VOICE_MOVE', { server_id: 'srv', channel_id: 'autre', channel_name: 'Autre' })
    await flush()
    expect(mockSend).toHaveBeenCalledWith({ type: 'VOICE_LEAVE', channel_id: 'salon' })
    expect(mockSend).toHaveBeenCalledWith({ type: 'VOICE_JOIN', channel_id: 'autre', listen_only: false })
    expect(useVoice.getState().channelName).toBe('Autre')
  })

  it('retirer la sourdine rétablit le micro tel qu’il était', async () => {
    await joinAndEnter()
    const v = useVoice.getState()
    expect(v.muted).toBe(false)
    v.toggleDeafen()
    expect(useVoice.getState()).toMatchObject({ deafened: true, muted: true })
    useVoice.getState().toggleDeafen()
    expect(useVoice.getState()).toMatchObject({ deafened: false, muted: false })
  })

  it('enregistrement d’un pair signalé au passage faux → vrai', async () => {
    await joinAndEnter()
    fire('VOICE_STATE_UPDATE', { channel_id: 'salon', user_id: 'bob', recording: true })
    expect(useVoice.getState().peers[0]!.recording).toBe(true)
    expect(useVoice.getState().notice).toMatch(/Bob/)
  })

  it('écoute seule : VOICE_JOIN listen_only, micro jamais publié', async () => {
    await useVoice.getState().join('srv', 'salon', 'Salon', undefined, true)
    expect(mockSend).toHaveBeenCalledWith({ type: 'VOICE_JOIN', channel_id: 'salon', listen_only: true })
    fire('VOICE_EXISTING_PEERS', { channel_id: 'salon', peers, livekit: ACCESS })
    await flush()
    expect(useVoice.getState().muted).toBe(true)
    expect(mockRooms[0]!.localParticipant.setMicrophoneEnabled).not.toHaveBeenCalled()
  })

  it('salon plein : message avec le nombre de places', async () => {
    await useVoice.getState().join('srv', 'salon', 'Salon')
    fire('VOICE_JOIN_ERROR', { channel_id: 'salon', reason: 'channel_full', limit: 5, current: 5 })
    expect(useVoice.getState().channelId).toBeNull()
    expect(useVoice.getState().error).toBe('Salon plein (5/5)')
  })

  describe('soundboard', () => {
    it('jouer un son : SOUNDBOARD_PLAY envoyé et son joué localement', async () => {
      await joinAndEnter()
      useVoice.getState().playSound('son1', '/uploads/sounds/a.mp3')
      expect(mockSend).toHaveBeenCalledWith({ type: 'SOUNDBOARD_PLAY', sound_id: 'son1', channel_id: 'salon' })
      expect(mockPlaySound).toHaveBeenCalledWith('/uploads/sounds/a.mp3')
    })

    it('son d’un autre membre du salon : joué ; écho du nôtre, autre salon : ignorés', async () => {
      await joinAndEnter()
      fire('SOUNDBOARD_PLAY', { channel_id: 'salon', sound_id: 's', file_url: '/uploads/sounds/b.mp3', user_id: 'bob' })
      expect(mockPlaySound).toHaveBeenCalledTimes(1)
      expect(mockPlaySound).toHaveBeenCalledWith('/uploads/sounds/b.mp3')
      fire('SOUNDBOARD_PLAY', { channel_id: 'salon', sound_id: 's', file_url: '/uploads/sounds/b.mp3', user_id: 'moi' })
      fire('SOUNDBOARD_PLAY', { channel_id: 'ailleurs', sound_id: 's', file_url: '/uploads/sounds/b.mp3', user_id: 'bob' })
      expect(mockPlaySound).toHaveBeenCalledTimes(1)
    })

    it('en sourdine : aucun son joué', async () => {
      await joinAndEnter()
      useVoice.getState().toggleDeafen()
      fire('SOUNDBOARD_PLAY', { channel_id: 'salon', sound_id: 's', file_url: '/uploads/sounds/b.mp3', user_id: 'bob' })
      useVoice.getState().playSound('son1', '/uploads/sounds/a.mp3')
      expect(mockPlaySound).not.toHaveBeenCalled()
      expect(mockSend).toHaveBeenCalledWith(expect.objectContaining({ type: 'SOUNDBOARD_PLAY' }))
    })
  })

  describe('scène', () => {
    const enterStage = async () => {
      await useVoice.getState().joinStage('srv', 'scene', 'Scène')
      fire('VOICE_EXISTING_PEERS', { channel_id: 'scene', peers, livekit: ACCESS })
      await flush()
    }

    it('rejoindre : écoute seule + STAGE_JOIN, puis orateurs et mains levées du serveur', async () => {
      await enterStage()
      expect(mockSend).toHaveBeenCalledWith({ type: 'VOICE_JOIN', channel_id: 'scene', listen_only: true })
      expect(mockSend).toHaveBeenCalledWith({ type: 'STAGE_JOIN', channel_id: 'scene' })
      fire('STAGE_STATE', { channel_id: 'scene', speakers: [{ user_id: 'bob', username: 'Bob', avatar: null }], hand_raises: [{ user_id: 'eve', username: 'Eve' }] })
      const st = useVoice.getState().stage!
      expect(st.speakers.map((u) => u.userId)).toEqual(['bob'])
      expect(st.hands.map((u) => u.userId)).toEqual(['eve'])
      expect(useVoice.getState().listenOnly).toBe(true)
    })

    it('demander la parole puis main baissée par le serveur : demande réinitialisée', async () => {
      await enterStage()
      useVoice.getState().stageRequestSpeak()
      useVoice.getState().stageRequestSpeak() // pas de doublon
      expect(mockSend.mock.calls.filter(([m]) => (m as { type: string }).type === 'STAGE_REQUEST_SPEAK')).toHaveLength(1)
      fire('STAGE_HAND_RAISE', { channel_id: 'scene', user_id: 'moi', username: 'Moi', raised: true })
      expect(useVoice.getState().stage).toMatchObject({ requested: true, hands: [{ userId: 'moi' }] })
      useVoice.getState().stageToggleHand()
      expect(mockSend).toHaveBeenLastCalledWith({ type: 'STAGE_HAND_RAISE', channel_id: 'scene', raised: false })
      fire('STAGE_HAND_RAISE', { channel_id: 'scene', user_id: 'moi', raised: false })
      expect(useVoice.getState().stage).toMatchObject({ requested: false, hands: [] })
    })

    it('invité à parler : rejoint avec micro, puis retour en audience quand la parole est retirée', async () => {
      await enterStage()
      mockSend.mockClear()
      fire('STAGE_SPEAKER_ADD', { channel_id: 'scene', user_id: 'moi', username: 'Moi' })
      await flush()
      expect(mockSend).toHaveBeenCalledWith({ type: 'VOICE_LEAVE', channel_id: 'scene' })
      expect(mockSend).toHaveBeenCalledWith({ type: 'VOICE_JOIN', channel_id: 'scene', listen_only: false })
      expect(mockSend).not.toHaveBeenCalledWith(expect.objectContaining({ type: 'STAGE_LEAVE_SPEAKER' }))
      expect(useVoice.getState()).toMatchObject({ listenOnly: false, stage: { channelId: 'scene', speakers: [{ userId: 'moi' }] } })
      mockSend.mockClear()
      fire('STAGE_SPEAKER_REMOVE', { channel_id: 'scene', user_id: 'moi' })
      await flush()
      expect(mockSend).toHaveBeenCalledWith({ type: 'VOICE_JOIN', channel_id: 'scene', listen_only: true })
      expect(useVoice.getState()).toMatchObject({ listenOnly: true, stage: { speakers: [] } })
    })

    it('modérateur : inviter, retirer la parole ; quitter en orateur descend de la scène', async () => {
      await enterStage()
      useVoice.getState().stageInvite('bob')
      expect(mockSend).toHaveBeenLastCalledWith({ type: 'STAGE_INVITE_SPEAK', channel_id: 'scene', target_user_id: 'bob' })
      useVoice.getState().stageRemoveSpeaker('bob')
      expect(mockSend).toHaveBeenLastCalledWith({ type: 'STAGE_LEAVE_SPEAKER', channel_id: 'scene', target_user_id: 'bob' })
      fire('STAGE_STATE', { channel_id: 'scene', speakers: [{ user_id: 'moi', username: 'Moi' }], hand_raises: [] })
      await flush()
      expect(useVoice.getState().listenOnly).toBe(false) // déjà orateur (autre appareil) : micro
      mockSend.mockClear()
      useVoice.getState().leave()
      expect(mockSend).toHaveBeenCalledWith({ type: 'STAGE_LEAVE_SPEAKER', channel_id: 'scene' })
      expect(useVoice.getState().stage).toBeNull()
    })

    it('événements d’une autre scène : ignorés', async () => {
      await enterStage()
      fire('STAGE_SPEAKER_ADD', { channel_id: 'autre', user_id: 'moi', username: 'Moi' })
      expect(useVoice.getState().stage!.speakers).toEqual([])
      expect(useVoice.getState().listenOnly).toBe(true)
    })
  })
})
