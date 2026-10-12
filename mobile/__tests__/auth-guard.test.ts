// Anti-retour arrière de la connexion v2 : un serveur qui répond `legacy: true` pour un compte
// déjà vu migré sur cet appareil ne reçoit jamais le mot de passe en clair.
const mockStore = new Map<string, string>()
const mockPost = jest.fn()
const mockGet = jest.fn()
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
  http: { post: (...a: unknown[]) => mockPost(...a), get: (...a: unknown[]) => mockGet(...a), put: jest.fn() },
}))

import { accountTag, guardArgon, guardKdf, guardPrelogin, markMigrated, markUserMigrated } from '@/e2e/authGuard'
import { passwordProof, prelogin } from '@/e2e/accountKey'
import { tokens } from '@/lib/tokens'

beforeEach(() => { mockStore.clear(); mockPost.mockReset(); mockGet.mockReset() })

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

const UID = '0b6f3c2e-8d1a-4c5e-9f7a-1b2c3d4e5f60'

test('actions sensibles : kdf legacy refusé pour un identifiant vu migré', async () => {
  await expect(guardKdf(UID, { legacy: true })).resolves.toBeUndefined() // jamais vu : migration possible
  await guardKdf(UID, { legacy: false }) // mémorise
  await expect(guardKdf(UID, { legacy: true })).rejects.toThrow('AUTH_DOWNGRADE')
  await expect(guardKdf('autre', { legacy: true })).resolves.toBeUndefined()
  expect([...mockStore.keys()].join()).not.toContain(UID)
})

test('passwordProof : jamais le mot de passe en clair pour un compte connu migré', async () => {
  await tokens.setUserId(UID)
  await markUserMigrated(UID) // connexion v2 précédente
  mockGet.mockResolvedValue({ kdf_salt: null, legacy: true })
  await expect(passwordProof('secret')).rejects.toMatchObject({ code: 'AUTH_DOWNGRADE' })
  // Compte jamais vu migré : ancien mot de passe accepté (compte pas encore migré).
  mockStore.clear()
  await tokens.setUserId(UID)
  await expect(passwordProof('secret')).resolves.toEqual({ password: 'secret' })
})

test('anti-retour PBKDF2 pour un compte vu en Argon2id (audit M3)', async () => {
  await guardArgon('argon@gmail.com', 'pbkdf2') // jamais vu : accepté
  await guardArgon('argon@gmail.com', 'argon2id')
  await expect(guardArgon('argon@gmail.com', 'pbkdf2')).rejects.toThrow('AUTH_DOWNGRADE')
  await expect(guardArgon('argon@gmail.com', undefined)).rejects.toThrow('AUTH_DOWNGRADE')
  await guardArgon('autre@gmail.com', 'pbkdf2')
})
