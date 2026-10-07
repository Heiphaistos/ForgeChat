// Conversations chiffrées : ouverture des messages avec les enveloppes du serveur
// (vecteurs communs docs/e2e-vectors.json : A enveloppe la clé d'époque 2 pour B).
import { readFileSync } from 'fs'
import { join } from 'path'

const mockV = JSON.parse(readFileSync(join(__dirname, '../../docs/e2e-vectors.json'), 'utf8'))
const mockIds = { a: mockV.convKey.sender, b: mockV.convKey.member }
const groupId = mockV.convKey.conv.split(':')[1]

const mockGet = jest.fn()
const mockPost = jest.fn()
jest.mock('expo-crypto', () => ({
  getRandomBytes: (n: number) => new Uint8Array(require('crypto').randomBytes(n)),
  randomUUID: () => require('crypto').randomUUID(),
}))
jest.mock('@/lib/http', () => ({
  ApiError: class ApiError extends Error {},
  http: { get: (...a: unknown[]) => mockGet(...a), post: (...a: unknown[]) => mockPost(...a), put: jest.fn() },
  path: (s: TemplateStringsArray, ...v: unknown[]) => s.reduce((acc, p, i) => acc + p + (i < v.length ? String(v[i]) : ''), ''),
}))
jest.mock('@/e2e/accountKey', () => {
  // Fabrique exécutée avant le corps du fichier : relit les vecteurs elle-même.
  const { b64uDecode } = jest.requireActual('@/e2e/crypto')
  const v = JSON.parse(require('fs').readFileSync(require('path').join(__dirname, '../../docs/e2e-vectors.json'), 'utf8'))
  const state = { status: 'ready', priv: b64uDecode(v.ecdh.privB), userId: v.convKey.member }
  return { useAccountKey: { getState: () => state } }
})
jest.mock('@/i18n', () => ({ t: (k: string) => k }))

import { forgetConv, keyChanges, openRaw, seal } from '@/e2e/conversations'

beforeEach(() => {
  forgetConv()
  mockGet.mockReset()
  mockPost.mockReset()
  mockGet.mockResolvedValue({
    current_epoch: 2, rotate_needed: false, all_keyed: true,
    envelopes: [{ epoch: 2, wrapped: mockV.convKey.wrapped, wrapped_by: mockIds.a, wrapped_by_pub: mockV.ecdh.pubA }],
  })
  mockPost.mockResolvedValue({ ok: true })
})

const msg = () => ({ id: 'm1', sender_id: mockV.message.author, client_msg_id: mockV.message.clientMsgId, enc: mockV.message.enc, content: null })

test('ouvre un message chiffré avec la clé de mon enveloppe', async () => {
  const o = await openRaw('group', groupId, msg())
  expect(o.content).toBe(mockV.message.body.t)
  expect(o.e2e).toBe('ok')
})

test('auteur usurpé ou époque inconnue : message verrouillé, clés redemandées', async () => {
  const o = await openRaw('group', groupId, { ...msg(), sender_id: mockIds.b })
  expect(o.e2e).toBe('locked')
  expect(o.content).toBe('e2e.msg.locked')
  const p = await openRaw('group', groupId, { ...msg(), enc: { ...mockV.message.enc, epoch: 3 } })
  expect(p.e2e).toBe('locked')
  expect(mockPost).toHaveBeenCalledWith(`/e2e/conversations/group/${groupId}/keys/request`)
})

test('message ancien purgé et message en clair', async () => {
  expect((await openRaw('dm', groupId, { id: 'x', purged: true, content: null, sender_id: mockIds.a })).content).toBe('e2e.msg.purged')
  expect((await openRaw('dm', groupId, { id: 'y', content: 'clair', sender_id: mockIds.a })).content).toBe('clair')
})

test('envoi : chiffré pour l\'époque courante, relisible', async () => {
  const sealed = await seal('group', groupId, 'Bonjour')
  expect(sealed?.enc.epoch).toBe(2)
  const back = await openRaw('group', groupId, { id: 'z', sender_id: mockIds.b, client_msg_id: sealed!.client_msg_id, enc: sealed!.enc })
  expect(back.content).toBe('Bonjour')
})

test('transition : un membre sans clé, texte en clair permis', async () => {
  mockGet.mockResolvedValue({ current_epoch: null, rotate_needed: false, all_keyed: false, envelopes: [] })
  expect(await seal('dm', groupId, 'Salut')).toBeNull()
})

test('alerte de changement de clé', () => {
  const members = [
    { user_id: mockIds.a, username: 'a', public: 'p', fingerprint: 'nouvelle' },
    { user_id: mockIds.b, username: 'moi', public: 'p', fingerprint: 'x' },
  ]
  expect(keyChanges(members, { [mockIds.a]: 'ancienne', [mockIds.b]: 'y' }, mockIds.b).map((m) => m.username)).toEqual(['a'])
  expect(keyChanges(members, {}, mockIds.b)).toEqual([])
})
