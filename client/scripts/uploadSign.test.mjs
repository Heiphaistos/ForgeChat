// URL signées des médias tirés d'un contenu chiffré : node --test scripts/uploadSign.test.mjs
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { SIGN_BATCH, createUploadSigner, unsignedUpload, uploadPath } from '../src/lib/uploadSign.ts'

const NOW = 1_800_000_000_000
const EXP = NOW / 1000 + 6 * 3600
const signedOf = (p, exp = EXP) => `${p}?exp=${exp}&sig=s${p.length}`

/** Signeur de test : envoi manuel (`flush`), serveur qui refuse `refuse`. */
function setup({ refuse = [], fail = false } = {}) {
  const calls = []
  let pending = null
  let now = NOW
  const s = createUploadSigner({
    post: async paths => {
      calls.push(paths)
      if (fail) throw new Error('réseau')
      return Object.fromEntries(paths.filter(p => !refuse.includes(p)).map(p => [p, signedOf(p)]))
    },
    now: () => now,
    schedule: f => { pending = f },
  })
  const flush = async () => { const f = pending; pending = null; f?.(); await new Promise(r => setTimeout(r, 0)) }
  return { s, calls, flush, setNow: t => { now = t } }
}

test('à signer : seulement /uploads non public et non signé', () => {
  assert.equal(unsignedUpload('/uploads/a.enc'), '/uploads/a.enc')
  assert.equal(unsignedUpload('/uploads/a.png?exp=1&sig=x'), null)
  for (const u of ['/uploads/avatars/a.png', '/uploads/emojis/e.gif', '/uploads/role-icon-1.png', '/uploads/sounds/s.mp3',
    'https://media.giphy.com/x.gif', 'blob:x', '/uploads/../etc/passwd']) assert.equal(unsignedUpload(u), null, u)
  assert.equal(uploadPath('/uploads/a.enc?exp=1&sig=x'), '/uploads/a.enc')
})

test('regroupe par lots de 100, une requête par chemin en vol', async () => {
  const { s, calls, flush } = setup()
  const urls = Array.from({ length: 150 }, (_, i) => `/uploads/${i}.png`)
  const all = Promise.all([...urls, ...urls].map(u => s.sign(u)))
  await flush()
  const out = await all
  assert.equal(calls.length, 2)
  assert.deepEqual(calls.map(c => c.length), [SIGN_BATCH, 50])
  assert.equal(out[0], signedOf('/uploads/0.png'))
  assert.equal(out[150], out[0])
})

test("cache par chemin brut jusqu'à exp - 10 min ; adresse publique ou déjà signée sans requête", async () => {
  const { s, calls, flush, setNow } = setup()
  const p = s.sign('/uploads/a.enc')
  await flush()
  const signed = await p
  assert.equal(await s.sign('/uploads/a.enc'), signed)
  assert.equal(s.cached('/uploads/a.enc'), signed)
  assert.equal(await s.sign('/uploads/avatars/x.png'), '/uploads/avatars/x.png')
  assert.equal(await s.sign(signed), signed)
  assert.equal(calls.length, 1)
  setNow(EXP * 1000 - 9 * 60_000)
  assert.equal(s.cached('/uploads/a.enc'), undefined, 'renouvelée 10 min avant échéance')
  const again = s.sign('/uploads/a.enc')
  await flush()
  await again
  assert.equal(calls.length, 2)
})

test('refus ou échec réseau : adresse brute, non mise en cache', async () => {
  const { s, calls, flush } = setup({ refuse: ['/uploads/x.enc'] })
  const p = s.sign('/uploads/x.enc')
  await flush()
  assert.equal(await p, '/uploads/x.enc')
  assert.equal(s.cached('/uploads/x.enc'), undefined)
  const bad = setup({ fail: true })
  const q = bad.s.sign('/uploads/y.png')
  await bad.flush()
  assert.equal(await q, '/uploads/y.png')
  assert.equal(calls.length, 1)
})

test('aperçu après envoi : signed_url connue, aucune requête', async () => {
  const { s, calls } = setup()
  s.prime('/uploads/n.webp', signedOf('/uploads/n.webp'))
  s.prime('/uploads/m.webp', signedOf('/uploads/autre.webp')) // signature d'un autre fichier : ignorée
  assert.equal(await s.sign('/uploads/n.webp'), signedOf('/uploads/n.webp'))
  assert.equal(s.cached('/uploads/m.webp'), undefined)
  assert.equal(calls.length, 0)
})
