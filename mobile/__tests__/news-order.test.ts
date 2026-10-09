import { orderCategories } from '@/api/news'

describe('orderCategories', () => {
  const cats = ['Série', '⭒𝐒𝐞́𝐜𝐮𝐫𝐢𝐭𝐞́', 'Film', 'YouTube · Jeux vidéo', 'Bon-Plan-Promo', 'Informatique', 'Jeux', 'Inconnue']
  it('range par familles par défaut (Film à côté de Série)', () => {
    expect(orderCategories(cats, [])).toEqual(['Informatique', '⭒𝐒𝐞́𝐜𝐮𝐫𝐢𝐭𝐞́', 'Jeux', 'Film', 'Série', 'YouTube · Jeux vidéo', 'Bon-Plan-Promo', 'Inconnue'])
  })
  it("l'ordre choisi passe devant, le reste suit l'ordre par défaut", () => {
    expect(orderCategories(cats, ['serie', 'jeux']).slice(0, 4)).toEqual(['Série', 'Jeux', 'Informatique', '⭒𝐒𝐞́𝐜𝐮𝐫𝐢𝐭𝐞́'])
  })
})
