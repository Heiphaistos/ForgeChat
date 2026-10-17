// Journal de transparence des clés (amélioration n° 10) : node --test scripts/keyTransparency.test.mjs
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { GENESIS, contactKeyLogged, entryHash, keyHash, monitor, userTag, verifyRange } from '../src/e2e/keyTransparency.ts'

const ME = '00000000-0000-4000-8000-000000000001'
const BOB = '00000000-0000-4000-8000-000000000002'

test('vecteur partagé avec le serveur (server/src/key_log.rs)', async () => {
  const tag = await userTag(ME)
  const kh = await keyHash('BAAAAA')
  assert.equal(tag, 'a3bfd8fc613dcfa0c605346f0070e658278f0d4f7d4ed2e31a38fb780bb2753c')
  assert.equal(kh, 'acf2ba26ddbba999659054eae374dd3cd414bd1be9a733e2270df636e72e4424')
  assert.equal(await entryHash(1, tag, kh, GENESIS), 'b32c588b8ca2c0326d9933bfb72b8a3b806d1ffbb465fc27dbf3d3a24e92e532')
})

async function chain(items) {
  const out = []
  let prev = GENESIS
  for (const [i, [user, pub]] of items.entries()) {
    const e = { seq: i + 1, user_tag: await userTag(user), key_hash: await keyHash(pub), prev_hash: prev }
    e.hash = await entryHash(e.seq, e.user_tag, e.key_hash, prev)
    prev = e.hash
    out.push(e)
  }
  return out
}
const pager = (log, size = 2) => async after => ({ entries: log.filter(e => e.seq > after).slice(0, size), head: log.length ? { seq: log.at(-1).seq, hash: log.at(-1).hash } : null })

test('chaîne valide, reprise depuis la tête, réécriture détectée', async () => {
  const log = await chain([[ME, 'k1'], [BOB, 'b1'], [ME, 'k2']])
  const r = await monitor(null, ME, 'k2', pager(log))
  assert.equal(r.status, 'ok')
  // Reprise : nouvelle entrée de Bob, chaîne prolongée.
  const longer = await chain([[ME, 'k1'], [BOB, 'b1'], [ME, 'k2'], [BOB, 'b2']])
  assert.equal((await monitor(r.state, ME, 'k2', pager(longer))).status, 'ok')
  // Histoire réécrite (entrée 2 changée) : la reprise ne rejoint plus la tête mémorisée.
  const forged = await chain([[ME, 'k1'], [BOB, 'bX'], [ME, 'k2'], [BOB, 'b2']])
  const r2 = await monitor(r.state, ME, 'k2', pager(forged))
  assert.equal(r2.status, 'rewritten')
  // Entrée modifiée sans recalcul : refusée.
  const tampered = log.map(e => ({ ...e }))
  tampered[1].key_hash = await keyHash('autre')
  assert.equal((await verifyRange(tampered, null)).ok, false)
})

test('clé publiée au nom de ce compte par un tiers : détectée', async () => {
  const log = await chain([[ME, 'k1'], [ME, 'cle-du-serveur']])
  const r = await monitor(null, ME, 'k1', pager(log))
  assert.deepEqual(r, { status: 'foreign_key', seq: 2 })
})

test('clé d’un contact : inscrite au journal ou non', async () => {
  const [, bob] = await chain([[ME, 'k1'], [BOB, 'b1']])
  assert.equal(await contactKeyLogged(BOB, 'b1', bob), true)
  assert.equal(await contactKeyLogged(BOB, 'autre', bob), false)
  assert.equal(await contactKeyLogged(ME, 'b1', bob), false)
  assert.equal(await contactKeyLogged(BOB, 'b1', null), false)
})

test('entrée servie falsifiée ou hors de la tête mémorisée : refusée', async () => {
  const log = await chain([[ME, 'k1'], [BOB, 'b1'], [BOB, 'b2']])
  const [e1, e2, e3] = log
  // Empreinte d'entrée qui ne se recalcule pas.
  assert.equal(await contactKeyLogged(BOB, 'b1', { ...e2, hash: GENESIS }), false)
  // Contenu modifié sans recalcul de l'empreinte.
  assert.equal(await contactKeyLogged(BOB, 'b1', { ...e2, key_hash: await keyHash('b9') }), false)
  // Tête mémorisée : même seq mais autre hash, ou suite qui ne s'y chaîne pas.
  assert.equal(await contactKeyLogged(BOB, 'b1', e2, { seq: 2, hash: e1.hash }), false)
  assert.equal(await contactKeyLogged(BOB, 'b2', e3, { seq: 2, hash: e1.hash }), false)
  assert.equal(await contactKeyLogged(BOB, 'b1', e2, { seq: 2, hash: e2.hash }), true)
  assert.equal(await contactKeyLogged(BOB, 'b2', e3, { seq: 2, hash: e2.hash }), true)
})
