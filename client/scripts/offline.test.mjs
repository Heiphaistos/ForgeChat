// Mode hors ligne (lectures gardées, file d'envoi) : node --test scripts/offline.test.mjs
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { cacheKey, convOf, isQueueable } from '../src/lib/offline.ts'

const U = '11111111-1111-4111-8111-111111111111'

test('lectures gardées : conversations et clés, première page seulement', () => {
  assert.equal(cacheKey('get', `/dms/${U}/messages`), `/dms/${U}/messages`)
  assert.equal(cacheKey(undefined, `/servers/${U}/channels/${U}/messages`), `/servers/${U}/channels/${U}/messages`)
  assert.equal(cacheKey('get', `/e2e/conversations/group/${U}/keys`), `/e2e/conversations/group/${U}/keys`)
  assert.equal(cacheKey('get', '/users/me'), '/users/me')
  assert.equal(cacheKey('get', `/dms/${U}/messages?around=x`), null)
  assert.equal(cacheKey('get', `/dms/${U}/messages`, { before: 'x' }), null)
  assert.equal(cacheKey('post', `/dms/${U}/messages`), null)
  assert.equal(cacheKey('get', '/users/me/keys'), null, 'clé de compte jamais gardée ici')
  assert.equal(cacheKey('get', `/servers/${U}/audit-log`), null)
})

test("file d'envoi : seulement du texte chiffré, sans pièce jointe", () => {
  const enc = { v: 1, epoch: 0, iv: 'a', ct: 'b' }
  assert.ok(isQueueable('post', `/dms/${U}/messages`, { enc, client_msg_id: U }))
  assert.ok(isQueueable('POST', `/dms/groups/${U}/messages`, { enc }))
  assert.ok(isQueueable('post', `/servers/${U}/channels/${U}/messages`, { enc, has_attachments: false }))
  assert.ok(!isQueueable('post', `/dms/${U}/messages`, { content: 'en clair' }), 'jamais de clair en file')
  assert.ok(!isQueueable('post', `/dms/${U}/messages`, { enc, has_attachments: true }))
  assert.ok(!isQueueable('patch', `/dms/${U}/messages`, { enc }))
  assert.ok(!isQueueable('post', `/dms/${U}/messages/${U}/reactions`, { enc }))
})

test('conversation visée par un envoi', () => {
  assert.deepEqual(convOf(`/dms/groups/${U}/messages`), ['group', U])
  assert.deepEqual(convOf(`/dms/${U}/messages`), ['dm', U])
  assert.deepEqual(convOf(`/servers/x/channels/${U}/messages`), ['channel', U])
  assert.equal(convOf('/users/me'), null)
})
