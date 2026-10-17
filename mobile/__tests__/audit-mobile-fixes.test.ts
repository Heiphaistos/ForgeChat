// Correctifs d'audit mobile : épingles TOFU non persistées signalées, transparence des clés fermée.
const mockSet = jest.fn()
jest.mock('expo-secure-store', () => ({
  WHEN_UNLOCKED_THIS_DEVICE_ONLY: 1,
  setItemAsync: (...a: unknown[]) => mockSet(...a),
  getItemAsync: async () => null,
  deleteItemAsync: async () => undefined,
}))
const mockGet = jest.fn()
jest.mock('@/lib/http', () => ({ http: { get: (...a: unknown[]) => mockGet(...a) }, path: (s: TemplateStringsArray, ...v: unknown[]) => String.raw({ raw: s }, ...v) }))
jest.mock('@/e2e/accountKey', () => ({ useAccountKey: { getState: () => ({ pub: null, userId: 'a' }) } }))

import { secureStateStorage } from '@/lib/secureStorage'
import { keyLogged } from '@/e2e/keyPins'

test('écriture SecureStore échouée : propagée pour les épingles fc_e2e_fp_*, avalée pour le reste', async () => {
  mockSet.mockRejectedValue(new Error('keystore'))
  await expect(secureStateStorage.setItem('fc_e2e_fp_a_b', 'x')).rejects.toThrow('keystore')
  await expect(secureStateStorage.setItem('autre', 'x')).resolves.toBeUndefined()
})

test('journal de transparence : kt_seq absent = false (bloquant), erreur réseau = null', async () => {
  mockGet.mockResolvedValueOnce({ public: 'p' })
  expect(await keyLogged('b', 'p')).toBe(false)
  mockGet.mockRejectedValueOnce(new Error('réseau'))
  expect(await keyLogged('b', 'p')).toBeNull()
})
