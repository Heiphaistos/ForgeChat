// Lot « Profil et social » côté mobile : anniversaires (mêmes règles que le serveur et le web)
// et texte du statut riche.
import { daysUntil, upcomingBirthdays, validBirthday } from '@/features/social/birthday'
import { friendSections } from '@/features/social/friendSections'
import { activityFrom, richText } from '@/features/social/rich'

const today = new Date(2026, 9, 7)
const t = (key: string, vars?: Record<string, unknown>) => (vars?.name ? `${key}:${String(vars.name)}` : key)

test('date d’anniversaire', () => {
  expect(validBirthday(2, 29, null, today)).toBe(true)
  expect(validBirthday(2, 29, 2001, today)).toBe(false)
  expect(validBirthday(4, 31, null, today)).toBe(false)
  expect(validBirthday(12, 1, 2026, today)).toBe(false)
  expect(validBirthday(3, 4, 1990, today)).toBe(true)
})

test('anniversaires à venir', () => {
  expect(daysUntil({ month: 10, day: 7 }, today)).toBe(0)
  expect(daysUntil({ month: 2, day: 29 }, new Date(2027, 1, 20))).toBe(8)
  const list = upcomingBirthdays([{ id: 'a', birthday: { month: 10, day: 9 } }, { id: 'b', birthday: null }], 7, today)
  expect(list.map((x) => x.days)).toEqual([2])
})

test('statut riche', () => {
  expect(richText({ activity_type: 'listening', activity_name: 'Daft Punk', in_call: true }, t as never)).toBe('🎵 soc.listening:Daft Punk · 📞 soc.inCall')
  expect(richText({ activity_type: 'playing', activity_name: null }, t as never)).toBeNull()
  expect(activityFrom({ status: 'online' })).toBeUndefined()
  expect(activityFrom({ activity_type: null, in_call: true })).toEqual({ activity_type: null, activity_name: null, activity_detail: null, in_call: true })
})

test('amis rangés : favoris, groupes, autres', () => {
  const f = (id: string, fav = false) => ({ friend_id: id, is_favorite: fav })
  const groups = [
    { id: 'g2', name: 'Travail', position: 1, member_ids: ['c'] },
    { id: 'g1', name: 'Jeu', position: 0, member_ids: ['a', 'b'] },
  ]
  const s = friendSections([f('a', true), f('b'), f('c'), f('d')], groups, { favorites: 'Favoris', others: 'Autres' })
  expect(s.map((x) => [x.title, x.data.map((d) => d.friend_id)])).toEqual([
    ['Favoris', ['a']],
    ['Jeu', ['b']],
    ['Travail', ['c']],
    ['Autres', ['d']],
  ])
  expect(friendSections([f('x')], [], { favorites: 'F', others: 'A' })).toEqual([{ key: 'others', title: null, data: [f('x')] }])
})
