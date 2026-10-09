import { categoryLookFor, categoryStyles } from '@/features/appearance/categoryLook'

const SID = '5c2300ff-87c8-4961-8fd5-ec0e61c95fa5'

describe('style des catégories (theme-studio)', () => {
  it('le style du serveur passe avant le style général', () => {
    const studio = { category: { shape: 'pill', color: '#22c55e', uppercase: false }, servers: { [SID]: { category: { shape: 'card', color: null, uppercase: true } } } }
    expect(categoryLookFor(studio, SID.toUpperCase())).toEqual({ shape: 'card', color: null, uppercase: true })
    expect(categoryLookFor(studio, '00000000-0000-0000-0000-000000000000')).toEqual({ shape: 'pill', color: '#22c55e', uppercase: false })
  })

  it('valeurs invalides ou absentes : style par défaut, rien d’injecté', () => {
    expect(categoryLookFor(null, SID)).toEqual({ shape: 'auto', color: null, uppercase: true })
    expect(categoryLookFor({ category: { shape: 'evil', color: 'red;}', uppercase: 'x' } }, SID)).toEqual({ shape: 'auto', color: null, uppercase: true })
  })

  it('chaque forme donne un style, « auto » et « plain » ne changent rien', () => {
    expect(categoryStyles({ shape: 'plain', color: null, uppercase: true })).toEqual({ row: {}, text: {} })
    expect(categoryStyles({ shape: 'bar', color: '#f97316', uppercase: true }).row.borderLeftColor).toBe('#f97316')
    expect(categoryStyles({ shape: 'pill', color: '#f97316', uppercase: true }).row.backgroundColor).toBe('#f9731629')
  })
})
