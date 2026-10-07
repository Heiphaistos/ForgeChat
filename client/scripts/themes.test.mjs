// Thèmes : catalogue, contraste AA, AMOLED noir pur, validation des imports (aucune injection).
// node --test scripts/themes.test.mjs
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import {
  PRESETS, COLOR_KEYS, contrast, contrastReport, decodeTheme, encodeTheme, findTheme, fixContrast,
  isSafeImageUrl, MAX_CUSTOM_THEMES, sanitizeCustomList, sanitizeTheme, toExport, withAccent,
} from '../src/theme/themeCore.ts'

const HEX = /^#[0-9a-f]{6}$/

test('catalogue : 4 thèmes de base, au moins 25 dégradés, identifiants uniques', () => {
  const ids = PRESETS.map(p => p.id)
  assert.equal(new Set(ids).size, ids.length)
  assert.deepEqual(PRESETS.filter(p => p.group === 'base').map(p => p.id), ['dark', 'onyx', 'darker', 'light'])
  const grads = PRESETS.filter(p => p.group === 'gradient')
  assert.ok(grads.length >= 25, `${grads.length} dégradés`)
  for (const g of grads) {
    assert.ok(g.spec.gradient && g.spec.gradient.stops.length >= 2 && g.spec.gradient.stops.length <= 3, g.id)
    assert.ok(g.spec.opacity < 1, `${g.id} : panneaux translucides`)
  }
  // Les anciens identifiants restent valides (thème déjà choisi par les utilisateurs).
  for (const id of ['dracula', 'nord', 'catppuccin', 'retro', 'winter', 'matrix']) assert.ok(findTheme(id), id)
  for (const p of PRESETS) for (const k of COLOR_KEYS) assert.match(p.spec.colors[k], HEX, `${p.id}.${k}`)
})

test('contraste AA (4,5:1) du texte, du texte secondaire et des liens sur tous les fonds de chaque thème', () => {
  for (const p of PRESETS) {
    const r = contrastReport(p.spec)
    assert.ok(r.text >= 4.5, `${p.id} texte ${r.text.toFixed(2)}`)
    assert.ok(r.muted >= 4.5, `${p.id} secondaire ${r.muted.toFixed(2)}`)
    assert.ok(r.link >= 4.5, `${p.id} liens ${r.link.toFixed(2)}`)
  }
})

test('AMOLED : noir pur sur toutes les surfaces, reliefs par bordures et survol discret', () => {
  const s = findTheme('darker')
  for (const k of ['bg', 'sidebar', 'channel', 'chat', 'input']) assert.equal(s.colors[k], '#000000', k)
  assert.equal(s.outline, true)
  assert.equal(s.gradient, null)
  assert.equal(s.opacity, 1)
  assert.ok(contrast(s.colors.hover, '#000000') < 1.3, 'survol discret')
  assert.ok(contrast(s.colors.border, '#000000') > 1.3, 'bordure visible')
})

test('correction automatique du contraste', () => {
  const bad = sanitizeTheme({ colors: { bg: '#202020', sidebar: '#202020', channel: '#202020', chat: '#202020', text: '#303030', muted: '#252525', link: '#222222' } })
  assert.ok(contrastReport(bad).text < 4.5)
  const fixed = contrastReport(fixContrast(bad))
  assert.ok(fixed.text >= 4.5 && fixed.muted >= 4.5 && fixed.link >= 4.5)
})

test('validation : seules des couleurs hexadécimales et des nombres bornés passent', () => {
  assert.equal(sanitizeTheme(null), null)
  assert.equal(sanitizeTheme('x'), null)
  assert.equal(sanitizeTheme([1]), null)
  assert.equal(sanitizeTheme({ name: 'sans couleurs' }), null)
  const s = sanitizeTheme({
    name: 'Ab\u0000c<script>'.padEnd(80, 'x'),
    colors: { bg: 'red;} body{display:none', text: 'url(javascript:alert(1))', accent: '#ABCDEF', muted: 42 },
    css: 'body { display: none }',
    style: '<style>',
    opacity: -5,
    blur: 9999,
    radius: 'big',
    outline: 'yes',
    gradient: { angle: 9999, stops: ['#000000', 'expression(alert(1))', '#ffffff', '#111111', '#222222'] },
  })
  assert.equal(s.colors.bg, findTheme('dark').colors.bg)
  assert.equal(s.colors.text, findTheme('dark').colors.text)
  assert.equal(s.colors.accent, '#abcdef')
  assert.equal(s.opacity, 0.15)
  assert.equal(s.blur, 40)
  assert.equal(s.radius, 1)
  assert.equal(s.outline, false)
  assert.deepEqual(s.gradient, { angle: 360, stops: ['#000000', '#ffffff', '#111111'] })
  assert.equal(s.name.length, 40)
  assert.ok(!s.name.includes('\u0000'))
  assert.deepEqual(Object.keys(s).sort(), ['blur', 'colors', 'gradient', 'image', 'name', 'opacity', 'outline', 'radius', 'scheme'])
  for (const v of Object.values(s.colors)) assert.match(v, HEX)
})

test("image de fond : https ou image locale en base64, rien d'autre", () => {
  assert.ok(isSafeImageUrl('https://exemple.fr/fond.jpg'))
  assert.ok(isSafeImageUrl('data:image/png;base64,iVBORw0KGgo='))
  for (const bad of [
    'http://exemple.fr/a.jpg',
    'javascript:alert(1)',
    'data:text/html;base64,PHNjcmlwdD4=',
    'data:image/svg+xml;base64,PHN2Zz4=',
    'https://exemple.fr/a.jpg") ; background:url("https://pistage.fr',
    'https://exemple.fr/a(1).jpg',
    "https://exemple.fr/a'.jpg",
    'https://user:pass@exemple.fr/a.jpg',
    'https://exemple.fr/a b.jpg',
    'file:///etc/passwd',
    '//exemple.fr/a.jpg',
    42,
  ]) assert.equal(isSafeImageUrl(bad), false, String(bad))
  assert.equal(sanitizeTheme({ colors: {}, image: { url: 'javascript:alert(1)' } }).image, null)
  assert.deepEqual(sanitizeTheme({ colors: {}, image: { url: 'https://a.fr/b.png', blur: 99, dim: 2 } }).image, { url: 'https://a.fr/b.png', blur: 30, dim: 0.9 })
})

test('export / import : code texte et fichier JSON, aller-retour identique', () => {
  const spec = { ...findTheme('g-aurora'), name: 'Aurore — été ☀️' }
  const code = encodeTheme(spec)
  assert.ok(code.startsWith('FCTHEME1:'))
  assert.deepEqual(decodeTheme(code), spec)
  assert.deepEqual(decodeTheme(`  ${code}\n`), spec)
  assert.deepEqual(decodeTheme(JSON.stringify(toExport(spec))), spec)
  assert.deepEqual(decodeTheme(JSON.stringify({ theme: toExport(spec) })), spec)
  for (const bad of ['', 'bonjour', 'FCTHEME1:@@@', 'FCTHEME1:' + btoa('[1,2]'), '{pas du json', '{"colors": 3}']) assert.equal(decodeTheme(bad), null, bad)
})

test('thèmes perso : identifiant contrôlé, doublons et excédent écartés', () => {
  const t = { ...findTheme('nord'), id: 'c-abcd1234' }
  const list = sanitizeCustomList([t, t, { ...t, id: '../../etc' }, { ...t, id: 'C-MAJ' }, 'x', null])
  assert.deepEqual(list.map(c => c.id), ['c-abcd1234'])
  const many = Array.from({ length: MAX_CUSTOM_THEMES + 5 }, (_, i) => ({ ...t, id: `c-id${String(i).padStart(4, '0')}` }))
  assert.equal(sanitizeCustomList(many).length, MAX_CUSTOM_THEMES)
  assert.deepEqual(sanitizeCustomList('pas une liste'), [])
})

test("accent du compte : appliqué seulement s'il est valide", () => {
  const nord = findTheme('nord')
  assert.equal(withAccent(nord, '#FF0000').colors.accent, '#ff0000')
  assert.equal(withAccent(nord, 'rouge').colors.accent, nord.colors.accent)
  assert.equal(withAccent(nord, null), nord)
})

test('le mobile embarque exactement le même module de thèmes', () => {
  const web = readFileSync(new URL('../src/theme/themeCore.ts', import.meta.url), 'utf8')
  const mobile = readFileSync(new URL('../../mobile/src/theme/themeCore.ts', import.meta.url), 'utf8')
  assert.equal(mobile, web, 'copier client/src/theme/themeCore.ts vers mobile/src/theme/themeCore.ts')
})
