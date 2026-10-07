// Test de la traduction : node --test scripts/i18n.test.mjs
// (Node >= 22.18 lit le TypeScript directement, aucune dépendance.)
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { translate, pickLang } from '../src/i18n/translate.ts'
import { fr } from '../src/i18n/fr.ts'
import { en } from '../src/i18n/en.ts'

test('clé absente en anglais : repli sur le français', () => {
  assert.equal(translate({}, { 'a.b': 'Bonjour' }, 'a.b'), 'Bonjour')
  assert.equal(translate({ 'a.b': 'Hello' }, { 'a.b': 'Bonjour' }, 'a.b'), 'Hello')
})

test('clé inconnue partout : la clé, jamais une chaîne vide', () => {
  assert.equal(translate({}, {}, 'x.y'), 'x.y')
  assert.equal(translate({ 'x.y': '' }, { 'x.y': 'Repli' }, 'x.y'), 'Repli')
})

test('interpolation {nom}', () => {
  const d = { k: 'Salut {nom}, {n} messages, {inconnu}' }
  assert.equal(translate(d, {}, 'k', { nom: 'Momo', n: 3 }), 'Salut Momo, 3 messages, {inconnu}')
})

test('choix de la langue', () => {
  assert.equal(pickLang('fr-FR'), 'fr')
  assert.equal(pickLang('FR'), 'fr')
  assert.equal(pickLang('en-US'), 'en')
  assert.equal(pickLang('es'), 'en')
  assert.equal(pickLang(undefined), 'en')
})

test('dictionnaires : aucune valeur vide, anglais ⊂ français', () => {
  for (const [k, v] of Object.entries(fr)) assert.ok(v.trim(), `fr vide : ${k}`)
  for (const [k, v] of Object.entries(en)) {
    assert.ok(v.trim(), `en vide : ${k}`)
    assert.ok(k in fr, `clé anglaise sans français : ${k}`)
  }
})
