// Parcours navigateur « cercle privé » : première inscription (avec l'e-mail administrateur), invitation, inscription par lien,
// refus d'un code déjà utilisé, bannissement depuis le panneau, expulsion en direct, connexion refusée.
// À lancer sur une base NEUVE (instance locale), avec le client servi par `vite --config vite.e2e.config.ts` :
//   BASE=http://localhost:5199 PW_MODULE=/chemin/vers/playwright/index.mjs CHROMIUM=/chemin/chrome node scripts/admin.ui.playwright.mjs
const { chromium } = await import(process.env.PW_MODULE ?? 'playwright')
const BASE = process.env.BASE ?? 'http://localhost:5199'
const PW = 'Mot de passe de test 42!'
const uniq = () => Math.random().toString(36).slice(2, 7)
let failed = 0
const ok = (c, l, x = '') => { console.log(`${c ? '  ✓' : '  ✗'} ${l}${c || !x ? '' : ' — ' + x}`); if (!c) failed++ }
const browser = await chromium.launch({ ...(process.env.CHROMIUM ? { executablePath: process.env.CHROMIUM } : {}), args: ['--no-sandbox'] })
const errors = []
async function ctx() { const c = await browser.newContext({ viewport: { width: 1280, height: 800 } }); await c.addInitScript(() => { try { localStorage.setItem('fc_onboarding_done', '1') } catch {} }); const p = await c.newPage(); p.on('pageerror', e => errors.push(String(e))); return p }

async function dismissRecovery(page) {
  // Écran « code de récupération » affiché une fois après la création de la clé de chiffrement.
  const box = page.locator('input[type="checkbox"]:visible').last()
  const done = page.locator("text=Je l'ai noté en lieu sûr")
  if (await done.waitFor({ timeout: 15000 }).then(() => true, () => false)) {
    await box.check(); await page.click('button:has-text("Terminé")')
    await page.waitForTimeout(500)
  }
}

// 1) Première inscription : pas de champ code, le compte devient admin
const adminName = 'admin' + uniq()
let p = await ctx()
await p.goto(BASE + '/register')
await p.waitForSelector('input[autocomplete="username"]')
ok(await p.locator('input[placeholder="XXXX-XXXX-XXXX"]').count() === 0, 'base neuve : pas de champ code d’invitation')
await p.fill('input[autocomplete="username"]', adminName)
await p.fill('input[type="email"]', process.env.FORGECHAT_ADMIN_EMAIL ?? 'heiphaistos44@gmail.com')
const pw = p.locator('input[autocomplete="new-password"]')
await pw.nth(0).fill(PW); await pw.nth(1).fill(PW)
await p.check('input[type="checkbox"]')
await p.click('button[type="submit"]')
await p.waitForURL(/friends/, { timeout: 15000 }).catch(() => {})
ok(/friends/.test(p.url()), 'inscription du premier compte → connecté', p.url())
await dismissRecovery(p)

// 2) Panneau admin visible dans la barre utilisateur
await p.waitForSelector('button[aria-label="Administration de ForgeChat"]', { timeout: 15000 }).catch(() => {})
ok(await p.locator('button[aria-label="Administration de ForgeChat"]').count() === 1, 'bouton « Administration de ForgeChat » visible pour l’admin')
await p.click('button[aria-label="Administration de ForgeChat"]', { timeout: 5000 })
await p.waitForSelector('text=Administration de ForgeChat', { timeout: 15000 })
await p.screenshot({ path: (process.env.SHOTS ?? '/tmp') + '/1-overview.png' })
ok(await p.locator('text=Connectés maintenant').count() === 1, 'onglet Aperçu : statistiques affichées')

// 3) Passer en mode invitation puis créer une invitation (le lien est copié)
await p.click('role=tab[name="Réglages"]', { timeout: 5000 })
await p.waitForSelector('label:has-text("Sur invitation") input:checked')
ok(true, 'réglages : « sur invitation » est le mode par défaut')
await p.click('role=tab[name="Invitations"]')
await p.fill('input[placeholder="ex. Cousine Léa"]', 'Cousine Léa')
await p.context().grantPermissions(['clipboard-read', 'clipboard-write'], { origin: BASE }).catch(() => {})
await p.click('text=Générer et copier le lien')
await p.waitForSelector('code')
const code = (await p.locator('code').first().innerText()).trim()
ok(/^[A-Z2-9]{4}-[A-Z2-9]{4}-[A-Z2-9]{4}$/.test(code), 'invitation générée', code)
await p.screenshot({ path: (process.env.SHOTS ?? '/tmp') + '/2-invites.png' })

// 4) L'invitée s'inscrit via le lien ?code=
const guestName = 'lea' + uniq()
const g = await ctx()
await g.goto(`${BASE}/register?code=${code}`)
await g.waitForSelector('input[placeholder="XXXX-XXXX-XXXX"]')
ok((await g.inputValue('input[placeholder="XXXX-XXXX-XXXX"]')) === code, 'le lien pré-remplit le code')
await g.fill('input[autocomplete="username"]', guestName)
await g.fill('input[type="email"]', guestName + '@test.local')
const gp = g.locator('input[autocomplete="new-password"]')
await gp.nth(0).fill(PW); await gp.nth(1).fill(PW)
await g.check('input[type="checkbox"]')
await g.click('button[type="submit"]')
await g.waitForURL(/friends/, { timeout: 15000 }).catch(() => {})
ok(/friends/.test(g.url()), 'inscription de l’invitée avec le code → connectée', g.url())
await dismissRecovery(g)
ok(await g.locator('button[aria-label="Administration de ForgeChat"]').count() === 0, 'l’invitée n’a pas le bouton d’administration')
await g.goto(BASE + '/admin/site'); await g.waitForTimeout(2500)
ok(await g.locator('text=Administration de ForgeChat').count() === 0, 'l’invitée ne voit pas la page admin')

// 5) Une 2e personne avec le même code (usage unique) est refusée
const h = await ctx()
await h.goto(`${BASE}/register?code=${code}`)
await h.waitForSelector('input[placeholder="XXXX-XXXX-XXXX"]')
const hn = 'bob' + uniq()
await h.fill('input[autocomplete="username"]', hn); await h.fill('input[type="email"]', hn + '@test.local')
const hp = h.locator('input[autocomplete="new-password"]'); await hp.nth(0).fill(PW); await hp.nth(1).fill(PW)
await h.check('input[type="checkbox"]'); await h.click('button[type="submit"]')
await h.waitForSelector('text=Code d\'invitation invalide', { timeout: 8000 }).catch(() => {})
ok(await h.locator('text=invalide, expiré ou déjà utilisé').count() >= 1, 'code déjà utilisé : message d’erreur affiché')

// 5b) Supervision visible d'un serveur de tiers : il s'ouvre dans l'interface sans invitation
const created = await g.request.post(BASE + '/api/servers', { data: { name: 'Serveur de Léa' } })
const srvId = (await created.json()).id
await p.click('role=tab[name="Serveurs"]')
await p.fill('input[placeholder^="Nom du serveur"]', 'Serveur de Léa')
await p.waitForSelector('text=Serveur de Léa')
await p.screenshot({ path: (process.env.SHOTS ?? '/tmp') + '/5-servers.png' })
await p.click('button:has-text("Superviser")')
await p.waitForURL(new RegExp('/servers/' + srvId), { timeout: 15000 }).catch(() => {})
ok(p.url().includes('/servers/' + srvId), 'supervision : le serveur d’un tiers s’ouvre sans invitation', p.url())
await p.waitForTimeout(2500)
ok(await p.locator('text=Serveur de Léa').count() >= 1, 'supervision : le nom du serveur est affiché')
await p.screenshot({ path: (process.env.SHOTS ?? '/tmp') + '/6-supervised.png' })
await p.click('button[aria-label="Administration de ForgeChat"]')
await p.click('role=tab[name="Serveurs"]')
await p.fill('input[placeholder^="Nom du serveur"]', 'Serveur de Léa')
await p.waitForSelector('span:text-is("SUPERVISÉ")')
await p.click('button:has-text("Terminer")')
await p.waitForSelector('span:text-is("SUPERVISÉ")', { state: 'detached', timeout: 8000 }).catch(() => {})
ok(await p.locator('span:text-is("SUPERVISÉ")').count() === 0, 'supervision terminée depuis le panneau')

// 6) L'admin retrouve l'invitée dans Comptes et la bannit
await p.click('role=tab[name="Comptes"]')
await p.fill('input[placeholder^="Pseudo"]', guestName)
await p.waitForSelector(`text=${guestName}`)
await p.screenshot({ path: (process.env.SHOTS ?? '/tmp') + '/3-users.png' })
ok(await p.locator('text=Cousine Léa').count() >= 1, 'liste des comptes : « invité par » et note de l’invitation')
p.once('dialog', d => d.accept('Test UI'))
await p.click(`button[aria-label="Bannir ${guestName}"]`)
await p.waitForSelector('span:text-is("BANNI")', { timeout: 8000 })
ok(true, 'compte banni depuis le panneau')
await g.waitForURL(/login/, { timeout: 15000 }).catch(() => {})
ok(/login/.test(g.url()), 'l’invitée est expulsée en direct vers l’écran de connexion', g.url())
await g.screenshot({ path: (process.env.SHOTS ?? '/tmp') + '/4-banned-guest.png' })

// 7) Le banni ne peut plus se reconnecter
await g.fill('input[type="email"]', guestName + '@test.local'); await g.fill('input[autocomplete="current-password"]', PW)
await g.click('button[type="submit"]')
await g.waitForSelector('text=suspendu', { timeout: 8000 }).catch(() => {})
ok(await g.locator('text=suspendu').count() >= 1, 'connexion du banni refusée avec message')

ok(errors.length === 0, 'aucune erreur JavaScript dans le navigateur', errors.slice(0, 3).join(' | '))
await browser.close()
console.log(failed ? `\n${failed} échec(s).` : '\nTout est passé.')
process.exit(failed ? 1 : 0)
