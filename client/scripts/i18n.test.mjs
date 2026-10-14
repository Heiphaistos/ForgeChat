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

test('aucune clé définie deux fois (avec des valeurs différentes) dans les fichiers de dictionnaire', async () => {
  const { readdirSync, readFileSync } = await import('node:fs')
  const dir = new URL('../src/i18n/', import.meta.url)
  const seen = new Map()
  const dups = []
  for (const f of [...readdirSync(dir).map(n => n), ...readdirSync(new URL('parts/', dir)).map(n => 'parts/' + n)].filter(n => n.endsWith('.ts'))) {
    let dict = ''
    for (const line of readFileSync(new URL(f, dir), 'utf8').split('\n')) {
      const d = line.match(/^export const (\w+)/)
      if (d) dict = d[1]
      const k = line.match(/^\s+'([\w.-]+)':\s*(.+?),?\s*$/)
      if (!k) continue
      const id = `${dict}|${k[1]}`
      const prev = seen.get(id)
      if (prev && prev.v !== k[2]) dups.push(`${k[1]} (${prev.f} / ${f})`)
      seen.set(id, { f, v: k[2] })
    }
  }
  assert.deepEqual(dups, [])
})
