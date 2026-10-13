// Apparence d'un serveur : node --test scripts/serverAppearance.test.mjs
// Mêmes règles que le serveur (server/src/models/server_look.rs) : liste blanche, bornes,
// couleurs entières, images seulement parmi nos envois ; aucun texte utilisateur dans le CSS.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import {
  accentFill, accentVars, backgroundCss, bannerBounds, bannerFocus, bannerOverlayCss, cleanAppearance,
  effectiveAppearance, iconRingCss, iconShape, patternCss, validImageRef, BG_PATTERNS,
} from '../src/lib/serverAppearance.ts'

test('vide, null ou valeurs par défaut : pas d’apparence', () => {
  assert.equal(cleanAppearance(null), null)
  assert.equal(cleanAppearance('dark'), null)
  assert.equal(cleanAppearance([]), null)
  assert.equal(cleanAppearance({}), null)
  assert.equal(cleanAppearance({ enforce: true }), null)
  assert.equal(cleanAppearance({ icon_shape: 'circle', welcome: 'classic', role_display: 'name', icon_ring: 'none' }), null)
})

test('identifiants hors liste et couleurs invalides ignorés', () => {
  const l = cleanAppearance({
    icon_shape: 'star', welcome: '<script>', role_display: 'rainbow', accent: '#ff0000', unread_color: 0x1000000,
    name: { font: 'Comic; color:red', effect: 'explode', colors: ['red', -1] },
    sidebar_bg: { kind: 'pattern', pattern: 'url(x)', color: 1 },
  })
  assert.equal(l, null)
})

test('nombres bornés, bannière normalisée', () => {
  const l = cleanAppearance({ banner: { focus_x: 500, focus_y: -3, height: 'huge', overlay: 'nope', overlay_strength: 900 } })
  assert.deepEqual(l.banner, { focus_x: 100, focus_y: 0, height: 'auto', overlay: 'bottom', overlay_strength: 100 })
  assert.equal(bannerFocus(l.banner), '100% 0%')
  assert.deepEqual(bannerBounds({ ...l.banner, height: 'compact' }), { min: 40, max: 96 })
  assert.ok(bannerBounds(undefined).max > bannerBounds({ ...l.banner, height: 'compact' }).max)
})

test('images de fond : seulement nos propres envois', () => {
  for (const bad of ['https://evil.example/x.png', '/uploads/avatars/x.png', '/uploads/server-banners/../x.png',
    '/uploads/server-banners/x.svg', 'javascript:alert(1)', '/uploads/server-banners/x y.png']) {
    assert.equal(validImageRef(bad), false, bad)
    assert.equal(cleanAppearance({ message_bg: { kind: 'image', image: bad } }), null, bad)
  }
  const l = cleanAppearance({ message_bg: { kind: 'image', image: '/uploads/server-banners/a_0b1c-2d.gif', blur: 99, opacity: -5 } })
  assert.equal(l.message_bg.image, '/uploads/server-banners/a_0b1c-2d.gif')
  assert.equal(l.message_bg.blur, 24)
  assert.equal(l.message_bg.opacity, 0)
})

test('styles : seulement des couleurs #rrggbb et des valeurs écrites dans le code', () => {
  const l = cleanAppearance({ accent: 0xff0000, accent2: 0x00ff00 })
  assert.deepEqual(accentVars(l), { '--fc-accent-rgb': '255 0 0' })
  assert.equal(accentFill(l), 'linear-gradient(135deg, #ff0000, #00ff00)')
  const g = backgroundCss({ kind: 'gradient', color: 0x112233, color2: 0x445566, angle: 45, opacity: 50, blur: 0 })
  assert.equal(g.backgroundImage, 'linear-gradient(45deg, #112233, #445566)')
  assert.equal(g.opacity, 0.5)
  for (const p of BG_PATTERNS) {
    const css = patternCss(p, 0xffffff)
    assert.ok(css.backgroundImage && !/url\(/.test(css.backgroundImage), p)
  }
  for (const o of ['bottom', 'top', 'full', 'vignette', 'accent']) {
    const css = bannerOverlayCss({ focus_x: 50, focus_y: 50, height: 'auto', overlay: o, overlay_strength: 50 }, 0x123456)
    assert.ok(css && !JSON.stringify(css).includes('url('), o)
  }
  assert.equal(bannerOverlayCss({ focus_x: 50, focus_y: 50, height: 'auto', overlay: 'none', overlay_strength: 50 }), undefined)
})

test('icône : forme et anneau', () => {
  assert.equal(iconShape(undefined).className, 'rounded-full')
  assert.match(iconShape('hexagon').style.clipPath, /^polygon\(/)
  assert.equal(iconRingCss(null), undefined)
  assert.match(iconRingCss(cleanAppearance({ icon_ring: 'glow', icon_ring_color: 0x00ffcc })).filter, /#00ffcc/)
})

test('refus du membre : ignoré si le serveur impose', () => {
  const free = cleanAppearance({ accent: 1 })
  const forced = cleanAppearance({ accent: 1, enforce: true })
  assert.equal(effectiveAppearance(free, true), null)
  assert.equal(effectiveAppearance(free, false), free)
  assert.equal(effectiveAppearance(forced, true), forced)
})
