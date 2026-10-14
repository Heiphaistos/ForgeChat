// Décorations d'avatar, effets de profil et anneau : node --test scripts/profileDecor.test.mjs
// Mêmes listes que le serveur (server/src/models/user.rs, profile_style.rs, avatar_ring.rs) ; le mobile vérifie
// les siennes (mobile/__tests__/profile-decor.test.ts).
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import {
  DECORATIONS, DECO_GROUPS, FX_GROUPS, PROFILE_EFFECTS, DECO_OPTS_DEFAULT, DECO_RANGES,
  cleanDecoOpts, cleanIntensity, decoGlow, decoOptsPayload, decoVars, fxCount, isDefaultDecoOpts, matches, searchKey, tintColor,
} from '../src/lib/profileDecor.ts'
import {
  RING_ANIMATED, RING_COLORS_MAX, RING_FILLS, RING_GAP_MAX, RING_RANGES, RING_SHAPES, RING_STATIC, RING_STYLES, RING_WIDTH_MAX,
  cleanRing, pickRing, ringLook,
} from '../src/lib/avatarRing.ts'
import { fr } from '../src/i18n/fr.ts'
import { en } from '../src/i18n/en.ts'

const rs = (p) => readFileSync(new URL(`../../server/src/models/${p}`, import.meta.url), 'utf8')
/** Chaînes entre guillemets d'un `pub const NOM: &[&str] = &[...]` Rust. */
const rustList = (src, name) => [...(src.split(`${name}: &[&str] = &[`)[1]?.split('];')[0] ?? '').matchAll(/"([^"]*)"/g)].map(m => m[1])

test('mêmes décorations et effets, dans le même ordre, que la liste blanche du serveur', () => {
  const user = rs('user.rs')
  assert.deepEqual(DECORATIONS.map(d => d.id), rustList(user, 'AVATAR_DECORATIONS'))
  assert.deepEqual(PROFILE_EFFECTS.map(f => f.id), rustList(user, 'PROFILE_EFFECTS'))
  assert.ok(DECORATIONS.length >= 215, `${DECORATIONS.length} décorations`)
  assert.ok(PROFILE_EFFECTS.length >= 143, `${PROFILE_EFFECTS.length} effets`)
})

/** Constantes de l'anneau v2 : avatar_ring.rs (repli profile_style.rs tant qu'il n'existe pas). */
const ringRs = () => {
  try { return rs('avatar_ring.rs') } catch { return rs('profile_style.rs') }
}
const rustNum = (src, name) => Number(src.match(new RegExp(`pub const ${name}: \\w+ = (\\d+);`))?.[1])
const rustRange = (src, name) => src.match(new RegExp(`pub const ${name}: [^=]+= (\\d+)\\.\\.=(\\d+);`))?.slice(1).map(Number)

test('anneau v2 : mêmes listes et mêmes bornes que le serveur (avatar_ring.rs)', () => {
  const src = ringRs()
  assert.deepEqual([...RING_STYLES], rustList(src, 'RING_STYLES'))
  assert.deepEqual([...RING_FILLS], rustList(src, 'RING_FILLS'))
  assert.deepEqual([...RING_SHAPES], rustList(src, 'RING_SHAPES'))
  assert.equal(RING_COLORS_MAX, rustNum(src, 'RING_COLORS_MAX'))
  assert.equal(RING_WIDTH_MAX, rustNum(src, 'RING_WIDTH_MAX'))
  assert.equal(RING_GAP_MAX, rustNum(src, 'RING_GAP_MAX'))
  assert.deepEqual([...RING_RANGES.segments], rustRange(src, 'RING_SEGMENTS_RANGE'))
  assert.deepEqual([...RING_RANGES.intensity], rustRange(src, 'INTENSITY_RANGE'))
})

test('anneau v2 : 34 styles, statiques / animés selon le contrat, libellés traduits', () => {
  assert.equal(RING_STYLES.length, 34)
  assert.deepEqual([...RING_STATIC].sort(), ['dashed', 'dotted', 'double', 'glow', 'halo', 'segmented', 'solid', 'stripes'])
  assert.equal(RING_STATIC.length + RING_ANIMATED.length, RING_STYLES.length)
  for (const s of RING_STYLES) assert.ok(fr[`ring.style.${s}`] && en[`ring.style.${s}`], s)
  for (const f of RING_FILLS) assert.ok(fr[`ring.fill.${f}`] && en[`ring.fill.${f}`], f)
  for (const s of RING_SHAPES) assert.ok(fr[`ring.shape.${s}`] && en[`ring.shape.${s}`], s)
})

test('anneau v2 : nettoyage borné, défauts retirés, entrée hostile', () => {
  assert.equal(cleanRing([1, 2]), null)
  assert.equal(cleanRing('x'), null)
  const r = cleanRing({
    colors: [1, 2, 3, 4, 5, 6, 7, 8, 9, 10], width: 99, style: 'orbit', fill: 'radial', angle: 400, shape: 'squircle',
    gap: 50, segments: 1, opacity: 5, intensity: 999, speed: 100, glow: 100, css: 'x',
  })
  assert.deepEqual(r, { colors: [1, 2, 3, 4, 5, 6, 7, 8], width: 12, style: 'orbit', fill: 'radial', angle: 360, shape: 'squircle', gap: 8, segments: 2, opacity: 20, intensity: 200 })
  const d = cleanRing({ colors: [1], fill: 'conic', shape: 'circle', angle: 0, segments: 12, opacity: 100, intensity: 100, gap: -4 })
  assert.deepEqual(d, { colors: [1], width: 3, style: 'solid', gap: 0 })
  assert.deepEqual(cleanRing({ colors: [1], fill: 'url(x)', shape: 'evil', gap: '2' }), { colors: [1], width: 3, style: 'solid' })
  // Ancien anneau v1 inchangé.
  assert.deepEqual(cleanRing({ colors: [1, 2, 3], width: 8, style: 'breathe' }), { colors: [1, 2, 3], width: 8, style: 'breathe' })
})

test('anneau v2 : style produit sûr pour chaque style, remplissage et forme', () => {
  const safe = /^[a-z0-9#().,%\s-]+$/
  for (const style of RING_STYLES) for (const fill of RING_FILLS) for (const shape of RING_SHAPES) {
    const look = ringLook(cleanRing({ colors: [0xff0000, 0x00ff00, 0x0000ff], width: 6, style, fill, shape, angle: 45, segments: 7, gap: 3 }), 40)
    if (look.background) assert.match(look.background, safe, `${style}/${fill}`)
    assert.match(look.radius, /^(9999px|\d+%)$/)
    for (const v of Object.values(look.vars)) assert.match(v, /^(-?[\d.]+(px)?|#[0-9a-f]{6}|transparent)$/, style)
  }
  const look = ringLook(cleanRing({ colors: [1], opacity: 40, intensity: 150 }), 72)
  assert.equal(look.vars['--ring-op'], '0.4')
  assert.equal(look.vars['--ring-int'], '1.5')
  assert.equal(ringLook(cleanRing({ colors: [1], gap: 0 }), 72).gap, 0)
  assert.ok(ringLook(cleanRing({ colors: [1], style: 'ripple' }), 72).echo)
})

test('anneau affiché : serveur sinon global', () => {
  const g = { colors: [1] }
  const s = { colors: [2] }
  assert.equal(pickRing(s, g), s)
  assert.equal(pickRing(null, g), g)
  assert.equal(pickRing({}, g), g)
  assert.equal(pickRing(null, null), undefined)
})

test('chaque décoration et chaque effet dans exactement une catégorie, libellés traduits', () => {
  for (const [list, groups] of [[DECORATIONS, DECO_GROUPS], [PROFILE_EFFECTS, FX_GROUPS]]) {
    const ids = groups.flatMap(g => g.ids)
    assert.equal(new Set(ids).size, ids.length, 'doublon de catégorie')
    assert.deepEqual([...ids].sort(), list.map(x => x.id).sort())
    for (const g of groups) assert.ok(fr[g.label] && en[g.label], g.label)
    for (const x of list) assert.ok(fr[x.label] && en[x.label], x.label)
  }
})

test('catalogue : couleurs constantes « #rrggbb » ou transparent, glyphes courts', () => {
  const color = /^(#[0-9a-f]{6}|transparent)$/
  for (const d of DECORATIONS) {
    for (const c of [...d.colors, d.glow, d.aura, d.ripple, d.arcs].filter(Boolean)) assert.match(c, color, d.id)
    if (d.orbitN) assert.ok(d.orbitN >= 1 && d.orbitN <= 6, d.id)
    if (d.wreath) assert.ok([...d.wreath].length <= 10, d.id)
  }
  for (const f of PROFILE_EFFECTS) for (const c of f.colors) assert.match(c, color, f.id)
})

test('réglages reçus nettoyés et bornés (mêmes bornes que le serveur)', () => {
  assert.deepEqual(cleanDecoOpts(null), DECO_OPTS_DEFAULT)
  assert.deepEqual(cleanDecoOpts('hue-rotate(9deg)'), DECO_OPTS_DEFAULT)
  const o = cleanDecoOpts({ speed: 9999, hue: -5, scale: 1.2, opacity: 0, tint: 0x1000000, direction: 'left', animate: 'no', css: 'x' })
  assert.equal(o.speed, 400)
  assert.equal(o.hue, 0)
  assert.equal(o.scale, 80)
  assert.equal(o.opacity, 20)
  assert.equal(o.tint, null)
  assert.equal(o.direction, 'cw')
  assert.equal(o.animate, true)
  assert.ok(!('css' in o))
  const ps = rs('profile_style.rs')
  for (const [k, [min, max]] of Object.entries(DECO_RANGES)) {
    const name = { speed: 'SPEED', brightness: 'BRIGHTNESS', saturation: 'SATURATION', glow: 'GLOW', opacity: 'OPACITY', hue: 'HUE', scale: 'SCALE' }[k]
    assert.ok(ps.includes(`${name}_RANGE: std::ops::RangeInclusive<u16> = ${min}..=${max};`), k)
  }
})

test('corps envoyé : seulement ce qui change ({} = défaut)', () => {
  assert.deepEqual(decoOptsPayload({ ...DECO_OPTS_DEFAULT }), {})
  assert.ok(isDefaultDecoOpts({ ...DECO_OPTS_DEFAULT }))
  assert.deepEqual(decoOptsPayload({ ...DECO_OPTS_DEFAULT, hue: 90, direction: 'ccw', tint: 0xff0000 }), { hue: 90, direction: 'ccw', tint: 0xff0000 })
})

test('variables CSS : des nombres et une couleur calculée, jamais une chaîne reçue', () => {
  const deco = DECORATIONS.find(d => d.id === 'neon')
  const o = cleanDecoOpts({ speed: 200, direction: 'ccw', hue: 45, brightness: 150, saturation: 0, opacity: 50, glow: 200, tint: 0x00ff00 })
  const vars = decoVars(o, decoGlow(deco, 4, o))
  assert.deepEqual(Object.keys(vars).sort(), ['--deco-bright', '--deco-glow-c', '--deco-glow-r', '--deco-hue', '--deco-opacity', '--deco-sat', '--deco-speed', '--deco-turn'])
  assert.equal(vars['--deco-speed'], '2')
  assert.equal(vars['--deco-turn'], '-1')
  assert.equal(vars['--deco-hue'], '45deg')
  for (const v of Object.values(vars)) assert.match(v, /^(-?[\d.]+(deg|px)?|#[0-9a-f]{6}|transparent)$/)
  // Halo coupé à 0 %.
  assert.equal(decoGlow(deco, 4, cleanDecoOpts({ glow: 0 })).radius, 0)
})

test('teinte : mélange de couleurs constantes', () => {
  assert.equal(tintColor('#000000', 0xffffff, 0.5), '#808080')
  assert.equal(tintColor('#123456', null), '#123456')
  assert.equal(tintColor('transparent', 0xff0000), 'transparent')
})

test('intensité de l’effet', () => {
  const fx = PROFILE_EFFECTS.find(f => f.id === 'snow')
  assert.equal(fxCount(fx, 100), 14)
  assert.equal(fxCount(fx, 200), 28)
  assert.equal(fxCount(fx, 1), Math.round(14 * 0.25))
  assert.equal(cleanIntensity('x'), 100)
  assert.equal(fxCount(PROFILE_EFFECTS.find(f => f.id === 'cyber_grid'), 200), 0)
  for (const f of PROFILE_EFFECTS) assert.ok(fxCount(f, 200) <= 90)
})

test('recherche sans accents ni casse', () => {
  assert.ok(matches(searchKey('ÉCLAIR'), 'Éclair'))
  assert.ok(matches(searchKey('cat'), 'Oreilles de chat', 'cat_ears'))
  assert.ok(!matches(searchKey('zzz'), 'Or', 'gold'))
})

test('anneau : nettoyage, réglages et style sûr', () => {
  assert.equal(cleanRing({ colors: [] }), null)
  const r = cleanRing({ colors: [0xff0000, 0x00ff00], style: 'comet', speed: 1000, direction: 'ccw', brightness: 10, glow: 150, css: 'x' })
  assert.deepEqual(r, { colors: [0xff0000, 0x00ff00], width: 3, style: 'comet', speed: 400, direction: 'ccw', brightness: 50, glow: 150 })
  assert.equal(cleanRing({ colors: [1], style: 'evil;' }).style, 'solid')
  const look = ringLook(r, 72)
  assert.equal(look.vars['--deco-turn'], '-1')
  assert.equal(look.vars['--ring-speed'], '4')
  assert.ok(look.animated && look.filtered)
  for (const s of RING_STYLES) assert.ok(ringLook({ colors: [1], width: 3, style: s }, 40))
})
