import { bannerBounds, bannerOverlay, cleanLook, hex, iconRadius, validImageRef } from '@/features/servers/serverLook'

describe('apparence du serveur (servers.look)', () => {
  it('vide, invalide ou par défaut : rien', () => {
    expect(cleanLook(null)).toBeNull()
    expect(cleanLook('dark')).toBeNull()
    expect(cleanLook({})).toBeNull()
    expect(cleanLook({ enforce: true })).toBeNull()
    expect(cleanLook({ icon_shape: 'circle' })).toBeNull()
    expect(cleanLook({ icon_shape: 'star', accent: '#ff0000', unread_color: 0x1000000 })).toBeNull()
  })

  it('nombres bornés, identifiants en liste blanche', () => {
    const l = cleanLook({ banner: { focus_x: 900, focus_y: -1, height: 'huge', overlay: 'x', overlay_strength: 500 }, icon_shape: 'hexagon', accent: 0x112233 })
    expect(l?.banner).toEqual({ focus_x: 100, focus_y: 0, height: 'auto', overlay: 'bottom', overlay_strength: 100 })
    expect(l?.icon_shape).toBe('hexagon')
    expect(hex(l!.accent!)).toBe('#112233')
    expect(bannerBounds({ ...l!.banner!, height: 'compact' }).max).toBeLessThan(bannerBounds(undefined).max)
    expect(bannerOverlay({ ...l!.banner!, overlay: 'none' })).toBeNull()
  })

  it('images de fond : seulement nos propres envois', () => {
    for (const bad of ['https://evil.example/x.png', '/uploads/avatars/x.png', '/uploads/server-banners/../x.png', '/uploads/server-banners/x.svg']) {
      expect(validImageRef(bad)).toBe(false)
      expect(cleanLook({ message_bg: { kind: 'image', image: bad } })).toBeNull()
    }
    const l = cleanLook({ message_bg: { kind: 'image', image: '/uploads/server-banners/a_0b1c.gif', blur: 99, opacity: 200 } })
    expect(l?.message_bg).toEqual({ kind: 'image', image: '/uploads/server-banners/a_0b1c.gif', blur: 24, opacity: 100 })
  })

  it('forme de l’icône', () => {
    expect(iconRadius(undefined, 48)).toBe(24)
    expect(iconRadius('square', 48)).toBeLessThan(iconRadius('squircle', 48))
  })
})
