// Lot communauté : mêmes fonctions pures que le web (client/scripts/community.test.mjs).
import { googleCalendarUrl, levelProgress, parseTags, renderWelcome, toCsv } from '@/features/community/format'
import { en, fr } from '@/i18n/parts/community'

test('CSV : échappement et neutralisation des formules', () => {
  const csv = toCsv([{ a: 'simple', b: 'avec, virgule' }, { a: '=HYPERLINK("x")', b: 'ligne\nsuivante' }, { a: null, b: { k: 1 } }], ['a', 'b'])
  expect(csv).toBe('a,b\r\nsimple,"avec, virgule"\r\n"\'=HYPERLINK(""x"")","ligne\nsuivante"\r\n,"{""k"":1}"\r\n')
})

test('Google Agenda : dates UTC, répétition, fin par défaut', () => {
  const u = new URL(googleCalendarUrl({ name: 'Quiz & co', start_time: '2026-10-09T18:30:00.000Z', recurrence: 'weekly' }))
  expect(u.searchParams.get('dates')).toBe('20261009T183000Z/20261009T193000Z')
  expect(u.searchParams.get('recur')).toBe('RRULE:FREQ=WEEKLY')
  expect(u.searchParams.get('text')).toBe('Quiz & co')
})

test('niveaux, bienvenue, étiquettes', () => {
  expect(levelProgress(150, 100, 400)).toBeCloseTo(50 / 300)
  expect(levelProgress(500, 400, 400)).toBe(1)
  expect(renderWelcome('Salut {user}, n°{count} de {server}', 'Momo', 'Jötunheim', 7)).toBe('Salut Momo, n°7 de Jötunheim')
  expect(parseTags(' Jeux, fr, jeux ,, a,b,c,d,e')).toEqual(['jeux', 'fr', 'a', 'b', 'c'])
})

test('i18n : tout le lot traduit en anglais', () => {
  expect(Object.keys(en).sort()).toEqual(Object.keys(fr).sort())
})
