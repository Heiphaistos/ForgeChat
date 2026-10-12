// Style du pseudo : node --test scripts/nameStyle.test.mjs
// Le mobile vérifie les mêmes règles (mobile/__tests__/nameStyle.test.ts).
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { clampInt, cleanStyle, colorFromInput, contrast, nameCss, pickNameStyle, readable, shownName, stillUrl, MIN_CONTRAST, DEFAULT_BG } from '../src/lib/nameStyle.ts'

test('dégradé : couleurs lisibles, angle, texte découpé', () => {
  const css = nameCss({ colors: [0xff0000, 0x00ff00, 0x0000ff], angle: 45 })
  assert.match(css.backgroundImage, /^linear-gradient\(45deg, #ff\w{4}, #\w{6}, #\w{6}\)$/)
  assert.equal(css.color, 'transparent')
  assert.equal(css.backgroundClip, 'text')
  assert.equal(css.WebkitBackgroundClip, 'text')
})

test('couleur unie, police, lueur, contour, reflet', () => {
  assert.deepEqual(nameCss({ colors: [0xffd166] }), { color: '#ffd166' })
  assert.equal(nameCss({ font: 'heavy' }).fontWeight, '900')
  assert.match(nameCss({ font: 'mono' }).fontFamily, /monospace/)
  assert.match(nameCss({ colors: [0xffd166], effect: 'glow' }).textShadow, /#ffd166/)
  assert.match(nameCss({ effect: 'outline' }).filter, /drop-shadow/)
  const shimmer = nameCss({ colors: [0xff5c8a], effect: 'shimmer' })
  assert.equal(shimmer.color, 'transparent')
  assert.match(shimmer.backgroundImage, /rgba\(255,255,255/)
  assert.deepEqual(nameCss(null), {})
})

test('contraste minimal : couleur trop sombre éclaircie sur fond sombre', () => {
  const dark = 0x0a0a20
  assert.ok(contrast(dark, DEFAULT_BG) < MIN_CONTRAST)
  const fixed = readable(dark)
  assert.ok(contrast(fixed, DEFAULT_BG) >= MIN_CONTRAST, `ratio ${contrast(fixed, DEFAULT_BG)}`)
  assert.equal(readable(0xffd166), 0xffd166) // déjà lisible : inchangée
  // Fond clair : une couleur trop claire est assombrie.
  assert.ok(contrast(readable(0xfff8e0, 0xffffff), 0xffffff) >= MIN_CONTRAST)
  assert.equal(nameCss({ colors: [0x000000] }).color === '#000000', false)
})

test('priorité rôle / perso', () => {
  const perso = { colors: [0xff0000], effect: 'shimmer', font: 'serif' }
  // Serveur où le rôle l'emporte (défaut) : couleur du rôle, police perso gardée.
  assert.deepEqual(pickNameStyle(perso, true, true), { personal: { font: 'serif' }, useRole: true })
  // Serveur qui laisse chacun sa couleur : style perso.
  assert.deepEqual(pickNameStyle(perso, true, false), { personal: perso, useRole: false })
  // Sans rôle coloré (MP) : style perso.
  assert.deepEqual(pickNameStyle(perso, false, true), { personal: perso, useRole: false })
  // Sans couleur perso : le rôle reste affiché même si le serveur laisse chacun sa couleur.
  assert.equal(pickNameStyle({ font: 'mono' }, true, false).useRole, true)
  assert.deepEqual(pickNameStyle(null, false, true), { personal: null, useRole: false })
})

test('style reçu nettoyé (jamais de CSS brut)', () => {
  assert.equal(cleanStyle(null), null)
  assert.equal(cleanStyle({}), null)
  assert.equal(cleanStyle('color:red'), null)
  const s = cleanStyle({ colors: [0x123456, 'red', -1, 0x1000000, 1, 2, 3], font: 'Comic;}', effect: 'blink', angle: 999 })
  assert.deepEqual(s, { colors: [0x123456, 1, 2], angle: 360, effect: '', font: '' })
})

test('nom affiché et version fixe des images animées', () => {
  assert.equal(shownName('momo'), 'momo')
  assert.equal(shownName('momo', 'Momo ✨'), 'Momo ✨')
  assert.equal(shownName('momo', 'Momo ✨', 'Chef'), 'Chef')
  assert.equal(shownName('momo', '   ', ''), 'momo')
  assert.equal(stillUrl('/uploads/avatars/a_0b1c2d3e-aaaa-bbbb-cccc-111122223333.gif'), '/uploads/avatars/a_0b1c2d3e-aaaa-bbbb-cccc-111122223333_s.gif')
  assert.equal(stillUrl('/uploads/avatars/0b1c2d3e.png'), null)
  assert.equal(stillUrl('/uploads/banners/a_x.jpg'), null)
})

test('éditeurs : couleur de sélecteur validée, nombres bornés, contour comme le serveur', () => {
  assert.equal(colorFromInput('#ff8800'), 0xff8800)
  assert.equal(colorFromInput('#FF8800'), 0xff8800)
  for (const bad of ['red', '#fff', '#ff8800;x', 'url(x)', '', '#12345g']) assert.equal(colorFromInput(bad), null)
  assert.equal(clampInt(9, 1, 8), 8)
  assert.equal(clampInt(-3, 0, 4), 0)
  assert.equal(clampInt(NaN, 1, 8), 1)
  assert.equal(clampInt(2.6, 0, 4), 3)
  // Contour : épaisseur bornée à 4, retiré sans épaisseur, noir par défaut.
  assert.deepEqual(cleanStyle({ outline_width: 9, outline: 0xffffff }), { colors: [], angle: 90, effect: '', font: '', outline_width: 4, outline: 0xffffff })
  assert.equal(cleanStyle({ outline: 0xffffff }), null)
  assert.equal(nameCss(cleanStyle({ outline_width: 2 })).WebkitTextStroke, '2px #000000')
  // Marque : identifiants inconnus et couleurs hors bornes écartés.
  assert.deepEqual(cleanStyle({ tag: { badge: 'neon', icon: '<img>', font: 'x;y', color2: 0x1000000, color: 0x00ff00 } }).tag, { color: 0x00ff00, badge: 'neon' })
})
