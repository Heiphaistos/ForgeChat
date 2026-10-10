// Texte sortant (liens nettoyés, émoticônes) : node --test scripts/outgoing.test.mjs
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { cleanUrl, cleanUrls, convertEmoticons, prepareOutgoing } from '../src/utils/outgoing.ts'

test('paramètres de pistage retirés, les autres gardés', () => {
  assert.equal(cleanUrl('https://a.fr/p?utm_source=x&utm_medium=y&id=3'), 'https://a.fr/p?id=3')
  assert.equal(cleanUrl('https://a.fr/p?fbclid=abc'), 'https://a.fr/p')
  assert.equal(cleanUrl('https://a.fr/p?gclid=1#frag'), 'https://a.fr/p#frag')
  assert.equal(cleanUrl('https://youtu.be/xyz?si=TRACK&t=42'), 'https://youtu.be/xyz?t=42')
  assert.equal(cleanUrl('https://www.youtube.com/watch?v=abc&si=TRACK'), 'https://www.youtube.com/watch?v=abc')
  assert.equal(cleanUrl('https://open.spotify.com/track/1?si=abc'), 'https://open.spotify.com/track/1')
})

test('adresse sans pistage ou invalide : intacte au caractère près', () => {
  assert.equal(cleanUrl('https://a.fr/p?si=1'), 'https://a.fr/p?si=1')
  assert.equal(cleanUrl('https://a.fr/a%20b?q=é'), 'https://a.fr/a%20b?q=é')
  assert.equal(cleanUrl('pas une url'), 'pas une url')
})

test('nettoyage dans un texte : ponctuation finale et code préservés', () => {
  assert.equal(cleanUrls('vois https://a.fr/?utm_source=x.'), 'vois https://a.fr/.')
  assert.equal(cleanUrls('`https://a.fr/?fbclid=1` et https://b.fr/?fbclid=2'), '`https://a.fr/?fbclid=1` et https://b.fr/')
  assert.equal(cleanUrls('```\nhttps://a.fr/?gclid=1\n```'), '```\nhttps://a.fr/?gclid=1\n```')
  assert.equal(cleanUrls('[lien](https://a.fr/?utm_x=1)'), '[lien](https://a.fr/)')
})

test('émoticônes converties seulement en mots isolés', () => {
  assert.equal(convertEmoticons('salut :)'), 'salut 🙂')
  assert.equal(convertEmoticons(':D trop bien ;) <3'), '😃 trop bien 😉 ❤️')
  assert.equal(convertEmoticons("bof :-/ et :'("), 'bof 😕 et 😢')
  assert.equal(convertEmoticons('ok :).'), 'ok 🙂.')
})

test('émoticônes : liens, emoji perso, code et mots intacts', () => {
  for (const s of ['http://a.fr/x', 'https://a.fr', '<:chat:0f0f0f0f-0000-0000-0000-000000000000>', 'a:)', '`:)`', 'xDD', 'B)ateau']) {
    assert.equal(convertEmoticons(s), s, s)
  }
})

test('prepareOutgoing suit les réglages', () => {
  const s = ':) https://a.fr/?utm_source=x'
  assert.equal(prepareOutgoing(s, { cleanUrls: false, convertEmoticons: false }), s)
  assert.equal(prepareOutgoing(s, { cleanUrls: true, convertEmoticons: true }), '🙂 https://a.fr/')
})
