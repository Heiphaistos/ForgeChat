// Anti-retour arrière de la connexion v2 : node --test scripts/authGuard.test.mjs
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { accountTag, checkKdf, checkPrelogin, markIn, markUserIn, userTag } from '../src/e2e/authGuard.ts'

const mem = () => { const s = new Set(); return { s, has: async t => s.has(t), add: async t => { s.add(t) } } }

test("étiquette : SHA-256 de l'e-mail normalisé, jamais l'e-mail en clair", async () => {
  const t = await accountTag('  Momo@Example.org ')
  assert.equal(t, await accountTag('momo@example.org'))
  assert.match(t, /^[0-9a-f]{64}$/)
  assert.ok(!t.includes('momo'))
})

test('compte migré : legacy refusé (le mot de passe ne part pas), v2 accepté', async () => {
  const st = mem()
  await markIn(st, 'momo@example.org')
  await assert.rejects(checkPrelogin(st, 'MOMO@example.org', { legacy: true }), /AUTH_DOWNGRADE/)
  await checkPrelogin(st, 'momo@example.org', { legacy: false })
})

test('compte jamais vu migré : legacy accepté (migration, e-mail inconnu)', async () => {
  const st = mem()
  await markIn(st, 'autre@example.org')
  await checkPrelogin(st, 'momo@example.org', { legacy: true })
})

test('actions sensibles : kdf legacy refusé pour un identifiant vu migré (connexion v2 ou kdf v2)', async () => {
  const st = mem()
  const id = '0b6f3c2e-8d1a-4c5e-9f7a-1b2c3d4e5f60'
  await checkKdf(st, id, { legacy: true }) // jamais vu migré : mot de passe accepté (migration)
  await checkKdf(st, id, { legacy: false }) // mémorise l'état migré
  await assert.rejects(checkKdf(st, id, { legacy: true }), /AUTH_DOWNGRADE/)
  const other = mem()
  await markUserIn(other, id) // après une connexion v2
  await assert.rejects(checkKdf(other, id, { legacy: true }), /AUTH_DOWNGRADE/)
  await checkKdf(other, 'autre-id', { legacy: true })
  assert.ok([...st.s].every(t => /^[0-9a-f]{64}$/.test(t) && !t.includes(id)), 'identifiant haché')
  assert.notEqual(await userTag(id), await accountTag(id))
})
