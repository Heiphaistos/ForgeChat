// Support à distance : mêmes cas que le web (client/scripts/remoteSupport.test.mjs) + adaptateur MP.
import * as rs from '@/lib/remoteSupport'
import { fromDmMessage } from '@/features/chat/adapters'
import type { DmMessage } from '@/types/models'

const REF = '0b6f0c1e-6a3b-4c1d-9e2f-1234567890ab'

test('invitation, liens et expiration', () => {
  const p = rs.invite('482 915 036', '7K2MQ9XR4TVB', 1_000)
  expect(rs.parseSupport(p)).toEqual({ v: 1, k: 'invite', id: '482915036', code: '7K2MQ9XR4TVB', exp: 601_000 })
  expect(rs.expired(p, 600_999)).toBe(false)
  expect(rs.expired(p, 601_000)).toBe(true)
  expect(rs.webViewerLink('482915036', '7K2MQ9XR4TVB')).toBe('https://ghd.heiphaistos.org/app/#id=482915036&code=7K2MQ9XR4TVB')
  expect(rs.newCode((n) => new Uint8Array(n).fill(255))).toBe('ZZZZZZZZZZZZ')
})

test('contenus refusés', () => {
  for (const bad of [null, { v: 1, k: 'accept' }, { v: 1, k: 'invite', id: '482915036', code: 'javascript:x', exp: 1 }, { v: 1, k: 'decline', ref: 'x' }])
    expect(rs.parseSupport(bad)).toBeNull()
  expect(rs.parseSupport({ v: 1, k: 'accept', ref: REF, x: 1 })).toEqual({ v: 1, k: 'accept', ref: REF })
})

test('MP déchiffré : la carte vient du contenu chiffré, jamais d\'un message illisible', () => {
  const base = { id: 'm1', content: 'x', created_at: '2026-10-07T00:00:00Z', sender_id: 'u', sender_username: 'A', sender_avatar: null } as unknown as DmMessage
  const ok = { ...base, e2e: 'ok', e2e_body: { t: 'x', rs: { v: 1, k: 'offer' } } } as unknown as DmMessage
  expect(fromDmMessage(ok).support).toEqual({ v: 1, k: 'offer' })
  expect(fromDmMessage({ ...base, e2e: 'locked', e2e_body: { t: '', rs: { v: 1, k: 'offer' } } } as unknown as DmMessage).support).toBeUndefined()
  expect(fromDmMessage({ ...ok, e2e_body: { t: 'x', rs: { v: 1, k: 'pwn' } } } as unknown as DmMessage).support).toBeUndefined()
})
