import { colors } from '@/theme'
import { contrastRatio, normalizeStatus, SELECTABLE_STATUSES, STATUS_COLORS, statusHollow, statusLabel } from '@/lib/status'

describe('statuts de présence (comme le web)', () => {
  it('normalise les valeurs du web et du mobile', () => {
    expect(normalizeStatus('idle')).toBe('away') // écrit par le web
    expect(normalizeStatus('away')).toBe('away') // écrit par le mobile
    expect(normalizeStatus('dnd')).toBe('dnd')
    expect(normalizeStatus(undefined)).toBe('offline')
    expect(normalizeStatus('nimporte')).toBe('offline')
  })

  it('libellés et ordre du sélecteur du web', () => {
    expect(SELECTABLE_STATUSES.map(statusLabel)).toEqual(['En ligne', 'Absent', 'Ne pas déranger', 'Invisible'])
    expect(statusLabel('offline')).toBe('Hors ligne')
  })

  it('couleurs du web (vert, jaune, rouge) ; hors ligne et invisible en anneau creux', () => {
    expect(STATUS_COLORS.online).toBe('#3ba55c')
    expect(STATUS_COLORS.away).toBe('#faa81a')
    expect(STATUS_COLORS.dnd).toBe('#ed4245')
    expect(statusHollow('invisible')).toBe(true)
    expect(statusHollow('online')).toBe(false)
  })

  it('contraste ≥ 3:1 (WCAG 1.4.11) sur tous les fonds sombres de l’app', () => {
    // Fonds réellement voisins d'une pastille : anneau bgAlt autour des avatars, sections et
    // feuilles en bgAlt, écrans en bg / bgDeep (bgElevated n'est jamais au contact d'une pastille).
    for (const bg of [colors.bg, colors.bgAlt, colors.bgDeep]) {
      for (const c of Object.values(STATUS_COLORS)) expect(contrastRatio(c, bg)).toBeGreaterThanOrEqual(3)
    }
    // Le gris du web (#72767d) ne passe pas sur le fond principal : raison de l'écart.
    expect(contrastRatio('#72767d', colors.bg)).toBeLessThan(3)
  })
})

describe('statut envoyé au serveur', () => {
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const { toServerStatus, SELECTABLE_STATUSES } = require('@/lib/status') as typeof import('@/lib/status')
  it('seulement online | idle | dnd | invisible (le serveur refuse le reste)', () => {
    expect(SELECTABLE_STATUSES.map(toServerStatus)).toEqual(['online', 'idle', 'dnd', 'invisible'])
  })
})
