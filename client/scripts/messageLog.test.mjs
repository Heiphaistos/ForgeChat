// Journal local des messages supprimés/modifiés : node --test scripts/messageLog.test.mjs
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { applyDeletion, editHistory } from '../src/lib/messageLog.ts'

const list = [
  { id: 'a', content: 'salut', author_id: 'bob' },
  { id: 'b', content: 'moi', author_id: 'me' },
  { id: 'c', content: 'éphémère', author_id: 'bob', expires_at: '2030-01-01T00:00:00Z' },
  { id: 'd', content: 'après lecture', sender_id: 'bob', expire_on_read: true },
  { id: 'e', content: null, author_id: 'bob' },
]

test('journal coupé : la suppression retire le message', () => {
  assert.deepEqual(applyDeletion(list, 'a', false, 'me').map(m => m.id), ['b', 'c', 'd', 'e'])
})

test('journal actif : message d\'un autre gardé et marqué', () => {
  const out = applyDeletion(list, 'a', true, 'me')
  assert.equal(out.length, list.length)
  assert.equal(out.find(m => m.id === 'a').logged_deleted, true)
  assert.equal(list[0].logged_deleted, undefined, 'liste d\'origine intacte')
})

test('jamais gardés : les miens, les éphémères, les illisibles', () => {
  for (const id of ['b', 'c', 'd', 'e']) {
    assert.ok(!applyDeletion(list, id, true, 'me').some(m => m.id === id), id)
  }
})

test('modifications : anciennes versions gardées seulement si le journal est actif', () => {
  const m = { id: 'x', content: 'v1' }
  assert.equal(editHistory(m, 'v2', false), undefined)
  assert.deepEqual(editHistory(m, 'v2', true), ['v1'])
  assert.deepEqual(editHistory({ ...m, logged_edits: ['v0'] }, 'v2', true), ['v0', 'v1'])
  assert.equal(editHistory(m, 'v1', true), undefined, 'texte inchangé')
  assert.equal(editHistory(m, null, true), undefined, 'texte illisible')
  const many = { id: 'y', content: 'v11', logged_edits: Array.from({ length: 10 }, (_, i) => `v${i + 1}`) }
  assert.equal(editHistory(many, 'v12', true).length, 10)
})
