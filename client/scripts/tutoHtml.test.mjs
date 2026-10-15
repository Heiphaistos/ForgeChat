// Rendu HTML des tutoriels : sous-ensemble sûr, aucun script / attribut / schéma dangereux.
// node --test scripts/tutoHtml.test.mjs
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { renderToStaticMarkup } from 'react-dom/server'
import { createElement, Fragment } from 'react'
import { htmlToReact } from '../src/pages/tutorials/htmlToReact.ts'

const out = h => renderToStaticMarkup(createElement(Fragment, null, ...htmlToReact(h)))

test('balises autorisées conservées', () => {
  assert.equal(out('<h2 id="x">T</h2><p>a <strong>b</strong><br>c</p><ul><li>1</li></ul>'), '<h2>T</h2><p>a <strong>b</strong><br/>c</p><ul><li>1</li></ul>')
})
test('script, handlers, javascript: et data: écartés', () => {
  const o = out('<p onclick="x()">a</p><script>alert(1)</script><a href="javascript:alert(1)">l</a><img src="http://x/y.png"><img src=x onerror=alert(1)><div>d</div>')
  assert.ok(!/script|onclick|javascript|onerror|<img|<div/.test(o), o)
  assert.ok(o.includes('d'))
})
test('lien https et image https gardés, texte échappé', () => {
  const o = out('<a href="https://a.fr/?x=1&amp;y=2">&lt;b&gt;</a><img src="https://a.fr/i.png" alt="i">')
  assert.ok(o.includes('href="https://a.fr/?x=1&amp;y=2"') && o.includes('rel="noopener noreferrer nofollow"'))
  assert.ok(o.includes('&lt;b&gt;') && o.includes('<img src="https://a.fr/i.png"'))
})
test('balises mal fermées tolérées', () => {
  assert.equal(out('<p>a<strong>b'), '<p>a<strong>b</strong></p>')
  assert.equal(out('x</p></em>y'), 'xy')
})
