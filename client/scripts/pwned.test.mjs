// Mots de passe ayant fuité (amélioration n° 6) : node --test scripts/pwned.test.mjs
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { pwnedCount, pwnedProblem } from '../src/e2e/pwned.ts'
import { useLang } from '../src/i18n/index.ts'

useLang.getState().setLang('fr') // messages affichés dans la langue active : le test vise le français

// SHA-1("password") = 5BAA61E4C9B93F3F0682250B6CF8331B7EE68FD8
const RANGE = '0018A45C4D1DEF81644B54AB7F969B88D65:1\n1E4C9B93F3F0682250B6CF8331B7EE68FD8:10434004\n'

test('seul le préfixe de 5 caractères part, la suite est comparée sur l\'appareil', async () => {
  const asked = []
  const n = await pwnedCount('password', async p => { asked.push(p); return RANGE })
  assert.deepEqual(asked, ['5BAA6'])
  assert.equal(n, 10434004)
  assert.equal(await pwnedCount('un mot de passe absent 9!', async () => RANGE), 0)
})

test('service injoignable : rien n\'est bloqué', async () => {
  assert.equal(await pwnedCount('password', async () => { throw new Error('503') }), null)
  assert.equal(await pwnedProblem('password', async () => { throw new Error('503') }), null)
  assert.match(await pwnedProblem('password', async () => RANGE), /fuites de données/)
})

test('message traduit selon la langue active', async () => {
  useLang.getState().setLang('en')
  try { assert.match(await pwnedProblem('password', async () => RANGE), /data breaches/) }
  finally { useLang.getState().setLang('fr') }
})
