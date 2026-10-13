import { categoryArrow, categoryLookFor, categoryStyles, categoryTitle, DEFAULT_CATEGORY_LOOK, inkOn } from '@/features/appearance/categoryLook'

const SID = '5c2300ff-87c8-4961-8fd5-ec0e61c95fa5'
const D = DEFAULT_CATEGORY_LOOK

describe('style des catégories (theme-studio)', () => {
  it('le style du serveur passe avant le style général', () => {
    const studio = { category: { shape: 'pill', color: '#22c55e', uppercase: false }, servers: { [SID]: { category: { shape: 'card', color: null, uppercase: true } } } }
    expect(categoryLookFor(studio, SID.toUpperCase())).toEqual({ ...D, shape: 'card' })
    expect(categoryLookFor(studio, '00000000-0000-0000-0000-000000000000')).toEqual({ ...D, shape: 'pill', color: '#22c55e', uppercase: false })
  })

  it('valeurs invalides ou absentes : style par défaut, rien d’injecté', () => {
    expect(categoryLookFor(null, SID)).toEqual(D)
    expect(categoryLookFor({ category: { shape: 'evil', color: 'red;}', uppercase: 'x', font: '}', icon: 'toString', size: 99, spacing: -1, arrow: 'x' } }, SID))
      .toEqual({ ...D, size: 18, spacing: 0 })
  })

  it('nouveaux champs relus (police, icône, flèche, alignement)', () => {
    const look = categoryLookFor({ category: { shape: 'terminal', font: 'mono', icon: 'rocket', arrow: 'plus', align: 'center', size: 14, spacing: 10, weight: 'black' } }, SID)
    expect(look).toMatchObject({ shape: 'terminal', font: 'mono', icon: 'rocket', arrow: 'plus', align: 'center', size: 14, spacing: 10, weight: 'black' })
    const st = categoryStyles(look)
    expect(st.icon).toBe('🚀')
    expect(st.row.justifyContent).toBe('center')
    expect(st.text.fontSize).toBe(14)
    expect(st.text.letterSpacing).toBeCloseTo(1.4)
    expect(categoryTitle(look, 'Général')).toBe('> général_')
    expect(categoryArrow(look, true)).toBe('add')
    expect(categoryArrow({ ...look, arrow: 'none' }, true)).toBeNull()
    expect(categoryTitle({ ...D, shape: 'bracket' }, 'Jeux')).toBe('[ JEUX ]')
  })

  it('chaque forme donne un style, « auto » et « plain » ne changent que la typographie', () => {
    const plain = categoryStyles({ ...D, shape: 'plain' })
    expect(plain.row).toEqual({})
    expect(plain.text).toEqual({ fontSize: 12, letterSpacing: 0.36, fontWeight: '600' })
    expect(categoryStyles({ ...D, shape: 'bar', color: '#f97316' }).row.borderLeftColor).toBe('#f97316')
    expect(categoryStyles({ ...D, shape: 'pill', color: '#f97316' }).row.backgroundColor).toBe('#f9731629')
    expect(categoryStyles({ ...D, shape: 'ribbon', color: '#ffd000' }).text.color).toBe('#000000')
    expect(inkOn('#101010')).toBe('#ffffff')
  })
})
