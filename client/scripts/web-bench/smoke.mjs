// Banc de sécurité de la version web (audit 2026-10-12) : parcours réel dans Chromium, CSP de
// production + Trusted Types imposés, chaque violation ou erreur de page relevée.
// Prérequis : serveur local (FRONTEND_URL=http://localhost:8099, FORGECHAT_TEST_MAILBOX, inscriptions
// ouvertes), `npm run build`, puis serve.mjs avec csp.txt. Lancer :
//   FORGECHAT_TEST_MAILBOX=… PW_MODULE=…/playwright/index.mjs node client/scripts/web-bench/smoke.mjs
// Vérifie aussi la clé de récupération signée : refusée sans accord explicite (Bob, Dave), rien
// enveloppé pour elle avant.
import { readdirSync, readFileSync } from 'node:fs'
import { deriveSecrets, newKdfSalt } from '../../src/e2e/authKdf.ts'
const { chromium } = await import(process.env.PW_MODULE ?? 'playwright')

const BASE = 'http://localhost:8099'
const MAILS = process.env.FORGECHAT_TEST_MAILBOX ?? '/tmp/mails'
const PW = 'Phrase de test longue 42!'
const sleep = ms => new Promise(r => setTimeout(r, ms))

async function api(path, body, cookie) {
  const r = await fetch(BASE + '/api' + path, { method: 'POST', headers: { 'content-type': 'application/json', ...(cookie ? { cookie } : {}) }, body: JSON.stringify(body) })
  return { status: r.status, json: await r.json().catch(() => null), cookies: r.headers.getSetCookie?.() ?? [] }
}

async function account(name) {
  const email = `${name}${Date.now()}@test.local`
  const salt = newKdfSalt()
  const s = await deriveSecrets(PW, salt, 'argon2id')
  const seen = new Set(readdirSync(MAILS))
  const reg = await api('/auth/register', { username: name + String(Date.now()).slice(-5), email, auth: s.auth, kdf_salt: salt, kdf: 'argon2id' })
  if (reg.status !== 200) throw new Error('register ' + reg.status + JSON.stringify(reg.json))
  let code
  for (let i = 0; i < 50 && !code; i++) {
    for (const f of readdirSync(MAILS)) if (!seen.has(f)) {
      const m = JSON.parse(readFileSync(`${MAILS}/${f}`, 'utf8'))
      if (m.to === email) code = /color:#fff">(\d{6})</.exec(m.body)?.[1]
    }
    if (!code) await sleep(200)
  }
  const v = await api('/auth/verify-email', { email, code })
  if (v.status !== 200) throw new Error('verify ' + v.status)
  return { email, id: v.json.user.id, username: v.json.user.username }
}

const a = await account('alice')
const b = await account('bob')
const c = await account('carol')

const browser = await chromium.launch(process.env.PW_CHROMIUM ? { executablePath: process.env.PW_CHROMIUM } : {})
const problems = []
async function login(who) {
  const ctx = await browser.newContext()
  const page = await ctx.newPage()
  page.on('console', m => { if (m.type() === 'error' && /Content Security Policy|Trusted Type|TrustedHTML|TrustedScript/i.test(m.text())) problems.push(`[${who.username}] console: ${m.text().slice(0, 300)}`) })
  page.on('pageerror', e => problems.push(`[${who.username}] pageerror: ${e.message.slice(0, 300)}`))
  await page.addInitScript(() => {
    document.addEventListener('securitypolicyviolation', e => console.error(`Content Security Policy violation: ${e.violatedDirective} ${e.blockedURI} ${e.sourceFile}:${e.lineNumber}`))
  })
  await page.goto(BASE + '/login')
  await page.fill('input[autocomplete="username"]', who.email)
  await page.fill('input[autocomplete="current-password"]', PW)
  await page.click('button[type="submit"]')
  await page.waitForURL(u => !u.pathname.startsWith('/login'), { timeout: 60000 })
  await sleep(4000)
  // Code de récupération affiché une fois : coché, fermé.
  const done = page.getByRole('button', { name: 'Terminé' })
  if (await done.count()) { await page.locator('input[type="checkbox"]').first().check(); await done.click(); await sleep(800) }
  const skip = page.getByRole('button', { name: 'Passer' })
  if (await skip.count()) { await skip.click(); await sleep(500) }
  return { ctx, page }
}

const A = await login(a)
const B = await login(b)
// Clé E2E créée ? (écran de code de récupération éventuel)
const shot = async (p, n) => p.screenshot({ path: `${process.env.SHOTS ?? '/tmp'}/${n}.png` })
await shot(A.page, 'a-home')

// MP de A vers B par l'API de A (cookies du navigateur), puis message tapé dans l'interface.
const dm = await A.page.evaluate(async id => (await fetch(`/api/dms/${id}`, { method: 'POST', credentials: 'include' })).json(), b.id)
await A.page.goto(`${BASE}/dms/${dm.dm_id}`)
await sleep(3000)
const box = A.page.locator('textarea, [contenteditable="true"]').first()
await box.click()
await box.type('Bonjour Bob https://github.com/x **gras** `code`')
await A.page.keyboard.press('Enter')
await sleep(3000)
await shot(A.page, 'a-dm')
await B.page.goto(`${BASE}/dms/${dm.dm_id}`)
await sleep(4000)
await shot(B.page, 'b-dm')
const seen = await B.page.locator('text=Bonjour Bob').count()
const block = await B.page.locator('pre code, code').count()
console.log(JSON.stringify({ dmVisibleChezBob: seen, codeBlocks: block }))
// Bloc de code (coloration = HTML injecté) pour exercer Trusted Types.
await box.click()
await box.type('```js\nconst x = 1\n```')
await A.page.keyboard.press('Enter')
await sleep(2500)
// Serveur + salon chiffré (clé de récupération signée, épinglage, époque de salon).
const srv = await A.page.evaluate(async () => (await fetch('/api/servers', { method: 'POST', credentials: 'include', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ name: 'Banc' }) })).json())
const chans = await A.page.evaluate(async id => (await fetch(`/api/servers/${id}/channels`, { credentials: 'include' })).json(), srv.id)
const text = (Array.isArray(chans) ? chans : chans.channels ?? []).find(c => c.type === 'text')
await A.page.goto(`${BASE}/servers/${srv.id}/channels/${text.id}`)
await sleep(4000)
const cbox = A.page.locator('textarea, [contenteditable="true"]').first()
await cbox.click()
await cbox.type('Salut le salon https://evil.example/pixel ```py\nprint(1)\n```')
await A.page.keyboard.press('Enter')
await sleep(3000)
await shot(A.page, 'a-channel')
const inChannel = await A.page.locator('text=Salut le salon').count()
// Clé de récupération créée DANS L'INTERFACE par Alice (signée par sa clé de compte).
await A.page.getByRole('button', { name: 'Créer la clé de récupération du serveur' }).click()
await sleep(4000)
await shot(A.page, 'a-serverkey')
const done2 = A.page.getByRole('button', { name: /Terminé|J'ai noté|Fermer/ })
if (await done2.count()) { const cb = A.page.locator('input[type="checkbox"]'); if (await cb.count()) await cb.first().check(); await done2.first().click(); await sleep(800) }
const ownEnc = await A.page.evaluate(async id => (await fetch(`/api/servers/${id}/e2e/server-key`, { credentials: 'include' })).json(), srv.id)
console.log(JSON.stringify({ messageDansSalon: inChannel, cleServeur: ownEnc.exists ?? null, signee: !!ownEnc.signature, signataire: ownEnc.signed_by === a.id }))
// Bob (qui connaît déjà Alice par leur MP) rejoint et écrit : la clé signée doit passer SANS boîte de dialogue.
const inv = await A.page.evaluate(async id => (await fetch(`/api/servers/${id}/invites`, { method: 'POST', credentials: 'include', headers: { 'content-type': 'application/json' }, body: '{}' })).json(), srv.id)
await B.page.evaluate(async code => fetch(`/api/servers/join/${code}`, { method: 'POST', credentials: 'include' }), inv.code)
await B.page.goto(`${BASE}/servers/${srv.id}/channels/${text.id}`)
await sleep(4000)
const bbox = B.page.locator('textarea, [contenteditable="true"]').first()
await bbox.click()
await bbox.type('Bob dans le salon')
await B.page.keyboard.press('Enter')
await sleep(3500)
await shot(B.page, 'b-channel')
const dialog = await B.page.locator('[role="alertdialog"]').count()
const bobMsg = await A.page.locator('text=Bob dans le salon').count() + await B.page.locator('text=Bob dans le salon').count()
const env = await A.page.evaluate(async id => (await fetch(`/api/e2e/conversations/channel/${id}/keys`, { credentials: 'include' })).json(), text.id)
console.log(JSON.stringify({ dialogueChezBob: dialog, messageBob: bobMsg, epoqueCourante: env.current_epoch }))
// Carol ne connaît pas Alice : la clé signée par une inconnue demande son accord explicite.
const C = await login(c)
await C.page.evaluate(async code => fetch(`/api/servers/join/${code}`, { method: 'POST', credentials: 'include' }), inv.code)
await C.page.goto(`${BASE}/servers/${srv.id}/channels/${text.id}`)
await sleep(4000)
const cbox2 = C.page.locator('textarea, [contenteditable="true"]').first()
await cbox2.click()
await cbox2.type('Carol ici')
await C.page.keyboard.press('Enter')
await sleep(3500)
await shot(C.page, 'c-channel')
const carolDialog = await C.page.locator('[role="alertdialog"]').count()
const carolTitle = carolDialog ? await C.page.locator('[role="alertdialog"] h2').innerText() : ''
console.log(JSON.stringify({ dialogueChezCarol: carolDialog, titre: carolTitle }))
// Nouvelle époque forcée : Carol quitte. Bob (qui connaît Alice) écrit : il crée l'époque 1 et
// l'enveloppe pour la clé signée par Alice, sans boîte de dialogue.
await C.page.evaluate(async id => fetch(`/api/servers/${id}/leave`, { method: 'POST', credentials: 'include' }), srv.id)
await sleep(1500)
await B.page.reload(); await sleep(4000)
const bbox2 = B.page.locator('textarea, [contenteditable="true"]').first()
await bbox2.click(); await bbox2.type('Bob après départ'); await B.page.keyboard.press('Enter')
await sleep(4000)
const bobAsked = await B.page.locator('[role="alertdialog"]').count()
const bobEnvBefore = await A.page.evaluate(async id => (await fetch(`/api/e2e/conversations/channel/${id}/keys`, { credentials: 'include' })).json(), text.id)
console.log(JSON.stringify({ demandeChezBob: bobAsked, epoqueAvantAccord: bobEnvBefore.current_epoch }))
if (bobAsked) {
  await B.page.locator('[role="alertdialog"] button').last().click()
  await sleep(1000)
  const again = B.page.locator('textarea, [contenteditable="true"]').first()
  await again.click(); await again.fill(''); await again.type('Bob après départ'); await B.page.keyboard.press('Enter')
  await sleep(4000)
}
const env1 = await A.page.evaluate(async id => (await fetch(`/api/e2e/conversations/channel/${id}/keys`, { credentials: 'include' })).json(), text.id)
console.log(JSON.stringify({ dialogueChezBob2: await B.page.locator('[role="alertdialog"]').count(), epoque: env1.current_epoch, messageBob2: await B.page.locator('text=Bob après départ').count() }))
// Dave ne connaît pas Alice. Bob quitte, Dave écrit : nouvelle époque, clé signée par une inconnue → demande d'accord.
const d = await account('dave')
const D = await login(d)
await D.page.evaluate(async code => fetch(`/api/servers/join/${code}`, { method: 'POST', credentials: 'include' }), inv.code)
await B.page.evaluate(async id => fetch(`/api/servers/${id}/leave`, { method: 'POST', credentials: 'include' }), srv.id)
await sleep(1500)
await D.page.goto(`${BASE}/servers/${srv.id}/channels/${text.id}`)
await sleep(4000)
const dbox = D.page.locator('textarea, [contenteditable="true"]').first()
await dbox.click(); await dbox.type('Dave ici'); await D.page.keyboard.press('Enter')
await sleep(4000)
await shot(D.page, 'd-channel')
const dDialog = await D.page.locator('[role="alertdialog"]').count()
console.log(JSON.stringify({ dialogueChezDave: dDialog, titre: dDialog ? await D.page.locator('[role="alertdialog"] h2').innerText() : '' }))
// Pages principales (chunks chargés à la demande).
for (const path of ['/settings', '/friends', '/notifications', '/saved', '/explore', '/news', '/ai-engine.html']) {
  await A.page.goto(BASE + path)
  await sleep(2500)
}
await browser.close()
console.log(problems.length ? 'PROBLÈMES:\n' + [...new Set(problems)].join('\n') : 'AUCUNE VIOLATION')
