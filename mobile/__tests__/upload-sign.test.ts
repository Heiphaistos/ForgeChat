// URL signées des médias tirés d'un contenu chiffré (même logique que client/scripts/uploadSign.test.mjs).
import { SIGN_BATCH, createUploadSigner, unsignedUpload } from '@/lib/uploadSign'

const NOW = 1_800_000_000_000
const EXP = NOW / 1000 + 6 * 3600
const signedOf = (p: string) => `${p}?exp=${EXP}&sig=s${p.length}`

function setup({ refuse = [] as string[], fail = false } = {}) {
  const calls: string[][] = []
  let pending: (() => void) | null = null
  let now = NOW
  const s = createUploadSigner({
    post: async (paths) => {
      calls.push(paths)
      if (fail) throw new Error('réseau')
      return Object.fromEntries(paths.filter((p) => !refuse.includes(p)).map((p) => [p, signedOf(p)]))
    },
    now: () => now,
    schedule: (f) => {
      pending = f
    },
  })
  const flush = async () => {
    const f = pending
    pending = null
    f?.()
    await new Promise((r) => setTimeout(r, 0))
  }
  return { s, calls, flush, setNow: (v: number) => (now = v) }
}

test('à signer : seulement /uploads non public et non signé', () => {
  expect(unsignedUpload('/uploads/a.enc')).toBe('/uploads/a.enc')
  for (const u of ['/uploads/a.png?exp=1&sig=x', '/uploads/avatars/a.png', '/uploads/role-icon-1.png', 'https://media.giphy.com/x.gif', '/uploads/../x'])
    expect(unsignedUpload(u)).toBeNull()
})

test('lots de 100, une requête par chemin en vol', async () => {
  const { s, calls, flush } = setup()
  const urls = Array.from({ length: 150 }, (_, i) => `/uploads/${i}.png`)
  const all = Promise.all([...urls, ...urls].map((u) => s.sign(u)))
  await flush()
  const out = await all
  expect(calls.map((c) => c.length)).toEqual([SIGN_BATCH, 50])
  expect(out[0]).toBe(signedOf('/uploads/0.png'))
  expect(out[150]).toBe(out[0])
})

test("cache jusqu'à exp - 10 min ; refus = adresse brute non mise en cache ; signed_url d'un envoi", async () => {
  const { s, calls, flush, setNow } = setup({ refuse: ['/uploads/x.enc'] })
  const a = s.sign('/uploads/a.enc')
  const x = s.sign('/uploads/x.enc')
  await flush()
  expect(await a).toBe(signedOf('/uploads/a.enc'))
  expect(await x).toBe('/uploads/x.enc')
  expect(s.cached('/uploads/a.enc')).toBe(signedOf('/uploads/a.enc'))
  expect(s.cached('/uploads/x.enc')).toBeUndefined()
  s.prime('/uploads/n.webp', signedOf('/uploads/n.webp'))
  expect(await s.sign('/uploads/n.webp')).toBe(signedOf('/uploads/n.webp'))
  expect(calls).toHaveLength(1)
  setNow(EXP * 1000 - 9 * 60_000)
  expect(s.cached('/uploads/a.enc')).toBeUndefined()
})

test('échec réseau : adresse brute', async () => {
  const { s, flush } = setup({ fail: true })
  const p = s.sign('/uploads/y.png')
  await flush()
  expect(await p).toBe('/uploads/y.png')
})
