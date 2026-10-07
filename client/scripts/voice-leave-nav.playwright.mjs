// Test PROD du salon vocal de serveur (comptes de test fixes calltest-a/b-fable) :
//  1) A navigue partout (MP, autre serveur, réglages, retour) PENDANT le vocal : il y reste
//     et B l'entend toujours (son réel mesuré) ;
//  2) A quitte le salon : A disparaît de la liste des participants chez B ET chez lui,
//     et de l'état serveur (GET /api/voice/state) ;
//  3) A revient puis ferme son onglet : B le voit partir.
//
// Usage : PW_MODULE=D:/Projet/forgechat-loop/node_modules/playwright/index.mjs node scripts/voice-leave-nav.playwright.mjs
// LOCAL_DIST=dist : sert le build local (client/dist) à la place du site de prod, l'API et le
// WebSocket restant ceux de la prod (interception page.route).
import { pathToFileURL } from 'node:url'
import { readFileSync, existsSync, statSync } from 'node:fs'
import { join, extname, resolve } from 'node:path'

const { chromium } = await import(process.env.PW_MODULE ? pathToFileURL(process.env.PW_MODULE).href : 'playwright')
const BASE = 'https://forgechat.heiphaistos.org'
// Mot de passe des comptes de test : variable d'environnement, jamais dans le dépôt.
const PW = process.env.FC_TEST_PW
if (!PW) throw new Error('FC_TEST_PW manquant (mot de passe des comptes calltest-*-fable)')
const USERS = ['a', 'b'].map(x => `calltest.${x}.fable@test.forgechat.local`)
const DIST = process.env.LOCAL_DIST ? resolve(process.env.LOCAL_DIST) : null
const MIME = { '.js': 'text/javascript', '.css': 'text/css', '.html': 'text/html', '.json': 'application/json', '.svg': 'image/svg+xml', '.png': 'image/png', '.wasm': 'application/wasm', '.woff2': 'font/woff2', '.ico': 'image/x-icon', '.webmanifest': 'application/manifest+json' }

let ko = 0
const ok = (c, m) => { console.log(c ? 'OK ' : 'KO ', m); if (!c) ko++ }

const browser = await chromium.launch({ args: ['--use-fake-ui-for-media-stream', '--use-fake-device-for-media-stream', '--autoplay-policy=no-user-gesture-required'] })
const ctxs = []
const me = []
for (const email of USERS) {
  const ctx = await browser.newContext({ viewport: { width: 1280, height: 800 }, serviceWorkers: 'block' })
  const l = await ctx.request.post(`${BASE}/api/auth/login`, { data: { email, password: PW } })
  if (!l.ok()) throw new Error('login ' + email)
  me.push((await l.json()).user)
  await ctx.addInitScript(pw => {
    localStorage.setItem('fc_onboarding_done', 'true')
    // Moteur de bruit du navigateur : RNNoise supprime la tonalité continue du micro factice.
    localStorage.setItem('fc_noise_engine', 'browser')
    // Déverrouillage des clés E2E (mot de passe) et fenêtre du code de récupération.
    setInterval(() => {
      const i = document.querySelector('input[type=password][placeholder="Mot de passe actuel"]')
      if (i && !i.dataset.fc) {
        i.dataset.fc = '1'
        Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set.call(i, pw)
        i.dispatchEvent(new Event('input', { bubbles: true }))
        setTimeout(() => i.form && i.form.requestSubmit(), 200)
      }
      const d = [...document.querySelectorAll('[role=dialog]')].find(x => /code de récupération/i.test(x.innerText))
      const c = d && d.querySelector('input[type=checkbox]')
      if (c && !c.checked) { c.click(); setTimeout(() => { [...d.querySelectorAll('button')].find(b => b.textContent.trim() === 'Terminé')?.click() }, 300) }
    }, 500)
  }, PW)
  if (DIST) {
    await ctx.route(`${BASE}/**`, async route => {
      const url = new URL(route.request().url())
      if (url.pathname.startsWith('/api/') || url.pathname.startsWith('/ws') || url.pathname.startsWith('/uploads/')) return route.continue()
      let file = join(DIST, decodeURIComponent(url.pathname))
      if (!file.startsWith(DIST) || !existsSync(file) || statSync(file).isDirectory()) file = join(DIST, 'index.html')
      return route.fulfill({ status: 200, body: readFileSync(file), headers: { 'content-type': MIME[extname(file)] ?? 'application/octet-stream' } })
    })
  }
  ctxs.push(ctx)
}
const [A, B] = me
console.log(DIST ? `Build local servi depuis ${DIST}` : 'Site de prod')

const post = (ctx, path, data = {}) => ctx.request.post(`${BASE}/api${path}`, { data }).then(r => r.json())
const srv = await post(ctxs[0], '/servers', { name: 'Essai vocal nav ' + Date.now() })
const other = await post(ctxs[0], '/servers', { name: 'Autre serveur ' + Date.now() })

/** Son réellement reçu (crête max sur les sorties vocales). */
const heard = page => page.evaluate(async () => {
  let best = 0
  for (const a of document.querySelectorAll('audio[data-fc-call="voice"]')) {
    if (!a.srcObject) continue
    const ctx = new AudioContext(); const an = ctx.createAnalyser(); an.fftSize = 2048
    ctx.createMediaStreamSource(a.srcObject).connect(an)
    const buf = new Float32Array(an.fftSize)
    for (let i = 0; i < 20; i++) { await new Promise(r => setTimeout(r, 50)); an.getFloatTimeDomainData(buf); for (const v of buf) best = Math.max(best, Math.abs(v)) }
    ctx.close()
  }
  return Number(best.toFixed(3))
})
const inStore = (page, ch, uid) => page.evaluate(([c, u]) => (window.__fcVoiceStore.getState().roomParticipants[c] ?? []).some(p => p.userId === u), [ch, uid])
const joined = page => page.evaluate(() => { const s = window.__fcVoiceStore.getState(); return { joined: s.joined, channelId: s.channelId, media: s.mediaStatus } })
const serverSees = async (ctx, ch, uid) => {
  const d = await (await ctx.request.get(`${BASE}/api/voice/state`)).json()
  return (d.channels ?? []).some(c => c.channel_id === ch && (c.participants ?? []).some(p => p.user_id === uid))
}
/** Navigation interne de l'appli (pas de rechargement de page). */
const spa = (page, path) => page.evaluate(p => { history.pushState({}, '', p); dispatchEvent(new PopStateEvent('popstate')) }, path)

try {
  const inv = await post(ctxs[0], `/servers/${srv.id}/invites`)
  await ctxs[1].request.post(`${BASE}/api/servers/join/${inv.code}`)
  const voc = await post(ctxs[0], `/servers/${srv.id}/channels`, { name: 'vocal', type: 'voice' })
  const chanUrl = `${BASE}/servers/${srv.id}/channels/${voc.id}`
  const pages = []
  for (const c of ctxs) {
    const p = await c.newPage()
    await p.goto(chanUrl); await p.waitForTimeout(3000)
    await p.click('button:has-text("Rejoindre")')
    await p.waitForSelector('button[aria-label="Quitter l\'appel"]', { timeout: 20000 })
    pages.push(p)
  }
  const [pa, pb] = pages
  await pa.waitForTimeout(6000)
  ok((await heard(pb)) > 0.01, 'B entend A dans le salon')
  ok(await inStore(pb, voc.id, A.id) && await inStore(pa, voc.id, A.id), 'A listé dans le salon chez A et chez B')

  // ── 1. Navigation pendant le vocal ──────────────────────────────────────
  const steps = [
    ['MP (bouton Messages directs)', () => pa.click('[aria-label="Messages directs"]')],
    ['autre serveur (icône)', () => pa.click(`[aria-label="${other.name}"]`)],
    ['réglages (bouton Paramètres)', () => pa.click('button[aria-label="Paramètres"]')],
    ['page Amis', () => spa(pa, '/friends')],
    ['retour arrière', () => pa.goBack().then(() => {})],
    ['retour au serveur du vocal', () => spa(pa, `/servers/${srv.id}/channels/${voc.id}`)],
  ]
  for (const [label, go] of steps) {
    await go(); await pa.waitForTimeout(2500)
    const s = await joined(pa)
    const peak = await heard(pb)
    ok(s.joined && s.channelId === voc.id && peak > 0.01, `après ${label} (${pa.url().replace(BASE, '')}) : A toujours dans le vocal, B l'entend (crête ${peak}, ${s.media})`)
  }
  ok(await serverSees(ctxs[1], voc.id, A.id), 'serveur : A toujours dans le salon après la navigation')
  // Deuxième onglet de A, hors du vocal : il doit aussi voir A partir.
  const pa2 = await ctxs[0].newPage()
  await pa2.goto(chanUrl); await pa2.waitForTimeout(4000)
  ok(await inStore(pa2, voc.id, A.id), '2e onglet de A : A listé dans le salon')
  ok((await joined(pa)).joined, 'ouvrir un 2e onglet ne sort pas A du vocal')

  // ── 2. A quitte le salon ────────────────────────────────────────────────
  await pa.click('button[aria-label="Quitter l\'appel"]')
  await pa.waitForTimeout(3000)
  ok(!(await joined(pa)).joined, 'A est sorti du vocal')
  ok(!(await serverSees(ctxs[1], voc.id, A.id)), 'serveur : A retiré du salon')
  ok(!(await inStore(pb, voc.id, A.id)), 'B ne voit plus A dans le salon')
  ok(!(await inStore(pa, voc.id, A.id)), 'A ne se voit plus dans le salon (sa propre barre latérale)')
  ok(!(await inStore(pa2, voc.id, A.id)), '2e onglet de A ne voit plus A dans le salon (serveur corrigé requis)')
  await pa2.close()
  const sidebarA = await pa.evaluate(name => document.body.innerText.split('\n').filter(l => l.trim() === name).length, A.username)
  console.log(`   occurrences du pseudo de A dans sa page après sortie : ${sidebarA}`)
  // Après un F5, l'état reste juste
  await pa.reload(); await pa.waitForTimeout(3000)
  ok(!(await inStore(pa, voc.id, A.id)), 'après F5, A ne se voit pas dans le salon')

  // ── 3. A revient puis ferme l'onglet ────────────────────────────────────
  await pa.click('button:has-text("Rejoindre")')
  await pa.waitForSelector('button[aria-label="Quitter l\'appel"]', { timeout: 20000 })
  await pa.waitForTimeout(3000)
  ok(await inStore(pb, voc.id, A.id), 'A revenu : B le voit')
  await pa.close()
  await pb.waitForTimeout(4000)
  ok(!(await inStore(pb, voc.id, A.id)), 'onglet de A fermé : B ne le voit plus')
  ok(!(await serverSees(ctxs[1], voc.id, A.id)), 'onglet de A fermé : serveur à jour')
  await pb.click('button[aria-label="Quitter l\'appel"]').catch(() => {})
} finally {
  for (const s of [srv, other]) await ctxs[0].request.delete(`${BASE}/api/servers/${s.id}`, { data: { password: PW } }).catch(() => {})
  await browser.close()
}
console.log(ko ? `${ko} échec(s)` : 'TOUT PASSE'); process.exit(ko ? 1 : 0)
