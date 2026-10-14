import { existsSync, readFileSync } from 'fs'
import { join } from 'path'
import {
  RING_ANIMATED, RING_COLORS_MAX, RING_FILLS, RING_GAP_MAX, RING_MAX_BYTES, RING_RANGES, RING_SEGMENTS_RANGE, RING_SHAPES,
  RING_STYLES, RING_WIDTH_MAX, cleanRing, linearSides, ringDuration, ringGap, ringNum, ringPalette, shapeRadius,
} from '@/components/avatarRingCore'
import { fr } from '@/i18n/fr'
import { en } from '@/i18n/en'
import type { Key } from '@/i18n'

const root = join(__dirname, '..', '..')
const read = (...p: string[]) => readFileSync(join(root, ...p), 'utf8')
/** Chaînes entre guillemets d'un `pub const NOM: &[&str] = &[...]` Rust. */
const rustList = (src: string, name: string) =>
  [...(src.split(`${name}: &[&str] = &[`)[1]?.split('];')[0] ?? '').matchAll(/"([^"]*)"/g)].map((m) => m[1])
/** Valeur d'un `pub const NOM: type = n;`. */
const rustNum = (src: string, name: string) => Number(src.match(new RegExp(`pub const ${name}: \\w+ = (\\d+);`))?.[1])
/** Bornes d'un `pub const NOM: …RangeInclusive<…> = a..=b;`. */
const rustRange = (src: string, name: string) =>
  (src.match(new RegExp(`pub const ${name}: [\\w:]*RangeInclusive<\\w+> = (\\d+)..=(\\d+);`)) ?? []).slice(1, 3).map(Number)
/** Chaînes d'un `export const NOM = [...] as const` TypeScript. */
const tsList = (src: string, name: string) =>
  [...(src.split(`export const ${name} = [`)[1]?.split(']')[0] ?? '').matchAll(/'([^']*)'/g)].map((m) => m[1])

// Constantes extraites dans avatar_ring.rs (contrat) ; repli sur profile_style.rs si absent.
const ringRsPath = ['server', 'src', 'models', 'avatar_ring.rs']
const ringRs = existsSync(join(root, ...ringRsPath)) ? read(...ringRsPath) : read('server', 'src', 'models', 'profile_style.rs')
const styleRs = read('server', 'src', 'models', 'profile_style.rs')
const web = read('client', 'src', 'lib', 'avatarRing.ts')

describe('anneau d’avatar v2 : parité', () => {
  it('mêmes listes que le serveur, dans le même ordre', () => {
    expect([...RING_STYLES]).toEqual(rustList(ringRs, 'RING_STYLES'))
    expect([...RING_FILLS]).toEqual(rustList(ringRs, 'RING_FILLS'))
    expect([...RING_SHAPES]).toEqual(rustList(ringRs, 'RING_SHAPES'))
    expect(RING_STYLES).toHaveLength(34)
  })
  it('mêmes bornes que le serveur', () => {
    expect(RING_COLORS_MAX).toBe(rustNum(ringRs, 'RING_COLORS_MAX'))
    expect(RING_WIDTH_MAX).toBe(rustNum(ringRs, 'RING_WIDTH_MAX'))
    expect(RING_GAP_MAX).toBe(rustNum(ringRs, 'RING_GAP_MAX'))
    expect(RING_MAX_BYTES).toBe(rustNum(ringRs, 'RING_MAX_BYTES'))
    expect([...RING_SEGMENTS_RANGE]).toEqual(rustRange(ringRs, 'RING_SEGMENTS_RANGE'))
    expect(RING_RANGES.intensity.slice(0, 2)).toEqual(rustRange(ringRs, 'INTENSITY_RANGE'))
    // Réglages partagés avec les décorations (profile_style.rs).
    for (const [k, rs] of [['speed', 'SPEED_RANGE'], ['brightness', 'BRIGHTNESS_RANGE'], ['glow', 'GLOW_RANGE'], ['opacity', 'OPACITY_RANGE']] as const)
      expect(RING_RANGES[k].slice(0, 2)).toEqual(rustRange(styleRs, rs))
  })
  it('mêmes listes et bornes que le web', () => {
    expect([...RING_STYLES]).toEqual(tsList(web, 'RING_STYLES'))
    expect([...RING_FILLS]).toEqual(tsList(web, 'RING_FILLS'))
    expect([...RING_SHAPES]).toEqual(tsList(web, 'RING_SHAPES'))
    for (const name of ['RING_COLORS_MAX', 'RING_WIDTH_MAX', 'RING_GAP_MAX'])
      expect(Number(web.match(new RegExp(`export const ${name} = (\\d+)`))?.[1])).toBe({ RING_COLORS_MAX, RING_WIDTH_MAX, RING_GAP_MAX }[name])
  })
  it('styles animés : tous sauf les statiques du contrat', () => {
    const fixed = RING_STYLES.filter((s) => !RING_ANIMATED.includes(s))
    expect(fixed).toEqual(['solid', 'dashed', 'dotted', 'double', 'glow', 'segmented', 'stripes', 'halo'])
  })
  it('libellés traduits pour chaque style, remplissage et forme', () => {
    for (const k of [...RING_STYLES.map((s) => `ring.style.${s}`), ...RING_FILLS.map((f) => `ring.fill.${f}`), ...RING_SHAPES.map((s) => `ring.shape.${s}`)]) {
      expect(fr[k as Key]).toBeTruthy()
      expect(en[k as Key]).toBeTruthy()
    }
  })
})

describe('anneau d’avatar v2 : nettoyage', () => {
  it('données hostiles ou absentes => pas d’anneau', () => {
    for (const x of [null, undefined, 1, 'x', [], { colors: [] }, { colors: ['#fff', -1, 0x1000000, 1.5, NaN] }, { colors: 'red' }]) expect(cleanRing(x)).toBeNull()
  })
  it('anneau v1 stocké : relu tel quel', () => {
    const v1 = { colors: [0xff0000, 0x00ff00, 0x0000ff], width: 8, style: 'comet', speed: 150, direction: 'ccw', brightness: 120, glow: 200 }
    expect(cleanRing(v1)).toEqual(v1)
  })
  it('bornes appliquées, défauts omis, champs inconnus ignorés', () => {
    const r = cleanRing({
      colors: Array.from({ length: 20 }, (_, i) => i), width: 99, style: 'matrix', fill: 'linear', angle: 999, shape: 'squircle', gap: -4,
      segments: 1, speed: 100, direction: 'up', brightness: 10, glow: 1000, opacity: 5, intensity: 900, css: 'url(x)',
    })
    expect(r).toEqual({
      colors: [0, 1, 2, 3, 4, 5, 6, 7], width: RING_WIDTH_MAX, style: 'matrix', fill: 'linear', angle: 360, shape: 'squircle', gap: 0,
      segments: 2, brightness: 50, glow: 300, opacity: 20, intensity: 200,
    })
    expect(cleanRing({ colors: [1], width: 2.5, style: 'nope', fill: 'conic', shape: 'circle', segments: 12, angle: 0 })).toEqual({ colors: [1], width: 3, style: 'solid' })
    expect(JSON.stringify(r).length).toBeLessThanOrEqual(RING_MAX_BYTES)
  })
  it('valeurs dérivées', () => {
    const r = cleanRing({ colors: [0x112233], style: 'rainbow', speed: 200 })!
    expect(ringPalette(r)).toHaveLength(6)
    expect(ringDuration(r)).toBe(3000)
    expect(ringNum(r, 'segments')).toBe(12)
    expect(ringGap(r, 4, 1)).toBe(2)
    expect(ringGap({ ...r, gap: 6 }, 4, 0.5)).toBe(3)
    expect(shapeRadius(undefined, 100)).toBe(50)
    expect(shapeRadius('rounded', 100)).toBe(22)
    expect(linearSides(['#a', '#b', '#c'])).toEqual(['#a', '#b', '#c', '#b'])
  })
})
