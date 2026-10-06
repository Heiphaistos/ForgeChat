import { serverAppearancePatch } from '@/features/appearance/sync'
import { formatTime } from '@/lib/format'
import { colors } from '@/theme'
import { isLightTheme, resolvePalette, THEMES } from '@/theme/palettes'
import { DEFAULT_PREFS, parsePrefs } from '@/theme/prefs'

const HEX = /^#[0-9a-f]{6}$/i

describe('palettes', () => {
  it('thème inconnu ou vide → Sombre', () => {
    const dark = resolvePalette('dark')
    expect(resolvePalette('nimporte-quoi')).toEqual(dark)
    expect(resolvePalette('')).toEqual(dark)
    expect(dark.bg).toBe('#313338')
    expect(isLightTheme('nimporte-quoi')).toBe(false)
  })

  it('reprend tous les thèmes du web avec des couleurs complètes', () => {
    expect(THEMES).toHaveLength(28)
    for (const t of THEMES) {
      for (const k of ['bg', 'bgAlt', 'bgDeep', 'bgElevated', 'bgHover', 'primary', 'primaryPressed', 'text', 'textMuted', 'textFaint'] as const) {
        expect(t.palette[k]).toMatch(HEX)
      }
    }
    expect(resolvePalette('dracula').primary).toBe('#bd93f9')
    expect(resolvePalette('darker').bg).toBe('#000000')
  })

  it('thèmes clairs : texte sombre sur fond clair', () => {
    for (const id of ['light', 'winter']) {
      expect(isLightTheme(id)).toBe(true)
      const p = resolvePalette(id)
      const lum = (c: string) => parseInt(c.slice(1, 3), 16) + parseInt(c.slice(3, 5), 16) + parseInt(c.slice(5, 7), 16)
      expect(lum(p.bg)).toBeGreaterThan(lum(p.text) + 300)
    }
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
    })
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
