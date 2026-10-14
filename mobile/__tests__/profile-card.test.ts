import { readFileSync } from 'fs'
import { join } from 'path'
import {
  BANNER_FX, CARD_DEFAULT, CARD_LAYOUTS, CARD_PATTERNS, CARD_RADIUS_MAX, CARD_STYLES, NAME_ALIGNS, PROFILE_CARD_MAX_BYTES,
  cardHeader, cardOnColor, cardPayload, cleanCard, gradientAxis, gradientStops,
} from '@/features/account/profileCard'
import { PATTERNS } from '@/theme/themeCore'
import { fr } from '@/i18n/fr'
import { en } from '@/i18n/en'
import type { Key } from '@/i18n'

const root = join(__dirname, '..', '..')
const read = (...p: string[]) => readFileSync(join(root, ...p), 'utf8')
const rustList = (src: string, name: string) =>
  [...(src.split(`${name}: &[&str] = &[`)[1]?.split('];')[0] ?? '').matchAll(/"([^"]*)"/g)].map((m) => m[1])
const rustNum = (src: string, name: string) => Number(src.match(new RegExp(`pub const ${name}: \\w+ = (\\d+);`))?.[1])

describe('carte de profil : parité', () => {
  const rs = read('server', 'src', 'models', 'profile_card.rs')
  it('mêmes listes et bornes que server/src/models/profile_card.rs', () => {
    expect([...CARD_LAYOUTS]).toEqual(rustList(rs, 'CARD_LAYOUTS'))
    expect([...CARD_STYLES]).toEqual(rustList(rs, 'CARD_STYLES'))
    expect([...CARD_PATTERNS]).toEqual(rustList(rs, 'CARD_PATTERNS'))
    expect([...BANNER_FX]).toEqual(rustList(rs, 'BANNER_FX'))
    expect([...NAME_ALIGNS]).toEqual(rustList(rs, 'NAME_ALIGNS'))
    expect(CARD_RADIUS_MAX).toBe(rustNum(rs, 'CARD_RADIUS_MAX'))
    expect(PROFILE_CARD_MAX_BYTES).toBe(rustNum(rs, 'PROFILE_CARD_MAX_BYTES'))
  })
  it('motifs : même liste que les thèmes', () => {
    expect([...PATTERNS]).toEqual([...CARD_PATTERNS])
  })
  it('libellés traduits', () => {
    const keys = [
      ...CARD_LAYOUTS.map((x) => `pcard.layout.${x}`), ...CARD_STYLES.map((x) => `pcard.card.${x}`), ...CARD_PATTERNS.map((x) => `pcard.pattern.${x}`),
      ...BANNER_FX.map((x) => `pcard.fx.${x}`), ...NAME_ALIGNS.map((x) => `pcard.align.${x}`),
    ]
    for (const k of keys) {
      expect(fr[k as Key]).toBeTruthy()
      expect(en[k as Key]).toBeTruthy()
    }
  })
})

describe('carte de profil : nettoyage', () => {
  it('absente ou hostile => défauts ; tout par défaut => null dans le PATCH', () => {
    for (const x of [null, undefined, 'x', 3, [], { layout: 'evil', card: 1, banner_y: 'NaN', show_badges: 'no' }]) expect(cleanCard(x)).toEqual(CARD_DEFAULT)
    expect(cardPayload(cleanCard(null))).toBeNull()
  })
  it('bornes appliquées et seules les valeurs hors défaut envoyées', () => {
    const c = cleanCard({ layout: 'wide', card: 'neon', pattern: 'waves', banner_y: 150, banner_fx: 'duotone', radius: 99, angle: -5, show_badges: false, show_links: true, name_align: 'center', x: 1 })
    expect(c).toEqual({ layout: 'wide', card: 'neon', pattern: 'waves', banner_y: 100, banner_fx: 'duotone', radius: CARD_RADIUS_MAX, angle: 0, show_badges: false, show_links: true, name_align: 'center' })
    const body = cardPayload(c)
    expect(body).toEqual({ layout: 'wide', card: 'neon', pattern: 'waves', banner_y: 100, banner_fx: 'duotone', radius: 24, angle: 0, show_badges: false, name_align: 'center' })
    expect(JSON.stringify(body).length).toBeLessThanOrEqual(PROFILE_CARD_MAX_BYTES)
  })
  it('dégradé, axe, en-tête, texte clair', () => {
    expect(gradientStops(0x000000, 0xffffff, 3)).toEqual(['#000000', '#808080', '#ffffff'])
    expect(gradientAxis(180)).toEqual({ row: false, reverse: false })
    expect(gradientAxis(90)).toEqual({ row: true, reverse: false })
    expect(gradientAxis(0)).toEqual({ row: false, reverse: true })
    expect(gradientAxis(270)).toEqual({ row: true, reverse: true })
    expect(cardHeader({ ...CARD_DEFAULT, layout: 'compact' })).toMatchObject({ avatar: 64, row: true })
    expect(cardHeader({ ...CARD_DEFAULT, layout: 'centered' }).textCenter).toBe(true)
    expect(cardOnColor('glass', true)).toBe(false)
    expect(cardOnColor('gradient', true)).toBe(true)
    expect(cardOnColor('solid', false)).toBe(false)
  })
})
