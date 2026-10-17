// sw.js : l'URL d'une notification push reste sur notre origine : node --test scripts/swUrl.test.mjs
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'

const sw = readFileSync(new URL('../public/sw.js', import.meta.url), 'utf8')
const m = sw.match(/&& (\/\^.*?\/)\.test\(data\.url\)/)

test('sw.js refuse // et /\ dans data.url', () => {
  assert.ok(m, 'filtre data.url introuvable')
  const re = new RegExp(m[1].slice(1, -1))
  for (const ok of ['/', '/channels/1?x=2']) assert.ok(re.test(ok), ok)
  for (const bad of ['//evil.example', '/' + String.fromCharCode(92) + 'evil.example', 'https://evil.example', 'x']) assert.ok(!re.test(bad), bad)
})

test('sw.js revérifie l’origine au clic', () => {
  assert.match(sw, /target\.origin !== self\.location\.origin/)
})
