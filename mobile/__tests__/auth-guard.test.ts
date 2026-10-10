// Anti-retour arrière de la connexion v2 : un serveur qui répond `legacy: true` pour un compte
// déjà vu migré sur cet appareil ne reçoit jamais le mot de passe en clair.
const mockStore = new Map<string, string>()
const mockPost = jest.fn()
jest.mock('expo-crypto', () => ({
  getRandomBytes: (n: number) => new Uint8Array(require('crypto').randomBytes(n)),
  randomUUID: () => require('crypto').randomUUID(),
}))
jest.mock('expo-secure-store', () => ({
  getItemAsync: async (k: string) => mockStore.get(k) ?? null,
  setItemAsync: async (k: string, v: string) => { mockStore.set(k, v) },
  deleteItemAsync: async (k: string) => { mockStore.delete(k) },
}))
jest.mock('@/lib/http', () => ({
  ApiError: class ApiError extends Error {},
  http: { post: (...a: unknown[]) => mockPost(...a), get: jest.fn(), put: jest.fn() },
}))

import { accountTag, guardPrelogin, markMigrated } from '@/e2e/authGuard'
import { prelogin } from '@/e2e/accountKey'

beforeEach(() => { mockStore.clear(); mockPost.mockReset() })

test("étiquette : SHA-256 de l'e-mail normalisé, jamais l'e-mail en clair", () => {
  expect(accountTag(' Momo@Example.org ')).toBe(accountTag('momo@example.org'))
  expect(accountTag('momo@example.org')).toMatch(/^[0-9a-f]{64}$/)
  expect([...mockStore.keys()].join()).not.toContain('momo')
})

test('compte jamais vu migré : legacy accepté (migration, e-mail inconnu)', async () => {
  mockPost.mockResolvedValue({ kdf_salt: 'x', legacy: true })
  await expect(prelogin('momo@example.org')).resolves.toEqual({ kdf_salt: 'x', legacy: true })
})

test('prelogin v2 retient le compte ; un legacy ensuite est refusé', async () => {
  mockPost.mockResolvedValueOnce({ kdf_salt: 'sel', legacy: false })
  await prelogin('Momo@example.org')
  expect([...mockStore.values()]).toEqual(['1'])
  mockPost.mockResolvedValueOnce({ kdf_salt: 'factice', legacy: true })
  await expect(prelogin('momo@example.org')).rejects.toThrow('AUTH_DOWNGRADE')
})

test('après une migration (connexion réussie) : legacy refusé, v2 accepté', async () => {
  await markMigrated('momo@example.org')
  await expect(guardPrelogin('momo@example.org', { legacy: true })).rejects.toThrow('AUTH_DOWNGRADE')
  await expect(guardPrelogin('momo@example.org', { legacy: false })).resolves.toBeUndefined()
  await expect(guardPrelogin('autre@example.org', { legacy: true })).resolves.toBeUndefined()
})
