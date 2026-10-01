import { bottomPadding } from '@/lib/bottomPadding'

describe('marge du bas de la zone de saisie (affichage bord à bord)', () => {
  it('clavier fermé : au-dessus de la barre de navigation', () => {
    expect(bottomPadding(48, 0)).toBe(48)
    expect(bottomPadding(48, 0, 8)).toBe(56)
  })
  it('clavier ouvert : plus de marge (le clavier couvre déjà la barre)', () => {
    expect(bottomPadding(48, 1, 8)).toBe(8)
  })
  it('suit l’animation du clavier et borne la progression', () => {
    expect(bottomPadding(48, 0.5)).toBe(24)
    expect(bottomPadding(48, -0.2)).toBe(48)
    expect(bottomPadding(48, 1.3)).toBe(0)
  })
})
