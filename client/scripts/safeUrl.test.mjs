// Adresses venues d'un message ou d'un flux : node --test scripts/safeUrl.test.mjs
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { deceptiveHost, isSafeUrl, safeHref } from '../src/utils/safeUrl.ts'

test('seules http(s) sont ouvrables', () => {
  assert.equal(isSafeUrl('https://a.fr/x'), true)
  assert.equal(isSafeUrl('http://a.fr'), true)
  for (const u of ['javascript:alert(1)', 'JaVaScRiPt:alert(1)', 'data:text/html,x', 'file:///etc/passwd', 'ghosthanddesk://x', '', null, 'pas une url']) {
    assert.equal(isSafeUrl(u), false, String(u))
    assert.equal(safeHref(u), undefined)
  }
})

test('lien masqué trompeur : hôte réel affiché', () => {
  assert.equal(deceptiveHost('paypal.com', 'https://evil.example/login'), 'evil.example')
  assert.equal(deceptiveHost('https://paypal.com/login', 'https://paypal.com.evil.example/'), 'paypal.com.evil.example')
  assert.equal(deceptiveHost('pаypal.com', 'https://paypal.com'), 'paypal.com') // « а » cyrillique
})

test('lien masqué honnête ou simple texte : rien à ajouter', () => {
  assert.equal(deceptiveHost('Clique ici', 'https://evil.example'), null)
  assert.equal(deceptiveHost('www.google.com', 'https://google.com/x'), null)
  assert.equal(deceptiveHost('google.com', 'https://mail.google.com'), null)
  assert.equal(deceptiveHost('version 1.2', 'https://a.fr'), null)
  assert.equal(deceptiveHost('a.fr', 'pas une url'), null)
})
