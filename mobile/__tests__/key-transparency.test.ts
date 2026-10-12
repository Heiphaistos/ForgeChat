// Journal de transparence des clés (amélioration n° 10) : mêmes vecteurs que le serveur et le web.
import { GENESIS, contactKeyLogged, entryHash, keyHash, monitor, userTag, type KtEntry } from '@/e2e/keyTransparency'

const ME = '00000000-0000-4000-8000-000000000001'
const BOB = '00000000-0000-4000-8000-000000000002'

async function chain(items: [string, string][]): Promise<KtEntry[]> {
  const out: KtEntry[] = []
  let prev = GENESIS
  for (const [i, [user, pub]] of items.entries()) {
    const e = { seq: i + 1, user_tag: await userTag(user), key_hash: await keyHash(pub), prev_hash: prev, hash: '' }
    e.hash = await entryHash(e.seq, e.user_tag, e.key_hash, prev)
    prev = e.hash
    out.push(e)
  }
  return out
}
const pager = (log: KtEntry[]) => async (after: number) => ({
  entries: log.filter((e) => e.seq > after).slice(0, 2),
  head: log.length ? { seq: log[log.length - 1]!.seq, hash: log[log.length - 1]!.hash } : null,
})

test('vecteur partagé (server/src/key_log.rs)', async () => {
  const tag = await userTag(ME)
  expect(tag).toBe('a3bfd8fc613dcfa0c605346f0070e658278f0d4f7d4ed2e31a38fb780bb2753c')
  expect(await entryHash(1, tag, await keyHash('BAAAAA'), GENESIS)).toBe('b32c588b8ca2c0326d9933bfb72b8a3b806d1ffbb465fc27dbf3d3a24e92e532')
})

test('réécriture et clé étrangère détectées', async () => {
  const log = await chain([[ME, 'k1'], [BOB, 'b1']])
  const r = await monitor(null, ME, 'k1', pager(log))
  expect(r.status).toBe('ok')
  if (r.status !== 'ok') return
  const forged = await chain([[ME, 'k1'], [BOB, 'bX'], [BOB, 'b2']])
  expect((await monitor(r.state, ME, 'k1', pager(forged))).status).toBe('rewritten')
  const foreign = await chain([[ME, 'k1'], [BOB, 'b1'], [ME, 'serveur']])
  expect(await monitor(r.state, ME, 'k1', pager(foreign))).toEqual({ status: 'foreign_key', seq: 3 })
  expect(await contactKeyLogged(BOB, 'b1', log[1]!)).toBe(true)
  expect(await contactKeyLogged(BOB, 'b2', log[1]!)).toBe(false)
})
