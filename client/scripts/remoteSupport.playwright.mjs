// Test LOCAL (sans serveur) du support à distance dans un vrai navigateur : les vraies cartes
// (rs-harness/), cliquées comme un utilisateur. Vérifie qu'« Accepter » et « Ouvrir » donnent
// toujours un retour visible et une issue (appli, visionneuse web ou téléchargement), dans le
// navigateur, dans l'appli de bureau (Tauri simulé) et sur macOS (WKWebView : confirm() = false).
//   PW_MODULE=chemin/vers/node_modules/playwright/index.mjs [PW_EDGE=chemin/edge_playwright.mjs] \
//     node scripts/remoteSupport.playwright.mjs
import { fileURLToPath, pathToFileURL } from 'node:url'
import assert from 'node:assert/strict'
import { realpathSync } from 'node:fs'
import { createServer } from 'vite'

const { chromium } = await import(process.env.PW_MODULE ? pathToFileURL(process.env.PW_MODULE).href : 'playwright')
const launch = process.env.PW_EDGE
  ? (await import(pathToFileURL(process.env.PW_EDGE).href)).edge
  : (c, o) => c.launchPersistentContext('', o)
const client = fileURLToPath(new URL('..', import.meta.url))
const server = await createServer({
  root: client, configFile: fileURLToPath(new URL('../vite.config.ts', import.meta.url)), logLevel: 'warn',
  server: { host: '127.0.0.1', port: 5198, strictPort: true, fs: { allow: [client, realpathSync(`${client}/node_modules`)] } },
  // src/main.tsx monte toute l'appli dans #root : le banc n'en garde que `queryClient`.
  plugins: [{
    name: 'banc-sans-appli', enforce: 'pre',
    resolveId: (id, from) => (id === '../main' && from?.includes('/src/') ? 'virtual:banc-main' : null),
    load: id => (id === 'virtual:banc-main' ? "import { QueryClient } from '@tanstack/react-query'; export const queryClient = new QueryClient()" : null),
  }],
})
await server.listen()

const WIN = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/141.0 Safari/537.36'
const MAC = 'Mozilla/5.0 (Macintosh; Intel Mac OS X 14_5) AppleWebKit/605.1.15 (KHTML, like Gecko)'

/** Page du banc. `tauri` : appli de bureau simulée (GhostHandDesk installé ou non) ; `mac` : confirm() natif muet. */
async function bench({ ua = WIN, tauri = null, mac = false } = {}) {
  const ctx = await launch(chromium, { userAgent: ua })
  const page = ctx.pages()[0] ?? await ctx.newPage()
  const dialogs = []
  page.on('dialog', d => { dialogs.push(d.message()); d.dismiss() })
  page.on('pageerror', e => console.error('[page]', e.message))
  await ctx.route('https://ghd.heiphaistos.org/**', r => r.fulfill({ body: 'ghd' }))
  await page.addInitScript(({ tauri, mac }) => {
    window.calls = []
    if (mac) window.confirm = () => false
    if (tauri) window.__TAURI_INTERNALS__ = {
      transformCallback: () => 0,
      invoke: async (cmd, args) => {
        window.calls.push([cmd, args])
        if (cmd === 'ghd_installed') return tauri.installed
        if (cmd === 'plugin:shell|open' && args.path.startsWith('ghosthanddesk:') && !tauri.installed) throw new Error('no association')
        return null
      },
    }
  }, { tauri, mac })
  await page.goto('http://127.0.0.1:5198/rs-harness/index.html', { waitUntil: 'domcontentloaded', timeout: 90_000 })
  await page.getByText('Support à distance').first().waitFor({ timeout: 90_000 })
  return { ctx, page, dialogs }
}

const shellOpens = page => page.evaluate(() => window.calls.filter(c => c[0] === 'plugin:shell|open').map(c => c[1].path))
const offer = page => page.getByTestId('offer')
const invite = page => page.getByTestId('invite')

/** Accepter une offre d'aide : confirmation dans l'appli, puis panneau hôte. */
async function acceptOffer(page) {
  await offer(page).getByRole('button', { name: 'Accepter' }).click()
  const dlg = page.getByRole('alertdialog')
  await dlg.waitFor({ timeout: 2000 })
  await dlg.getByRole('button', { name: /GhostHandDesk/ }).click()
}

const cases = {
  async 'navigateur Windows : Accepter ouvre GhostHandDesk et propose le téléchargement'() {
    const { ctx, page, dialogs } = await bench()
    await acceptOffer(page)
    const dl = offer(page).getByRole('button', { name: /Télécharger GhostHandDesk/ })
    await dl.waitFor({ timeout: 2000 })
    await offer(page).getByRole('textbox').fill('482 915 036')
    await offer(page).getByRole('button', { name: 'Envoyer la demande' }).click()
    const sent = await page.evaluate(() => window.sent)
    assert.equal(sent.length, 1)
    assert.equal(sent[0].k, 'invite')
    assert.equal(sent[0].id, '482915036')
    assert.match(sent[0].code, /^[0-9A-HJKMNP-TV-Z]{12}$/)
    assert.deepEqual(dialogs, [], 'aucune boîte native (muette sur macOS)')
    await ctx.close()
  },
  async 'navigateur : ouvrir une invitation donne un retour visible'() {
    const { ctx, page, dialogs } = await bench()
    const popup = ctx.waitForEvent('page')
    await invite(page).getByRole('button', { name: 'Ouvrir dans le navigateur' }).click()
    assert.match((await popup).url(), /^https:\/\/ghd\.heiphaistos\.org\/app\/#id=482915036&code=7K2MQ9XR4TVB$/)
    const { page: p2, ctx: c2 } = await bench()
    await invite(p2).getByRole('button', { name: 'Ouvrir dans GhostHandDesk' }).click()
    await p2.getByRole('status').filter({ hasText: /GhostHandDesk/ }).waitFor({ timeout: 2000 })
    assert.deepEqual(dialogs, [])
    await ctx.close(); await c2.close()
  },
  async 'bureau sans GhostHandDesk : erreur visible, téléchargement, visionneuse web en repli'() {
    const { ctx, page } = await bench({ tauri: { installed: false } })
    await acceptOffer(page)
    await page.getByRole('status').filter({ hasText: /pas installé/ }).waitFor({ timeout: 2000 })
    await offer(page).getByRole('button', { name: /Télécharger GhostHandDesk/ }).click()
    // Retour dans ForgeChat après avoir lancé le téléchargement (> 5 s) : nouvelle tentative toute seule.
    const checks = () => page.evaluate(() => window.calls.filter(c => c[0] === 'ghd_installed').length)
    const before = await checks()
    await page.evaluate(() => { const now = Date.now; Date.now = () => now() + 6000; window.dispatchEvent(new Event('focus')) })
    await page.waitForTimeout(200)
    assert.equal(await checks(), before + 1, 'relance automatique au retour')
    await invite(page).getByRole('button', { name: 'Ouvrir dans GhostHandDesk' }).click()
    await page.waitForTimeout(300)
    const opened = await shellOpens(page)
    assert.ok(!opened.some(u => u.startsWith('ghosthanddesk:')), `pas de lien d'appli absente : ${opened}`)
    assert.ok(opened.some(u => /^https:\/\/ghd\.heiphaistos\.org\/download\/.+_portable_x64\.exe$/.test(u)), `téléchargement direct : ${opened}`)
    assert.ok(opened.includes('https://ghd.heiphaistos.org/app/#id=482915036&code=7K2MQ9XR4TVB'), `repli web : ${opened}`)
    await ctx.close()
  },
  async 'bureau avec GhostHandDesk : le lien part vers l\'appli'() {
    const { ctx, page } = await bench({ tauri: { installed: true } })
    await acceptOffer(page)
    await invite(page).getByRole('button', { name: 'Ouvrir dans GhostHandDesk' }).click()
    await page.waitForTimeout(300)
    const opened = await shellOpens(page)
    assert.ok(opened.some(u => /^ghosthanddesk:\/\/share\?code=[0-9A-Z]{12}&ttl=600$/.test(u)), `partage armé : ${opened}`)
    assert.ok(opened.includes('ghosthanddesk://connect?id=482915036&code=7K2MQ9XR4TVB'), `connexion : ${opened}`)
    await ctx.close()
  },
  async 'macOS (bureau) : explication claire, aide possible par le web'() {
    const { ctx, page } = await bench({ ua: MAC, tauri: { installed: false }, mac: true })
    await offer(page).getByRole('button', { name: 'Accepter' }).click()
    await offer(page).getByText(/Windows/).first().waitFor({ timeout: 2000 })
    await invite(page).getByRole('button', { name: 'Ouvrir dans le navigateur' }).click()
    await page.waitForTimeout(300)
    assert.deepEqual(await shellOpens(page), ['https://ghd.heiphaistos.org/app/#id=482915036&code=7K2MQ9XR4TVB'])
    await ctx.close()
  },
}

let failed = 0
for (const [name, run] of Object.entries(cases)) {
  try { await run(); console.log('OK   ', name) } catch (e) { failed++; console.error('ÉCHEC', name, '\n     ', e.message.split('\n')[0]) }
}
await server.close()
process.exit(failed ? 1 : 0)
