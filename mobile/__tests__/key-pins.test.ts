// Épinglage des clés publiques (TOFU, audit H3) : mêmes cas que client/scripts/keyPins.test.mjs,
// plus le registre SecureStore (une entrée par contact, ancienne valeur = empreinte seule).
const mockStore = new Map<string, string>()
const mockMe: string | null = 'a'
const mockMyPub: string | null = null
jest.mock('expo-crypto', () => ({
  getRandomBytes: (n: number) => new Uint8Array(require('crypto').randomBytes(n)),
}))
jest.mock('@/lib/secureStorage', () => ({
  secureStateStorage: {
    getItem: async (k: string) => mockStore.get(k) ?? null,
    setItem: async (k: string, v: string) => { mockStore.set(k, v) },
    removeItem: async (k: string) => { mockStore.delete(k) },
  },
}))
jest.mock('@/e2e/accountKey', () => ({ useAccountKey: { getState: () => ({ pub: mockMyPub, userId: mockMe }) } }))

import { b64uDecode, b64uEncode, generateKeyPair, signServerKey, verifyServerKeySig } from '@/e2e/crypto'
import { acceptKey, markVerified, parsePin, pinOf, trustedMembers, trustedServerKey, useKeyAlerts } from '@/e2e/keyPins'
import { checkServerKey, fpOf, ownerVouches, serverSubject, sortMembers } from '@/e2e/keyPinsCore'

const pubKey = async () => b64uEncode((await generateKeyPair()).pub)
const store = (init: Record<string, { fp: string; verified?: boolean }> = {}) => {
  const pins = { ...init }
  return { pins, get: async (s: string) => pins[s] }
}

test("empreinte recalculée : celle annoncée par le serveur est ignorée", async () => {
  const pub = await pubKey()
  const fp = await fpOf(pub)
  const { trusted, fresh } = await sortMembers([{ user_id: 'b', public: pub, fingerprint: 'MENSONGE' }], 'a', null, store().get)
  expect(trusted[0]?.fingerprint).toBe(fp)
  expect(fresh).toEqual([{ subject: 'b', fp }])
})

test('clé changée : exclue, signalée ; acceptation : de nouveau sûre', async () => {
  const [oldPub, newPub, other] = [await pubKey(), await pubKey(), await pubKey()]
  const s = store({ b: { fp: await fpOf(oldPub), verified: true }, c: { fp: await fpOf(other) } })
  const r = await sortMembers([{ user_id: 'b', public: newPub }, { user_id: 'c', public: other }], 'a', null, s.get)
  expect(r.trusted.map((m) => m.user_id)).toEqual(['c'])
  expect(r.changed.map((m) => [m.user_id, m.verified])).toEqual([['b', true]])
  s.pins.b = { fp: await fpOf(newPub) }
  expect((await sortMembers([{ user_id: 'b', public: newPub }], 'a', null, s.get)).trusted).toHaveLength(1)
})

test('moi : seulement ma vraie clé', async () => {
  const [mine, fake] = [await pubKey(), await pubKey()]
  expect((await sortMembers([{ user_id: 'a', public: mine }], 'a', mine, store().get)).trusted).toHaveLength(1)
  expect((await sortMembers([{ user_id: 'a', public: fake }], 'a', mine, store().get)).trusted).toHaveLength(0)
})

test('clé de serveur changée : refusée', async () => {
  const [p1, p2] = [await pubKey(), await pubKey()]
  const s = store()
  const first = await checkServerKey({ server_id: 's', public: p1 }, s.get)
  expect(first).toMatchObject({ ok: true, fresh: true })
  s.pins[serverSubject('s')] = { fp: first.fp }
  expect((await checkServerKey({ server_id: 's', public: p2 }, s.get)).ok).toBe(false)
})

test('registre SecureStore : 1re vue épinglée, clé changée exclue + boîte de dialogue, acceptation', async () => {
  mockStore.clear()
  const [oldPub, newPub] = [await pubKey(), await pubKey()]
  // Ancien format (empreinte seule) relu tel quel.
  mockStore.set('fc_e2e_fp_a_b', await fpOf(oldPub))
  expect(parsePin(mockStore.get('fc_e2e_fp_a_b'))).toEqual({ fp: await fpOf(oldPub) })
  expect(await trustedMembers([{ user_id: 'c', username: 'c', public: oldPub }])).toHaveLength(1)
  expect(parsePin(mockStore.get('fc_e2e_fp_a_c'))?.fp).toBe(await fpOf(oldPub))
  expect(await trustedMembers([{ user_id: 'b', username: 'bob', public: newPub }])).toHaveLength(0)
  const alert = useKeyAlerts.getState().alerts[0]
  expect(alert).toMatchObject({ subject: 'b', name: 'bob', kind: 'user', pub: newPub })
  await acceptKey(alert!)
  expect(useKeyAlerts.getState().alerts).toHaveLength(0)
  expect(await trustedMembers([{ user_id: 'b', username: 'bob', public: newPub }])).toHaveLength(1)
  expect(await markVerified('b', newPub)).toBe(true)
  expect((await pinOf('b'))?.verified).toBe(true)
  expect(await markVerified('b', oldPub)).toBe(false)
})

test('registre : clé de serveur jamais vue refusée tant que non acceptée, puis changée refusée', async () => {
  const [p1, p2] = [await pubKey(), await pubKey()]
  // Jamais épinglée en silence : rien ne lui est enveloppé avant acceptation (audit 2026-10-12, H2).
  expect(await trustedServerKey({ server_id: 'srv', public: p1 })).toBeNull()
  const fresh = useKeyAlerts.getState().alerts.find((a) => a.subject === 'server:srv')
  expect(fresh).toMatchObject({ kind: 'server', fresh: true, fp: await fpOf(p1) })
  await acceptKey(fresh!)
  expect(await trustedServerKey({ server_id: 'srv', public: p1 })).toMatchObject({ fingerprint: await fpOf(p1) })
  // Clé différente ensuite : refusée et signalée comme changée.
  expect(await trustedServerKey({ server_id: 'srv', public: p2 })).toBeNull()
  expect(useKeyAlerts.getState().alerts.some((a) => a.kind === 'server' && a.subject === 'server:srv' && !a.fresh)).toBe(true)
})

test('clé de serveur signée : vecteur du navigateur (S bas et S haut) et règles de confiance', async () => {
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const v = (require('../../docs/e2e-vectors.json') as { serverKeySig: Record<string, string> }).serverKeySig
  const signerPub = b64uDecode(v.signer_public)
  expect(await verifyServerKeySig(signerPub, v.signature, v.server_id, v.signed_by, v.public)).toBe(true)
  expect(await verifyServerKeySig(signerPub, v.signature_high_s, v.server_id, v.signed_by, v.public)).toBe(true)
  expect(await verifyServerKeySig(signerPub, v.signature, v.server_id, 'autre', v.public)).toBe(false)

  const owner = await generateKeyPair()
  const ownerPub = b64uEncode(owner.pub)
  const sk = { server_id: 'srv', public: await pubKey(), signed_by: 'owner', signature: '' }
  sk.signature = await signServerKey(owner.priv, 'srv', 'owner', sk.public)
  const pins = new Map([['owner', { fp: await fpOf(ownerPub) }]])
  const served = async () => ownerPub
  expect(await ownerVouches(sk, 'me', null, async (s) => pins.get(s), served)).toBe(true)
  expect(await ownerVouches(sk, 'owner', ownerPub, async () => undefined, served)).toBe(true)
  expect(await ownerVouches(sk, 'me', null, async () => undefined, served)).toBe(false)
  expect(await ownerVouches(sk, 'me', null, async (s) => pins.get(s), async () => pubKey())).toBe(false)
  expect(await ownerVouches({ ...sk, public: await pubKey() }, 'me', null, async (s) => pins.get(s), served)).toBe(false)
})
