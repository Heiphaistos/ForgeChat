// Panneau vocal (carte de stream, minuteur) : node --test scripts/voiceDock.test.mjs
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { screenCaptureConstraints, sourceFromLabel, streamSummary, formatDuration } from '../src/lib/voiceDock.ts'

test('qualité du partage : hauteur visée en 16/9, ou taille native pour « source »', () => {
  assert.deepEqual(screenCaptureConstraints('1440', 30), {
    width: { ideal: 2560 }, height: { ideal: 1440 }, frameRate: { ideal: 30 },
  })
  assert.deepEqual(screenCaptureConstraints(null, 60).height, { ideal: 1080 }) // défaut
  assert.deepEqual(screenCaptureConstraints('source', 15), { frameRate: { ideal: 15 } })
})

test('nom de la source : titre de fenêtre, numéro d’écran, libellés techniques ignorés', () => {
  assert.deepEqual(sourceFromLabel('screen:0:0'), { screen: 1 })
  assert.deepEqual(sourceFromLabel('screen:2:0'), { screen: 3 })
  assert.equal(sourceFromLabel('window:1234:1'), null)
  assert.equal(sourceFromLabel('web-contents-media-stream://12:3'), null)
  assert.equal(sourceFromLabel('  '), null)
  assert.deepEqual(sourceFromLabel('Metin2 — Client'), { name: 'Metin2 — Client' })
})

test('résumé de la piste : résolution et FPS réels arrondis', () => {
  assert.equal(streamSummary({ height: 1440, frameRate: 29.97 }), '1440p 30 FPS')
  assert.equal(streamSummary({ frameRate: 60 }), '60 FPS')
  assert.equal(streamSummary({}), '')
})

test('durée d’appel', () => {
  assert.equal(formatDuration(0), '0:00')
  assert.equal(formatDuration(75), '1:15')
  assert.equal(formatDuration(3725), '1:02:05')
  assert.equal(formatDuration(-3), '0:00')
})
