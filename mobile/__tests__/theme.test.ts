import { readFileSync } from 'fs'
import { join } from 'path'
import { serverAppearancePatch, serverThemePatch } from '@/features/appearance/sync'
import { formatTime } from '@/lib/format'
import { colors, outlined } from '@/theme'
import { isLightTheme, isOutlined, paletteFromSpec, resolvePalette, THEMES } from '@/theme/palettes'
import { DEFAULT_PREFS, parsePrefs } from '@/theme/prefs'
import { contrast, findTheme, PRESETS, sanitizeTheme } from '@/theme/themeCore'

const HEX = /^#[0-9a-f]{6}$/i

describe('palettes', () => {
  it('thème inconnu ou vide → Sombre', () => {
    const dark = resolvePalette('dark')
    expect(resolvePalette('nimporte-quoi')).toEqual(dark)
    expect(resolvePalette('')).toEqual(dark)
    expect(dark.bg).toBe('#313338')
    expect(isLightTheme('nimporte-quoi')).toBe(false)
  })

  it('fichiers de thème identiques au web (copie client/src/theme/*, fins de ligne ignorées)', () => {
    const read = (dir: string, f: string) => readFileSync(join(__dirname, '..', '..', dir, 'src', 'theme', f), 'utf8').replace(/\r\n/g, '\n')
    for (const f of ['themeCore.ts', 'themeModel.ts', 'themeBase.ts', 'themeClassic.ts', 'themeCurated.ts', 'themeFamilies.ts']) {
      expect({ f, src: read('mobile', f) }).toEqual({ f, src: read('client', f) })
    }
  })

  it('reprend tous les thèmes du web avec des couleurs complètes', () => {
    expect(THEMES).toHaveLength(PRESETS.length)
    expect(THEMES.filter((t) => t.group === 'gradient').length).toBeGreaterThanOrEqual(25)
    for (const t of THEMES) {
      for (const k of ['bg', 'bgAlt', 'bgDeep', 'bgElevated', 'bgHover', 'primary', 'primaryPressed', 'text', 'textMuted', 'textFaint'] as const) {
        expect(t.palette[k]).toMatch(HEX)
      }
    }
    expect(resolvePalette('dracula').primary).toBe('#bd93f9')
    expect(resolvePalette('darker').bg).toBe('#000000')
  })

  it('thèmes clairs : texte sombre sur fond clair', () => {
    for (const id of ['light', 'winter', 'g-lavender', 'g-mint']) {
      expect(isLightTheme(id)).toBe(true)
      const p = resolvePalette(id)
      const lum = (c: string) => parseInt(c.slice(1, 3), 16) + parseInt(c.slice(3, 5), 16) + parseInt(c.slice(5, 7), 16)
      expect(lum(p.bg)).toBeGreaterThan(lum(p.text) + 300)
    }
  })

  it('AMOLED : noir pur partout sauf le survol, avec bordures', () => {
    const p = resolvePalette('darker')
    for (const k of ['bg', 'bgAlt', 'bgDeep', 'bgElevated', 'codeBg'] as const) expect(p[k]).toBe('#000000')
    expect(isOutlined('darker')).toBe(true)
    expect(isOutlined('dark')).toBe(false)
    expect(outlined).toBe(false)
  })

  it('texte lisible (AA) sur les fonds de tous les thèmes, dégradés compris', () => {
    for (const t of THEMES) {
      for (const bg of [t.palette.bg, t.palette.bgAlt, t.palette.bgDeep]) {
        expect(contrast(t.palette.text, bg)).toBeGreaterThanOrEqual(4.5)
        expect(contrast(t.palette.textMuted, bg)).toBeGreaterThanOrEqual(4.5)
      }
      if (t.group === 'gradient') expect(t.gradient).toMatch(/^linear-gradient\(\d+deg, #[0-9a-f]{6}/)
    }
  })

  it("thème perso : ses couleurs et son accent, jamais l'accent du compte", () => {
    const custom = sanitizeTheme({ name: 'Perso', colors: { bg: '#102030', accent: '#ff00aa', text: '#ffffff' } })
    expect(custom).not.toBeNull()
    const p = resolvePalette('c-abcd1234', '#00ff00', custom)
    expect(p.bg).toBe('#102030')
    expect(p.primary).toBe('#ff00aa')
    expect(p).toEqual(paletteFromSpec(custom!))
    // Sans ses couleurs (pas encore synchronisé) : Sombre.
    expect(resolvePalette('c-abcd1234', null, null)).toEqual(resolvePalette('dark'))
  })

  it("applique l'accent personnalisé valide seulement", () => {
    expect(resolvePalette('nord', '#ff0000').primary).toBe('#ff0000')
    expect(resolvePalette('nord', 'rouge').primary).toBe('#5e81ac')
    expect(resolvePalette('nord', null).primary).toBe('#5e81ac')
  })

  it('le module theme expose la palette Sombre sans préférence enregistrée', () => {
    expect(colors.bg).toBe('#313338')
  })
})

describe('préférences', () => {
  it('valeur absente, corrompue ou invalide → défauts', () => {
    expect(parsePrefs(null)).toEqual(DEFAULT_PREFS)
    expect(parsePrefs('{pas du json')).toEqual(DEFAULT_PREFS)
    expect(parsePrefs(JSON.stringify({ theme: 3, accent: 'bleu', timeFormat: '13h', textScale: 9, streamerMode: 'oui' }))).toEqual(DEFAULT_PREFS)
    expect(parsePrefs(JSON.stringify({ theme: 'nord', accent: '#AABBCC', timeFormat: '12h', textScale: 1.15, streamerMode: true }))).toEqual({
      theme: 'nord',
      accent: '#AABBCC',
      timeFormat: '12h',
      textScale: 1.15,
      streamerMode: true,
      custom: null,
      density: 'normal',
      categoriesFolded: true,
      appIcon: null,
    })
    expect(parsePrefs(JSON.stringify({ categoriesFolded: false })).categoriesFolded).toBe(false)
    const withCustom = parsePrefs(JSON.stringify({ theme: 'c-abcd1234', density: 'compact', custom: { colors: { bg: '#123456' }, image: { url: 'https://a.fr/b.png' } } }))
    expect(withCustom.density).toBe('compact')
    expect(withCustom.custom?.colors.bg).toBe('#123456')
    expect(withCustom.custom?.image).toBeNull()
    expect(parsePrefs(JSON.stringify({ custom: { colors: 'x' }, density: 'énorme' }))).toMatchObject({ custom: null, density: 'normal' })
  })

  it('ne reprend du serveur que ce qui diffère', () => {
    expect(serverAppearancePatch({ accent_color: null, time_format: '24h', streamer_mode: false }, DEFAULT_PREFS)).toEqual({})
    expect(serverAppearancePatch({ accent_color: '#ABCDEF', time_format: '12h', streamer_mode: true }, DEFAULT_PREFS)).toEqual({
      accent: '#abcdef',
      timeFormat: '12h',
      streamerMode: true,
    })
    expect(serverAppearancePatch({ accent_color: 'n/a', time_format: 'autre' }, { ...DEFAULT_PREFS, accent: '#123456' })).toEqual({ accent: null })
  })
})

describe('thème du compte', () => {
  const nord = { ...findTheme('nord')!, id: 'c-abcd1234' }

  it('thème prédéfini : appliqué, thème perso local oublié', () => {
    expect(serverThemePatch('dracula', [], DEFAULT_PREFS)).toEqual({ theme: 'dracula', custom: null })
    expect(serverThemePatch('dark', [], DEFAULT_PREFS)).toBeNull()
    expect(serverThemePatch('inconnu', [], DEFAULT_PREFS)).toBeNull()
    expect(serverThemePatch(null, [], DEFAULT_PREFS)).toBeNull()
  })

  it('thème perso : seulement si ses couleurs sont connues, copiées sans image', () => {
    expect(serverThemePatch('c-abcd1234', [], DEFAULT_PREFS)).toBeNull()
    const patch = serverThemePatch('c-abcd1234', [{ ...nord, image: { url: 'https://a.fr/b.png', blur: 0, dim: 0.4 } }], DEFAULT_PREFS)
    expect(patch?.theme).toBe('c-abcd1234')
    expect(patch?.custom?.colors.bg).toBe(nord.colors.bg)
    expect(patch?.custom?.image).toBeNull()
    // Déjà à jour : rien à changer.
    expect(serverThemePatch('c-abcd1234', [nord], { ...DEFAULT_PREFS, ...patch })).toBeNull()
  })
})

describe('formatTime', () => {
  const at = (h: number, m: number) => new Date(2026, 9, 7, h, m).toISOString()

  it('24 h par défaut', () => {
    expect(formatTime(at(14, 5))).toBe('14:05')
    expect(formatTime(at(0, 0), '24h')).toBe('00:00')
  })

  it('12 h comme le web (hh:mm a)', () => {
    expect(formatTime(at(14, 5), '12h')).toBe('02:05 PM')
    expect(formatTime(at(0, 30), '12h')).toBe('12:30 AM')
    expect(formatTime(at(12, 0), '12h')).toBe('12:00 PM')
    expect(formatTime(at(9, 7), '12h')).toBe('09:07 AM')
  })
})
