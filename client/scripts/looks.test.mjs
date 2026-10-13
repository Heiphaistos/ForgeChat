// Styles des catégories et disposition : listes fermées, nombres bornés, rien d'injectable.
// node --test scripts/looks.test.mjs
import { test } from 'node:test'
import assert from 'node:assert/strict'
import {
  CATEGORY_SHAPES, CATEGORY_ICONS, DEFAULT_CATEGORY, categoryAttrs, categoryVars, inkOn, sanitizeCategory,
} from '../src/theme/serverLook.ts'
import { DEFAULT_LAYOUT, LAYOUT_CHOICES, sanitizeLayout } from '../src/theme/applyTheme.ts'

test('catégories : au moins 24 formes distinctes', () => {
  assert.ok(CATEGORY_SHAPES.length >= 24, `${CATEGORY_SHAPES.length}`)
  assert.equal(new Set(CATEGORY_SHAPES).size, CATEGORY_SHAPES.length)
  for (const s of CATEGORY_SHAPES) assert.match(s, /^[a-z]+$/)
})

test('catégories : anciens styles relus, valeurs hostiles écartées', () => {
  assert.deepEqual(sanitizeCategory({ shape: 'pill', color: '#22C55E', uppercase: false }),
    { ...DEFAULT_CATEGORY, shape: 'pill', color: '#22c55e', uppercase: false })
  const bad = sanitizeCategory({
    shape: 'x;}', color: 'red;}', color2: 'url(a)', font: '"; body{', weight: 900, size: 999, spacing: -4,
    align: 'justify', icon: '<img>', arrow: 'constructor', uppercase: 'oui',
  })
  assert.deepEqual(bad, { ...DEFAULT_CATEGORY, size: 18, spacing: 0 })
  assert.equal(sanitizeCategory({ icon: 'toString' }).icon, 'none')
  assert.equal(sanitizeCategory({ icon: 'rocket' }).icon, 'rocket')
  assert.equal(CATEGORY_ICONS.none, '')
})

test('catégories : variables CSS numériques uniquement', () => {
  const v = categoryVars({ ...DEFAULT_CATEGORY, color: '#ffffff', color2: '#000000', size: 14, spacing: 10 })
  assert.deepEqual(v, { '--fc-cat-size': '14px', '--fc-cat-ls': '0.1em', '--fc-cat-rgb': '255 255 255', '--fc-cat2-rgb': '0 0 0', '--fc-cat-ink': '0 0 0' })
  assert.equal(categoryVars(DEFAULT_CATEGORY, 'pas une couleur')['--fc-cat-ink'], undefined)
  assert.equal(inkOn('#000000'), '#ffffff')
  assert.equal(inkOn('#ffd000'), '#000000')
  assert.deepEqual(categoryAttrs(DEFAULT_CATEGORY), { 'data-shape': 'auto', 'data-font': 'theme', 'data-weight': 'semibold', 'data-align': 'left', 'data-upper': 'true' })
})

test('disposition : défauts, listes fermées et nombres bornés', () => {
  assert.deepEqual(sanitizeLayout(null), DEFAULT_LAYOUT)
  for (const [k, values] of Object.entries(LAYOUT_CHOICES)) assert.ok(values.includes(DEFAULT_LAYOUT[k]), k)
  const l = sanitizeLayout({
    members: 'left', sidebarSide: 'right', composer: 'pill', chatMode: 'irc', header: 'evil;}', corners: 'sharp',
    membersWidth: 9999, contentWidth: -1, messageGap: 12.6, chatFontScale: 'grand', lineHeight: 500, glass: Infinity,
    reduceTransparency: 'yes',
  })
  assert.equal(l.members, 'left')
  assert.equal(l.sidebarSide, 'right')
  assert.equal(l.composer, 'pill')
  assert.equal(l.chatMode, 'irc')
  assert.equal(l.header, 'default')
  assert.equal(l.corners, 'sharp')
  assert.equal(l.membersWidth, 360)
  assert.equal(l.contentWidth, 600)
  assert.equal(l.messageGap, 13)
  assert.equal(l.chatFontScale, 100)
  assert.equal(l.lineHeight, 220)
  assert.equal(l.glass, 100)
  assert.equal(l.reduceTransparency, false)
  assert.ok(Object.keys(DEFAULT_LAYOUT).length >= 25)
})
