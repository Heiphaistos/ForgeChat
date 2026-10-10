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
  const state = { status: 'ready', priv: b64uDecode(v.ecdh.privB), pub: v.ecdh.pubB, userId: v.convKey.member }
  return { useAccountKey: { getState: () => state } }
})
jest.mock('@/i18n', () => ({ t: (k: string) => k }))
const mockPins = new Map<string, string>()
jest.mock('@/lib/secureStorage', () => ({
  secureStateStorage: {
    getItem: async (k: string) => mockPins.get(k) ?? null,
    setItem: async (k: string, v: string) => { mockPins.set(k, v) },
    removeItem: async (k: string) => { mockPins.delete(k) },
  },
}))

import { forgetConv, openRaw, seal, sealBody } from '@/e2e/conversations'

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

test('chiffrement obligatoire : un membre sans clé ne bloque pas, l\'époque est créée pour les membres munis d\'une clé', async () => {
  mockGet.mockImplementation(async (url: string) => url.endsWith('/members')
    ? [
        { user_id: mockIds.b, username: 'moi', public: mockV.ecdh.pubB, fingerprint: 'fp-b' },
        { user_id: mockIds.a, username: 'sans-cle', public: null, fingerprint: null },
      ]
    : { current_epoch: null, rotate_needed: false, all_keyed: false, encrypt: true, envelopes: [] })
  const sealed = await seal('dm', groupId, 'Salut')
  expect(sealed.enc.epoch).toBe(0)
  const [url, body] = mockPost.mock.calls[0] as [string, { create: boolean; envelopes: { member_id: string }[] }]
  expect(url).toBe(`/e2e/conversations/dm/${groupId}/keys`)
  expect(body.create).toBe(true)
  expect(body.envelopes.map((e) => e.member_id)).toEqual([mockIds.b])
  const back = await openRaw('dm', groupId, { id: 'w', sender_id: mockIds.b, client_msg_id: sealed.client_msg_id, enc: sealed.enc })
  expect(back.content).toBe('Salut')
})

const changedKeyMembers = () => {
  // Empreinte épinglée d'une AUTRE clé pour A (le serveur sert maintenant pubA).
  mockPins.set(`fc_e2e_fp_${mockIds.b}_${mockIds.a}`, JSON.stringify({ fp: 'ancienne-empreinte' }))
  mockGet.mockImplementation(async (url: string) => url.endsWith('/members')
    ? [
        { user_id: mockIds.b, username: 'moi', public: mockV.ecdh.pubB, fingerprint: 'menteur' },
        { user_id: mockIds.a, username: 'a', public: mockV.ecdh.pubA, fingerprint: 'menteur' },
      ]
    : { current_epoch: null, rotate_needed: false, all_keyed: true, encrypt: true, envelopes: [] })
}

test("clé d'un membre changée depuis son épinglage : aucune enveloppe pour elle, membre annoncé comme retenu", async () => {
  changedKeyMembers()
  const sealed = await seal('dm', groupId, 'Salut')
  expect(sealed.enc.epoch).toBe(0)
  const [, body] = mockPost.mock.calls[0] as [string, { envelopes: { member_id: string }[]; withheld: string[] }]
  expect(body.envelopes.map((e) => e.member_id)).toEqual([mockIds.b])
  expect(body.withheld).toEqual([mockIds.a])
  const { useKeyAlerts } = jest.requireActual('@/e2e/keyPins')
  expect(useKeyAlerts.getState().alerts.map((x: { subject: string }) => x.subject)).toEqual([mockIds.a])
  mockPins.clear()
})

test('WITHHELD_NOT_ALLOWED : envoi refusé avec un message clair, boîte de dialogue rouverte même après « pas maintenant »', async () => {
  const { ApiError } = jest.requireMock('@/lib/http')
  const { useKeyAlerts, refuseKey } = jest.requireActual('@/e2e/keyPins')
  const { e2eErrorText } = jest.requireActual('@/e2e/conversations')
  changedKeyMembers()
  useKeyAlerts.getState().alerts.forEach(refuseKey)
  expect(useKeyAlerts.getState().alerts).toEqual([])
  mockPost.mockRejectedValue(new ApiError('WITHHELD_NOT_ALLOWED'))
  const err = await seal('dm', groupId, 'Salut').catch((e: unknown) => e)
  expect((err as Error).message).toBe('E2E_WITHHELD')
  expect(e2eErrorText(err)).toBe('e2e.send.withheld')
  expect(useKeyAlerts.getState().alerts.map((x: { subject: string }) => x.subject)).toEqual([mockIds.a])
  mockPins.clear()
})

test('enveloppe illisible : signalée une seule fois par époque, puis clés redemandées', async () => {
  const bad = { ...mockV.convKey.wrapped, ct: mockV.convKey.wrapped.ct.slice(0, -4) + 'AAAA' }
  mockGet.mockResolvedValue({
    current_epoch: 5, rotate_needed: false, all_keyed: true,
    envelopes: [{ epoch: 5, wrapped: bad, wrapped_by: mockIds.a, wrapped_by_pub: mockV.ecdh.pubA }],
  })
  const o = await openRaw('group', groupId, { ...msg(), enc: { ...mockV.message.enc, epoch: 5 } })
  expect(o.e2e).toBe('locked')
  forgetConv()
  await openRaw('group', groupId, { ...msg(), enc: { ...mockV.message.enc, epoch: 5 } })
  const reports = mockPost.mock.calls.filter(([u]) => u === `/e2e/conversations/group/${groupId}/keys/unreadable`)
  expect(reports).toEqual([[`/e2e/conversations/group/${groupId}/keys/unreadable`, { epoch: 5 }]])
})

test("rechiffrement de l'ancien texte d'un autre membre : l'AAD garde son auteur d'origine", async () => {
  const sealed = await sealBody('group', groupId, { t: 'ancien' }, { author: mockIds.a })
  const raw = { id: 'old', client_msg_id: sealed.client_msg_id, enc: sealed.enc }
  expect((await openRaw('group', groupId, { ...raw, sender_id: mockIds.a })).content).toBe('ancien')
  // Attribué à celui qui a rechiffré (moi) : refusé.
  expect((await openRaw('group', groupId, { ...raw, sender_id: mockIds.b })).e2e).toBe('locked')
})

