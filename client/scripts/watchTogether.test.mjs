// Test des fonctions pures de « Regarder ensemble » : node --test scripts/watchTogether.test.mjs
// (Node >= 22.18 lit le TypeScript directement, aucune dépendance.)
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { parseYouTubeId, parseWatchState, expectedPosition, needsResync, youtubeLink } from '../src/lib/watchTogether.ts'

test('adresses YouTube acceptées (mêmes cas que le serveur)', () => {
  for (const url of [
    'https://www.youtube.com/watch?v=dQw4w9WgXcQ',
    '  youtube.com/watch?feature=share&v=dQw4w9WgXcQ&t=42s ',
    'https://m.youtube.com/watch/?v=dQw4w9WgXcQ#x',
    'https://youtu.be/dQw4w9WgXcQ?si=abc',
    'http://YOUTU.BE/dQw4w9WgXcQ/',
    'https://www.youtube.com/shorts/dQw4w9WgXcQ?feature=x',
  ]) assert.equal(parseYouTubeId(url), 'dQw4w9WgXcQ', url)
})

test('adresses refusées', () => {
  for (const url of [
    'dQw4w9WgXcQ',
    'https://www.youtube.com/watch?v=dQw4w9WgXc',
    'https://www.youtube.com/watch?v=dQw4w9WgXcQQ',
    'https://www.youtube.com/watch?v=dQw4w9WgX<Q',
    'https://youtube.com@evil.example/watch?v=dQw4w9WgXcQ',
    'https://evil.example/watch?v=dQw4w9WgXcQ',
    'https://youtube.com.evil.example/watch?v=dQw4w9WgXcQ',
    'https://www.youtube.com/embed/dQw4w9WgXcQ',
    'https://www.youtube.com/watch?vv=dQw4w9WgXcQ',
    'javascript:alert(1)//youtu.be/dQw4w9WgXcQ',
    '',
  ]) assert.equal(parseYouTubeId(url), null, url)
})

test('état reçu validé, position datée à la réception', () => {
  const ev = { channel_id: 'c', item: 3, video_id: 'dQw4w9WgXcQ', playing: true, position: 30, queue: ['aaaaaaaaaaa', 'pas-un-id'], by: 'u' }
  const s = parseWatchState(ev, 1000)
  assert.deepEqual(s?.queue, ['aaaaaaaaaaa'])
  assert.equal(expectedPosition(s, 6000), 35)
  assert.equal(expectedPosition({ ...s, playing: false }, 6000), 30)
  assert.equal(parseWatchState({ ...ev, video_id: '<script>' }, 0), null)
  assert.equal(parseWatchState({ ...ev, position: Number.NaN }, 0), null)
  assert.equal(parseWatchState(null, 0), null)
})

test('recalage au-delà de 2 s, plus fin après une action', () => {
  assert.equal(needsResync(10, 11.9), false)
  assert.equal(needsResync(10, 12.1), true)
  assert.equal(needsResync(10, 9), false)
  assert.equal(needsResync(10, 9, 0.5), true)
})

test('lien YouTube horodaté', () => {
  assert.equal(youtubeLink('dQw4w9WgXcQ', 75.9), 'https://www.youtube.com/watch?v=dQw4w9WgXcQ&t=75s')
  assert.equal(youtubeLink('dQw4w9WgXcQ'), 'https://www.youtube.com/watch?v=dQw4w9WgXcQ')
})
