import { animatedImageType, profileLinkError } from '@/features/account/rules'
import { readFileSync } from 'fs'
import { join } from 'path'
import { effectStyle, outlineStyle } from '@/components/nameEffects'
import { BUNDLED_FONTS, NAME_FONT_BUNDLED, NAME_FONT_STYLES, nameFontStyle } from '@/components/nameFonts'
import { effectLabel, fontLabel } from '@/features/account/nameStyleLabels'
import { fr } from '@/i18n/fr'
import {
  LEVEL_DEFAULT, LEVEL_MAX, NAME_COLORS_MAX, NAME_EFFECTS, NAME_FONTS, NAME_GRADIENTS, OUTLINE_STYLES, OUTLINE_WIDTH_MAX,
  TAG_BADGES, TAG_ICONS, cleanNameStyle, contrastRatio, displayNameOf, ensureContrast, gradientChars, parseHex, resolveNameStyle, toHex,
} from '@/lib/nameStyle'

describe('style du pseudo', () => {
  it('dégradé : une couleur par caractère, des extrémités exactes', () => {
    const chars = gradientChars('abc', ['#ff0000', '#0000ff'])
    expect(chars.map((c) => c.ch).join('')).toBe('abc')
    expect(chars[0]!.color).toBe('#ff0000')
    expect(chars[1]!.color).toBe('#800080')
    expect(chars[2]!.color).toBe('#0000ff')
    // 3 couleurs : le milieu du nom prend la couleur du milieu ; emoji = un seul caractère.
    const three = gradientChars('a✨b', ['#ff0000', '#00ff00', '#0000ff'])
    expect(three.map((c) => c.color)).toEqual(['#ff0000', '#00ff00', '#0000ff'])
  })

  it('contraste : une couleur trop sombre est éclaircie jusqu’à 3:1', () => {
    const dark = 0x111214
    expect(contrastRatio(dark, 0x1e1f22)).toBeLessThan(3)
    const fixed = ensureContrast(dark, 0x1e1f22)
    expect(contrastRatio(fixed, 0x1e1f22)).toBeGreaterThanOrEqual(3)
    expect(fixed).not.toBe(0xffffff)
    // Déjà lisible : inchangée.
    expect(ensureContrast(0xffd166, 0x1e1f22)).toBe(0xffd166)
    // Fond clair : assombrie.
    expect(contrastRatio(ensureContrast(0xfff1b8, 0xffffff), 0xffffff)).toBeGreaterThanOrEqual(3)
  })

  it('priorité rôle / perso', () => {
    const style = { colors: [0xeb459e, 0x00c6ff], effect: 'glow', font: 'serif' }
    // Rôle coloré et serveur par défaut : rôle, police gardée, effet retiré.
    expect(resolveNameStyle({ style, roleColor: '#3ba55c' })).toEqual({ colors: ['#3ba55c'], effect: '', font: 'serif' })
    // Le serveur laisse le style perso gagner.
    expect(resolveNameStyle({ style, roleColor: '#3ba55c', roleOverrides: false })).toEqual({ colors: ['#eb459e', '#00c6ff'], effect: 'glow', font: 'serif' })
    // Sans style perso : couleur du rôle ; sans rien : défaut.
    expect(resolveNameStyle({ style: null, roleColor: '#3ba55c', roleOverrides: false })?.colors).toEqual(['#3ba55c'])
    expect(resolveNameStyle({ style: null })).toBeNull()
    // MP : style perso.
    expect(resolveNameStyle({ style })?.colors).toEqual(['#eb459e', '#00c6ff'])
  })

  it('nom affiché : surnom > nom d’affichage > pseudo', () => {
    expect(displayNameOf({ username: 'momo', display_name: 'Momo ✨' }, 'Chef')).toBe('Chef')
    expect(displayNameOf({ username: 'momo', display_name: 'Momo ✨' }, '  ')).toBe('Momo ✨')
    expect(displayNameOf({ username: 'momo', display_name: null })).toBe('momo')
  })

  it('saisie hexadécimale', () => {
    expect(parseHex('#5865F2')).toBe(0x5865f2)
    expect(parseHex('fff')).toBe(0xffffff)
    expect(parseHex('red')).toBeNull()
    expect(toHex(0x00000a)).toBe('#00000a')
  })

  it('liens : https uniquement, sans identifiants', () => {
    expect(profileLinkError({ label: 'Site', url: 'https://heiphaistos.org' })).toBeNull()
    for (const url of ['http://a.fr', 'javascript:alert(1)', 'https://user:pw@a.fr', 'pas un lien']) expect(profileLinkError({ label: 'x', url })).not.toBeNull()
    expect(profileLinkError({ label: ' ', url: 'https://a.fr' })).not.toBeNull()
  })

  it('image animée : GIF ou WebP par type ou extension', () => {
    expect(animatedImageType('image/gif', null)).toBe('image/gif')
    expect(animatedImageType(undefined, 'chat.WEBP')).toBe('image/webp')
    expect(animatedImageType('image/jpeg', 'photo.jpg')).toBeNull()
  })
})

describe('style du pseudo : listes blanches, réglages et polices', () => {
  const root = join(__dirname, '..', '..')
  const read = (...p: string[]) => readFileSync(join(root, ...p), 'utf8')
  const rustList = (src: string, name: string) =>
    [...(src.split(`${name}: &[&str] = &[`)[1]?.split('];')[0] ?? '').matchAll(/"([^"]*)"/g)].map((m) => m[1])
  const tsList = (src: string, name: string) =>
    [...(src.split(`export const ${name} = [`)[1]?.split('] as const')[0] ?? '').matchAll(/'([^']*)'/g)].map((m) => m[1])
  const rustNum = (src: string, name: string) => Number(src.match(new RegExp(`pub const ${name}: \\w+ = (\\d+);`))?.[1])

  it('mêmes listes et bornes que le serveur et le web', () => {
    const server = read('server', 'src', 'models', 'profile_style.rs')
    const web = read('client', 'src', 'lib', 'nameStyle.ts')
    const lists: Record<string, readonly string[]> = { NAME_EFFECTS, NAME_FONTS, NAME_GRADIENTS, OUTLINE_STYLES, TAG_BADGES, TAG_ICONS }
    for (const [name, list] of Object.entries(lists)) {
      expect(rustList(server, name)).toEqual([...list])
      expect(tsList(web, name)).toEqual([...list])
    }
    const nums: Record<string, number> = { NAME_COLORS_MAX, OUTLINE_WIDTH_MAX, LEVEL_MAX, LEVEL_DEFAULT }
    for (const [name, v] of Object.entries(nums)) expect(rustNum(server, name)).toBe(v)
    expect(NAME_EFFECTS.length - 1).toBeGreaterThanOrEqual(40)
    expect(NAME_FONTS.length - 1).toBeGreaterThanOrEqual(60)
  })

  it('style nettoyé : 5 couleurs, dégradé, intensité, contour double ou lumineux', () => {
    const s = cleanNameStyle({ colors: [1, 2, 3, 4, 5, 6], gradient: 'conic', effect: 'aurora', intensity: 42, speed: 0, outline_width: 9, outline_style: 'double' })
    expect(s).toEqual({ colors: [1, 2, 3, 4, 5], angle: 90, effect: 'aurora', font: '', gradient: 'conic', intensity: 10, speed: 1, outline_width: 6, outline: 0, outline_style: 'double', outline2: 0xffffff })
    expect(cleanNameStyle({ colors: [1], gradient: 'radial', intensity: 9 })).toEqual({ colors: [1], angle: 90, effect: '', font: '' })
    expect(cleanNameStyle({ colors: [1, 2], gradient: 'url(x)', outline_width: 2, outline_style: 'x;y', outline2: 3 })).toEqual({ colors: [1, 2], angle: 90, effect: '', font: '', outline_width: 2, outline: 0 })
  })

  it('rendu résolu : intensité et contour gardés, rôle prioritaire garde le contour', () => {
    const r = resolveNameStyle({ style: { colors: [0xffd166], effect: 'glow', intensity: 9, outline: 0xff0000, outline_width: 3, outline_style: 'double', outline2: 0x00ff00 } })
    expect(r).toEqual({ colors: ['#ffd166'], effect: 'glow', font: '', intensity: 9, outline: { color: '#ff0000', width: 3, style: 'double', color2: '#00ff00' } })
    const role = resolveNameStyle({ style: { colors: [1], outline_width: 2, outline_style: 'glow' }, roleColor: '#3ba55c' })
    expect(role?.outline).toEqual({ color: '#000000', width: 2, style: 'glow' })
    expect(resolveNameStyle({ style: { colors: [], effect: 'gold' } })?.colors.length).toBeGreaterThan(1)
  })

  it('chaque police et chaque effet a un rendu et un libellé ; polices embarquées sûres', () => {
    for (const f of NAME_FONTS.slice(1)) {
      expect(NAME_FONT_STYLES[f]).toBeTruthy()
      expect(fr[fontLabel(f) as keyof typeof fr]).toBeTruthy()
    }
    for (const e of NAME_EFFECTS) expect(fr[effectLabel(e) as keyof typeof fr]).toBeTruthy()
    for (const fam of Object.values(NAME_FONT_BUNDLED)) expect(Object.keys(BUNDLED_FONTS)).toContain(fam)
    // Police embarquée pas encore chargée : la famille système reste (jamais de famille inconnue).
    expect(nameFontStyle('calibri')?.fontFamily).not.toBe('FCHumanist')
    expect(nameFontStyle('')).toBeNull()
    expect(nameFontStyle('Comic;x')).toBeNull()
  })

  it('effets statiques : une ombre plus forte avec l’intensité', () => {
    expect(effectStyle('glow', '#ffffff', 2)?.textShadowRadius).toBe(16)
    expect(effectStyle('glow', '#ffffff', 0.2)?.textShadowRadius).toBeCloseTo(1.6)
    expect(outlineStyle({ color: '#ff0000', width: 2, style: 'glow' })?.textShadowRadius).toBe(8)
    expect(outlineStyle({ color: '#ff0000', width: 2, style: 'double', color2: '#00ff00' })?.textShadowColor).toBe('#00ff00')
  })
})
