// Banc de la protection du compte (audit 2026-10-12, améliorations n° 3, 4, 25) dans Chromium,
// CSP de production + Trusted Types imposés, authentificateur WebAuthn virtuel (CDP).
// Mêmes prérequis que smoke.mjs. Lancer :
//   FORGECHAT_TEST_MAILBOX=… PW_MODULE=…/playwright/index.mjs node client/scripts/web-bench/account-guard.mjs
// Parcours : 2FA activée → connexion web avec un code de secours (19 caractères) → e-mail
// « nouvel appareil » → clé d'accès ajoutée dans Paramètres > Sécurité → connexion avec la clé →
// lien « ce n'est pas moi » → compte verrouillé, connexion refusée.
import { createHmac } from 'node:crypto'
import { readdirSync, readFileSync } from 'node:fs'
import { deriveSecrets, newKdfSalt } from '../../src/e2e/authKdf.ts'
const { chromium } = await import(process.env.PW_MODULE ?? 'playwright')

const BASE = 'http://localhost:8099'
const MAILS = process.env.FORGECHAT_TEST_MAILBOX ?? '/tmp/mails'
const PW = 'Phrase de test longue 42!'
const sleep = ms => new Promise(r => setTimeout(r, ms))
const results = {}
const problems = []

function totp(secret) {
  const alphabet = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567'
  let bits = ''
  for (const ch of secret.replace(/=+$/, '')) bits += alphabet.indexOf(ch).toString(2).padStart(5, '0')
  const key = Buffer.from(bits.match(/.{8}/g).map(b => parseInt(b, 2)))
  const msg = Buffer.alloc(8)
  msg.writeBigUInt64BE(BigInt(Math.floor(Date.now() / 30000)))
  const h = createHmac('sha1', key).update(msg).digest()
  const o = h[h.length - 1] & 15
  return String((h.readUInt32BE(o) & 0x7fffffff) % 1e6).padStart(6, '0')
}

async function api(path, body, cookie) {
  const r = await fetch(BASE + '/api' + path, {
    method: 'POST',
    headers: { 'content-type': 'application/json', origin: BASE, ...(cookie ? { cookie } : {}) },
    body: JSON.stringify(body ?? {}),
  })
  return { status: r.status, json: await r.json().catch(() => null), cookies: r.headers.getSetCookie?.() ?? [] }
}

async function waitMail(to, test, since) {
  for (let i = 0; i < 50; i++) {
    for (const f of readdirSync(MAILS)) if (!since.has(f)) {
      const m = JSON.parse(readFileSync(`${MAILS}/${f}`, 'utf8'))
      if (m.to === to && test(m)) return m
    }
    await sleep(200)
  }
  return null
}

// Compte + 2FA par l'API.
const email = `garde${Date.now()}@test.local`
const salt = newKdfSalt()
const s = await deriveSecrets(PW, salt, 'argon2id')
let seen = new Set(readdirSync(MAILS))
const reg = await api('/auth/register', { username: 'garde' + String(Date.now()).slice(-5), email, auth: s.auth, kdf_salt: salt, kdf: 'argon2id' })
if (reg.status !== 200) throw new Error('register ' + reg.status)
const codeMail = await waitMail(email, m => /color:#fff">\d{6}</.test(m.body), seen)
const v = await api('/auth/verify-email', { email, code: /color:#fff">(\d{6})</.exec(codeMail.body)[1] })
const cookie = v.cookies.map(c => c.split(';')[0]).join('; ')
results.identifiantAppareilRendu = typeof v.json?.device_id === 'string' && v.json.device_id.length === 43
const setup = await api('/auth/2fa/setup', {}, cookie)
const confirm = await api('/auth/2fa/confirm', { code: totp(setup.json.secret) }, cookie)
results.totpActive = confirm.status === 200
const backup = setup.json.backup_codes

const browser = await chromium.launch(process.env.PW_CHROMIUM ? { executablePath: process.env.PW_CHROMIUM } : {})
const ctx = await browser.newContext()
const page = await ctx.newPage()
page.on('console', m => { if (m.type() === 'error' && /Content Security Policy|Trusted Type|TrustedHTML|TrustedScript/i.test(m.text())) problems.push(`console: ${m.text().slice(0, 300)}`) })
page.on('pageerror', e => problems.push(`pageerror: ${e.message.slice(0, 300)}`))
await page.addInitScript(() => {
  document.addEventListener('securitypolicyviolation', e => console.error(`Content Security Policy violation: ${e.violatedDirective} ${e.blockedURI} ${e.sourceFile}:${e.lineNumber}`))
})
const cdp = await ctx.newCDPSession(page)
await cdp.send('WebAuthn.enable')
await cdp.send('WebAuthn.addVirtualAuthenticator', {
  options: { protocol: 'ctap2', transport: 'internal', hasResidentKey: true, hasUserVerification: true, isUserVerified: true, automaticPresenceSimulation: true },
})

async function closeDialogs() {
  await sleep(3000)
  const done = page.getByRole('button', { name: 'Terminé' })
  if (await done.count()) { await page.locator('input[type="checkbox"]').first().check(); await done.click(); await sleep(800) }
  const skip = page.getByRole('button', { name: 'Passer' })
  if (await skip.count()) { await skip.click(); await sleep(500) }
}

async function loginForm() {
  await page.goto(BASE + '/login')
  await page.fill('input[autocomplete="username"]', email)
  await page.fill('input[autocomplete="current-password"]', PW)
  await page.click('button[type="submit"]')
  await page.waitForSelector('input[autocomplete="one-time-code"]', { timeout: 60000 })
}

// 1. Connexion avec un code de secours complet (19 caractères), depuis un nouvel appareil.
seen = new Set(readdirSync(MAILS))
await loginForm()
results.boutonCleAvantEnregistrement = await page.getByRole('button', { name: 'Utiliser ma clé d’accès' }).count()
await page.fill('input[autocomplete="one-time-code"]', backup[0])
await page.click('button[type="submit"]')
await page.waitForURL(u => !u.pathname.startsWith('/login'), { timeout: 60000 })
results.connexionCodeDeSecours = true
const deviceMail = await waitMail(email, m => /Nouvelle connexion/.test(m.subject ?? m.body), seen)
results.emailNouvelAppareil = !!deviceMail
const lockLink = deviceMail && /href="([^"]*\/verrouiller#token=[^"]+)"/.exec(deviceMail.body)?.[1]
results.lienVerrouillageDansEmail = !!lockLink
const deviceCookie = (await ctx.cookies()).find(c => c.name === 'fc_device')
results.cookieAppareilHttpOnly = !!deviceCookie?.httpOnly
await closeDialogs()

// 2. Clé d'accès ajoutée dans Paramètres > Sécurité.
page.on('dialog', d => d.type() === 'prompt' ? d.accept('Clé virtuelle') : d.accept())
await page.goto(BASE + '/settings?section=security')
await page.getByRole('button', { name: 'Ajouter une clé d’accès' }).click()
await page.getByText('Clé virtuelle').waitFor({ timeout: 15000 })
results.cleEnregistree = true

// 3. Déconnexion locale (cookies de session effacés, appareil gardé), connexion avec la clé.
const keep = (await ctx.cookies()).filter(c => c.name === 'fc_device')
await ctx.clearCookies()
await ctx.addCookies(keep)
seen = new Set(readdirSync(MAILS))
await loginForm()
const btn = page.getByRole('button', { name: 'Utiliser ma clé d’accès' })
results.boutonCle = await btn.count()
await btn.click()
await page.waitForURL(u => !u.pathname.startsWith('/login'), { timeout: 60000 })
results.connexionAvecCle = true
await sleep(1500)
results.pasDeNouvelEmailMemeAppareil = !(await waitMail(email, m => /Nouvelle connexion/.test(m.subject ?? m.body), seen))

// 4. « Ce n'est pas moi » : verrouillage par le lien, puis connexion refusée.
await page.goto(lockLink.replace(/^https?:\/\/[^/]+/, BASE))
await page.getByText('Compte verrouillé. Toutes les sessions sont fermées.').waitFor({ timeout: 15000 })
results.verrouille = true
results.jetonRetireDeLAdresse = !page.url().includes('token=')
const again = await api('/auth/login', { email, auth: s.auth, totp_code: backup[1] })
results.connexionRefuseeApresVerrou = again.status === 403 && /verrouillé/.test(again.json?.error ?? '')

await browser.close()
console.log(JSON.stringify(results, null, 1))
console.log(problems.length ? 'PROBLÈMES:\n' + [...new Set(problems)].join('\n') : 'AUCUNE VIOLATION')
