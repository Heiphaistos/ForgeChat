// Test LOCAL (jamais la prod) du chiffrement de bout en bout des médias, de navigateur à navigateur.
//
// Prérequis : un serveur LiveKit local et Playwright (non installé dans ce projet) :
//   livekit-server --config lk.yaml   (clé devkey, liaison 127.0.0.1, voir docs/CHIFFREMENT-E2E.md §5)
//   PW_MODULE=chemin/vers/node_modules/playwright/index.mjs node scripts/e2ee-media.playwright.mjs
// Variables : LK_URL (ws://127.0.0.1:7880), LK_KEY (devkey), LK_SECRET.
//
// Vérifie : 1) deux pages avec la même clé de média s'entendent (440 Hz reçu, piste chiffrée) ;
// 2) une page avec la clé d'une autre conversation (même index) ou d'une autre époque
//    n'obtient aucun son décodable.
import { createHmac } from 'node:crypto'
import { fileURLToPath, pathToFileURL } from 'node:url'
import assert from 'node:assert/strict'
import { readFileSync, realpathSync } from 'node:fs'
import { createServer } from 'vite'

const { chromium } = await import(process.env.PW_MODULE ? pathToFileURL(process.env.PW_MODULE).href : 'playwright')
const LK_URL = process.env.LK_URL ?? 'ws://127.0.0.1:7880'
const KEY = process.env.LK_KEY ?? 'devkey'
const SECRET = process.env.LK_SECRET ?? 'secretsecretsecretsecretsecretsecret'
const V = JSON.parse(readFileSync(new URL('../../docs/e2e-vectors.json', import.meta.url), 'utf8')).media

const b64u = b => Buffer.from(b).toString('base64url')
function token(identity, room) {
  const now = Math.floor(Date.now() / 1000)
  const head = b64u(JSON.stringify({ alg: 'HS256', typ: 'JWT' }))
  const body = b64u(JSON.stringify({
    iss: KEY, sub: identity, nbf: now - 10, exp: now + 600,
    video: { room, roomJoin: true, canPublish: true, canSubscribe: true, canPublishData: true },
    attributes: { e2ee: '1' },
  }))
  return `${head}.${body}.${b64u(createHmac('sha256', SECRET).update(`${head}.${body}`).digest())}`
}

const root = fileURLToPath(new URL('../e2ee-harness/', import.meta.url))
const server = await createServer({
  configFile: false, root, logLevel: 'warn',
  server: {
    host: '127.0.0.1', port: 5199, strictPort: true,
    // node_modules peut être une jonction vers un autre dossier : autoriser sa cible réelle.
    fs: { allow: [fileURLToPath(new URL('..', import.meta.url)), realpathSync(fileURLToPath(new URL('../node_modules', import.meta.url)))] },
  },
})
await server.listen()
const browser = await chromium.launch({ args: ['--autoplay-policy=no-user-gesture-required'] })

async function page(identity, room, epoch, publish, conv = V.conv) {
  const p = await (await browser.newContext()).newPage()
  p.on('pageerror', e => console.error(`[${identity}]`, e.message))
  await p.goto('http://127.0.0.1:5199/index.html')
  await p.waitForFunction(() => 'run' in window)
  const r = await p.evaluate(o => window.run(o), { url: LK_URL, token: token(identity, room), convKey: V.convKey, conv, epoch, publish })
  assert.equal(r.e2ee, true, 'E2EE actif')
  return p
}

let failed = false
try {
  const room = `e2ee-test-${Date.now()}`
  await page('emetteur', room, V.epoch, true)
  const good = await page('bonne-cle', room, V.epoch, false)
  const bad = await page('autre-conversation', room, V.epoch, false, 'channel:autre')
  const old = await page('autre-epoque', room, V.epoch + 1, false)
  await new Promise(r => setTimeout(r, 3000))
  const ok = await good.evaluate(() => window.measure())
  const ko = await bad.evaluate(() => window.measure())
  const ko2 = await old.evaluate(() => window.measure())
  console.log('même clé          :', ok)
  console.log('autre conversation:', ko)
  console.log('autre époque      :', ko2)
  assert.equal(ok.encrypted, true, 'la piste reçue est annoncée chiffrée')
  assert.ok(ok.peak440 > -60, `440 Hz entendu avec la bonne clé (${ok.peak440} dB)`)
  assert.ok(ko.peak440 < ok.peak440 - 30, `rien de décodable avec la clé d'une autre conversation (${ko.peak440} dB)`)
  assert.ok(ko2.peak440 < ok.peak440 - 30, `rien de décodable avec la clé d'une autre époque (${ko2.peak440} dB)`)
  console.log('OK : même clé = son, autre clé = rien de décodable')
} catch (e) {
  failed = true
  console.error('ÉCHEC :', e.message)
} finally {
  await browser.close()
  await server.close()
}
process.exit(failed ? 1 : 0)
