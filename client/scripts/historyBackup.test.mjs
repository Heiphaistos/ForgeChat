// Sauvegarde chiffrée de l'historique (amélioration n° 30) : node --test scripts/historyBackup.test.mjs
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { openBackup, sealBackup } from '../src/e2e/historyBackup.ts'

const payload = { conversation: 'Alice', exported_at: '2026-10-12T10:00:00Z', messages: [{ at: '2026-10-12T09:00:00Z', author: 'alice', text: 'secret', files: ['photo.jpg'] }] }

test('aller-retour, rien en clair dans le fichier', async () => {
  const file = await sealBackup(payload, 'une phrase très longue 42')
  assert.ok(!file.includes('secret') && !file.includes('photo.jpg') && !file.includes('alice'))
  assert.deepEqual(await openBackup(file, 'une phrase très longue 42'), payload)
})

test('mauvaise phrase, fichier modifié, réglages piégés : refus', async () => {
  const file = await sealBackup(payload, 'une phrase très longue 42')
  await assert.rejects(openBackup(file, 'autre phrase'), /Phrase secrète incorrecte/)
  const s = JSON.parse(file)
  const tampered = { ...s, ct: s.ct.slice(0, -2) + (s.ct.endsWith('A') ? 'BB' : 'AA') }
  await assert.rejects(openBackup(JSON.stringify(tampered), 'une phrase très longue 42'), /incorrecte/)
  await assert.rejects(openBackup(JSON.stringify({ ...s, kdf: { ...s.kdf, m: 4_000_000 } }), 'x'), /refusés/)
  await assert.rejects(openBackup('{}', 'x'), /pas une sauvegarde/)
})
