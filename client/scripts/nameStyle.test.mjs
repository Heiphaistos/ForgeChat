// Style du pseudo : node --test scripts/nameStyle.test.mjs
// Le mobile vérifie les mêmes règles (mobile/__tests__/nameStyle.test.ts).
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync, statSync, readdirSync } from 'node:fs'
import {
  clampInt, cleanStyle, colorFromInput, contrast, fontCss, gradientImage, nameClass, nameCss, nameFontStacks, perLetter, pickNameStyle, readable, shownName, stillUrl,
  MIN_CONTRAST, DEFAULT_BG, NAME_EFFECTS, NAME_FONTS, NAME_GRADIENTS, OUTLINE_STYLES, NAME_COLORS_MAX, OUTLINE_WIDTH_MAX, LEVEL_MAX, LEVEL_DEFAULT,
} from '../src/lib/nameStyle.ts'
import { NAME_PRESET_GROUPS } from '../src/lib/namePresets.ts'
import { fr } from '../src/i18n/fr.ts'

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
  assert.deepEqual(s, { colors: [0x123456, 1, 2, 3], angle: 360, effect: '', font: '' })
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
  // Contour : épaisseur bornée à 6, retiré sans épaisseur, noir par défaut.
  assert.deepEqual(cleanStyle({ outline_width: 9, outline: 0xffffff }), { colors: [], angle: 90, effect: '', font: '', outline_width: 6, outline: 0xffffff })
  assert.equal(cleanStyle({ outline: 0xffffff }), null)
  assert.equal(nameCss(cleanStyle({ outline_width: 2 })).WebkitTextStroke, '2px #000000')
  // Marque : identifiants inconnus et couleurs hors bornes écartés.
  assert.deepEqual(cleanStyle({ tag: { badge: 'neon', icon: '<img>', font: 'x;y', color2: 0x1000000, color: 0x00ff00 } }).tag, { color: 0x00ff00, badge: 'neon' })
})

const read = (rel) => readFileSync(new URL(rel, import.meta.url), 'utf8')
/** Chaînes d'un `pub const NOM: &[&str] = &[...]` Rust ou d'un `export const NOM = [...]` TS. */
const rustList = (src, name) => [...(src.split(`${name}: &[&str] = &[`)[1]?.split('];')[0] ?? '').matchAll(/"([^"]*)"/g)].map(m => m[1])
const tsList = (src, name) => [...(src.split(`export const ${name} = [`)[1]?.split('] as const')[0] ?? '').matchAll(/'([^']*)'/g)].map(m => m[1])
const rustNum = (src, name) => Number(src.match(new RegExp(`pub const ${name}: \\w+ = (\\d+);`))?.[1])
const tsNum = (src, name) => Number(src.match(new RegExp(`export const ${name} = (\\d+)`))?.[1])

test('listes blanches identiques : serveur, web et mobile', () => {
  const server = read('../../server/src/models/profile_style.rs')
  const mobile = read('../../mobile/src/lib/nameStyle.ts')
  const lists = { NAME_EFFECTS, NAME_FONTS, NAME_GRADIENTS, OUTLINE_STYLES }
  for (const [name, list] of Object.entries(lists)) {
    assert.deepEqual(rustList(server, name), [...list], `serveur ${name}`)
    assert.deepEqual(tsList(mobile, name), [...list], `mobile ${name}`)
    assert.equal(new Set(list).size, list.length, `doublon dans ${name}`)
  }
  for (const [name, v] of Object.entries({ NAME_COLORS_MAX, OUTLINE_WIDTH_MAX, LEVEL_MAX, LEVEL_DEFAULT })) {
    assert.equal(rustNum(server, name), v, `serveur ${name}`)
    assert.equal(tsNum(mobile, name), v, `mobile ${name}`)
  }
  assert.ok(NAME_EFFECTS.length - 1 >= 40, `${NAME_EFFECTS.length - 1} effets`)
  assert.ok(NAME_FONTS.length - 1 >= 60, `${NAME_FONTS.length - 1} polices`)
  assert.equal(NAME_COLORS_MAX, 5)
  assert.equal(OUTLINE_WIDTH_MAX, 6)
})

test('libellés : chaque effet, police, famille, dégradé et contour est traduit', () => {
  for (const e of NAME_EFFECTS) assert.ok(fr[`profileId.effect.${e || 'none'}`], `effet ${e}`)
  for (const f of NAME_FONTS) assert.ok(fr[`profileId.font.${f || 'default'}`], `police ${f}`)
  for (const g of NAME_PRESET_GROUPS) assert.ok(fr[`nameStyle.group.${g.id}`], `famille ${g.id}`)
  for (const g of NAME_GRADIENTS) assert.ok(fr[`nameStyle.gradient.${g || 'linear'}`], `dégradé ${g}`)
  for (const o of OUTLINE_STYLES) assert.ok(fr[`nameStyle.outlineStyle.${o || 'solid'}`], `contour ${o}`)
})

test('préréglages : 60 couleurs unies et 40 dégradés au moins, par familles', () => {
  const solids = NAME_PRESET_GROUPS.flatMap(g => g.solids)
  const gradients = NAME_PRESET_GROUPS.flatMap(g => g.gradients)
  assert.ok(solids.length >= 60, `${solids.length} unies`)
  assert.ok(gradients.filter(p => p.length >= 2 && p.length <= 3).length >= 40, 'dégradés de 2-3 couleurs')
  for (const id of ['pastel', 'neon', 'metal', 'gems', 'nature', 'sunset', 'ocean', 'galaxy', 'pride', 'teams', 'holo']) {
    assert.ok(NAME_PRESET_GROUPS.some(g => g.id === id), id)
  }
  for (const p of [...solids.map(c => [c]), ...gradients]) {
    assert.ok(p.length >= 1 && p.length <= NAME_COLORS_MAX)
    for (const c of p) assert.ok(Number.isInteger(c) && c >= 0 && c <= 0xffffff)
    // Le préréglage passe tel quel la validation (aucune couleur retirée).
    assert.deepEqual(cleanStyle({ colors: p }).colors, p)
  }
  assert.equal(new Set(gradients.map(p => p.join())).size, gradients.length, 'dégradé en double')
})

test('types de dégradé : linéaire, radial, conique, animé', () => {
  const stops = ['#ff0000', '#00ff00', '#0000ff']
  assert.equal(gradientImage('', 45, stops), 'linear-gradient(45deg, #ff0000, #00ff00, #0000ff)')
  assert.match(gradientImage('radial', 45, stops), /^radial-gradient\(ellipse at center, /)
  assert.match(gradientImage('conic', 45, stops), /^conic-gradient\(from 45deg at 50% 50%, #ff0000, #00ff00, #0000ff, #ff0000\)$/)
  const flow = cleanStyle({ colors: [0xff5c8a, 0x5ee7df, 0xffd166, 0x7dffb0, 0xb388ff], gradient: 'flow' })
  assert.equal(flow.colors.length, 5)
  assert.equal(nameClass(flow), ' fc-name-fx fc-name-flow')
  assert.equal(nameCss(flow).backgroundSize, '200% 100%')
  // Une seule couleur : pas de dégradé ; type inconnu écarté.
  assert.equal(cleanStyle({ colors: [1], gradient: 'radial' }).gradient, undefined)
  assert.equal(cleanStyle({ colors: [1, 2], gradient: 'url(x)' }).gradient, undefined)
  assert.equal(cleanStyle({ colors: [1, 2, 3, 4, 5, 6, 7] }).colors.length, 5)
})

test('intensité et vitesse : bornées, seulement avec un effet, lues par les animations', () => {
  assert.deepEqual(cleanStyle({ effect: 'glow', intensity: 99, speed: -4 }), { colors: [], angle: 90, effect: 'glow', font: '', intensity: 10, speed: 1 })
  assert.deepEqual(cleanStyle({ font: 'serif', intensity: 9, speed: 9 }), { colors: [], angle: 90, effect: '', font: 'serif' })
  assert.equal(cleanStyle({ effect: 'glow', intensity: 5 }).intensity, undefined)
  assert.equal(nameCss(cleanStyle({ effect: 'rainbow', speed: 10 }))['--fc-fx-k'], '0.3')
  assert.equal(nameCss(cleanStyle({ effect: 'rainbow', speed: 1 }))['--fc-fx-k'], '2.5')
  const weak = nameCss({ colors: [0xffd166], effect: 'glow', intensity: 1 }).textShadow
  const strong = nameCss({ colors: [0xffd166], effect: 'glow', intensity: 10 }).textShadow
  assert.equal(weak, '0 0 1.2px #ffd166')
  assert.equal(strong, '0 0 12px #ffd166')
})

test('contour : double (2ᵉ couleur), lumineux, rôle prioritaire garde le contour', () => {
  const d = cleanStyle({ outline_width: 3, outline: 0xff0000, outline_style: 'double' })
  assert.equal(d.outline2, 0xffffff)
  const css = nameCss({ ...d, outline2: 0x00ff00 })
  assert.equal(css.WebkitTextStroke, '3px #ff0000')
  assert.match(css.filter, /drop-shadow\(1px 0 0 #00ff00\)/)
  assert.match(nameCss(cleanStyle({ outline_width: 2, outline: 0x00ffff, outline_style: 'glow' })).filter, /drop-shadow\(0 0 4px #00ffff\)/)
  assert.equal(cleanStyle({ outline_width: 2, outline_style: 'glow', outline2: 5 }).outline2, undefined)
  assert.equal(cleanStyle({ outline_width: 2, outline_style: 'dashed' }).outline_style, undefined)
  const kept = pickNameStyle({ colors: [1], outline: 2, outline_width: 3, outline_style: 'double', outline2: 4 }, true, true)
  assert.deepEqual(kept.personal, { outline: 2, outline_width: 3, outline_style: 'double', outline2: 4 })
})

test('effets : tous distincts, animations en CSS, figées si « réduire les animations »', () => {
  const css = read('../src/profileStyles.css') + read('../src/index.css')
  const sample = { colors: [0xff5c8a, 0x5ee7df], angle: 90, font: '' }
  const seen = new Map()
  for (const effect of NAME_EFFECTS) {
    const s = { ...sample, effect }
    const cls = nameClass(s)
    const key = JSON.stringify([nameCss(s), cls, perLetter(s)])
    assert.ok(!seen.has(key), `${effect} identique à ${seen.get(key)}`)
    seen.set(key, effect || 'none')
    for (const c of cls.trim().split(/\s+/).filter(Boolean)) {
      assert.ok(css.includes(`.${c}`), `classe .${c} absente du CSS`)
      // Tout effet animé passe par .fc-name-fx (ou .fc-name-shimmer) : coupé par la règle de réduction.
      assert.ok(cls.includes('fc-name-fx') || cls.includes('fc-name-shimmer'), effect)
    }
  }
  const reduce = css.split('@media (prefers-reduced-motion: reduce)').slice(1).join('')
  assert.match(reduce, /\.fc-name-fx, \.fc-name-fx > \.fc-ch, \.fc-name-shimmer \{ animation: none !important; \}/)
  assert.match(css, /\[data-reduce-motion="true"\] \.fc-name-fx > \.fc-ch \{ animation: none !important; \}/)
  // Chaque animation de pseudo lit la vitesse (--fc-fx-k).
  for (const m of css.matchAll(/\.fc-name-[\w-]+(?: > \.fc-ch|::after|::before)?\s*\{[^}]*animation:([^;]+);/g)) {
    if (/animation: none/.test(m[0])) continue
    assert.match(m[1], /var\(--fc-fx-k, 1\)/, m[0].slice(0, 60))
  }
})

test('jamais de CSS venu d’un utilisateur : seulement des valeurs écrites ici', () => {
  const hostile = { colors: ['red;}', 0x123456, 'url(x)'], effect: 'glow;x', font: 'serif" onload', gradient: 'conic,url(x)', outline_style: 'double;x', outline_width: 3, outline2: 'url(x)', intensity: '9;', speed: {} }
  assert.deepEqual(cleanStyle(hostile), { colors: [0x123456], angle: 90, effect: '', font: '', outline_width: 3, outline: 0 })
  for (const effect of NAME_EFFECTS) for (const gradient of NAME_GRADIENTS) for (const outline_style of OUTLINE_STYLES) {
    const out = nameCss(cleanStyle({ colors: [0x123456, 0xabcdef, 0xffffff], effect, gradient, outline_style, outline_width: 2, intensity: 7, speed: 3 }))
    for (const [k, v] of Object.entries(out)) {
      if (v === undefined) continue
      assert.ok(!/url\(|javascript|expression|[;{}<>\\]/i.test(v), `${effect}/${k}: ${v}`)
    }
  }
})

test('polices : 60 au moins, piles bornées, polices embarquées présentes et légères', () => {
  for (const f of NAME_FONTS.slice(1)) assert.ok(Object.keys(fontCss(f)).length > 0, f)
  const stacks = nameFontStacks()
  assert.ok(stacks.length >= 40, `${stacks.length} piles pour l'appli`)
  for (const { id, stack } of stacks) {
    // user_settings.font_family est un VARCHAR(100) (migration 010).
    assert.ok(stack.length <= 100, `${id} : ${stack.length} caractères`)
    assert.match(stack, /(serif|monospace|cursive|fantasy)$/, id)
  }
  const faces = read('../src/bundledFonts.css')
  const families = [...faces.matchAll(/font-family: '([^']+)'/g)].map(m => m[1])
  const files = [...faces.matchAll(/url\('\/fonts\/([\w-]+\.woff2)'\)/g)].map(m => m[1])
  assert.equal(families.length, files.length)
  assert.ok(families.length >= 6)
  // Chaque police embarquée sert au moins une pile ; chaque « FC … » cité est déclaré.
  const all = NAME_FONTS.map(f => fontCss(f).fontFamily ?? '').join(' ')
  for (const fam of families) assert.ok(all.includes(`"${fam}"`), fam)
  for (const m of all.matchAll(/"(FC [^"]+)"/g)) assert.ok(families.includes(m[1]), m[1])
  const dir = new URL('../public/fonts/', import.meta.url)
  let total = 0
  for (const f of readdirSync(dir)) if (f.endsWith('.woff2')) total += statSync(new URL(f, dir)).size
  for (const f of files) assert.ok(statSync(new URL(f, dir)).size < 200_000, f)
  assert.ok(total < 3_000_000, `${total} octets`)
  assert.match(read('../public/fonts/OFL.txt'), /SIL OPEN FONT LICENSE Version 1\.1/)
})
