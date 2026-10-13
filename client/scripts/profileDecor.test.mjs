// Décorations d'avatar, effets de profil et anneau : node --test scripts/profileDecor.test.mjs
// Mêmes listes que le serveur (server/src/models/user.rs, profile_style.rs) ; le mobile vérifie
// les siennes (mobile/__tests__/profile-decor.test.ts).
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import {
  DECORATIONS, DECO_GROUPS, FX_GROUPS, PROFILE_EFFECTS, DECO_OPTS_DEFAULT, DECO_RANGES,
  cleanDecoOpts, cleanIntensity, decoGlow, decoOptsPayload, decoVars, fxCount, isDefaultDecoOpts, matches, searchKey, tintColor,
} from '../src/lib/profileDecor.ts'
import { RING_STYLES, cleanRing, ringLook } from '../src/lib/avatarRing.ts'
import { fr } from '../src/i18n/fr.ts'
import { en } from '../src/i18n/en.ts'

const rs = (p) => readFileSync(new URL(`../../server/src/models/${p}`, import.meta.url), 'utf8')
/** Chaînes entre guillemets d'un `pub const NOM: &[&str] = &[...]` Rust. */
const rustList = (src, name) => [...(src.split(`${name}: &[&str] = &[`)[1]?.split('];')[0] ?? '').matchAll(/"([^"]*)"/g)].map(m => m[1])

test('mêmes décorations et effets, dans le même ordre, que la liste blanche du serveur', () => {
  const user = rs('user.rs')
  assert.deepEqual(DECORATIONS.map(d => d.id), rustList(user, 'AVATAR_DECORATIONS'))
  assert.deepEqual(PROFILE_EFFECTS.map(f => f.id), rustList(user, 'PROFILE_EFFECTS'))
  assert.ok(DECORATIONS.length >= 145, `${DECORATIONS.length} décorations`)
  assert.ok(PROFILE_EFFECTS.length >= 88, `${PROFILE_EFFECTS.length} effets`)
})

test('mêmes styles d’anneau que le serveur', () => {
  assert.deepEqual([...RING_STYLES], rustList(rs('profile_style.rs'), 'RING_STYLES'))
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
