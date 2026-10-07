import { animatedImageType, profileLinkError } from '@/features/account/rules'
import { contrastRatio, displayNameOf, ensureContrast, gradientChars, parseHex, resolveNameStyle, toHex } from '@/lib/nameStyle'

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
