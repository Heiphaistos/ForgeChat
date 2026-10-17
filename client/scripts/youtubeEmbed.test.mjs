// Lecteur YouTube en postMessage : node --test scripts/youtubeEmbed.test.mjs
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { embedUrl, fromOurFrame, parseYtMessage, ytCommand, YT_ORIGIN } from '../src/lib/youtubeEmbed.ts'

test('adresse d’iframe : youtube-nocookie, jsapi, origine', () => {
  const u = new URL(embedUrl('dQw4w9WgXcQ', { origin: 'https://forgechat.example', start: 12.7, autoplay: true }))
  assert.equal(u.origin, YT_ORIGIN)
  assert.equal(u.pathname, '/embed/dQw4w9WgXcQ')
  assert.equal(u.searchParams.get('enablejsapi'), '1')
  assert.equal(u.searchParams.get('origin'), 'https://forgechat.example')
  assert.equal(u.searchParams.get('start'), '12')
  assert.equal(u.searchParams.get('autoplay'), '1')
})

test('commande et messages', () => {
  assert.deepEqual(JSON.parse(ytCommand('seekTo', [5, true])), { event: 'command', func: 'seekTo', args: [5, true] })
  assert.deepEqual(parseYtMessage('{"event":"onReady"}'), { type: 'ready' })
  assert.deepEqual(parseYtMessage('{"event":"onStateChange","info":0}'), { type: 'state', state: 0 })
  assert.deepEqual(
    parseYtMessage('{"event":"infoDelivery","info":{"currentTime":3.5,"duration":90,"playerState":1,"videoData":{"title":"T"}}}'),
    { type: 'info', time: 3.5, duration: 90, state: 1, title: 'T' })
  for (const bad of ['', 'x', 'null', '{"event":"autre"}', '{"event":"onStateChange","info":"1"}', 42, null]) assert.equal(parseYtMessage(bad), null, String(bad))
})

test('seul notre iframe + youtube-nocookie est écouté', () => {
  const win = {}
  assert.equal(fromOurFrame({ origin: YT_ORIGIN, source: win }, win), true)
  assert.equal(fromOurFrame({ origin: 'https://evil.example', source: win }, win), false)
  assert.equal(fromOurFrame({ origin: YT_ORIGIN, source: {} }, win), false)
  assert.equal(fromOurFrame({ origin: YT_ORIGIN, source: null }, null), false)
})
