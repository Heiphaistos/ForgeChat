// Fonctions pures du lot communauté : node --test scripts/community.test.mjs
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { googleCalendarUrl, levelProgress, parseTags, renderWelcome, toCsv } from '../src/components/community/format.ts'
import { communityEn, communityFr } from '../src/i18n/community.ts'

test('CSV : échappement et neutralisation des formules', () => {
  const csv = toCsv([
    { a: 'simple', b: 'avec, virgule' },
    { a: '=HYPERLINK("x")', b: 'ligne\nsuivante' },
    { a: null, b: { k: 1 } },
  ], ['a', 'b'])
  assert.equal(csv, 'a,b\r\nsimple,"avec, virgule"\r\n"\'=HYPERLINK(""x"")","ligne\nsuivante"\r\n,"{""k"":1}"\r\n')
  assert.ok(toCsv([{ a: '-2+3' }], ['a']).includes("'-2+3"))
})

test('Google Agenda : dates UTC, répétition, fin par défaut', () => {
  const u = new URL(googleCalendarUrl({ name: 'Quiz & co', start_time: '2026-10-09T18:30:00.000Z', recurrence: 'weekly' }))
  assert.equal(u.hostname, 'calendar.google.com')
  assert.equal(u.searchParams.get('text'), 'Quiz & co')
  assert.equal(u.searchParams.get('dates'), '20261009T183000Z/20261009T193000Z')
  assert.equal(u.searchParams.get('recur'), 'RRULE:FREQ=WEEKLY')
  assert.equal(new URL(googleCalendarUrl({ name: 'x', start_time: '2026-10-09T18:30:00Z', recurrence: 'none' })).searchParams.get('recur'), null)
})

test('niveaux, bienvenue, étiquettes', () => {
  assert.equal(levelProgress(150, 100, 400), 50 / 300)
  assert.equal(levelProgress(0, 0, 100), 0)
  assert.equal(levelProgress(500, 400, 400), 1)
  assert.equal(renderWelcome('Salut {user}, n°{count} de {server} ({user})', 'Momo', 'Jötunheim', 7), 'Salut Momo, n°7 de Jötunheim (Momo)')
  assert.deepEqual(parseTags(' Jeux, fr, jeux ,, a,b,c,d,e'), ['jeux', 'fr', 'a', 'b', 'c'])
})

test('i18n : toutes les clés du lot traduites en anglais', () => {
  assert.deepEqual(Object.keys(communityEn).sort(), Object.keys(communityFr).sort())
  for (const [k, v] of Object.entries(communityEn)) assert.ok(v.trim(), k)
})
