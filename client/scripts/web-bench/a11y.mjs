// Audit d'accessibilité (audit 2026-10-12, amélioration n° 41) : axe-core (WCAG 2.1 A et AA) sur
// les pages principales, dans Chromium avec la CSP de production. Mêmes prérequis que smoke.mjs :
//   FORGECHAT_TEST_MAILBOX=… PW_MODULE=…/playwright/index.mjs node client/scripts/web-bench/a11y.mjs
// Échoue (code 1) s'il reste une violation « critical » ou « serious ».
import { readdirSync, readFileSync } from 'node:fs'
import { deriveSecrets, newKdfSalt } from '../../src/e2e/authKdf.ts'
const { chromium } = await import(process.env.PW_MODULE ?? 'playwright')

const BASE = 'http://localhost:8099'
const MAILS = process.env.FORGECHAT_TEST_MAILBOX ?? '/tmp/mails'
const PW = 'Phrase de test longue 42!'
const AXE = readFileSync(new URL('../../node_modules/axe-core/axe.min.js', import.meta.url), 'utf8')
const sleep = ms => new Promise(r => setTimeout(r, ms))

async function api(path, body, cookie) {
  const r = await fetch(BASE + '/api' + path, { method: 'POST', headers: { 'content-type': 'application/json', origin: BASE, ...(cookie ? { cookie } : {}) }, body: JSON.stringify(body ?? {}) })
  return { status: r.status, json: await r.json().catch(() => null), cookies: r.headers.getSetCookie?.() ?? [] }
}

const email = `a11y${Date.now()}@test.local`
const salt = newKdfSalt()
const s = await deriveSecrets(PW, salt, 'argon2id')
const seen = new Set(readdirSync(MAILS))
await api('/auth/register', { username: 'a11y' + String(Date.now()).slice(-5), email, auth: s.auth, kdf_salt: salt, kdf: 'argon2id' })
let code
for (let i = 0; i < 50 && !code; i++) {
  for (const f of readdirSync(MAILS)) if (!seen.has(f)) {
    const m = JSON.parse(readFileSync(`${MAILS}/${f}`, 'utf8'))
    if (m.to === email) code = /color:#fff">(\d{6})</.exec(m.body)?.[1]
  }
  if (!code) await sleep(200)
}
await api('/auth/verify-email', { email, code })

const browser = await chromium.launch(process.env.PW_CHROMIUM ? { executablePath: process.env.PW_CHROMIUM } : {})
const page = await (await browser.newContext()).newPage()

async function audit(path) {
  await page.goto(BASE + path)
  await sleep(2500)
  // Injecté par le protocole de débogage (hors CSP), jamais par la page.
  await page.evaluate(AXE)
  return page.evaluate(async () => {
    const r = await window.axe.run(document, { runOnly: { type: 'tag', values: ['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa'] }, resultTypes: ['violations'] })
    return r.violations.map(v => ({ id: v.id, impact: v.impact, help: v.help, n: v.nodes.length, targets: v.nodes.slice(0, 3).map(n => n.target.join(' ')) }))
  })
}

const report = {}
for (const p of ['/login', '/register', '/statut', '/forgot-password']) report[p] = await audit(p)
await page.goto(BASE + '/login')
await page.fill('input[autocomplete="username"]', email)
await page.fill('input[autocomplete="current-password"]', PW)
await page.click('button[type="submit"]')
await page.waitForURL(u => !u.pathname.startsWith('/login'), { timeout: 60000 })
await sleep(3000)
const done = page.getByRole('button', { name: 'Terminé' })
if (await done.count()) { await page.locator('input[type="checkbox"]').first().check(); await done.click(); await sleep(800) }
const skip = page.getByRole('button', { name: 'Passer' })
if (await skip.count()) { await skip.click(); await sleep(500) }
for (const p of ['/friends', '/saved', '/settings?section=security', '/settings?section=notifications', '/settings?section=sessions']) report[p] = await audit(p)
await browser.close()

let blocking = 0
for (const [path, violations] of Object.entries(report)) {
  for (const v of violations) {
    if (v.impact === 'critical' || v.impact === 'serious') blocking++
    console.log(`${path}\t${v.impact}\t${v.id}\t${v.n}\t${v.help}\t${v.targets.join(' | ')}`)
  }
}
console.log(blocking ? `${blocking} violation(s) bloquante(s)` : 'AUCUNE VIOLATION BLOQUANTE')
process.exit(blocking ? 1 : 0)
