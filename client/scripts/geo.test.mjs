// Partage de position (amélioration n° 34) : node --test scripts/geo.test.mjs
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { geoOf, osmUrl, roundGeo } from '../src/lib/geo.ts'

test('position validée, arrondie, lien sans paramètre injecté', () => {
  assert.deepEqual(geoOf({ t: '', g: { lat: 48.8566, lon: 2.3522, acc: 12 } }), { lat: 48.8566, lon: 2.3522, acc: 12 })
  for (const g of [{ lat: 91, lon: 0 }, { lat: 0, lon: 181 }, { lat: '1', lon: 2 }, { lat: NaN, lon: 0 }, null]) assert.equal(geoOf({ g }), null)
  assert.deepEqual(roundGeo({ lat: 48.856613456, lon: 2.352219876, acc: 12.7 }), { lat: 48.85661, lon: 2.35222, acc: 13 })
  assert.equal(osmUrl({ lat: 1.5, lon: -2 }), 'https://www.openstreetmap.org/?mlat=1.5&mlon=-2#map=16/1.5/-2')
})
