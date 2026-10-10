// Anti-retour arrière de la connexion v2 : node --test scripts/authGuard.test.mjs
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { accountTag, checkPrelogin, markIn } from '../src/e2e/authGuard.ts'

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
