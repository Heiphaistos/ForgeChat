// Règles du lot « Profil et social » côté web : node --test scripts/social.test.mjs
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { validBirthday, daysUntil, upcomingBirthdays } from '../src/utils/birthday.ts'

const today = new Date(2026, 9, 7) // 7 octobre 2026

test('date d\'anniversaire : mêmes règles que le serveur', () => {
  assert.equal(validBirthday(2, 29, null, today), true)
  assert.equal(validBirthday(2, 29, 2001, today), false)
  assert.equal(validBirthday(4, 31, null, today), false)
  assert.equal(validBirthday(13, 1, null, today), false)
  assert.equal(validBirthday(3, 4, 1990, today), true)
  assert.equal(validBirthday(1, 1, 1850, today), false)
  assert.equal(validBirthday(12, 1, 2026, today), false)
})

test('prochains anniversaires', () => {
  assert.equal(daysUntil({ month: 10, day: 7 }, today), 0)
  assert.equal(daysUntil({ month: 10, day: 9 }, today), 2)
  assert.equal(daysUntil({ month: 10, day: 6 }, today), 364)
  assert.equal(daysUntil({ month: 2, day: 29 }, new Date(2027, 1, 20)), 8) // fêté le 28/02/2027
  const list = upcomingBirthdays([
    { id: 'a', birthday: { month: 10, day: 12 } },
    { id: 'b', birthday: null },
    { id: 'c', birthday: { month: 10, day: 7 } },
    { id: 'd', birthday: { month: 12, day: 25 } },
  ], 7, today)
  assert.deepEqual(list.map(x => [x.friend.id, x.days]), [['c', 0], ['a', 5]])
})
