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

// Adresses de médias venues du serveur ou d'un contenu chiffré (avatar, pièce jointe, emoji,
// bannière) : elles finissent dans des `src` ET des `href` (« ouvrir l'original »).
test('média : charges XSS et sorties de l\'origine refusées', async () => {
  const { isMediaUrl } = await import('../src/utils/safeUrl.ts')
  for (const ok of ['/uploads/a.png', '/uploads/x.enc?exp=1&sig=a', 'https://cdn.example/a.gif',
    'http://a.fr/b.png', 'blob:http://tauri.localhost/1-2', 'data:image/png;base64,AAAA', 'data:image/jpeg;base64,/9j/']) {
    assert.equal(isMediaUrl(ok), true, ok)
  }
  for (const ko of [
    'javascript:alert(1)', ' javascript:alert(1)', 'JAVASCRIPT:alert(1)', 'java\tscript:alert(1)',
    'vbscript:msgbox(1)', 'data:text/html,<script>alert(1)</script>', 'data:text/html;base64,PHNjcmlwdD4=',
    // SVG inline : script exécutable s'il est ouvert en onglet (href) ou rendu en document.
    'data:image/svg+xml,<svg onload=alert(1)>', 'DATA:IMAGE/SVG+XML;base64,PHN2Zz4=',
    // Chemin « relatif » que le navigateur lit comme une autre origine (//, /\, \).
    '//evil.example/x.png', '/\\evil.example/x.png', '\\\\evil.example\\x', '/\t/evil.example',
    'file:///C:/Windows/win.ini', 'ghosthanddesk://connect?x', '', null, undefined,
  ]) {
    assert.equal(isMediaUrl(ko), false, String(ko))
  }
})

test('redirection après connexion : jamais hors de l\'appli', async () => {
  const { safeRedirect } = await import('../src/utils/safeUrl.ts')
  assert.equal(safeRedirect('/invite/abc?x=1#m', '/friends'), '/invite/abc?x=1#m')
  for (const ko of ['//evil.example', '/\\evil.example', '/\t/evil.example', 'https://evil.example',
    'javascript:alert(1)', '\\\\evil.example', '', null]) {
    assert.equal(safeRedirect(ko, '/friends'), '/friends', String(ko))
  }
})
