// Voix spatiale : node --test scripts/spatialAudio.test.mjs (mêmes cas : mobile/__tests__/spatial-audio.test.ts)
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { spatialAzimuth, spatialPosition } from '../src/lib/spatialAudio.ts'

const deg = r => Math.round((r * 180) / Math.PI * 10) / 10

test('un seul participant : devant soi', () => {
  assert.equal(spatialAzimuth(0, 1), 0)
  assert.equal(spatialAzimuth(3, 2), 0) // index hors bornes : centre
})

test('deux participants : 12,5° de part et d autre', () => {
  assert.equal(deg(spatialAzimuth(0, 2)), -12.5)
  assert.equal(deg(spatialAzimuth(1, 2)), 12.5)
})

test('salle pleine : arc borné à ±75°, ordre gauche → droite', () => {
  const n = 20
  const a = Array.from({ length: n }, (_, i) => spatialAzimuth(i, n))
  assert.equal(deg(a[0]), -75)
  assert.equal(deg(a[n - 1]), 75)
  for (let i = 1; i < n; i++) assert.ok(a[i] > a[i - 1])
})

test('position : devant = -z, gauche = -x', () => {
  const front = spatialPosition(0)
  assert.equal(front.x, 0)
  assert.equal(front.z, -1)
  assert.ok(spatialPosition(spatialAzimuth(0, 3)).x < 0)
})
