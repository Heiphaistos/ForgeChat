// Position partagée (amélioration n° 34) : lue seulement d'un corps chiffré déchiffré, validée.
import { fromDmMessage } from '@/features/chat/adapters'
import { geoOf, osmUrl } from '@/lib/geo'

test('validation et lien', () => {
  expect(geoOf({ g: { lat: 48.85, lon: 2.35, acc: 10 } })).toEqual({ lat: 48.85, lon: 2.35, acc: 10 })
  expect(geoOf({ g: { lat: 95, lon: 0 } })).toBeNull()
  expect(osmUrl({ lat: 1, lon: 2 })).toBe('https://www.openstreetmap.org/?mlat=1&mlon=2#map=16/1/2')
})

test('un message déchiffré porte sa position, un message en clair jamais', () => {
  const base = { id: 'm', dm_channel_id: 'd', sender_id: 's', sender_username: 'a', content: '📍', created_at: '2026-10-12T10:00:00Z' }
  const enc = fromDmMessage({ ...base, e2e: 'ok', e2e_body: { t: '📍', g: { lat: 1, lon: 2 } } } as never)
  expect(enc.geo).toEqual({ lat: 1, lon: 2 })
  const plain = fromDmMessage({ ...base, e2e_body: { t: '📍', g: { lat: 1, lon: 2 } } } as never)
  expect(plain.geo).toBeUndefined()
})
