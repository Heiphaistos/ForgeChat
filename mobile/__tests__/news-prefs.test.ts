// Page Actualités du mobile : logique partagée avec le web (groupes, ordre, fusion des pages, genres)
// et préférences synchronisées (/users/me/news-prefs, même JSON que le web).
const mockGet = jest.fn()
const mockPut = jest.fn()
jest.mock('@/lib/http', () => ({
  http: { get: (...a: unknown[]) => mockGet(...a), put: (...a: unknown[]) => mockPut(...a) },
  errorMessage: (e: unknown) => String(e),
  onSessionExpired: () => undefined,
}))
jest.mock('@/lib/logger', () => ({ logger: { debug: jest.fn(), info: jest.fn(), warn: jest.fn(), error: jest.fn() } }))
jest.mock('@/lib/secureStorage', () => {
  const mem = new Map<string, string>()
  return {
    secureStateStorage: {
      getItem: async (k: string) => mem.get(k) ?? null,
      setItem: async (k: string, v: string) => void mem.set(k, v),
      removeItem: async (k: string) => void mem.delete(k),
    },
  }
})

import { useAuth } from '@/stores/auth'
import { newsCategoryKey, type NewsSite } from '@/api/news'
import {
  buildNews, byLetter, families, genreOfView, genreView, groupOf, longName, mergePages, moveItem, moveWithin,
  sanitizePrefs, shortName, shownTheme, togglePin,
} from '@/features/news/logic'
import { loadNewsPrefs, resetNewsPrefsSync, useNewsPrefs } from '@/features/news/prefs'
import { useSettings } from '@/stores/settings'

const site = (id: string, category: string, today = 1): NewsSite => ({ id, name: id, category, last_title: null, last_at: null, today })

describe('groupes et noms', () => {
  it('groupe par familles, « IA » seulement en mot entier, inconnue = autres', () => {
    expect(groupOf('⭒𝐒𝐞́𝐜𝐮𝐫𝐢𝐭𝐞́')).toBe('tech')
    expect(groupOf('IA générative')).toBe('tech')
    expect(groupOf('Iaido')).toBe('autres')
    expect(groupOf('YouTube · Jeux vidéo')).toBe('youtube')
    expect(groupOf('Bon-Plan-Promo')).toBe('bonsplans')
    expect(groupOf('Cuisine')).toBe('autres')
  })
  it('nom court dans le groupe YouTube, long hors du groupe', () => {
    expect(shortName('YouTube · Jeux vidéo')).toBe('Jeux vidéo')
    expect(longName('YouTube · Jeux vidéo')).toBe('YouTube · Jeux vidéo')
    expect(shortName('Film')).toBe('Film')
  })
})

describe('déplacements', () => {
  it('moveWithin ne touche pas aux rubriques hors du sous-ensemble', () => {
    expect(moveWithin(['a', 'x', 'b', 'y', 'c'], ['a', 'b', 'c'], 'c', 0)).toEqual(['c', 'x', 'a', 'y', 'b'])
    expect(moveWithin(['a', 'b'], ['a', 'b'], 'a', 99)).toEqual(['b', 'a'])
  })
  it('moveItem borne le rang, togglePin ajoute en fin ou retire', () => {
    expect(moveItem(['a', 'b', 'c'], 'a', -3)).toEqual(['a', 'b', 'c'])
    expect(moveItem(['a', 'b', 'c'], 'a', 1)).toEqual(['b', 'a', 'c'])
    expect(togglePin(['c:ia'], 's:1')).toEqual(['c:ia', 's:1'])
    expect(togglePin(['c:ia', 's:1'], 'c:ia')).toEqual(['s:1'])
  })
})

describe('mergePages', () => {
  const art = (id: string, min: number) => ({ id, published_at: new Date(Date.UTC(2026, 0, 1, 12, min)).toISOString() })
  it('coupe à la fin la plus récente des pages pleines, sans doublon, du plus récent au plus ancien', () => {
    const a = [art('a1', 50), art('a2', 40), art('a3', 30)] // pleine (page de 3), finit à 30
    const b = [art('b1', 45), art('b2', 20), art('b3', 10)] // pleine, finit à 10
    const c = [art('c1', 35), art('a1', 50)] // incomplète
    const out = mergePages([a, b, c], 3)
    expect(out.articles.map((x) => x.id)).toEqual(['a1', 'b1', 'a2', 'c1', 'a3'])
    expect(out.next).toBe(a[2]!.published_at)
  })
  it('liste unique incomplète : pas de page suivante', () => {
    expect(mergePages([[art('a', 1)]], 3)).toEqual({ articles: [art('a', 1)], next: undefined })
  })
})

describe('buildNews', () => {
  const sites = [site('zataz', 'Sécurité', 4), site('korben', 'Informatique', 2), site('yt1', 'YouTube · Jeux vidéo'), site('muet', 'Informatique', 9)]
  it('sources coupées exclues, rubriques et groupes ordonnés, sites visibles A-Z', () => {
    const { rubrics, groups, visible } = buildNews(sites, [newsCategoryKey('YouTube · Jeux vidéo')], ['muet'])
    expect(rubrics.map((r) => r.cat)).toEqual(['YouTube · Jeux vidéo', 'Informatique', 'Sécurité'])
    expect(rubrics[1]!.today).toBe(2)
    expect(groups.map((g) => [g.id, g.today])).toEqual([['youtube', 1], ['tech', 6]])
    expect(visible.map((s) => s.id)).toEqual(['korben', 'yt1', 'zataz'])
  })
  it('genres : une rubrique chacun, YouTube réuni en un seul', () => {
    const yt = [site('a', 'YouTube · Jeux vidéo'), site('b', 'YouTube · Cuisine'), site('k', 'Informatique')]
    const fams = families(buildNews(yt, [], []).groups, 'YouTube')
    const all = fams.flatMap((f) => f.list)
    expect(all.map((g) => [g.id, g.sites.length])).toEqual([['informatique', 1], ['youtube', 2]])
    const ytGenre = all[1]!
    const v = genreView(ytGenre)
    expect(v).toEqual({ kind: 'genre', id: 'youtube', label: 'YouTube', categories: ['YouTube · Cuisine', 'YouTube · Jeux vidéo'] })
    expect(genreView(all[0]!)).toEqual({ kind: 'category', category: 'Informatique' })
    expect(genreOfView({ kind: 'category', category: 'YouTube · Cuisine' }, all)?.id).toBe('youtube')
    expect(genreOfView({ kind: 'top' }, all)).toBeUndefined()
  })
  it('A-Z : initiale sans accent, « # » pour le reste', () => {
    expect(byLetter([site('Écran', 'x'), site('3DNews', 'x'), site('eco', 'x')]).map(([l, list]) => [l, list.length])).toEqual([['E', 2], ['#', 1]])
  })
})

describe('sanitizePrefs', () => {
  it('valeurs abîmées : défauts du web, bornes', () => {
    expect(sanitizePrefs(null)).toEqual({ theme: 10, pins: [], order: [], muted: [], folded: {} })
    expect(sanitizePrefs({ theme: '3', pins: [1, 'c:ia', 'x'.repeat(121)], folded: { 'g:tech': true, k: 'oui' } })).toEqual({ theme: 10, pins: ['c:ia'], order: [], muted: [], folded: { 'g:tech': true } })
    expect(sanitizePrefs({ muted: Array.from({ length: 300 }, (_, i) => String(i)) }).muted).toHaveLength(200)
  })
  it('thème inconnu du mobile gardé tel quel, affiché comme le thème par défaut', () => {
    expect(sanitizePrefs({ theme: 12 }).theme).toBe(12)
    expect(shownTheme(12)).toBe(10)
    expect(shownTheme(9)).toBe(9)
  })
})

describe('synchronisation des préférences', () => {
  beforeAll(async () => {
    await useNewsPrefs.persist.rehydrate()
    await useSettings.persist.rehydrate()
  })
  beforeEach(() => {
    jest.useFakeTimers()
    resetNewsPrefsSync()
    useNewsPrefs.setState({ prefs: sanitizePrefs({}), migrated: false, owner: null })
    useSettings.setState({ newsOrder: [] })
    mockGet.mockReset()
    mockPut.mockReset().mockResolvedValue({ ok: true })
  })
  afterEach(() => jest.useRealTimers())

  it('le serveur fait foi ; un changement part une fois, 800 ms après le dernier', async () => {
    mockGet.mockResolvedValue({ theme: 42, pins: ['c:ia'], order: [], muted: [], folded: {} })
    await loadNewsPrefs()
    expect(mockGet).toHaveBeenCalledWith('/users/me/news-prefs')
    expect(useNewsPrefs.getState().prefs.theme).toBe(42)
    expect(mockPut).not.toHaveBeenCalled()
    useNewsPrefs.getState().update({ muted: ['s1'] })
    useNewsPrefs.getState().update({ muted: ['s1', 's2'] })
    jest.advanceTimersByTime(799)
    expect(mockPut).not.toHaveBeenCalled()
    jest.advanceTimersByTime(1)
    expect(mockPut).toHaveBeenCalledTimes(1)
    expect(mockPut).toHaveBeenCalledWith('/users/me/news-prefs', { theme: 42, pins: ['c:ia'], order: [], muted: ['s1', 's2'], folded: {} })
  })

  it('rien en ligne : reprend une fois l’ancien ordre local et l’envoie', async () => {
    useSettings.setState({ newsOrder: ['jeux', 'ia'] })
    mockGet.mockResolvedValue(null)
    await loadNewsPrefs()
    expect(mockPut).toHaveBeenCalledWith('/users/me/news-prefs', { theme: 10, pins: [], order: ['jeux', 'ia'], muted: [], folded: {} })
    expect(useSettings.getState().newsOrder).toEqual([])
    expect(useNewsPrefs.getState().migrated).toBe(true)
  })

  it('l’ancien ordre ne remplace pas un ordre déjà réglé', async () => {
    useNewsPrefs.setState({ prefs: sanitizePrefs({ order: ['sport'] }) })
    useSettings.setState({ newsOrder: ['jeux'] })
    mockGet.mockResolvedValue(null)
    await loadNewsPrefs()
    expect(useNewsPrefs.getState().prefs.order).toEqual(['sport'])
  })

  it('hors ligne : cache local affiché, rien envoyé (le serveur n’est pas écrasé)', async () => {
    mockGet.mockRejectedValue(new Error('réseau'))
    await loadNewsPrefs()
    useNewsPrefs.getState().update({ theme: 3 })
    jest.advanceTimersByTime(2000)
    expect(mockPut).not.toHaveBeenCalled()
    expect(useNewsPrefs.getState().prefs.theme).toBe(3)
  })

  it('autre compte : réglages remis à zéro, rien envoyé avant d’avoir lu ceux du nouveau compte', async () => {
    useAuth.setState({ user: { id: 'a' } as never })
    mockGet.mockResolvedValue({ theme: 3, pins: ['c:ia'], order: [], muted: ['s9'], folded: {} })
    await loadNewsPrefs()
    expect(useNewsPrefs.getState().owner).toBe('a')
    useAuth.setState({ user: { id: 'b' } as never })
    expect(useNewsPrefs.getState().prefs).toEqual(sanitizePrefs({}))
    useNewsPrefs.getState().update({ theme: 2 })
    jest.advanceTimersByTime(2000)
    expect(mockPut).not.toHaveBeenCalled()
    useAuth.setState({ user: null })
  })
})
