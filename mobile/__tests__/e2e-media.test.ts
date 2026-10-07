// Médias chiffrés de bout en bout (vocal, appels) : clé donnée à LiveKit, index
// d'émission, nouvelle époque pendant l'appel (vecteur commun docs/e2e-vectors.json).
import { readFileSync } from 'fs'
import { join } from 'path'

const mockV = JSON.parse(readFileSync(join(__dirname, '../../docs/e2e-vectors.json'), 'utf8'))
const mockSetSharedKey = jest.fn().mockResolvedValue(true)
const mockDispose = jest.fn()
const mockHandlers = new Map<string, (e: Record<string, unknown>) => void>()
const mockCurrentKey = jest.fn()

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
import { openMediaE2EE } from '@/e2e/media'

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
