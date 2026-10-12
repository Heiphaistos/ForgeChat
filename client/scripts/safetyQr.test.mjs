// Code de sécurité en QR (amélioration n° 11) : node --test scripts/safetyQr.test.mjs
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { compareSafetyScan, safetyPayload } from '../src/e2e/safetyQr.ts'

const code = '0123456789'.repeat(6)
test('égalité stricte, sinon mismatch ou invalid', () => {
  assert.equal(compareSafetyScan(safetyPayload(code), code), 'match')
  assert.equal(compareSafetyScan(safetyPayload(code.slice(0, 59) + '0'), code), 'mismatch')
  for (const bad of [code, 'FCSAFE1:' + code.slice(1), 'FCSAFE2:' + code, 'https://evil.example', '']) {
    assert.equal(compareSafetyScan(bad, code), 'invalid', bad)
  }
  assert.equal(compareSafetyScan(safetyPayload(code), 'abc'), 'invalid')
})
