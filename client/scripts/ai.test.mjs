// IA sur l'appareil, logique sans modèle : node --test scripts/ai.test.mjs
// Aucun modèle n'est téléchargé ici (la vérification d'empreinte porte sur des octets fabriqués).
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { detectLang, chunkLine, needsTranslation } from '../src/ai/text.ts'
import { summarize } from '../src/ai/summary.ts'
import { SpeechChunker, resample, rms, RATE } from '../src/ai/audio.ts'
import { PACKS, planTranslation, packsFor, packSize, fileByPath } from '../src/ai/manifest.ts'
import { sha256Hex, verifyFile } from '../src/ai/modelStore.ts'

test('détection de langue : six langues, null si trop court ou ambigu', () => {
  const cases = {
    fr: 'Salut, je pense que nous allons au cinéma ce soir avec les enfants.',
    en: 'Hey, I think we are going to the movies tonight with the kids.',
    es: 'Hola, creo que vamos al cine esta noche con los niños.',
    de: 'Hallo, ich glaube wir gehen heute Abend mit den Kindern ins Kino.',
    it: 'Ciao, penso che stasera andiamo al cinema con i bambini.',
    pt: 'Olá, acho que nós vamos ao cinema hoje à noite com as crianças.',
  }
  for (const [lang, text] of Object.entries(cases)) assert.equal(detectLang(text), lang, text)
  assert.equal(detectLang('Merci beaucoup !'), 'fr')
  assert.equal(detectLang('¿Dónde está?'), 'es')
  assert.equal(detectLang('Straße'), 'de')
  assert.equal(detectLang('ok 👍'), null)
  assert.equal(detectLang(''), null)
  assert.equal(detectLang('https://example.com/the/and/is'), null, 'les URL ne comptent pas')
})

test('découpage avant traduction : phrases, longueur bornée, lignes sans lettres ignorées', () => {
  assert.deepEqual(chunkLine('Bonjour, ça va ? On se voit demain. Super !'), ['Bonjour, ça va ?', 'On se voit demain.', 'Super !'])
  assert.deepEqual(chunkLine('sans ponctuation finale'), ['sans ponctuation finale'])
  const long = 'a'.repeat(950)
  assert.deepEqual(chunkLine(long).map(c => c.length), [400, 400, 150])
  assert.equal(needsTranslation('https://forgechat.example/x 🎉'), false)
  assert.equal(needsTranslation('Voir https://x.y'), true)
})

test('plan de traduction : pivot par l’anglais, jeton de langue cible, packs à télécharger', () => {
  assert.deepEqual(planTranslation('fr', 'fr'), [])
  assert.deepEqual(planTranslation('fr', 'en'), [{ pack: 'romance-en', prefix: '' }])
  assert.deepEqual(planTranslation('en', 'pt'), [{ pack: 'en-romance', prefix: '>>pt<< ' }])
  assert.deepEqual(planTranslation('de', 'it'), [{ pack: 'de-en', prefix: '' }, { pack: 'en-romance', prefix: '>>it<< ' }])
  assert.deepEqual(planTranslation('es', 'de'), [{ pack: 'romance-en', prefix: '' }, { pack: 'en-de', prefix: '' }])
  assert.deepEqual(packsFor(planTranslation('en', 'de')), ['runtime', 'en-de'])
  assert.deepEqual(packsFor([]), [])
  assert.equal(packSize(['runtime', 'runtime']), PACKS.runtime.files[0].size, 'pas de double compte')
})

test('manifeste : empreintes SHA-256 bien formées, chemins uniques et retrouvables', () => {
  const paths = new Set()
  for (const [id, p] of Object.entries(PACKS)) {
    assert.ok(p.license, id)
    for (const f of p.files) {
      assert.match(f.sha256, /^[0-9a-f]{64}$/, f.path)
      assert.ok(f.size > 0 && Number.isInteger(f.size), f.path)
      assert.match(f.src, /^https:\/\/(huggingface\.co|cdn\.jsdelivr\.net)\//, f.path)
      assert.ok(!f.path.includes('..') && !f.path.startsWith('/'), f.path)
      assert.ok(!paths.has(f.path), `doublon ${f.path}`)
      paths.add(f.path)
      assert.equal(fileByPath(f.path), f)
      if (p.repo) assert.ok(f.path.startsWith(p.repo + '/') && f.src.includes(p.revision), f.path)
    }
  }
  assert.equal(fileByPath('Xenova/whisper-base/inconnu.json'), null)
})

test('vérification d’empreinte : accepte le bon fichier, refuse taille ou contenu altérés', async () => {
  const data = new TextEncoder().encode('modèle factice').buffer
  const sha256 = await sha256Hex(data)
  assert.equal(await sha256Hex(new TextEncoder().encode('abc')), 'ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad')
  assert.equal(await verifyFile(data, { size: data.byteLength, sha256 }), true)
  assert.equal(await verifyFile(data, { size: data.byteLength + 1, sha256 }), false)
  const bad = new Uint8Array(data.slice(0))
  bad[0] ^= 1
  assert.equal(await verifyFile(bad.buffer, { size: data.byteLength, sha256 }), false)
})

test('résumé extractif : mentions, réactions et contenu avant le bavardage', () => {
  const msgs = [
    { id: '1', author: 'Léa', text: 'ok' },
    { id: '2', author: 'Tom', text: 'Rendez-vous samedi à 14 h devant la gare pour la randonnée au lac, prenez de l’eau.', reactions: 4 },
    { id: '3', author: 'Léa', text: 'mdr' },
    { id: '4', author: 'Max', text: 'Qui peut apporter le pique-nique pour la randonnée samedi ?' },
    { id: '5', author: 'Tom', text: '<@me> tu peux confirmer pour la voiture ?', mentionsMe: true },
    { id: '6', author: 'Léa', text: 'trop bien' },
    { id: '7', author: 'Max', text: 'Voici le parcours : https://example.com/carte' },
  ]
  const s = summarize(msgs, 3)
  assert.equal(s.count, 7)
  assert.deepEqual(s.highlights.map(h => h.id), ['2', '4', '5'], 'ordre chronologique conservé')
  assert.equal(s.authors[0].name, 'Léa')
  assert.ok(s.keywords.includes('randonnee'), s.keywords.join(','))
  assert.ok(!s.highlights.some(h => h.text === 'ok' || h.text === 'mdr'))
  assert.deepEqual(summarize([], 5).highlights, [])
  assert.ok(summarize([{ id: 'x', author: 'A', text: 'b'.repeat(500) }]).highlights[0].text.length <= 200)
})

test('audio : rééchantillonnage et découpage de la parole', () => {
  const tone = (sec, amp, rate = RATE) => Float32Array.from({ length: Math.round(sec * rate) }, (_, i) => amp * Math.sin(i / 5))
  assert.equal(resample(new Float32Array(48000), 48000).length, 16000)
  assert.equal(resample(new Float32Array(441), 44100).length, 160)
  const same = new Float32Array([1, 2])
  assert.equal(resample(same, RATE), same)
  assert.ok(rms(tone(0.1, 0.5)) > 0.3)

  const frames = (buf, size = 4096) => Array.from({ length: Math.ceil(buf.length / size) }, (_, i) => buf.subarray(i * size, (i + 1) * size))
  // Silence seul : rien n'est émis.
  const c = new SpeechChunker()
  assert.ok(frames(tone(3, 0)).every(f => c.push(f) === null))
  // Parole de 1,5 s puis pause : un morceau d'à peu près 2,1 s (parole + fin de pause).
  const out = [...frames(tone(1.5, 0.3)), ...frames(tone(1, 0))].map(f => c.push(f)).filter(Boolean)
  assert.equal(out.length, 1)
  assert.ok(out[0].length / RATE > 1.5 && out[0].length / RATE < 2.4, String(out[0].length / RATE))
  // Parole continue : coupée tous les 8 s au plus.
  const long = frames(tone(17, 0.3)).map(f => c.push(f)).filter(Boolean)
  assert.equal(long.length, 2)
  assert.ok(long.every(p => p.length / RATE <= 8.3))
  // Raclement de gorge (0,2 s) : ignoré.
  const c2 = new SpeechChunker()
  assert.equal([...frames(tone(0.2, 0.3), 1600), ...frames(tone(1, 0), 1600)].map(f => c2.push(f)).filter(Boolean).length, 0)
})
