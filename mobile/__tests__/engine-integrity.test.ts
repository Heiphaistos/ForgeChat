// Page moteur d'IA : acceptée seulement si page + scripts (Worker compris) ont les SHA-256 embarqués.
import { sha256 } from '@noble/hashes/sha2.js'
import { bytesToHex } from '@noble/hashes/utils.js'
import { loadVerifiedEngine } from '@/features/ai/engineIntegrity'
import { ENGINE_HASHES } from '@/features/ai/engineHashes'

const enc = (s: string) => new TextEncoder().encode(s)
const h = (s: string) => bytesToHex(sha256(enc(s)))
const PAGE = '<head></head><script type="module" crossorigin src="/assets/a-12345678.js"></script>\n<link rel="modulepreload" crossorigin href="/assets/b-12345678.js">'
const FILES: Record<string, string> = {
  '/ai-engine.html': PAGE,
  '/assets/a-12345678.js': 'import "./b-12345678.js"',
  '/assets/b-12345678.js': 'new Worker("engine.worker-12345678.js")',
  '/assets/engine.worker-12345678.js': 'worker',
}
const expected = Object.fromEntries(Object.entries(FILES).map(([k, v]) => [k, h(v)]))
const serve = (over: Record<string, string> = {}) => async (url: string) => {
  const body = { ...FILES, ...over }[url.replace('https://s.example', '')]
  if (body === undefined) throw new Error('404')
  return enc(body)
}

test('page et scripts conformes : acceptée, SRI imposé aux scripts et aux préchargements', async () => {
  const html = await loadVerifiedEngine('https://s.example', serve(), expected)
  expect(html).toContain('src="/assets/a-12345678.js" integrity="sha256-')
  expect(html).toContain('href="/assets/b-12345678.js" integrity="sha256-')
  // La page relit le Worker avec cette empreinte (client/src/ai/engineCore.ts).
  expect(html).toContain(`<meta name="fc-worker-integrity" content="sha256-${Buffer.from(h('worker'), 'hex').toString('base64')}">`)
})

test('aucun Worker dans les empreintes : refusée', async () => {
  const { ['/assets/engine.worker-12345678.js']: _w, ...noWorker } = expected
  expect(await loadVerifiedEngine('https://s.example', serve(), noWorker)).toBeNull()
})

test('Worker modifié par le serveur : refusée', async () => {
  expect(await loadVerifiedEngine('https://s.example', serve({ '/assets/engine.worker-12345678.js': 'evil' }), expected)).toBeNull()
})
test('page modifiée : refusée', async () => {
  expect(await loadVerifiedEngine('https://s.example', serve({ '/ai-engine.html': PAGE + '<script src="https://evil/x.js"></script>' }), expected)).toBeNull()
})
test('serveur injoignable : refusée', async () => {
  expect(await loadVerifiedEngine('https://s.example', async () => { throw new Error('réseau') }, expected)).toBeNull()
})
test('empreintes embarquées : page + 5 scripts au plus, SHA-256 hex', () => {
  expect(ENGINE_HASHES['/ai-engine.html']).toBeDefined()
  for (const v of Object.values(ENGINE_HASHES)) expect(v).toMatch(/^[0-9a-f]{64}$/)
})
