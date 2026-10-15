import { FIXED_IDS, MOBILE_FIXED, fixedOrder, moveFixedStep, resetFixed, setFixedHidden, visibleFixed, withBase } from '@/features/servers/railFixed'
import { railEntries } from '@/features/servers/layout'

test('ordre par défaut : Tutoriel juste au-dessus d’Actualités', () => {
  expect(fixedOrder(undefined)).toEqual([...FIXED_IDS])
  expect(visibleFixed(null)).toEqual(['dms', 'tutorials', 'news'])
})

test('ordre enregistré : inconnus et doublons ignorés, manquants replacés', () => {
  expect(fixedOrder(['news', 'zz', 'news', 'dms'])).toEqual(['saved', 'tutorials', 'news', 'dms', 'notifications'])
  expect(fixedOrder('x')).toEqual([...FIXED_IDS])
})

test('masquer / afficher', () => {
  const l = setFixedHidden({ order: ['a'] }, 'tutorials', true)
  expect(l.hidden).toEqual(['tutorials'])
  expect(visibleFixed(l)).toEqual(['dms', 'news'])
  expect(setFixedHidden(l, 'tutorials', false).hidden).toEqual([])
})

test('monter / descendre parmi les entrées affichées ; aux bords rien ne change', () => {
  const l = moveFixedStep(null, 'news', -1, MOBILE_FIXED)
  expect(visibleFixed(l)).toEqual(['dms', 'news', 'tutorials'])
  expect(moveFixedStep(l, 'tutorials', 1, MOBILE_FIXED)).toEqual(l)
  expect(visibleFixed(moveFixedStep(l, 'dms', 1, MOBILE_FIXED))).toEqual(['news', 'dms', 'tutorials'])
  expect(moveFixedStep(null, 'dms', -1, MOBILE_FIXED).fixed).toBeUndefined()
})

test('les entrées du web non affichées sur mobile gardent leur place relative', () => {
  const l = moveFixedStep({ fixed: ['notifications', 'saved', 'dms', 'tutorials', 'news'] }, 'tutorials', -1, MOBILE_FIXED)
  expect(l.fixed).toEqual(['notifications', 'saved', 'tutorials', 'dms', 'news'])
})

test('écriture sans perte : order, folders, clés inconnues du web préservés', () => {
  const web = { order: ['s1', 'folder_1'], folders: { folder_1: { name: 'J', color: '#fff', serverIds: ['s2'] } }, futur: { a: 1 }, fixed: ['news', 'dms'], hidden: ['saved'] }
  const hidden = setFixedHidden(web, 'dms', true)
  expect(hidden).toEqual({ ...web, hidden: ['saved', 'dms'] })
  expect(moveFixedStep(web, 'dms', -1, MOBILE_FIXED).futur).toEqual({ a: 1 })
  expect(resetFixed(web)).toEqual({ order: web.order, folders: web.folders, futur: { a: 1 } })
  expect(withBase(null)).toEqual({ order: [], folders: {} })
  expect(withBase(web)).toEqual(web)
  expect(web.hidden).toEqual(['saved']) // entrée non mutée
})

test('railEntries ignore fixed / hidden', () => {
  const s = { id: 'a', name: 'a' } as never
  expect(railEntries([s], { order: ['a'], folders: {}, fixed: ['news'], hidden: ['dms'], futur: 1 }).length).toBe(1)
})
