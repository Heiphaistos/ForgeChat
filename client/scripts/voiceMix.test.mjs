// Lecture des voix (web et bureau) : node --test scripts/voiceMix.test.mjs
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { clampVolumePct, mixPlan } from '../src/lib/voiceMix.ts'

test('volume par personne : borné à 0-200 %, 100 % par défaut', () => {
  assert.equal(clampVolumePct(150), 150)
  assert.equal(clampVolumePct(0), 0)
  assert.equal(clampVolumePct(250), 200)
  assert.equal(clampVolumePct(-5), 0)
  assert.equal(clampVolumePct('80'), 80) // valeur mémorisée en texte
  assert.equal(clampVolumePct(undefined), 100)
  assert.equal(clampVolumePct('abc'), 100)
})

test('voix sans voix spatiale : mono forcé, pas de panner', () => {
  const p = mixPlan('voice', 1, null)
  assert.deepEqual(p, { graph: true, mono: true, panner: false, gain: 1 })
})

test('voix au-delà de 100 % : gain jusqu’à 2, jamais plus', () => {
  assert.equal(mixPlan('voice', 1.5, null).gain, 1.5)
  assert.equal(mixPlan('voice', 3, null).gain, 2)
  assert.equal(mixPlan('voice', -1, null).gain, 0)
  assert.equal(mixPlan('voice', NaN, null).gain, 1)
})

test('panner HRTF seulement en voix spatiale', () => {
  assert.equal(mixPlan('voice', 1, 0.3).panner, true)
  assert.equal(mixPlan('voice', 1, 0).panner, true) // spatial actif, participant au centre
  assert.equal(mixPlan('screen', 1, null).panner, false)
})

test('son de partage d’écran : stéréo gardée, lecture directe jusqu’à 100 %', () => {
  assert.deepEqual(mixPlan('screen', 0.5, null), { graph: false, mono: false, panner: false, gain: 0.5 })
  assert.equal(mixPlan('screen', 1.2, null).graph, true)
})

test('orateur prioritaire retiré : plus aucune atténuation des autres voix', () => {
  for (const f of ['../src/components/voice/PersistentVoiceAudio.tsx', '../src/store/voice.ts', '../src/lib/voicePlayback.ts']) {
    const src = readFileSync(new URL(f, import.meta.url), 'utf8')
    assert.doesNotMatch(src, /priority|ducked/i, f)
  }
})
