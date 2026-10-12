// Épinglage des clés publiques (TOFU, audit H3) : node --test scripts/keyPins.test.mjs
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { checkServerKey, firstUnreadable, fpOf, serverSubject, sortMembers, withheldOf } from '../src/e2e/keyPinsCore.ts'
import { b64uEncode, generateKeyPair } from '../src/e2e/crypto.ts'

const pubKey = async () => b64uEncode((await generateKeyPair()).pub)
const store = (init = {}) => {
  const pins = { ...init }
  return { pins, get: async s => pins[s] }
}

test("empreinte recalculée : celle annoncée par le serveur est ignorée", async () => {
  const pub = await pubKey()
  const fp = await fpOf(pub)
  const { pins, get } = store()
  const { trusted, fresh } = await sortMembers([{ user_id: 'b', public: pub, fingerprint: 'MENSONGE' }], 'a', null, get)
  assert.equal(trusted[0].fingerprint, fp)
  assert.deepEqual(fresh, [{ subject: 'b', fp }])
  assert.equal(pins.b, undefined) // l'appelant épingle
})

test('clé changée : exclue du chiffrement, signalée (vérifié conservé)', async () => {
  const [oldPub, newPub, other] = [await pubKey(), await pubKey(), await pubKey()]
  const { get } = store({ b: { fp: await fpOf(oldPub), verified: true }, c: { fp: await fpOf(other) } })
  const r = await sortMembers([{ user_id: 'b', public: newPub }, { user_id: 'c', public: other }], 'a', null, get)
  assert.deepEqual(r.trusted.map(m => m.user_id), ['c'])
  assert.equal(r.changed.length, 1)
  assert.equal(r.changed[0].user_id, 'b')
  assert.equal(r.changed[0].verified, true)
  assert.equal(r.changed[0].fingerprint, await fpOf(newPub))
})

test('acceptation : la nouvelle empreinte épinglée rend le membre de nouveau sûr', async () => {
  const [oldPub, newPub] = [await pubKey(), await pubKey()]
  const s = store({ b: { fp: await fpOf(oldPub) } })
  assert.equal((await sortMembers([{ user_id: 'b', public: newPub }], 'a', null, s.get)).trusted.length, 0)
  s.pins.b = { fp: await fpOf(newPub) } // acceptKey
  assert.equal((await sortMembers([{ user_id: 'b', public: newPub }], 'a', null, s.get)).trusted.length, 1)
})

test("moi : seulement si la clé servie est la mienne ; clé mal formée ou absente ignorée", async () => {
  const [mine, fake] = [await pubKey(), await pubKey()]
  const { get } = store()
  const ok = await sortMembers([{ user_id: 'a', public: mine }], 'a', mine, get)
  assert.equal(ok.trusted.length, 1)
  const bad = await sortMembers([{ user_id: 'a', public: fake }, { user_id: 'b', public: null }], 'a', mine, get)
  assert.equal(bad.trusted.length, 0)
})

test('clé de serveur : épinglée à la 1re vue, refusée si elle change', async () => {
  const [p1, p2] = [await pubKey(), await pubKey()]
  const s = store()
  const first = await checkServerKey({ server_id: 's', public: p1 }, s.get)
  assert.equal(first.ok, true)
  assert.equal(first.fresh, true)
  s.pins[serverSubject('s')] = { fp: first.fp }
  assert.equal((await checkServerKey({ server_id: 's', public: p1 }, s.get)).ok, true)
  const changed = await checkServerKey({ server_id: 's', public: p2 }, s.get)
  assert.equal(changed.ok, false)
  assert.equal(changed.fresh, false)
})

test('membres retenus : clé changée non acceptée ; ni moi, ni les membres sans clé', async () => {
  const [oldPub, newPub, ok, mine] = [await pubKey(), await pubKey(), await pubKey(), await pubKey()]
  const { get } = store({ b: { fp: await fpOf(oldPub) } })
  const all = [
    { user_id: 'a', public: mine }, { user_id: 'b', public: newPub }, { user_id: 'c', public: ok },
    { user_id: 'd', public: null },
  ]
  const { trusted } = await sortMembers(all, 'a', mine, get)
  assert.deepEqual(withheldOf(all, trusted, 'a'), ['b'])
  assert.deepEqual(withheldOf(all.slice(0, 1), trusted, 'a'), [])
})

test('enveloppe illisible : signalée une seule fois par conversation et époque', () => {
  const seen = new Set()
  assert.equal(firstUnreadable(seen, 'dm:x', 2), true)
  assert.equal(firstUnreadable(seen, 'dm:x', 2), false)
  assert.equal(firstUnreadable(seen, 'dm:x', 3), true)
  assert.equal(firstUnreadable(seen, 'group:x', 2), true)
})

test('clé de serveur signée : acceptée seulement si le signataire est VÉRIFIÉ (ou moi)', async () => {
  const c = await import('../src/e2e/crypto.ts')
  const { ownerVouches, fpOf } = await import('../src/e2e/keyPinsCore.ts')
  const owner = await c.generateKeyPair()
  const ownerPub = c.b64uEncode(owner.pub)
  const sign = await c.importSigningKey(owner.priv, owner.pub)
  const server = await c.generateKeyPair()
  const sk = { server_id: 'srv', public: c.b64uEncode(server.pub), signed_by: 'owner' }
  sk.signature = await c.signServerKey(sign, 'srv', 'owner', sk.public)
  const pins = new Map([['owner', { fp: await fpOf(ownerPub), verified: true }]])
  const getPin = async s => pins.get(s)
  const served = async () => ownerPub
  assert.equal(await ownerVouches(sk, 'me', null, getPin, served), true)
  // Simplement épinglé (liste des membres servie par le serveur) : pas de confiance automatique.
  assert.equal(await ownerVouches(sk, 'me', null, async () => ({ fp: await fpOf(ownerPub) }), served), false)
  // Moi-même propriétaire (clé de compte locale).
  assert.equal(await ownerVouches({ ...sk }, 'owner', ownerPub, async () => undefined, served), true)
  // Signataire jamais vu : pas de confiance automatique.
  assert.equal(await ownerVouches(sk, 'me', null, async () => undefined, served), false)
  // Le serveur sert une autre clé pour le signataire (ou une autre clé de serveur) : refus.
  const other = c.b64uEncode((await c.generateKeyPair()).pub)
  assert.equal(await ownerVouches(sk, 'me', null, getPin, async () => other), false)
  assert.equal(await ownerVouches({ ...sk, public: other }, 'me', null, getPin, served), false)
  assert.equal(await ownerVouches({ ...sk, server_id: 'autre' }, 'me', null, getPin, served), false)
  assert.equal(await ownerVouches({ ...sk, signature: null }, 'me', null, getPin, served), false)
})
