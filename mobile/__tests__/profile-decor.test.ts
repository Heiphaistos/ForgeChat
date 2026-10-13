import { readFileSync } from 'fs'
import { join } from 'path'
import {
  DECORATIONS, DECO_GROUPS, DECO_OPTS_DEFAULT, DECO_RANGES, FX_GROUPS, PROFILE_EFFECTS, adjustColor, cleanDecoOpts, cleanIntensity,
  decoOptsPayload, fxCount, profileTheme, searchKey, tintColor,
} from '@/features/account/profileDecor'
import { cleanRing } from '@/components/AvatarRing'
import { fr } from '@/i18n/fr'
import { en } from '@/i18n/en'

const root = join(__dirname, '..', '..')
const read = (...p: string[]) => readFileSync(join(root, ...p), 'utf8')
/** Chaînes entre guillemets d'un `pub const NOM: &[&str] = &[...]` Rust. */
const rustList = (src: string, name: string) =>
  [...(src.split(`${name}: &[&str] = &[`)[1]?.split('];')[0] ?? '').matchAll(/"([^"]*)"/g)].map((m) => m[1])

describe('personnalisation du profil', () => {
  const server = read('server', 'src', 'models', 'user.rs')
  const web = read('client', 'src', 'lib', 'profileDecor.ts') + read('client', 'src', 'lib', 'profileDecorMore.ts') + read('client', 'src', 'lib', 'profileDecorExtra.ts')

  it('mêmes décorations et effets, dans le même ordre, que la liste blanche du serveur', () => {
    expect(DECORATIONS.map((d) => d.id)).toEqual(rustList(server, 'AVATAR_DECORATIONS'))
    expect(PROFILE_EFFECTS.map((e) => e.id)).toEqual(rustList(server, 'PROFILE_EFFECTS'))
    expect(DECORATIONS.length).toBeGreaterThanOrEqual(215)
    expect(PROFILE_EFFECTS.length).toBeGreaterThanOrEqual(143)
  })
  it('mêmes identifiants que le web', () => {
    for (const id of [...DECORATIONS, ...PROFILE_EFFECTS].map((d) => d.id)) expect(web).toContain(`id: '${id}'`)
  })
  it('chaque décoration et chaque effet dans une seule catégorie, libellés traduits', () => {
    for (const [list, groups] of [[DECORATIONS, DECO_GROUPS], [PROFILE_EFFECTS, FX_GROUPS]] as const) {
      const ids = groups.flatMap((g) => g.ids)
      expect(new Set(ids).size).toBe(ids.length)
      expect([...ids].sort()).toEqual(list.map((x) => x.id).sort())
      for (const x of [...groups, ...list]) {
        expect(fr[x.label]).toBeTruthy()
        expect(en[x.label]).toBeTruthy()
      }
    }
  })
  it('thème : une seule couleur suffit, aucune = défaut', () => {
    expect(profileTheme(null, null)).toBeNull()
    expect(profileTheme(0xff0000, null)).toEqual({ top: '#ff0000', bottom: '#ff0000' })
    expect(profileTheme(0x00000a, 0x5865f2)).toEqual({ top: '#00000a', bottom: '#5865f2' })
  })
  it('réglages de décoration nettoyés et bornés', () => {
    expect(cleanDecoOpts(undefined)).toEqual(DECO_OPTS_DEFAULT)
    const o = cleanDecoOpts({ speed: 1000, scale: 10, hue: 400, tint: -1, direction: 'up', css: 'x' })
    expect(o).toEqual({ ...DECO_OPTS_DEFAULT, speed: 400, scale: 80, hue: 360 })
    expect(decoOptsPayload({ ...DECO_OPTS_DEFAULT })).toEqual({})
    expect(decoOptsPayload({ ...DECO_OPTS_DEFAULT, pulse: true, tint: 0xff0000 })).toEqual({ pulse: true, tint: 0xff0000 })
  })
  it('bornes des réglages identiques au serveur (profile_style.rs) et au web', () => {
    const rs = read('server', 'src', 'models', 'profile_style.rs')
    const webDecor = read('client', 'src', 'lib', 'profileDecor.ts')
    for (const [k, [lo, hi]] of Object.entries(DECO_RANGES)) {
      const m = rs.match(new RegExp(`pub const ${k.toUpperCase()}_RANGE: [^=]+= (\\d+)..=(\\d+);`))
      expect([k, Number(m?.[1]), Number(m?.[2])]).toEqual([k, lo, hi])
      expect(webDecor).toMatch(new RegExp(`\\b${k}: \\[${lo}, ${hi}\\]`))
      // cleanDecoOpts borne aux mêmes extrémités.
      expect(cleanDecoOpts({ [k]: lo - 1000 })[k as keyof typeof DECO_RANGES]).toBe(lo)
      expect(cleanDecoOpts({ [k]: hi + 1000 })[k as keyof typeof DECO_RANGES]).toBe(hi)
    }
  })
  it('couleurs : teinte, décalage, luminosité', () => {
    expect(tintColor('#000000', 0xffffff, 0.5)).toBe('#808080')
    expect(tintColor('transparent', 0xff0000)).toBe('transparent')
    expect(adjustColor('#ff0000', 120)).toBe('#00ff00')
    expect(adjustColor('#123456', 0)).toBe('#123456')
  })
  it('intensité et recherche', () => {
    const snow = PROFILE_EFFECTS.find((f) => f.id === 'snow')!
    expect(fxCount(snow, 200)).toBe(28)
    expect(cleanIntensity(999)).toBe(200)
    expect(searchKey('Éclair')).toBe('eclair')
  })
  it('anneau : réglages bornés', () => {
    expect(cleanRing({ colors: [1], style: 'comet', speed: 5, direction: 'ccw', glow: 900 })).toEqual({ colors: [1], width: 3, style: 'comet', speed: 25, direction: 'ccw', glow: 300 })
    expect(cleanRing({ colors: [1], style: 'x' })?.style).toBe('solid')
  })
})
