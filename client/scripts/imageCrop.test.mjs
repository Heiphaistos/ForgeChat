// Recadrage d'avatar : node --test scripts/imageCrop.test.mjs
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { squareCrop, isAnimatedImage } from '../src/lib/imageCrop.ts'

test('carré centré, borné dans l’image', () => {
  assert.deepEqual(squareCrop(400, 200, 1, 200, 100), { x: 100, y: 0, side: 200 })
  assert.deepEqual(squareCrop(400, 200, 2, 0, 0), { x: 0, y: 0, side: 100 })
  assert.deepEqual(squareCrop(400, 200, 2, 1000, 1000), { x: 300, y: 100, side: 100 })
  assert.deepEqual(squareCrop(400, 200, 0.5, 200, 100), { x: 100, y: 0, side: 200 })
})

const bytes = (...parts) => new Uint8Array(parts.flatMap(p => typeof p === 'string' ? [...p].map(c => c.charCodeAt(0)) : p))
const chunk = (type, len = 0) => [...bytes([0, 0, 0, len], type, new Array(len + 4).fill(0))]
const PNG = [0x89, ...'PNG\r\n\x1a\n'.split('').map(c => c.charCodeAt(0))]

test('détection d’image animée', () => {
  assert.equal(isAnimatedImage(bytes('GIF89a')), true)
  assert.equal(isAnimatedImage(bytes(PNG, chunk('IHDR', 13), chunk('acTL', 8), chunk('IDAT'))), true)
  assert.equal(isAnimatedImage(bytes(PNG, chunk('IHDR', 13), chunk('IDAT'), chunk('acTL', 8))), false)
  const webp = flag => bytes('RIFF', [0, 0, 0, 0], 'WEBP', 'VP8X', [10, 0, 0, 0], [flag, 0, 0, 0])
  assert.equal(isAnimatedImage(webp(0x02)), true)
  assert.equal(isAnimatedImage(webp(0x10)), false)
  assert.equal(isAnimatedImage(bytes([0xff, 0xd8, 0xff])), false)
})
