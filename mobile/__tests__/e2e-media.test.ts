// Médias chiffrés de bout en bout (vocal, appels) : clé donnée à LiveKit, index
// d'émission, nouvelle époque pendant l'appel (vecteur commun docs/e2e-vectors.json).
import { readFileSync } from 'fs'
import { join } from 'path'

const mockV = JSON.parse(readFileSync(join(__dirname, '../../docs/e2e-vectors.json'), 'utf8'))
const mockSetSharedKey = jest.fn().mockResolvedValue(true)
const mockDispose = jest.fn()
const mockHandlers = new Map<string, (e: Record<string, unknown>) => void>()
const mockCurrentKey = jest.fn()
const mockCreate = jest.fn()

jest.mock('expo-crypto', () => ({
  getRandomBytes: (n: number) => new Uint8Array(require('crypto').randomBytes(n)),
}))
jest.mock('@livekit/react-native', () => ({
  RNKeyProvider: class {
    setSharedKey(k: string, i: number) { return mockSetSharedKey(k, i) }
    dispose() { mockDispose() }
  },
  RNE2EEManager: class {
    frameCryptors = new Map()
    async setupE2EESender(...a: unknown[]) { mockCreate('sender', ...a) }
    async setupE2EEReceiver(...a: unknown[]) { mockCreate('receiver', ...a) }
  },
}))
jest.mock('livekit-client', () => ({ RoomEvent: { Disconnected: 'disconnected' } }))
jest.mock('@/lib/realtime', () => ({
  realtime: {
    on: (type: string, h: (e: Record<string, unknown>) => void) => {
      mockHandlers.set(type, h)
      return () => mockHandlers.delete(type)
    },
  },
}))
jest.mock('@/e2e/conversations', () => ({
  currentKey: (...a: unknown[]) => mockCurrentKey(...a),
  forgetConv: jest.fn(),
}))

import { b64uDecode } from '@/e2e/crypto'
import { cryptorAllowed, openMediaE2EE } from '@/e2e/media'
import { closeMediaE2EE } from '@/e2e/mediaClose'

const [kind, id] = mockV.media.conv.split(':') as ['group', string]
const flush = () => new Promise((r) => setTimeout(r, 0))

beforeEach(() => {
  jest.clearAllMocks()
  mockHandlers.clear()
})

test('clé de l’époque courante donnée à LiveKit : mêmes octets que le web, index = époque', async () => {
  mockCurrentKey.mockResolvedValue({ epoch: mockV.media.epoch, key: b64uDecode(mockV.media.convKey), me: 'moi' })
  const m = await openMediaE2EE(kind, id)
  expect(mockSetSharedKey).toHaveBeenCalledWith(mockV.media.key, mockV.media.keyIndex)
  m.stop()
  expect(mockDispose).toHaveBeenCalled()
  expect(mockHandlers.has('E2E_KEYS')).toBe(false)
})

test('nouvelle époque pendant l’appel : nouvelle clé et émetteurs passés au nouvel index', async () => {
  mockCurrentKey.mockResolvedValue({ epoch: 2, key: b64uDecode(mockV.media.convKey), me: 'moi' })
  const m = await openMediaE2EE(kind, id)
  const setKeyIndex = jest.fn().mockResolvedValue(true)
  ;(m.encryption.e2eeManager as unknown as { frameCryptors: Map<string, unknown> }).frameCryptors.set('TR_mic', { setKeyIndex })
  m.bind({ localParticipant: { trackPublications: new Map([['TR_mic', {}]]) } } as never)

  // Autre conversation : ignorée.
  mockHandlers.get('E2E_KEYS')?.({ conv_kind: 'dm', conv_id: id })
  await flush()
  expect(mockSetSharedKey).toHaveBeenCalledTimes(1)

  mockCurrentKey.mockResolvedValue({ epoch: 17, key: new Uint8Array(32).fill(7), me: 'moi' })
  mockHandlers.get('E2E_KEYS')?.({ conv_kind: kind, conv_id: id })
  await flush()
  await flush()
  expect(mockSetSharedKey).toHaveBeenCalledTimes(2)
  expect(mockSetSharedKey.mock.calls[1]?.[1]).toBe(1) // 17 modulo 16
  expect(mockSetSharedKey.mock.calls[1]?.[0]).not.toBe(mockV.media.key)
  expect(setKeyIndex).toHaveBeenCalledWith(1)
  m.stop()
})

test('clé indisponible : refus, jamais de salle en clair', async () => {
  mockCurrentKey.mockRejectedValue(new Error('E2E_WAITING'))
  await expect(openMediaE2EE('channel', 'salon')).rejects.toThrow('E2E_WAITING')
  expect(mockSetSharedKey).not.toHaveBeenCalled()
})

describe('raccrochage : plus aucun chiffreur natif sur une connexion fermée (SIGSEGV)', () => {
  const room = (state = 'connected', isClosed = false) => ({
    state,
    engine: { isClosed },
    localParticipant: { trackPublications: new Map([['TR_cam', { track: { id: 'cam' } }]]), unpublishTracks: jest.fn().mockResolvedValue([]) },
  })
  type Internals = { setupE2EESender(...a: unknown[]): Promise<void>; setupE2EEReceiver(...a: unknown[]): Promise<void>; frameCryptors: Map<string, unknown> }

  test('garde : salle vivante seulement', () => {
    expect(cryptorAllowed(false, room() as never)).toBe(true)
    expect(cryptorAllowed(false, room('reconnecting') as never)).toBe(true)
    expect(cryptorAllowed(true, room() as never)).toBe(false)
    expect(cryptorAllowed(false, room('disconnected') as never)).toBe(false)
    expect(cryptorAllowed(false, room('connected', true) as never)).toBe(false)
    expect(cryptorAllowed(false, null)).toBe(false)
  })

  test('PeerConnection fermée (engine.isClosed) : le SDK ne crée plus de chiffreur', async () => {
    mockCurrentKey.mockResolvedValue({ epoch: 2, key: b64uDecode(mockV.media.convKey), me: 'moi' })
    const m = await openMediaE2EE(kind, id)
    const mgr = m.encryption.e2eeManager as unknown as Internals
    const r = room()
    m.bind(r as never)
    await mgr.setupE2EEReceiver('pub', 'p')
    expect(mockCreate).toHaveBeenCalledTimes(1)
    r.engine.isClosed = true // déconnexion venue du serveur : fermeture en cours
    await mgr.setupE2EESender('pub', 'p')
    await mgr.setupE2EEReceiver('pub', 'p')
    expect(mockCreate).toHaveBeenCalledTimes(1)
    m.stop()
  })

  test('closeMediaE2EE avant disconnect : émetteurs dépubliés, récepteurs libérés, puis plus rien', async () => {
    mockCurrentKey.mockResolvedValue({ epoch: 2, key: b64uDecode(mockV.media.convKey), me: 'moi' })
    const m = await openMediaE2EE(kind, id)
    const mgr = m.encryption.e2eeManager as unknown as Internals
    const r = room()
    m.bind(r as never)
    const receiver = { setEnabled: jest.fn().mockResolvedValue(true), dispose: jest.fn().mockResolvedValue(undefined), setKeyIndex: jest.fn() }
    mgr.frameCryptors.set('TR_remote', receiver)
    await closeMediaE2EE(r as never)
    expect(r.localParticipant.unpublishTracks).toHaveBeenCalledWith([{ id: 'cam' }])
    expect(receiver.setEnabled).toHaveBeenCalledWith(false)
    expect(receiver.dispose).toHaveBeenCalled()
    expect(mgr.frameCryptors.size).toBe(0)
    // Caméra republiée / piste reçue pendant la fermeture : ignorées.
    await mgr.setupE2EESender('pub', 'p')
    await mgr.setupE2EEReceiver('pub', 'p')
    expect(mockCreate).not.toHaveBeenCalled()
    // Nouvelle époque pendant la fermeture : aucun chiffreur touché.
    mockCurrentKey.mockResolvedValue({ epoch: 3, key: new Uint8Array(32).fill(1), me: 'moi' })
    mockHandlers.get('E2E_KEYS')?.({ conv_kind: kind, conv_id: id })
    await flush()
    await flush()
    expect(receiver.setKeyIndex).not.toHaveBeenCalled()
    m.stop()
  })
})
