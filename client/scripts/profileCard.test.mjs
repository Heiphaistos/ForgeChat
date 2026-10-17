// Carte de profil (users.profile_card) : node --test scripts/profileCard.test.mjs
// Mêmes listes et bornes que le serveur (server/src/models/profile_card.rs).
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import {
  BANNER_FX, CARD_DEFAULT, CARD_LAYOUTS, CARD_PATTERNS, CARD_RADIUS_MAX, CARD_STYLES, NAME_ALIGNS,
  cardLook, cardPayload, cleanCard,
} from '../src/lib/profileCard.ts'
import { fr } from '../src/i18n/fr.ts'
import { en } from '../src/i18n/en.ts'

const rs = (p) => readFileSync(new URL(`../../server/src/models/${p}`, import.meta.url), 'utf8')
const rustList = (src, name) => [...(src.split(`${name}: &[&str] = &[`)[1]?.split('];')[0] ?? '').matchAll(/"([^"]*)"/g)].map(m => m[1])
const rustNum = (src, name) => Number(src.match(new RegExp(`pub const ${name}: \\w+ = (\\d+);`))?.[1])

test('mêmes listes et même arrondi maximal que le serveur (profile_card.rs)', () => {
  const src = rs('profile_card.rs')
  assert.deepEqual([...CARD_LAYOUTS], rustList(src, 'CARD_LAYOUTS'))
  assert.deepEqual([...CARD_STYLES], rustList(src, 'CARD_STYLES'))
  assert.deepEqual([...CARD_PATTERNS], rustList(src, 'CARD_PATTERNS'))
  assert.deepEqual([...BANNER_FX], rustList(src, 'BANNER_FX'))
  assert.deepEqual([...NAME_ALIGNS], rustList(src, 'NAME_ALIGNS'))
  assert.equal(CARD_RADIUS_MAX, rustNum(src, 'CARD_RADIUS_MAX'))
})

test('nettoyage : bornes, listes blanches, entrée hostile', () => {
  assert.deepEqual(cleanCard(null), CARD_DEFAULT)
  assert.deepEqual(cleanCard([1]), CARD_DEFAULT)
  assert.deepEqual(cleanCard('layout'), CARD_DEFAULT)
  const c = cleanCard({ layout: 'wide', card: 'neon;x', pattern: 'dots', banner_y: 140, banner_fx: 'blur', radius: 99, angle: -5, show_badges: 'no', show_links: false, name_align: 'center', css: 'x' })
  assert.deepEqual(c, { layout: 'wide', card: 'solid', pattern: 'dots', banner_y: 100, banner_fx: 'blur', radius: CARD_RADIUS_MAX, angle: 0, show_badges: true, show_links: false, name_align: 'center' })
  assert.ok(!('css' in c))
})

test('corps envoyé : seulement ce qui change, null = par défaut', () => {
  assert.equal(cardPayload({ ...CARD_DEFAULT }), null)
  assert.deepEqual(cardPayload({ ...CARD_DEFAULT, layout: 'compact', radius: 0, show_badges: false }), { layout: 'compact', radius: 0, show_badges: false })
  // Pire cas sous PROFILE_CARD_MAX_BYTES (512).
  const max = cardPayload({ layout: 'centered', card: 'gradient', pattern: 'diagonal', banner_y: 100, banner_fx: 'duotone', radius: 24, angle: 360, show_badges: false, show_links: false, name_align: 'center' })
  assert.ok(JSON.stringify(max).length <= 512)
})

test('apparence : nombres et « #rrggbb » calculés seulement ; profils existants inchangés', () => {
  const safe = /^[a-z0-9#().,%\s-]+$/i
  for (const card of CARD_STYLES) for (const layout of CARD_LAYOUTS) {
    const look = cardLook(cleanCard({ card, layout, angle: 90, radius: 20 }), 0x112233, 0xaabbcc)
    for (const v of Object.values(look.style)) assert.match(v, safe, `${card}/${layout}`)
    assert.match(look.banner.focus, /^50% \d+%$/)
  }
  // « solid » sans couleur : fond de l'app ; avec couleurs : l'ancien dégradé voilé.
  assert.equal(cardLook(CARD_DEFAULT).style.background, undefined)
  assert.match(cardLook(CARD_DEFAULT, 0xff0000, null).style.background, /160deg, #ff0000 0%, #ff0000 100%/)
  // Bannière jamais rognée, même en mise en page compacte ou large.
  for (const layout of ['compact', 'wide']) assert.equal('cover' in cardLook(cleanCard({ layout })).banner, false)
  assert.equal(cardLook(cleanCard({ pattern: 'none' })).pattern, null)
})

test('libellés fr / en présents', () => {
  const keys = [
    'card.title', 'card.hint', 'card.layout', 'card.style', 'card.pattern', 'card.bannerFx', 'card.nameAlign', 'card.reset',
    'card.bannerY', 'card.radius', 'card.angle', 'card.showBadges', 'card.showLinks', 'ring.global.title', 'ring.global.hint',
    ...CARD_LAYOUTS.map(v => `card.layout.${v}`),
    ...CARD_STYLES.map(v => `card.style.${v}`),
    ...CARD_PATTERNS.map(v => `themes.pattern.${v}`),
    ...BANNER_FX.map(v => `card.bannerFx.${v}`),
    ...NAME_ALIGNS.map(v => `card.nameAlign.${v}`),
  ]
  for (const k of keys) assert.ok(fr[k] && en[k], k)
})
