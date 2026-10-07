// Non-régression : une conversation ouverte AVANT le déverrouillage de la clé de compte
// (démarrage) restait « en attente » ; elle doit se déchiffrer dès que la clé est prête.
import { readFileSync } from 'fs'
import { join } from 'path'

const mockV = JSON.parse(readFileSync(join(__dirname, '../../docs/e2e-vectors.json'), 'utf8'))
const groupId = mockV.convKey.conv.split(':')[1]

const mockGet = jest.fn()
jest.mock('expo-crypto', () => ({
  getRandomBytes: (n: number) => new Uint8Array(require('crypto').randomBytes(n)),
  randomUUID: () => require('crypto').randomUUID(),
}))
jest.mock('@/lib/http', () => ({
  ApiError: class ApiError extends Error {},
  http: { get: (...a: unknown[]) => mockGet(...a), post: jest.fn().mockResolvedValue({}), put: jest.fn() },
  path: (s: TemplateStringsArray, ...v: unknown[]) => s.reduce((acc, p, i) => acc + p + (i < v.length ? String(v[i]) : ''), ''),
}))
const mockState: { status: string; priv: Uint8Array | null; userId: string | null } = { status: 'locked', priv: null, userId: null }
jest.mock('@/e2e/accountKey', () => ({ useAccountKey: { getState: () => mockState } }))
jest.mock('@/i18n', () => ({ t: (k: string) => k }))

import { b64uDecode } from '@/e2e/crypto'
import { becameReady, cacheUsable, forgetConv, openRaw } from '@/e2e/conversations'

const keys = {
  current_epoch: 2, rotate_needed: false, all_keyed: true,
  envelopes: [{ epoch: 2, wrapped: mockV.convKey.wrapped, wrapped_by: mockV.convKey.sender, wrapped_by_pub: mockV.ecdh.pubA }],
}
const msg = () => ({ id: 'm1', sender_id: mockV.message.author, client_msg_id: mockV.message.clientMsgId, enc: mockV.message.enc, content: null })
const unlock = () => Object.assign(mockState, { status: 'ready', priv: b64uDecode(mockV.ecdh.privB), userId: mockV.convKey.member })

beforeEach(() => {
  forgetConv()
  Object.assign(mockState, { status: 'locked', priv: null, userId: null })
  mockGet.mockReset()
  mockGet.mockResolvedValue(keys)
})

test('ouvert avant la clé de compte, lisible dès qu\'elle est prête (sans oubli explicite ni attente)', async () => {
  const before = await openRaw('group', groupId, msg())
  expect(before.e2e).toBe('locked')
  expect(before.content).toBe('e2e.msg.needKey')
  unlock()
  const after = await openRaw('group', groupId, msg())
  expect(after.e2e).toBe('ok')
  expect(after.content).toBe(mockV.message.body.t)
})

test('chargement lancé avant la clé et terminé après : relancé avec elle', async () => {
  let release: () => void = () => undefined
  mockGet.mockImplementationOnce(() => new Promise((r) => { release = () => r(keys) }))
  const pending = openRaw('group', groupId, msg())
  await new Promise((r) => setTimeout(r, 0))
  unlock()
  release()
  expect((await pending).e2e).toBe('ok')
})

test('clé prête ou remplacée : ré-essai ; état sans clé jamais réutilisé', () => {
  const k1 = new Uint8Array(1), k2 = new Uint8Array(1)
  expect(becameReady({ status: 'ready', priv: k1 }, { status: 'working', priv: null })).toBe(true)
  expect(becameReady({ status: 'ready', priv: k2 }, { status: 'ready', priv: k1 })).toBe(true)
  expect(becameReady({ status: 'ready', priv: k1 }, { status: 'ready', priv: k1 })).toBe(false)
  expect(becameReady({ status: 'locked', priv: null }, { status: 'idle', priv: null })).toBe(false)
  expect(cacheUsable({ priv: null, at: 0 }, k1, false, 0)).toBe(false)
  expect(cacheUsable({ priv: k1, at: 0 }, k1, false, 5000)).toBe(true)
  expect(cacheUsable({ priv: k1, at: 0 }, k1, true, 5000)).toBe(false)
})
